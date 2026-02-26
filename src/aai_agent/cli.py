"""aai-agent CLI — scaffold and manage voice agent projects."""

import shutil
from pathlib import Path

import typer

app = typer.Typer(
    name="aai-agent",
    add_completion=False,
)

TEMPLATE_DIR = Path(__file__).parent / "_template"


@app.callback()
def callback():
    """Voice agent SDK powered by AssemblyAI, Rime TTS, and smolagents."""


@app.command()
def init(
    directory: str = typer.Argument(
        ".", help="Target directory (defaults to current directory)"
    ),
    force: bool = typer.Option(False, "--force", "-f", help="Overwrite existing files"),
):
    """Scaffold a new voice agent project.

    Copies a ready-to-run server, .env template, and static frontend
    into the target directory.
    """
    target = Path(directory).resolve()

    if not force:
        existing = [
            item.name
            for item in TEMPLATE_DIR.iterdir()
            if (target / item.name).exists()
        ]
        if existing:
            typer.echo(f"Files already exist: {', '.join(existing)}")
            typer.echo("Use --force to overwrite.")
            raise typer.Exit(1)

    target.mkdir(parents=True, exist_ok=True)

    for item in TEMPLATE_DIR.iterdir():
        dest = target / item.name
        if item.is_dir():
            shutil.copytree(item, dest, dirs_exist_ok=True)
        else:
            shutil.copy2(item, dest)

    # Prepend the SDK dependency in requirements.txt
    req_file = target / "requirements.txt"
    original = req_file.read_text()
    req_file.write_text(
        "aai-agent[fastapi] @ git+https://github.com/alexkroman/aai-agent.git\n"
        + original
    )

    rel = directory if directory != "." else target.name
    typer.echo(f"Initialized voice agent project in {target}")
    typer.echo()
    typer.echo("Next steps:")
    typer.echo(f"  cd {rel}")
    typer.echo("  cp .env.example .env   # add your API keys")
    typer.echo("  uv venv && source .venv/bin/activate")
    typer.echo("  uv pip install -r requirements.txt")
    typer.echo("  aai-agent start")


@app.command()
def start(
    server: str = typer.Option(
        "server:app", "--server", "-s", help="Uvicorn app import string"
    ),
    host: str = typer.Option("", "--host", "-h", help="Bind host"),
    port: int = typer.Option(0, "--port", "-p", help="Bind port"),
    reload: bool = typer.Option(False, help="Enable auto-reload"),
    prod: bool = typer.Option(
        False, "--prod", help="Production mode (0.0.0.0, no reload)"
    ),
):
    """Start the voice agent server.

    In production mode (--prod or when FLY_APP_NAME / PORT env vars are
    detected), defaults to host 0.0.0.0 and reload disabled.
    Otherwise defaults to localhost:8000 with auto-reload.
    """
    import os
    import sys

    import uvicorn

    # Auto-detect production environment
    is_prod = (
        prod or os.environ.get("FLY_APP_NAME") or os.environ.get("RAILWAY_ENVIRONMENT")
    )

    if not host:
        host = "0.0.0.0" if is_prod else "localhost"
    if not port:
        port = int(os.environ.get("PORT", 8000))
    if not prod and not reload:
        # No explicit flags: default reload on for dev, off for prod
        reload = not is_prod

    # Ensure the current directory is importable so uvicorn can find server.py
    cwd = str(Path.cwd())
    if cwd not in sys.path:
        sys.path.insert(0, cwd)

    typer.echo(f"Starting server at http://{host}:{port}")
    uvicorn.run(server, host=host, port=port, reload=reload)


# ---------------------------------------------------------------------------
# Deploy command
# ---------------------------------------------------------------------------


def _detect_project(cwd: Path) -> dict:
    """Detect the project structure to generate appropriate deploy files."""
    return {
        "has_pyproject": (cwd / "pyproject.toml").exists(),
        "has_requirements": (cwd / "requirements.txt").exists(),
        "has_uv_lock": (cwd / "uv.lock").exists(),
        "has_index_docs": (cwd / "index_docs.py").exists(),
        "has_chroma_db": (cwd / "chroma_db").is_dir(),
        "has_static": (cwd / "static").is_dir(),
    }


