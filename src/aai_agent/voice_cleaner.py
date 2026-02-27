"""Text normalization for TTS output.

Cleans LLM-generated text so it sounds natural when spoken by a TTS system.
Handles numbers, currency, markdown artifacts, URLs, and more.
"""

from __future__ import annotations

import re

import inflect

# Pre-compiled regex patterns
_RE_CODE_BLOCKS = re.compile(r"```[\s\S]*?```")
_RE_INDENTED_CODE = re.compile(r"^(?:    |\t).+$", re.MULTILINE)
_RE_INLINE_CODE = re.compile(r"`([^`]+)`")
_RE_BOLD_ITALIC_STAR = re.compile(r"\*{1,3}([^*]+)\*{1,3}")
_RE_BOLD_ITALIC_UNDER = re.compile(r"_{1,3}([^_]+)_{1,3}")
_RE_HEADERS = re.compile(r"^#{1,6}\s+", re.MULTILINE)
_RE_LINKS = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_RE_IMAGES = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_RE_BULLETS = re.compile(r"^\s*[-*+]\s+", re.MULTILINE)
_RE_NUMBERED = re.compile(r"^\s*\d+\.\s+", re.MULTILINE)
_RE_BLOCKQUOTES = re.compile(r"^\s*>\s?", re.MULTILINE)
_RE_HORIZ_RULES = re.compile(r"^[-*_]{3,}\s*$", re.MULTILINE)
_RE_URLS = re.compile(r"https?://\S+")
_RE_CURRENCY = re.compile(r"([$£€¥])(\d+(?:,\d{3})*(?:\.\d{2})?)")
_RE_PERCENTAGES = re.compile(r"(\d+(?:\.\d+)?)%")
_RE_PHONE = re.compile(r"(\d{3})-(\d{3})-(\d{4})")
_RE_ORDINALS = re.compile(r"\b(\d{1,2})(st|nd|rd|th)\b")
_RE_NUMBERS = re.compile(r"(?<![:\w])\b\d+(?:\.\d+)?\b(?![:\w])")
_RE_SPACES = re.compile(r"[ \t]+")
_RE_NEWLINES = re.compile(r"\n{2,}")

_CURRENCY_MAP = {"$": "dollars", "£": "pounds", "€": "euros", "¥": "yen"}

_UNIT_MAP = {
    "Hz": "hertz",
    "kHz": "kilohertz",
    "MHz": "megahertz",
    "GHz": "gigahertz",
    "KB": "kilobytes",
    "MB": "megabytes",
    "GB": "gigabytes",
    "TB": "terabytes",
    "ms": "milliseconds",
    "kb": "kilobits",
    "Mb": "megabits",
    "Gb": "gigabits",
}
_UNIT_PATTERNS = {
    abbr: re.compile(rf"(\d)\s*{re.escape(abbr)}\b") for abbr in _UNIT_MAP
}

_p = inflect.engine()


def _num2words(n: int | float) -> str:
    return _p.number_to_words(n)  # type: ignore[return-value, arg-type]


def _ordinal(word: str) -> str:
    return _p.ordinal(word)  # type: ignore[return-value, arg-type]


def normalize_voice_text(text: str) -> str:
    """Run all normalization passes on *text* and return cleaned result."""
    # Strip markdown
    text = _RE_CODE_BLOCKS.sub("", text)
    text = _RE_INDENTED_CODE.sub("", text)
    text = _RE_INLINE_CODE.sub(r"\1", text)
    text = _RE_BOLD_ITALIC_STAR.sub(r"\1", text)
    text = _RE_BOLD_ITALIC_UNDER.sub(r"\1", text)
    text = _RE_HEADERS.sub("", text)
    text = _RE_LINKS.sub(r"\1", text)
    text = _RE_IMAGES.sub("", text)
    text = _RE_BULLETS.sub("", text)
    text = _RE_NUMBERED.sub("", text)
    text = _RE_BLOCKQUOTES.sub("", text)
    text = _RE_HORIZ_RULES.sub("", text)

    # Remove URLs
    text = _RE_URLS.sub("", text)

    # Currency: $7.95 → seven dollars and ninety-five cents
    def _expand_currency(m: re.Match) -> str:
        symbol, num = m.groups()
        num_clean = num.replace(",", "")
        currency = _CURRENCY_MAP.get(symbol, "currency")
        if "." in num_clean:
            dollars, cents = num_clean.split(".")
            return f"{_num2words(int(dollars))} {currency} and {_num2words(int(cents))} cents"
        return f"{_num2words(int(num_clean))} {currency}"

    text = _RE_CURRENCY.sub(_expand_currency, text)

    # Percentages: 100% → 100 percent
    text = _RE_PERCENTAGES.sub(r"\1 percent", text)

    # Phone numbers: 555-772-9140 → five five five, seven seven two, ...
    def _expand_phone(m: re.Match) -> str:
        return ", ".join(
            " ".join(_num2words(int(d)) for d in group) for group in m.groups()
        )

    text = _RE_PHONE.sub(_expand_phone, text)

    # Ordinals: 1st → first, 2nd → second
    text = _RE_ORDINALS.sub(lambda m: _ordinal(_num2words(int(m.group(1)))), text)

    # Units: Hz → hertz, kHz → kilohertz, etc.
    for abbr, full in _UNIT_MAP.items():
        text = _UNIT_PATTERNS[abbr].sub(rf"\1 {full}", text)

    # Numbers: 123 → one hundred and twenty-three
    def _expand_number(m: re.Match) -> str:
        raw = m.group(0)
        try:
            return _num2words(float(raw)) if "." in raw else _num2words(int(raw))
        except (ValueError, OverflowError):
            return raw

    text = _RE_NUMBERS.sub(_expand_number, text)

    # Symbols
    text = text.replace("°F", " degrees Fahrenheit")
    text = text.replace("°C", " degrees Celsius")
    text = text.replace("°", " degrees")
    text = text.replace("&", " and ")
    text = text.replace("+", " plus ")
    text = text.replace("→", "")
    text = text.replace("—", ", ")
    text = text.replace("–", ", ")

    # Collapse whitespace
    text = _RE_SPACES.sub(" ", text)
    text = _RE_NEWLINES.sub("\n", text)
    return text.strip()


class VoiceCleaner:
    """Backward-compatible wrapper around :func:`normalize_voice_text`."""

    def normalize(self, text: str) -> str:
        return normalize_voice_text(text)
