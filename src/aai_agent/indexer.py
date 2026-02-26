"""Knowledge base indexer for building ChromaDB collections from documents."""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

DEFAULT_COLLECTION_NAME = "knowledge_base"
DEFAULT_CHUNK_SIZE = 800
DEFAULT_CHUNK_OVERLAP_SENTENCES = 2
DEFAULT_EMBEDDING_MODEL = "multi-qa-MiniLM-L6-cos-v1"


# ---------------------------------------------------------------------------
# Text cleaning
# ---------------------------------------------------------------------------

def _table_to_prose(match: re.Match) -> str:
    """Convert a markdown table into natural-language sentences."""
    lines = match.group(0).strip().split("\n")
    header_line = lines[0]
    headers = [h.strip() for h in header_line.strip("|").split("|")]
    headers = [h for h in headers if h and not re.match(r"^[-:]+$", h)]
    if not headers:
        return match.group(0)

    prose_lines = []
    for line in lines[2:]:
        cells = [c.strip() for c in line.strip("|").split("|")]
        cells = [c for c in cells if c]
        if len(cells) != len(headers) or re.match(r"^[-:]+$", cells[0]):
            continue
        parts = [f"{headers[i]}: {cells[i]}" for i in range(len(cells)) if cells[i]]
        prose_lines.append(". ".join(parts) + ".")

    return "\n".join(prose_lines) if prose_lines else match.group(0)


def clean_text(text: str) -> str:
    """Clean document text for RAG indexing.

    Strips HTML/JSX, markdown images, link syntax, URLs, YAML metadata,
    and converts tables to prose.
    """
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\{[^}]{0,200}\}", " ", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"^'[^']+':.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^(#{1,4})\s+title:\s*", r"\1 ", text, flags=re.MULTILINE)
    text = re.sub(
        r"(?:^\|.+\|[ ]*\n){2,}", _table_to_prose, text, flags=re.MULTILINE,
    )
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def _split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z\n])", text)
    return [s.strip() for s in parts if s.strip()]


def _is_faq_title(title: str) -> bool:
    return bool(
        title
        and (
            "?" in title
            or title.lower().startswith(
                ("how ", "what ", "can ", "do ", "does ", "is ", "why ", "when ", "where ")
            )
        )
    )


def chunk_text(
    text: str,
    *,
    section: str = "",
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap_sentences: int = DEFAULT_CHUNK_OVERLAP_SENTENCES,
) -> list[dict]:
    """Split text into retrieval-sized chunks with metadata.

    Args:
        text: The text to chunk.
        section: Section name for metadata.
        chunk_size: Target characters per chunk.
        overlap_sentences: Number of sentences to overlap between chunks.

    Returns:
        List of dicts with ``text`` and ``section`` keys.
    """
    cleaned = clean_text(text)
    if not cleaned:
        return []

    # Split into sub-sections by markdown headers
    sections: list[dict] = []
    lines = cleaned.split("\n")
    current_section = section
    current_lines: list[str] = []

    for line in lines:
        header_match = re.match(r"^#{1,4}\s+(.+)", line)
        if header_match:
            if current_lines:
                body = "\n".join(current_lines).strip()
                if body:
                    sections.append({"sub_title": current_section, "text": body})
            current_section = header_match.group(1).strip()
            current_lines = []
            if _is_faq_title(current_section):
                current_lines.append(current_section)
        else:
            current_lines.append(line)

    if current_lines:
        body = "\n".join(current_lines).strip()
        if body:
            sections.append({"sub_title": current_section, "text": body})

    if not sections:
        sections = [{"sub_title": section, "text": cleaned}]

    all_chunks = []
    for sect in sections:
        sub_title = sect["sub_title"]
        section_text = sect["text"]

        # Filter out pure-code sections
        prose = re.sub(r"```[\s\S]*?```", "", section_text)
        prose = re.sub(r"`[^`]+`", "", prose)
        if len(re.sub(r"[^a-zA-Z]", "", prose)) < 30:
            continue

        prefix = f"[{sub_title}]\n" if sub_title else ""
        sentences = _split_sentences(section_text)
        if not sentences:
            continue

        chunks: list[str] = []
        current_chunk = prefix
        current_sents: list[str] = []

        for sentence in sentences:
            test = current_chunk + (" " if current_chunk.strip() else "") + sentence
            if len(test) > chunk_size and current_sents:
                chunks.append(current_chunk.strip())
                overlap = current_sents[-overlap_sentences:]
                current_chunk = prefix + " ".join(overlap) + " " + sentence
                current_sents = overlap + [sentence]
            else:
                current_chunk = test
                current_sents.append(sentence)

        if current_chunk.strip() and current_chunk.strip() != prefix.strip():
            chunks.append(current_chunk.strip())

        for chunk_text_str in chunks:
            all_chunks.append({"text": chunk_text_str, "section": sub_title or section})

    # Split oversized chunks
    max_len = chunk_size * 2
    final: list[dict] = []
    queue = list(all_chunks)
    while queue:
        chunk = queue.pop(0)
        if len(chunk["text"]) > max_len:
            t = chunk["text"]
            mid = len(t) // 2
            sp = t.rfind(". ", 0, mid + 200)
            if sp == -1 or sp < 100:
                sp = t.rfind("\n", 0, mid + 200)
            if sp == -1 or sp < 100:
                sp = mid
            else:
                sp += 1
            queue.insert(0, {"text": t[sp:].strip(), "section": chunk["section"]})
            queue.insert(0, {"text": t[:sp].strip(), "section": chunk["section"]})
        else:
            final.append(chunk)

    # Filter very small chunks (unless FAQ)
    final = [c for c in final if len(c["text"]) >= 80 or _is_faq_title(c["section"])]
    return final


