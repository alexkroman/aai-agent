"""Text normalization for TTS output.

Cleans LLM-generated text so it sounds natural when spoken by a TTS system.
Handles acronyms, numbers, currency, markdown artifacts, URLs, and more.
"""

from __future__ import annotations

import re

from typing import cast

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
_RE_ACRONYMS = re.compile(r"\b[A-Z]{2,}(?:'?s)?\b")
_RE_SPACES = re.compile(r"[ \t]+")
_RE_NEWLINES = re.compile(r"\n{2,}")

_CURRENCY_MAP = {"$": "dollars", "£": "pounds", "€": "euros", "¥": "yen"}

_p = inflect.engine()


def _num2words(n: int | float) -> str:
    """Typed wrapper around inflect's ``number_to_words``."""
    return cast(str, _p.number_to_words(n))  # type: ignore[arg-type]


def _ordinal(word: str) -> str:
    """Typed wrapper around inflect's ``ordinal``."""
    return cast(str, _p.ordinal(word))  # type: ignore[arg-type]


class VoiceCleaner:
    """Normalize text for TTS consumption.

    Automatically applied to all text before it reaches the TTS engine.
    Handles:
    - Acronyms / initialisms (API → a. p. i.)
    - Numbers, ordinals, currency, percentages
    - Markdown stripping (bold, links, code, headers, lists)
    - URL removal
    - Common symbols and special characters
    """

    def normalize(self, text: str) -> str:
        """Run all normalization passes on *text* and return cleaned result."""
        text = self._strip_markdown(text)
        text = self._remove_urls(text)
        text = self._expand_currency(text)
        text = self._expand_percentages(text)
        text = self._expand_phone_numbers(text)
        text = self._expand_ordinals(text)
        text = self._expand_units(text)
        text = self._expand_numbers(text)
        text = self._expand_acronyms(text)
        text = self._clean_symbols(text)
        text = self._collapse_whitespace(text)
        return text.strip()

    # ------------------------------------------------------------------
    # Markdown
    # ------------------------------------------------------------------
    def _strip_markdown(self, text: str) -> str:
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
        return text

    # ------------------------------------------------------------------
    # URLs
    # ------------------------------------------------------------------
    def _remove_urls(self, text: str) -> str:
        return _RE_URLS.sub("", text)

    # ------------------------------------------------------------------
    # Currency: $7.95 → seven dollars and ninety-five cents
    # ------------------------------------------------------------------
    def _expand_currency(self, text: str) -> str:
        def _replace(m: re.Match) -> str:
            symbol, num = m.groups()
            num_clean = num.replace(",", "")
            currency = _CURRENCY_MAP.get(symbol, "currency")
            if "." in num_clean:
                dollars, cents = num_clean.split(".")
                dollars_words = _num2words(int(dollars))
                cents_words = _num2words(int(cents))
                return f"{dollars_words} {currency} and {cents_words} cents"
            return f"{_num2words(int(num_clean))} {currency}"

        return _RE_CURRENCY.sub(_replace, text)

    # ------------------------------------------------------------------
    # Percentages: 100% → 100 percent
    # ------------------------------------------------------------------
    def _expand_percentages(self, text: str) -> str:
        return _RE_PERCENTAGES.sub(r"\1 percent", text)

    # ------------------------------------------------------------------
    # Phone numbers: 555-772-9140 → five five five, seven seven two, ...
    # ------------------------------------------------------------------
    def _expand_phone_numbers(self, text: str) -> str:
        def _replace(m: re.Match) -> str:
            return ", ".join(
                " ".join(_num2words(int(d)) for d in group) for group in m.groups()
            )

        return _RE_PHONE.sub(_replace, text)

    # ------------------------------------------------------------------
    # Units: Hz → hertz, kHz → kilohertz, etc.
    # ------------------------------------------------------------------
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

    # Pre-compile unit patterns
    _UNIT_PATTERNS = {
        abbr: re.compile(rf"(\d)\s*{re.escape(abbr)}\b") for abbr in _UNIT_MAP
    }

    def _expand_units(self, text: str) -> str:
        for abbr, full in self._UNIT_MAP.items():
            text = self._UNIT_PATTERNS[abbr].sub(rf"\1 {full}", text)
        return text

    # ------------------------------------------------------------------
    # Ordinals: 1st → first, 2nd → second, etc.
    # ------------------------------------------------------------------
    def _expand_ordinals(self, text: str) -> str:
        def _replace(m: re.Match) -> str:
            return _ordinal(_num2words(int(m.group(1))))

        return _RE_ORDINALS.sub(_replace, text)

    # ------------------------------------------------------------------
    # Numbers: 123 → one hundred and twenty-three
    # ------------------------------------------------------------------
    def _expand_numbers(self, text: str) -> str:
        def _replace(m: re.Match) -> str:
            raw = m.group(0)
            try:
                if "." in raw:
                    return _num2words(float(raw))
                return _num2words(int(raw))
            except (ValueError, OverflowError):
                return raw

        return _RE_NUMBERS.sub(_replace, text)

    # ------------------------------------------------------------------
    # Acronyms: API → a. p. i.
    # ------------------------------------------------------------------
    # Words that look like acronyms but should be left alone
    _NOT_ACRONYMS = frozenset(
        {
            "AM",
            "PM",
            "OK",
            "US",  # common words
        }
    )

    def _expand_acronyms(self, text: str) -> str:
        def _replace(m: re.Match) -> str:
            word = m.group(0)
            # Strip plural suffix, expand the acronym, then re-attach
            suffix = ""
            if word.endswith("'s") or (word.endswith("s") and word[-2].isupper()):
                suffix = "s"
                word = word.rstrip("s").rstrip("'")
            if word in self._NOT_ACRONYMS:
                return word + suffix
            return ". ".join(word.lower()) + "." + suffix

        return _RE_ACRONYMS.sub(_replace, text)

    # ------------------------------------------------------------------
    # Symbols and special characters
    # ------------------------------------------------------------------
    def _clean_symbols(self, text: str) -> str:
        text = text.replace("°F", " degrees Fahrenheit")
        text = text.replace("°C", " degrees Celsius")
        text = text.replace("°", " degrees")
        text = text.replace("&", " and ")
        text = text.replace("+", " plus ")
        text = text.replace("→", "")
        text = text.replace("—", ", ")
        text = text.replace("–", ", ")
        return text

    # ------------------------------------------------------------------
    # Whitespace
    # ------------------------------------------------------------------
    def _collapse_whitespace(self, text: str) -> str:
        text = _RE_SPACES.sub(" ", text)
        text = _RE_NEWLINES.sub("\n", text)
        return text
