import { describe, expect, it } from "vitest";

import { normalizeSubtitleRequest } from "../src/domain/request-normalization.js";
import { rankSubtitleCandidates } from "../src/domain/ranking.js";
import type { ProviderSubtitleResult } from "../src/domain/types.js";

const CANDIDATES: ProviderSubtitleResult[] = [
  {
    id: "assrt-1001",
    providerId: "assrt",
    title: "The Matrix (1999) 1080p BluRay",
    language: "en",
    format: "srt",
    downloads: 1500,
  },
  {
    id: "assrt-1002",
    providerId: "assrt",
    title: "The Matrix (1999) 蓝光版",
    language: "zh-cn",
    format: "srt",
    downloads: 2100,
  },
  {
    id: "subhd:xD0xeo",
    providerId: "subhd",
    title: "The Matrix (1999) UHD BluRay",
    language: "zh-cn",
    format: "ass",
    downloads: 1100,
  },
  {
    id: "assrt-1003",
    providerId: "assrt",
    title: "The Matrix (1999) 繁中字幕",
    language: "zh-tw",
    format: "ass",
    downloads: 900,
  },
];

describe("request normalization + ranking determinism", () => {
  it("normalizes request into stable fingerprint", () => {
    const normalized = normalizeSubtitleRequest({
      query: "   The   Matrix   ",
      year: 1999,
      languages: ["EN", "eng", "chs", "zh-cn"],
    });

    expect(normalized).toMatchObject({
      query: "The Matrix",
      normalizedQuery: "the matrix",
      queryTokens: ["matrix", "the"],
      languagePreferences: ["en", "zh-cn"],
      fingerprint: "the matrix|1999|||en,zh-cn",
    });
  });

  it("returns deterministic ranking independent of candidate order", () => {
    const request = normalizeSubtitleRequest({
      query: "The Matrix",
      year: 1999,
      languages: ["zh-cn", "en"],
    });

    const rankingA = rankSubtitleCandidates(request, [...CANDIDATES], 3);
    const rankingB = rankSubtitleCandidates(request, [...CANDIDATES].reverse(), 3);

    expect(rankingA.map((item) => item.id)).toEqual(rankingB.map((item) => item.id));
    expect(rankingA.map((item) => item.score)).toEqual(rankingB.map((item) => item.score));
    expect(rankingA[0]?.id).toBe("subhd:xD0xeo");
  });
});