# ---------------------------------------------------------------------------
# Fetching llms-full.txt
# ---------------------------------------------------------------------------

def _split_llms_full(text: str) -> list[dict]:
    """Split an llms-full.txt document into per-page dicts."""
    raw_pages = re.split(r"\n\*{3}\s*\n", text)
    pages = []
    for raw in raw_pages:
        raw = raw.strip()
        if not raw:
            continue
        title_match = re.search(r"^title:\s*(.+)$", raw, re.MULTILINE)
        if not title_match:
            title_match = re.search(r"^#{1,4}\s+(?:title:\s*)?(.+)$", raw, re.MULTILINE)
        page_title = title_match.group(1).strip() if title_match else ""

        body = re.sub(
            r"^---\s*\n.*?\n---\s*\n?", "", raw, flags=re.DOTALL | re.MULTILINE,
        )
        body = re.sub(
            r"^(title|layout|hide-feedback|hide-nav-links|subtitle|description"
            r"|'[^']+'):.*$",
            "", body, flags=re.MULTILINE,
        )
        body = re.sub(r"^-{20,}\s*$", "", body, flags=re.MULTILINE)
        body = body.strip()
        if body:
            pages.append({"title": page_title, "body": body})
    return pages


# ---------------------------------------------------------------------------
# KnowledgeBaseIndexer
# ---------------------------------------------------------------------------

