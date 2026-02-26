"""Re-exported smolagents tools for convenience."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from smolagents import (
    DuckDuckGoSearchTool,
    PythonInterpreterTool,
    VisitWebpageTool,
    WikipediaSearchTool,
)
from smolagents.tools import Tool

logger = logging.getLogger(__name__)

__all__ = [
    "AskUserTool",
    "DuckDuckGoSearchTool",
    "KnowledgeBaseTool",
    "PythonInterpreterTool",
    "VisitWebpageTool",
    "WebTool",
    "WikipediaSearchTool",
    "resolve_tools",
]


class AskUserTool(Tool):
    """Ask the user a clarifying question via voice.

    Unlike smolagents' built-in UserInputTool (which calls input()),
    this returns the question as the final answer so it gets spoken
    aloud by TTS. The user's reply comes back as the next voice turn.
    """

    name = "ask_user"
    description = (
        "Ask the user a clarifying question. Use this when you need more "
        "information to answer properly. The question will be spoken aloud."
    )
    inputs = {
        "question": {
            "type": "string",
            "description": "The question to ask the user.",
        }
    }
    output_type = "string"

    def forward(self, question: str) -> str:
        return question


class WebTool(Tool):
    """Base class for tools that make HTTP requests.

    Handles timeouts, error handling, retries, and JSON parsing so
    subclasses can focus on business logic.

    Subclasses should call :meth:`fetch` or :meth:`fetch_text` in their
    ``forward()`` method instead of making HTTP requests directly.

    Args:
        timeout: Default request timeout in seconds.
        retries: Number of retry attempts on transient failures.

    Example::

        from aai_agent import WebTool

        class CheckWeather(WebTool):
            name = "check_weather"
            description = "Check the current weather."
            inputs = {"city": {"type": "string", "description": "City name."}}
            output_type = "string"

            def forward(self, city: str) -> str:
                data = self.fetch(f"https://api.weather.com/{city}")
                if isinstance(data, str):
                    return data  # error message
                return f"Temperature: {data['temp']}"
    """

    _default_timeout: float = 10.0
    _default_retries: int = 1

    def __init__(
        self,
        *,
        timeout: float | None = None,
        retries: int | None = None,
        **kwargs: Any,
    ):
        self._timeout = timeout or self._default_timeout
        self._retries = retries or self._default_retries
        self._http = httpx.Client(timeout=self._timeout)
        super().__init__(**kwargs)

    def fetch(
        self,
        url: str,
        method: str = "GET",
        **kwargs: Any,
    ) -> dict | list | str:
        """Make an HTTP request and return parsed JSON.

        Returns the parsed JSON response on success, or an error message
        string on failure. Callers should check ``isinstance(result, str)``
        to detect errors.

        Args:
            url: The URL to request.
            method: HTTP method (GET, POST, etc.).
            **kwargs: Passed through to ``httpx.Client.request`` (e.g.
                ``json``, ``headers``, ``params``).

        Returns:
            Parsed JSON (dict or list) on success, or an error string.
        """
        last_error = ""
        for attempt in range(1, self._retries + 1):
            try:
                resp = self._http.request(method, url, **kwargs)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as exc:
                last_error = (
                    f"HTTP {exc.response.status_code}: {exc.response.reason_phrase}"
                )
                if exc.response.status_code < 500:
                    break  # don't retry client errors
            except httpx.ConnectError:
                last_error = f"Could not connect to {url}"
            except httpx.TimeoutException:
                last_error = f"Request to {url} timed out"
            except ValueError:
                last_error = "Response was not valid JSON"
            except Exception as exc:
                last_error = str(exc)
                break

            if attempt < self._retries:
                logger.debug("Retrying %s %s (attempt %d)", method, url, attempt + 1)

        return f"Error: {last_error}"

    def fetch_text(
        self,
        url: str,
        method: str = "GET",
        **kwargs: Any,
    ) -> str:
        """Make an HTTP request and return the response body as text.

        Args:
            url: The URL to request.
            method: HTTP method.
            **kwargs: Passed through to ``httpx.Client.request``.

        Returns:
            Response text on success, or an error string prefixed with "Error:".
        """
        try:
            resp = self._http.request(method, url, **kwargs)
            resp.raise_for_status()
            return resp.text
        except Exception as exc:
            return f"Error: {exc}"


class KnowledgeBaseTool(Tool):
    """Semantic search over a ChromaDB collection.

    Wraps a persisted ChromaDB vector store so the agent can retrieve
    relevant passages at query time. The embedding model and DB
    connection are handled automatically.

    Args:
        name: Tool name the LLM will use to invoke this tool.
        description: Human-readable description shown to the LLM.
        path: Path to the persisted ChromaDB directory.
        collection_name: Name of the collection inside the DB.
        n_results: Number of results to return per query.
        embedding_model: Sentence-transformer model name for embeddings.
            Defaults to ``multi-qa-MiniLM-L6-cos-v1`` which is optimized
            for question-answering retrieval.

    Example::

        from aai_agent import KnowledgeBaseTool

        docs_tool = KnowledgeBaseTool(
            name="search_docs",
            path="./chroma_db",
            collection_name="my_docs",
            description="Search the documentation for answers.",
        )
    """

    DEFAULT_EMBEDDING_MODEL = "multi-qa-MiniLM-L6-cos-v1"

    inputs = {
        "query": {
            "type": "string",
            "description": "The search query.",
        }
    }
    output_type = "string"

    def __init__(
        self,
        *,
        name: str,
        description: str,
        path: str,
        collection_name: str,
        n_results: int = 5,
        embedding_model: str | None = None,
    ):
        try:
            import chromadb
            from chromadb.utils import embedding_functions
        except ImportError as exc:
            raise ImportError(
                "chromadb is required for KnowledgeBaseTool. "
                "Install it with: pip install chromadb"
            ) from exc

        self.name = name
        self.description = description
        self._n_results = n_results

        model = embedding_model or self.DEFAULT_EMBEDDING_MODEL
        client = chromadb.PersistentClient(path=path)
        ef = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=model,
        )
        self._collection = client.get_collection(
            name=collection_name,
            embedding_function=ef,  # type: ignore[arg-type]
        )

        super().__init__()

    def forward(self, query: str) -> str:
        results = self._collection.query(query_texts=[query], n_results=self._n_results)
        if not results["documents"] or not results["documents"][0]:
            return "No relevant results found."

        passages = []
        for i, doc in enumerate(results["documents"][0], 1):
            section = ""
            if results["metadatas"] and results["metadatas"][0]:
                section = results["metadatas"][0][i - 1].get("section", "")
            header = f"[{section}]" if section else ""
            passages.append(f"--- Result {i} {header} ---\n{doc}")

        return "\n\n".join(passages)


TOOL_REGISTRY = {
    "AskUserTool": AskUserTool,
    "DuckDuckGoSearchTool": lambda: DuckDuckGoSearchTool(max_results=3),
    "VisitWebpageTool": VisitWebpageTool,
    "WikipediaSearchTool": WikipediaSearchTool,
    "PythonInterpreterTool": PythonInterpreterTool,
}


def resolve_tools(tools: list[Tool | str]) -> list[Tool]:
    """Resolve a mixed list of tool instances and string names into tool instances.

    Strings are looked up in the built-in tool registry. Tool instances are
    passed through unchanged.

    Args:
        tools: List of tool instances or string names (e.g. "DuckDuckGoSearchTool").

    Returns:
        List of instantiated tool objects.
    """
    resolved: list[Tool] = []
    for tool in tools:
        if isinstance(tool, str):
            factory = TOOL_REGISTRY.get(tool)
            if factory is None:
                raise ValueError(
                    f"Unknown tool: {tool!r}. Available: {', '.join(TOOL_REGISTRY)}"
                )
            resolved.append(factory())
        else:
            resolved.append(tool)
    return resolved
