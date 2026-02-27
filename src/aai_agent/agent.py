"""VoiceAgent — the main entry point for the aai-agent SDK."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from collections.abc import Sequence
from typing import Any
import httpx
import logfire
from pydantic_ai import Agent, ModelSettings, UsageLimits
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
)
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from .stt import AssemblyAISTT
from .types import (
    STTConfig,
    VoiceResponse,
)

logger = logging.getLogger(__name__)

try:
    logfire.configure(
        send_to_logfire="if-token-present", console=logfire.ConsoleOptions()
    )
    logfire.instrument_pydantic_ai()
except Exception:
    pass


def _load_dotenv() -> None:
    """Load .env file if python-dotenv is installed. No-op otherwise."""
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass


LLM_GATEWAY_BASE = "https://llm-gateway.assemblyai.com/v1"

_FINISH_REASON_MAP = {
    "end_turn": "stop",
    "max_tokens": "length",
    "tool_use": "tool_calls",
}


class _PatchTransport(httpx.AsyncBaseTransport):
    """Async HTTP transport that normalises non-standard LLM Gateway responses.

    The AssemblyAI LLM Gateway proxies Anthropic models but returns responses
    that don't fully conform to the OpenAI ChatCompletion schema (e.g.
    ``finish_reason: "end_turn"``, null ``id``/``model``/``usage`` fields).

    This transport wraps another transport, patches the JSON response body to
    be OpenAI-compatible, and also sanitizes outgoing request bodies by
    replacing empty text content with a placeholder (the gateway rejects
    empty text blocks).
    """

    def __init__(self, transport: httpx.AsyncBaseTransport):
        self._transport = transport

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        # --- Sanitize outgoing request: replace empty text content ---
        if request.content:
            try:
                body = json.loads(request.content)
                for msg in body.get("messages", []):
                    content = msg.get("content")
                    if isinstance(content, str) and not content.strip():
                        msg["content"] = "..."
                    elif isinstance(content, list):
                        for block in content:
                            if (
                                isinstance(block, dict)
                                and block.get("type") == "text"
                                and not (block.get("text") or "").strip()
                            ):
                                block["text"] = "..."
                new_body = json.dumps(body).encode()
                headers = dict(request.headers)
                headers["content-length"] = str(len(new_body))
                request = httpx.Request(
                    method=request.method,
                    url=request.url,
                    headers=headers,
                    content=new_body,
                )
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

        response = await self._transport.handle_async_request(request)

        # --- Patch incoming response to be OpenAI-compatible ---
        raw = await response.aread()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return response

        data.setdefault("id", f"chatcmpl-{uuid.uuid4().hex[:12]}")
        data.setdefault("object", "chat.completion")
        data.setdefault("model", "unknown")
        if data.get("usage") is None:
            data["usage"] = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            }
        else:
            data["usage"].setdefault("prompt_tokens", 0)
            data["usage"].setdefault("completion_tokens", 0)
            data["usage"].setdefault("total_tokens", 0)

        for choice in data.get("choices", []):
            choice.setdefault("index", 0)
            fr = choice.get("finish_reason")
            if fr in _FINISH_REASON_MAP:
                choice["finish_reason"] = _FINISH_REASON_MAP[fr]
            elif fr is None:
                choice["finish_reason"] = "stop"

        patched = json.dumps(data).encode()
        return httpx.Response(
            status_code=response.status_code,
            headers=response.headers,
            content=patched,
        )


DEFAULT_MODEL = "claude-haiku-4-5-20251001"

DEFAULT_INSTRUCTIONS = """\
You are a helpful voice assistant. Your goal is to provide accurate, \
research-backed answers using your available tools.

Voice-First Rules:
- Optimize for natural speech. Avoid jargon unless central to the answer. \
Use short, punchy sentences.
- Never mention "search results," "sources," or "the provided text." \
Speak as if the knowledge is your own.
- No visual formatting. Do not say "bullet point," "bold," or "bracketed one." \
If you need to list items, say "First," "Next," and "Finally."
- Start with the most important information. No introductory filler.
- Be concise. For complex topics, provide a high-level summary.
- Be confident. Avoid hedging phrases like "It seems that" or "I believe."
- If you don't have enough information, say so directly rather than guessing."""

VOICE_RULES = (
    "\n\nCRITICAL: When you produce your final answer, it will be spoken aloud by a TTS system. "
    "Write your answer exactly as you would say it out loud to a friend. "
    "One to two sentences max. No markdown, no bullet points, no numbered lists, no code. "
    "Sound like a human talking, not a document."
)

DEFAULT_GREETING = "Hey there! I'm a voice assistant. What can I help you with?"


def _extract_steps(messages: Sequence[ModelMessage]) -> list[str]:
    """Extract human-readable step descriptions from pydantic-ai messages."""
    steps: list[str] = []
    for msg in messages:
        if isinstance(msg, ModelResponse):
            for part in msg.parts:
                if isinstance(part, ToolCallPart):
                    steps.append(f"Using {part.tool_name}")
    return steps