class KnowledgeBaseIndexer:
    """Build and populate a ChromaDB collection for use with KnowledgeBaseTool.

    Args:
        path: Path to the ChromaDB directory.
        collection_name: Name for the collection.
        embedding_model: Sentence-transformer model name.
        chunk_size: Target characters per chunk.
        chunk_overlap_sentences: Sentence overlap between chunks.

    Example::

        from aai_agent import KnowledgeBaseIndexer

        indexer = KnowledgeBaseIndexer(path="./chroma_db", collection_name="docs")
        indexer.index_url("https://example.com/docs/llms-full.txt")
    """

    def __init__(
        self,
        *,
        path: str = "./chroma_db",
        collection_name: str = DEFAULT_COLLECTION_NAME,
        embedding_model: str = DEFAULT_EMBEDDING_MODEL,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap_sentences: int = DEFAULT_CHUNK_OVERLAP_SENTENCES,
    ):
        try:
            import chromadb
            from chromadb.utils import embedding_functions
        except ImportError as exc:
            raise ImportError(
                "chromadb and sentence-transformers are required for indexing. "
                "Install them with: pip install aai-agent[knowledge]"
            ) from exc

        self._path = path
        self._collection_name = collection_name
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap_sentences

        self._client = chromadb.PersistentClient(path=path)
        self._ef = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=embedding_model,
        )

    def _get_or_recreate_collection(self):
        """Delete existing collection if present, then create a fresh one."""
        existing = [c.name for c in self._client.list_collections()]
        if self._collection_name in existing:
            self._client.delete_collection(self._collection_name)
            logger.info("Deleted existing '%s' collection", self._collection_name)

        return self._client.create_collection(
            name=self._collection_name,
            embedding_function=self._ef,  # type: ignore[arg-type]
        )

    def _add_chunks(self, collection, chunks: list[dict]) -> None:
        """Batch-add chunks to a collection."""
        ids = [f"chunk_{i}" for i in range(len(chunks))]
        documents = [c["text"] for c in chunks]
        metadatas = [
            {"section": c.get("section", ""), "chunk_index": i}
            for i, c in enumerate(chunks)
        ]

        batch_size = 500
        for start in range(0, len(ids), batch_size):
            end = start + batch_size
            collection.add(
                ids=ids[start:end],
                documents=documents[start:end],
                metadatas=metadatas[start:end],  # type: ignore[arg-type]
            )
            logger.info("Indexed chunks %d-%d", start, min(end, len(ids)) - 1)

    def index_url(self, url: str) -> int:
        """Fetch a URL (plain text or llms-full.txt format) and index its content.

        If the text contains ``***`` page separators (llms-full.txt format),
        each page is chunked separately with its title as context.
        Otherwise the entire text is chunked as a single document.

        Args:
            url: URL to fetch.

        Returns:
            Number of chunks indexed.
        """
        import httpx

        logger.info("Downloading %s", url)
        resp = httpx.get(url, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        text = resp.text
        logger.info("Downloaded %d characters", len(text))

        return self.index_text(text)

    def index_text(self, text: str) -> int:
        """Index a single document (plain text or llms-full.txt format).

        Args:
            text: Document text.

        Returns:
            Number of chunks indexed.
        """
        # Detect llms-full.txt format (pages separated by ***)
        if "\n***\n" in text:
            pages = _split_llms_full(text)
            logger.info("Split into %d pages", len(pages))
            all_chunks: list[dict] = []
            for page in pages:
                page_chunks = chunk_text(
                    page["body"],
                    section=page["title"],
                    chunk_size=self._chunk_size,
                    overlap_sentences=self._chunk_overlap,
                )
                all_chunks.extend(page_chunks)
        else:
            all_chunks = chunk_text(
                text,
                chunk_size=self._chunk_size,
                overlap_sentences=self._chunk_overlap,
            )

        if not all_chunks:
            logger.warning("No chunks produced from input")
            return 0

        collection = self._get_or_recreate_collection()
        self._add_chunks(collection, all_chunks)
        logger.info(
            "Indexed %d chunks into '%s' at %s",
            len(all_chunks), self._collection_name, self._path,
        )
        return len(all_chunks)

    def index_texts(
        self,
        texts: list[str],
        *,
        metadatas: list[dict] | None = None,
    ) -> int:
        """Index pre-chunked texts directly (no splitting).

        Args:
            texts: List of text chunks to index.
            metadatas: Optional metadata dicts for each chunk.

        Returns:
            Number of chunks indexed.
        """
        if not texts:
            return 0

        collection = self._get_or_recreate_collection()
        ids = [f"chunk_{i}" for i in range(len(texts))]
        metas = metadatas or [{"chunk_index": i} for i in range(len(texts))]

        batch_size = 500
        for start in range(0, len(ids), batch_size):
            end = start + batch_size
            collection.add(
                ids=ids[start:end],
                documents=texts[start:end],
                metadatas=metas[start:end],  # type: ignore[arg-type]
            )

        logger.info(
            "Indexed %d texts into '%s' at %s",
            len(texts), self._collection_name, self._path,
        )
        return len(texts)
