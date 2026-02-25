"""Rime TTS connector."""

import httpx

from .types import TTSConfig

RIME_API_URL = "https://users.rime.ai/v1/rime-tts"


class RimeTTS:
    """Rime text-to-speech client.

    Args:
        api_key: Rime API key.
        config: TTS configuration. Uses defaults if not provided.
    """

    def __init__(self, api_key: str, config: TTSConfig | None = None):
        self.api_key = api_key
        self.config = config or TTSConfig()

    async def synthesize(self, text: str) -> bytes:
        """Convert text to speech, returning raw WAV bytes.

        Args:
            text: The text to synthesize.

        Returns:
            WAV audio bytes.
        """
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                RIME_API_URL,
                headers={
                    "Accept": "audio/wav",
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "text": text,
                    "speaker": self.config.speaker,
                    "modelId": self.config.model,
                    "samplingRate": self.config.sample_rate,
                    "speedAlpha": self.config.speed,
                    "repetition_penalty": self.config.repetition_penalty,
                    "temperature": self.config.temperature,
                    "top_p": self.config.top_p,
                    "max_tokens": self.config.max_tokens,
                },
                timeout=60.0,
            ) as resp:
                resp.raise_for_status()
                return b"".join([chunk async for chunk in resp.aiter_bytes()])
