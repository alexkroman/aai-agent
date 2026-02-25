"""aai-agent CLI — scaffold and manage voice agent projects."""

import shutil
from pathlib import Path

import typer

app = typer.Typer(
    name="aai-agent",
    add_completion=False,
)

TEMPLATE_DIR = Path(__file__).parent / "_template"
SDK_ROOT = Path(__file__).parent.parent.parent  # repo root containing pyproject.toml


@app.callback()
def callback():
    """Voice agent SDK powered by AssemblyAI, Rime TTS, and smolagents."""


@app.command()
def init(
    directory: str = typer.Argument(
        ".", help="Target directory (defaults to current directory)"
    ),
    force: bool = typer.Option(
        False, "--force", "-f", help="Overwrite existing files"
    ),
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

    # Prepend the SDK as an editable install in requirements.txt
    req_file = target / "requirements.txt"
    original = req_file.read_text()
    sdk_root = SDK_ROOT.resolve()
    req_file.write_text(f"-e {sdk_root}\n{original}")

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
    host: str = typer.Option("localhost", "--host", "-h", help="Bind host"),
    port: int = typer.Option(8000, "--port", "-p", help="Bind port"),
    reload: bool = typer.Option(True, help="Enable auto-reload"),
):
    """Start the voice agent server."""
    import sys

    import uvicorn

    # Ensure the current directory is importable so uvicorn can find server.py
    cwd = str(Path.cwd())
    if cwd not in sys.path:
        sys.path.insert(0, cwd)

    typer.echo(f"Starting server at http://{host}:{port}")
    uvicorn.run(server, host=host, port=port, reload=reload)
