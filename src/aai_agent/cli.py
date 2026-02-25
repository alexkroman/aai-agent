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

    rel = directory if directory != "." else target.name
    typer.echo(f"Initialized voice agent project in {target}")
    typer.echo()
    typer.echo("Next steps:")
    typer.echo(f"  cd {rel}")
    typer.echo("  cp .env.example .env   # add your API keys")
    typer.echo("  pip install aai-agent[examples]")
    typer.echo("  python server.py")