def _generate_dockerfile(project: dict, port: int) -> str:
    """Generate a Dockerfile based on the detected project structure."""
    lines = [
        "FROM python:3.11-slim",
        "",
        "RUN apt-get update && apt-get install -y --no-install-recommends \\",
        "    build-essential \\",
        "    git \\",
        "    && rm -rf /var/lib/apt/lists/*",
        "",
        "COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/",
        "",
        "WORKDIR /app",
        "",
    ]

    # Install CPU-only PyTorch first to avoid pulling ~4GB of CUDA libraries
    lines += [
        "# Install CPU-only PyTorch first (prevents ~4GB of CUDA libraries)",
        "RUN uv pip install --system --no-cache \\",
        "    torch --index-url https://download.pytorch.org/whl/cpu",
        "",
    ]

    # Dependency install step
    if project["has_pyproject"]:
        lines += [
            "COPY pyproject.toml ./",
            "RUN uv pip install --system --no-cache .",
            "",
        ]
    elif project["has_requirements"]:
        lines += [
            "COPY requirements.txt ./",
            "RUN uv pip install --system --no-cache -r requirements.txt",
            "",
        ]
    else:
        typer.echo("Warning: No pyproject.toml or requirements.txt found.")
        lines += [
            "# TODO: Add your dependency install step here",
            "",
        ]

    # Copy source files
    lines.append("COPY . .")
    lines.append("")

    # If index_docs.py exists, run it; otherwise use aai-agent index if chroma_db is .dockerignored
    if project["has_index_docs"]:
        lines += [
            "# Build the knowledge base index",
            "RUN python index_docs.py",
            "",
        ]
    elif project.get("has_chroma_db"):
        lines += [
            "# Build the knowledge base index",
            "# TODO: replace URL and collection name with your own",
            "RUN aai-agent index \\",
            "    --url https://example.com/docs/llms-full.txt \\",
            "    --db ./chroma_db \\",
            "    --collection knowledge_base",
            "",
        ]

    lines += [
        f"EXPOSE {port}",
        "",
        f"ENV PORT={port}",
        "",
        'CMD ["aai-agent", "start", "--prod"]',
        "",
    ]

    return "\n".join(lines)


def _generate_fly_toml(app_name: str, port: int) -> str:
    """Generate a fly.toml configuration."""
    return f"""\
app = '{app_name}'
primary_region = 'iad'

[build]

[http_service]
  internal_port = {port}
  force_https = true
  auto_stop_machines = 'suspend'
  auto_start_machines = true
  min_machines_running = 1
  max_machines_running = 1

[[http_service.checks]]
  grace_period = "120s"
  interval = "30s"
  method = "GET"
  timeout = "5s"
  path = "/health"

[[vm]]
  memory = '2gb'
  cpu_kind = 'shared'
  cpus = 2
"""


_DOCKERIGNORE = """\
.venv/
.git/
.env
chroma_db/
__pycache__/
*.pyc
*.egg-info/
"""


@app.command()
def deploy(
    app_name: str = typer.Option(
        "",
        "--app",
        "-a",
        help="Fly.io app name (default: current directory name)",
    ),
    port: int = typer.Option(80, "--port", "-p", help="Server port"),
    force: bool = typer.Option(
        False, "--force", "-f", help="Overwrite existing deploy files"
    ),
):
    """Generate Fly.io deployment files (Dockerfile, fly.toml, .dockerignore)."""
    cwd = Path.cwd()
    app_name = app_name or cwd.name

    files = {
        "Dockerfile": None,
        "fly.toml": None,
        ".dockerignore": None,
    }

    if not force:
        existing = [name for name in files if (cwd / name).exists()]
        if existing:
            typer.echo(f"Files already exist: {', '.join(existing)}")
            typer.echo("Use --force to overwrite.")
            raise typer.Exit(1)

    project = _detect_project(cwd)

    # Generate and write files
    (cwd / "Dockerfile").write_text(_generate_dockerfile(project, port))
    (cwd / "fly.toml").write_text(_generate_fly_toml(app_name, port))
    (cwd / ".dockerignore").write_text(_DOCKERIGNORE)

    typer.echo("Generated deployment files for Fly.io:")
    typer.echo("  Dockerfile")
    typer.echo(f"  fly.toml (app: {app_name})")
    typer.echo("  .dockerignore")
    typer.echo()
    typer.echo("Next steps:")
    typer.echo("  flyctl auth login")
    typer.echo(f"  flyctl apps create {app_name}")
    typer.echo("  flyctl secrets set ASSEMBLYAI_API_KEY=... RIME_API_KEY=...")
    typer.echo("  flyctl deploy")


# ---------------------------------------------------------------------------
# Index command
# ---------------------------------------------------------------------------


@app.command()
def index(
    url: str = typer.Option(
        ...,
        "--url",
        "-u",
        help="URL to fetch and index (plain text or llms-full.txt format)",
    ),
    db: str = typer.Option(
        "./chroma_db", "--db", "-d", help="Path to ChromaDB directory"
    ),
    collection: str = typer.Option(
        "knowledge_base", "--collection", "-c", help="Collection name"
    ),
    chunk_size: int = typer.Option(
        800, "--chunk-size", help="Target characters per chunk"
    ),
):
    """Fetch a URL and index its content into ChromaDB for KnowledgeBaseTool."""
    import logging

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from .indexer import KnowledgeBaseIndexer

    indexer = KnowledgeBaseIndexer(
        path=db,
        collection_name=collection,
        chunk_size=chunk_size,
    )

    count = indexer.index_url(url)
    typer.echo(f"Done! Indexed {count} chunks into '{collection}' at {db}")
