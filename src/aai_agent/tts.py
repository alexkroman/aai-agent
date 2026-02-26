"""Rime TTS connector."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx

from .types import TTSConfig
from .voice_cleaner import VoiceCleaner

RIME_API_URL = "https://users.rime.ai/v1/rime-tts"


class RimeTTS:
    """Rime text-to-speech client.

    Args:
        api_key: Rime API key.
        config: TTS configuration. Uses defaults if not provided.
        cleaner: VoiceCleaner instance for text normalization.
            A default one is created if not provided.
    """

    def __init__(
        self,
        api_key: str,
        config: TTSConfig | None = None,
        cleaner: VoiceCleaner | None = None,
        client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key
        self.config = config or TTSConfig()
        self.cleaner = cleaner or VoiceCleaner()
        self._client = client or httpx.AsyncClient(timeout=60.0)

    def _request_params(
        self, text: str, *, accept: str = "audio/wav"
    ) -> dict[str, Any]:
        """Return shared httpx request kwargs for TTS."""
        return {
            "method": "POST",
            "url": RIME_API_URL,
            "headers": {
                "Accept": accept,
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            "json": {
                "text": text,
                "speaker": self.config.speaker,
                "modelId": self.config.model,
                "samplingRate": self.config.sample_rate,
                "speedAlpha": self.config.speed,
                "max_tokens": self.config.max_tokens,
                "repetitionPenalty": self.config.repetition_penalty,
                "temperature": self.config.temperature,
                "topP": self.config.top_p,
            },
        }

    async def synthesize(self, text: str) -> bytes:
        """Convert text to speech, returning raw WAV bytes.

        Args:
            text: The text to synthesize.

        Returns:
            WAV audio bytes.
        """
        text = self.cleaner.normalize(text)
        async with self._client.stream(**self._request_params(text)) as resp:
            resp.raise_for_status()
            return b"".join([chunk async for chunk in resp.aiter_bytes()])

    async def synthesize_stream(self, text: str) -> AsyncIterator[bytes]:
        """Stream raw PCM audio chunks as they arrive from Rime.

        Yields:
            Raw 16-bit signed little-endian PCM bytes.
        """
        text = self.cleaner.normalize(text)
        async with self._client.stream(
            **self._request_params(text, accept="audio/pcm")
        ) as resp:
            resp.raise_for_status()
            async for chunk in resp.aiter_bytes():
                yield chunk

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> RimeTTS:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()
