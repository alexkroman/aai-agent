"""Tests for aai_agent.cli."""

from typer.testing import CliRunner

from aai_agent.cli import app

runner = CliRunner()


class TestNew:
    def test_scaffolds_project(self, tmp_path):
        result = runner.invoke(app, ["new", str(tmp_path / "myproject")])
        assert result.exit_code == 0
        assert "Created voice agent project" in result.output

        project = tmp_path / "myproject"
        assert (project / "server.py").exists()
        assert (project / "requirements.txt").exists()
        assert (project / "static" / "index.html").exists()
        assert (project / "static" / "aai-voice-agent.iife.js").exists()

    def test_scaffolds_env_example(self, tmp_path):
        target = tmp_path / "proj"
        runner.invoke(app, ["new", str(target)])
        env_file = target / ".env.example"
        assert env_file.exists()
        content = env_file.read_text()
        assert "ASSEMBLYAI_API_KEY" in content
        assert "ASSEMBLYAI_TTS_API_KEY" in content

    def test_requirements_has_sdk_path(self, tmp_path):
        target = tmp_path / "proj"
        runner.invoke(app, ["new", str(target)])
        req = (target / "requirements.txt").read_text()
        assert req.startswith("aai-agent")

    def test_refuses_overwrite_without_force(self, tmp_path):
        target = tmp_path / "proj"
        runner.invoke(app, ["new", str(target)])
        result = runner.invoke(app, ["new", str(target)])
        assert result.exit_code == 1
        assert "already exist" in result.output

    def test_force_overwrites(self, tmp_path):
        target = tmp_path / "proj"
        runner.invoke(app, ["new", str(target)])
        result = runner.invoke(app, ["new", str(target), "--force"])
        assert result.exit_code == 0
        assert "Created" in result.output

    def test_default_directory(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(app, ["new"])
        assert result.exit_code == 0
        assert (tmp_path / "server.py").exists()

    def test_next_steps_output(self, tmp_path):
        result = runner.invoke(app, ["new", str(tmp_path / "myapp")])
        assert "aai-agent start" in result.output
        assert "cp .env.example .env" in result.output
        assert "uv pip install -r requirements.txt" in result.output

    def test_server_py_content(self, tmp_path):
        target = tmp_path / "proj"
        runner.invoke(app, ["new", str(target)])
        content = (target / "server.py").read_text()
        assert "create_voice_app" in content
        assert "aai-agent start" in content
        assert "def get_weather" in content

    def test_does_not_copy_pycache(self, tmp_path):
        target = tmp_path / "proj"
        runner.invoke(app, ["new", str(target)])
        assert not (target / "__pycache__").exists()

    def test_does_not_copy_venv(self, tmp_path):
        target = tmp_path / "proj"
        runner.invoke(app, ["new", str(target)])
        assert not (target / ".venv").exists()

    def test_does_not_copy_dotenv(self, tmp_path):
        target = tmp_path / "proj"
        runner.invoke(app, ["new", str(target)])
        assert not (target / ".env").exists()


class TestInitAlias:
    """The ``init`` command is a hidden alias for ``new``."""

    def test_init_still_works(self, tmp_path):
        result = runner.invoke(app, ["init", str(tmp_path / "proj")])
        assert result.exit_code == 0
        assert "Created voice agent project" in result.output
        assert (tmp_path / "proj" / "server.py").exists()
