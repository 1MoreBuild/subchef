import type { NormalizedSubtitleRequest, SubtitleRequestInput } from "./types.js";

const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  zh: "zh",
  zho: "zh",
  chinese: "zh",
  chs: "zh-cn",
  cht: "zh-tw",
  "zh-cn": "zh-cn",
  "zh-hans": "zh-cn",
  "zh-tw": "zh-tw",
  "zh-hant": "zh-tw",
  en: "en",
  eng: "en",
  english: "en",
  ja: "ja",
  jpn: "ja",
  japanese: "ja",
};

export function normalizeSubtitleRequest(input: SubtitleRequestInput): NormalizedSubtitleRequest {
  const query = collapseWhitespace(input.query);
  const normalizedQuery = query.toLowerCase();
  const queryTokens = tokenize(normalizedQuery);

  const languagePreferences = normalizeLanguages(input.languages ?? []);
  const canonicalLanguages = [...languagePreferences].sort((a, b) => a.localeCompare(b));

  const fingerprint = [
    normalizedQuery,
    String(input.year ?? ""),
    String(input.season ?? ""),
    String(input.episode ?? ""),
    canonicalLanguages.join(","),
  ].join("|");

  return {
    query,
    normalizedQuery,
    queryTokens,
    year: input.year,
    season: input.season,
    episode: input.episode,
    languagePreferences,
    fingerprint,
  };
}

export function normalizeLanguage(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return normalized;
  }

  return LANGUAGE_ALIAS_MAP[normalized] ?? normalized;
}

export function normalizeLanguages(values: string[]): string[] {
  const deduped = new Set<string>();

  for (const value of values) {
    const normalized = normalizeLanguage(value);
    if (normalized.length > 0) {
      deduped.add(normalized);
    }
  }

  return [...deduped];
}

export function tokenize(text: string): string[] {
  if (text.trim().length === 0) {
    return [];
  }

  const items = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const deduped = new Set(items);
  return [...deduped].sort((a, b) => a.localeCompare(b));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
