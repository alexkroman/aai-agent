// voice-cleaner.ts — Text normalization for TTS.
// Port of the Python voice_cleaner.py.

import { toWords, toWordsOrdinal } from "number-to-words";

// Pre-compiled regex patterns
const RE_CODE_BLOCKS = /```[\s\S]*?```/g;
const RE_INDENTED_CODE = /^(?:    |\t).+$/gm;
const RE_INLINE_CODE = /`([^`]+)`/g;
const RE_BOLD_ITALIC_STAR = /\*{1,3}([^*]+)\*{1,3}/g;
const RE_BOLD_ITALIC_UNDER = /_{1,3}([^_]+)_{1,3}/g;
const RE_HEADERS = /^#{1,6}\s+/gm;
const RE_LINKS = /\[([^\]]+)\]\([^)]*\)/g;
const RE_IMAGES = /!\[[^\]]*\]\([^)]*\)/g;
const RE_BULLETS = /^\s*[-*+]\s+/gm;
const RE_NUMBERED = /^\s*\d+\.\s+/gm;
const RE_BLOCKQUOTES = /^\s*>\s?/gm;
const RE_HORIZ_RULES = /^[-*_]{3,}\s*$/gm;
const RE_URLS = /https?:\/\/\S+/g;
const RE_CURRENCY = /([$£€¥])(\d+(?:,\d{3})*(?:\.\d{2})?)/g;
const RE_PERCENTAGES = /(\d+(?:\.\d+)?)%/g;
const RE_PHONE = /(\d{3})-(\d{3})-(\d{4})/g;
const RE_ORDINALS = /\b(\d{1,2})(st|nd|rd|th)\b/g;
const RE_NUMBERS = /(?<![:\w])\b\d+(?:\.\d+)?\b(?![:\w])/g;
const RE_SPACES = /[ \t]+/g;
const RE_NEWLINES = /\n{2,}/g;

const CURRENCY_MAP: Record<string, string> = {
  $: "dollars",
  "£": "pounds",
  "€": "euros",
  "¥": "yen",
};

const UNIT_MAP: Record<string, string> = {
  Hz: "hertz",
  kHz: "kilohertz",
  MHz: "megahertz",
  GHz: "gigahertz",
  KB: "kilobytes",
  MB: "megabytes",
  GB: "gigabytes",
  TB: "terabytes",
  ms: "milliseconds",
  kb: "kilobits",
  Mb: "megabits",
  Gb: "gigabits",
};

function num2words(n: number): string {
  if (Number.isInteger(n)) {
    return toWords(n);
  }
  // number-to-words doesn't support floats — split on decimal point
  const [intPart, decPart] = String(n).split(".");
  const intWords = toWords(parseInt(intPart));
  const decWords = decPart
    .split("")
    .map((d) => toWords(parseInt(d)))
    .join(" ");
  return `${intWords} point ${decWords}`;
}

/**
 * Normalize text for TTS output.
 * Strips markdown, expands numbers/currency/units, collapses whitespace.
 */
export function normalizeVoiceText(text: string): string {
  // Strip markdown
  text = text.replace(RE_CODE_BLOCKS, "");
  text = text.replace(RE_INDENTED_CODE, "");
  text = text.replace(RE_INLINE_CODE, "$1");
  text = text.replace(RE_BOLD_ITALIC_STAR, "$1");
  text = text.replace(RE_BOLD_ITALIC_UNDER, "$1");
  text = text.replace(RE_HEADERS, "");
  text = text.replace(RE_IMAGES, "");   // Must run before LINKS
  text = text.replace(RE_LINKS, "$1");
  text = text.replace(RE_BULLETS, "");
  text = text.replace(RE_NUMBERED, "");
  text = text.replace(RE_BLOCKQUOTES, "");
  text = text.replace(RE_HORIZ_RULES, "");

  // Remove URLs
  text = text.replace(RE_URLS, "");

  // Currency: $7.95 → seven dollars and ninety-five cents
  text = text.replace(RE_CURRENCY, (_match, symbol: string, num: string) => {
    const numClean = num.replace(/,/g, "");
    const currency = CURRENCY_MAP[symbol] ?? "currency";
    if (numClean.includes(".")) {
      const [dollars, cents] = numClean.split(".");
      return `${num2words(parseInt(dollars))} ${currency} and ${num2words(parseInt(cents))} cents`;
    }
    return `${num2words(parseInt(numClean))} ${currency}`;
  });

  // Percentages: 100% → 100 percent
  text = text.replace(RE_PERCENTAGES, "$1 percent");

  // Phone numbers: 555-772-9140 → five five five, seven seven two, ...
  text = text.replace(RE_PHONE, (_match, a: string, b: string, c: string) => {
    const expand = (group: string) =>
      group
        .split("")
        .map((d) => num2words(parseInt(d)))
        .join(" ");
    return `${expand(a)}, ${expand(b)}, ${expand(c)}`;
  });

  // Ordinals: 1st → first, 2nd → second
  text = text.replace(RE_ORDINALS, (_match, num: string) => {
    return toWordsOrdinal(parseInt(num));
  });

  // Units: Hz → hertz, kHz → kilohertz, etc.
  for (const [abbr, full] of Object.entries(UNIT_MAP)) {
    const re = new RegExp(`(\\d)\\s*${abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    text = text.replace(re, `$1 ${full}`);
  }

  // Numbers: 123 → one hundred and twenty-three
  text = text.replace(RE_NUMBERS, (match) => {
    try {
      const n = match.includes(".") ? parseFloat(match) : parseInt(match);
      return num2words(n);
    } catch {
      return match;
    }
  });

  // Symbols
  text = text.replace(/°F/g, " degrees Fahrenheit");
  text = text.replace(/°C/g, " degrees Celsius");
  text = text.replace(/°/g, " degrees");
  text = text.replace(/&/g, " and ");
  text = text.replace(/\+/g, " plus ");
  text = text.replace(/→/g, "");
  text = text.replace(/—/g, ", ");
  text = text.replace(/–/g, ", ");

  // Collapse whitespace
  text = text.replace(RE_SPACES, " ");
  text = text.replace(RE_NEWLINES, "\n");
  return text.trim();
}
