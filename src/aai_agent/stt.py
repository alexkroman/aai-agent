"""AssemblyAI streaming STT connector."""

import httpx

from .types import STTConfig

TOKEN_URL = "https://streaming.assemblyai.com/v3/token"


class AssemblyAISTT:
    """AssemblyAI streaming speech-to-text client.

    Provides token generation for browser-side WebSocket streaming.

    Args:
        api_key: AssemblyAI API key.
        config: STT configuration. Uses defaults if not provided.
    """

    def __init__(self, api_key: str, config: STTConfig | None = None):
        self.api_key = api_key
        self.config = config or STTConfig()

    async def create_token(self) -> str:
        """Create an ephemeral streaming token.

        Returns:
            A temporary token for browser-side WebSocket connections.
        """
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                TOKEN_URL,
                headers={"Authorization": self.api_key},
                params={"expires_in_seconds": self.config.token_expires_in},
            )
            resp.raise_for_status()
            return resp.json()["token"]

    @property
    def sample_rate(self) -> int:
        return self.config.sample_rate

    @property
    def wss_base(self) -> str:
        return self.config.wss_base

    @property
    def speech_model(self) -> str:
        return self.config.speech_model