class VoiceAgent:
    """A voice-first AI agent backed by AssemblyAI STT and pydantic-ai.

    API keys are resolved in this order:

    1. Explicit argument (``assemblyai_api_key``).
    2. Environment variable ``ASSEMBLYAI_API_KEY``.

    Args:
        assemblyai_api_key: AssemblyAI API key (used for STT and LLM Gateway).
            Falls back to the ``ASSEMBLYAI_API_KEY`` environment variable.
        model: LLM model ID to use via the AssemblyAI LLM Gateway.
        tools: List of tools the agent can use. Each tool should be a
            callable or a ``pydantic_ai.Tool`` instance.
        instructions: System prompt / persona instructions. Defaults to
            DEFAULT_INSTRUCTIONS, a voice-optimized assistant prompt.
        max_steps: Maximum agent reasoning steps per query.
        model_settings: pydantic-ai ``ModelSettings`` for the LLM
            (e.g. temperature, top_p, max_tokens).
        stt_config: AssemblyAI STT configuration overrides.
        greeting: Text returned when the assistant first connects. Set to
            empty string to disable. Defaults to DEFAULT_GREETING.
        voice_rules: Appended to instructions to guide voice-friendly output.
            Pass an empty string to disable. Defaults to VOICE_RULES.

    Example::

        from aai_agent import VoiceAgent

        agent = VoiceAgent(
            tools=[my_tool],
        )

        response = await agent.chat("What is AssemblyAI?")
        print(response.text)
    """

    def __init__(
        self,
        assemblyai_api_key: str | None = None,
        *,
        model: str = DEFAULT_MODEL,
        tools: list[Any] | None = None,
        instructions: str = DEFAULT_INSTRUCTIONS,
        max_steps: int = 3,
        model_settings: ModelSettings | None = None,
        stt_config: STTConfig | None = None,
        greeting: str = DEFAULT_GREETING,
        voice_rules: str | None = None,
        stt: AssemblyAISTT | None = None,
    ):
        _load_dotenv()

        assemblyai_api_key = assemblyai_api_key or os.environ.get("ASSEMBLYAI_API_KEY")
        if not assemblyai_api_key:
            raise ValueError(
                "assemblyai_api_key must be provided or set via the "
                "ASSEMBLYAI_API_KEY environment variable"
            )

        if max_steps < 1:
            raise ValueError("max_steps must be at least 1")

        self.stt = stt or AssemblyAISTT(assemblyai_api_key, stt_config)

        self._assemblyai_api_key = assemblyai_api_key
        self._model_id = model
        self._instructions = instructions
        self._greeting = greeting
        self._max_steps = max_steps
        self._model_settings = model_settings
        self._voice_rules = VOICE_RULES if voice_rules is None else voice_rules

        # Build tools list — accepts plain callables and pydantic_ai.Tool instances
        all_tools: list[Any] = []
        if tools:
            all_tools.extend(tools)

        # Build the pydantic-ai Agent (stateless — conversation state is in message_history)
        # _PatchTransport normalises LLM Gateway responses to the OpenAI schema.
        self._http_client = httpx.AsyncClient(
            transport=_PatchTransport(httpx.AsyncHTTPTransport()),
        )
        llm_model = OpenAIChatModel(
            model_name=self._model_id,
            provider=OpenAIProvider(
                base_url=LLM_GATEWAY_BASE,
                api_key=assemblyai_api_key,
                http_client=self._http_client,
            ),
        )
        self._agent = Agent(
            model=llm_model,
            instructions=self._instructions + self._voice_rules,
            tools=all_tools,  # type: ignore[arg-type]
            model_settings=self._model_settings,
        )

        self._message_history: list[ModelMessage] = []
        self._current_task: asyncio.Task | None = None
        self._task_lock = asyncio.Lock()

    @property
    def greeting(self) -> str:
        """The greeting text spoken when the assistant first connects."""
        return self._greeting

    @property
    def memory(self) -> list[ModelMessage]:
        """The agent's conversation message history."""
        return self._message_history

    async def aclose(self) -> None:
        """Close the underlying HTTP clients (STT and LLM)."""
        await self.stt.aclose()
        await self._http_client.aclose()

    async def __aenter__(self) -> VoiceAgent:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def reset(self) -> None:
        """Reset the agent's conversation memory.

        Cancels any in-flight task and clears all history so the next
        ``chat()`` call starts a fresh conversation.
        """
        await self.cancel()
        self._message_history = []

    async def cancel(self) -> None:
        """Cancel any in-flight chat task for this agent."""
        async with self._task_lock:
            task = self._current_task
            self._current_task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    async def chat(self, message: str, *, reset: bool = False) -> VoiceResponse:
        """Send a text message and get a text response.

        Args:
            message: User's message.
            reset: If True, reset the agent's conversation memory.

        Returns:
            VoiceResponse with text and steps (no audio).
        """
        message = message.strip()
        if not message:
            raise ValueError("message must not be empty")

        # Cancel any in-flight request before starting a new one
        await self.cancel()

        if reset:
            self._message_history = []

        async with self._task_lock:
            self._current_task = asyncio.current_task()
        try:
            result = await self._agent.run(
                message,
                message_history=self._message_history,
                usage_limits=UsageLimits(request_limit=self._max_steps),
            )
            self._message_history = result.all_messages()
            steps = _extract_steps(result.new_messages())
            text = str(result.output)
        except asyncio.CancelledError:
            logger.info("Chat cancelled (barge-in)")
            raise
        except Exception:
            logger.exception("Agent run failed")
            text = "Sorry, something went wrong. Could you say that again?"
            steps = []
        finally:
            async with self._task_lock:
                self._current_task = None

        return VoiceResponse(text=text, steps=steps)

    async def greet(self) -> VoiceResponse:
        """Return the greeting message.

        Returns:
            VoiceResponse with greeting text.
        """
        return VoiceResponse(text=self._greeting)
