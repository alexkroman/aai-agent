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
    typer.echo(f"Initialized voice agent project in {target}")
    typer.echo()
    typer.echo("Next steps:")
    typer.echo(f"  cd {rel}")
    typer.echo("  cp .env.example .env   # add your API keys")
    typer.echo("  uv venv && source .venv/bin/activate")
    typer.echo("  uv pip install -r requirements.txt")
    typer.echo("  aai-agent start")


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
        typer.echo("Run 'aai-agent init' first to scaffold a project.")
        raise typer.Exit(1)

    for name in ("aai-voice-agent.iife.js", "react.css"):
        src = source / name
        shutil.copy2(src, target / name)
        typer.echo(f"Updated {name}")


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
