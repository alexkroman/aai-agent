"""Text normalization for TTS output.

Cleans LLM-generated text so it sounds natural when spoken by a TTS system.
Handles acronyms, numbers, currency, markdown artifacts, URLs, and more.
"""

from __future__ import annotations

import re
from collections.abc import Callable

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
_RE_CURRENCY_CENTS = re.compile(r"\$(\d+)\.(\d{2})\b")
_RE_CURRENCY_WHOLE = re.compile(r"\$(\d+)\b")
_RE_PERCENTAGES = re.compile(r"(\d+(?:\.\d+)?)%")
_RE_PHONE = re.compile(r"\b\d{3,4}(?:-\d{3,4}){1,3}\b")
_RE_ORDINALS = re.compile(r"\b(\d{1,2})(st|nd|rd|th)\b")
_RE_NUMBERS = re.compile(r"(?<![:\w])\b\d+(?:\.\d+)?\b(?![:\w])")
_RE_ACRONYMS = re.compile(r"\b[A-Z]{2,}(?:'?s)?\b")
_RE_SPACES = re.compile(r"[ \t]+")
_RE_NEWLINES = re.compile(r"\n{2,}")

# Resolve num2words once at import time
_num2words: Callable[..., str] | None
try:
    from num2words import num2words as _num2words
except ImportError:
    _num2words = None


class VoiceCleaner:
    """Normalize text for TTS consumption.

    Automatically applied to all text before it reaches the TTS engine.
    Handles:
    - Acronyms / initialisms (API → A. P. I.)
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
    # Currency: $7.95 → 7 dollars and 95 cents
    # ------------------------------------------------------------------
    def _expand_currency(self, text: str) -> str:
        def _replace_dollars(m: re.Match) -> str:
            dollars = int(m.group(1))
            cents = m.group(2)
            parts = []
            if dollars:
                parts.append(f"{dollars} {'dollar' if dollars == 1 else 'dollars'}")
            if cents:
                c = int(cents)
                if c:
                    parts.append(f"{c} {'cent' if c == 1 else 'cents'}")
            return " and ".join(parts) if parts else "zero dollars"

        text = _RE_CURRENCY_CENTS.sub(_replace_dollars, text)
        text = _RE_CURRENCY_WHOLE.sub(lambda m: f"{m.group(1)} dollars", text)
        return text

    # ------------------------------------------------------------------
    # Percentages: 100% → 100 percent
    # ------------------------------------------------------------------
    def _expand_percentages(self, text: str) -> str:
        return _RE_PERCENTAGES.sub(r"\1 percent", text)

    # ------------------------------------------------------------------
    # Phone numbers: 555-772-9140 → 5 5 5, 7 7 2, 9 1 4 0
    # ------------------------------------------------------------------
    def _expand_phone_numbers(self, text: str) -> str:
        def _digits_spaced(segment: str) -> str:
            return " ".join(segment)

        def _replace(m: re.Match) -> str:
            parts = [_digits_spaced(p) for p in m.group(0).split("-")]
            return ", ".join(parts)

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
    _ORDINAL_MAP = {
        "1": "first",
        "2": "second",
        "3": "third",
        "4": "fourth",
        "5": "fifth",
        "6": "sixth",
        "7": "seventh",
        "8": "eighth",
        "9": "ninth",
        "10": "tenth",
        "11": "eleventh",
        "12": "twelfth",
        "13": "thirteenth",
        "14": "fourteenth",
        "15": "fifteenth",
        "16": "sixteenth",
        "17": "seventeenth",
        "18": "eighteenth",
        "19": "nineteenth",
        "20": "twentieth",
        "21": "twenty-first",
        "22": "twenty-second",
        "23": "twenty-third",
        "24": "twenty-fourth",
        "25": "twenty-fifth",
        "26": "twenty-sixth",
        "27": "twenty-seventh",
        "28": "twenty-eighth",
        "29": "twenty-ninth",
        "30": "thirtieth",
        "31": "thirty-first",
    }

    def _expand_ordinals(self, text: str) -> str:
        def _replace(m: re.Match) -> str:
            num = m.group(1) or ""
            return self._ORDINAL_MAP.get(num, m.group(0) or "")

        return _RE_ORDINALS.sub(_replace, text)

    # ------------------------------------------------------------------
    # Numbers: 123 → one hundred and twenty-three
    # ------------------------------------------------------------------
    def _expand_numbers(self, text: str) -> str:
        converter = _num2words
        if converter is None:
            return text

        def _replace(m: re.Match) -> str:
            raw = m.group(0)
            try:
                if "." in raw:
                    return converter(float(raw))
                return converter(int(raw))
            except (ValueError, OverflowError):
                return raw

        # Match standalone numbers (integers and decimals), but not those
        # already part of a word or time format (10:30)
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
