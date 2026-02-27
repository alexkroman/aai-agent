"""aai-agent CLI — scaffold and manage voice agent projects."""

import shutil
from pathlib import Path

import typer

app = typer.Typer(
    name="aai-agent",
    add_completion=False,
)

TEMPLATE_DIR = Path(__file__).parent / "_template"

# Files/dirs that should never be copied from the template directory.
_TEMPLATE_IGNORE = {"__pycache__", ".venv", ".env"}


@app.callback()
def callback():
    """Voice agent SDK powered by AssemblyAI, Rime TTS, and smolagents."""


def _scaffold(directory: str, *, force: bool) -> None:
    """Shared implementation for the ``new`` command."""
    target = Path(directory).resolve()

    template_items = [
        item for item in TEMPLATE_DIR.iterdir() if item.name not in _TEMPLATE_IGNORE
    ]

    if not force:
        existing = [
            item.name for item in template_items if (target / item.name).exists()
        ]
        if existing:
            typer.echo(f"Files already exist: {', '.join(existing)}")
            typer.echo("Use --force to overwrite.")
            raise typer.Exit(1)

    target.mkdir(parents=True, exist_ok=True)

    for item in template_items:
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
    typer.echo(f"Created voice agent project in {target}")
    typer.echo()
    typer.echo("Next steps:")
    typer.echo(f"  cd {rel}")
    typer.echo("  cp .env.example .env   # add your API keys")
    typer.echo("  uv venv && source .venv/bin/activate")
    typer.echo("  uv pip install -r requirements.txt")
    typer.echo("  aai-agent start")


@app.command()
def new(
    directory: str = typer.Argument(
        ".", help="Target directory (defaults to current directory)"
    ),
    force: bool = typer.Option(False, "--force", "-f", help="Overwrite existing files"),
):
    """Scaffold a new voice agent project.

    Copies a ready-to-run server, .env template, and static frontend
    into the target directory.
    """
    _scaffold(directory, force=force)


@app.command()
def update(
    directory: str = typer.Argument(
        ".", help="Target directory (defaults to current directory)"
    ),
):
    """Update the frontend static assets (JS + CSS) to the latest version."""
    target = Path(directory).resolve() / "static"
    source = TEMPLATE_DIR / "static"

    if not target.exists():
        typer.echo(f"No static/ directory found in {target.parent}")
        typer.echo("Run 'aai-agent new' first to scaffold a project.")
        raise typer.Exit(1)

    for name in ("aai-voice-agent.iife.js", "react.css"):
        src = source / name
        shutil.copy2(src, target / name)
        typer.echo(f"Updated {name}")


@app.command()
def start(
    entry: str = typer.Argument(
        "server:app", help="Uvicorn app import string (module:attribute)"
    ),
    host: str = typer.Option("", "--host", "-h", help="Bind host"),
    port: int = typer.Option(0, "--port", "-p", help="Bind port"),
    watch: bool = typer.Option(
        False, "--watch", "-w", help="Watch for file changes and reload"
    ),
    debug: bool = typer.Option(
        False, "--debug", "-d", help="Enable debug mode (auto-reload + verbose logging)"
    ),
    prod: bool = typer.Option(
        False, "--prod", help="Production mode (0.0.0.0, no reload)"
    ),
):
    """Start the voice agent server.

    By default starts in development mode on localhost:8000 with auto-reload.
    Use --watch to enable file-watching, --debug for debug mode, or --prod
    for production (0.0.0.0, no reload).

    Production mode is also auto-detected when FLY_APP_NAME, RAILWAY_ENVIRONMENT,
    or PORT environment variables are set.
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

    # Resolve reload: --watch or --debug enable it explicitly,
    # --prod disables it, otherwise default to on in dev.
    reload = watch or debug
    if not watch and not debug and not prod:
        reload = not is_prod

    log_level = "debug" if debug else "info"

    # Ensure the current directory is importable so uvicorn can find server.py
    cwd = str(Path.cwd())
    if cwd not in sys.path:
        sys.path.insert(0, cwd)

    typer.echo(f"Starting server at http://{host}:{port}")
    uvicorn.run(entry, host=host, port=port, reload=reload, log_level=log_level)
