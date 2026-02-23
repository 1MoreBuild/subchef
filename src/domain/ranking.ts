import { tokenize } from "./request-normalization.js";
import type {
  NormalizedSubtitleRequest,
  ProviderSubtitleResult,
  RankedSubtitleResult,
} from "./types.js";

const PROVIDER_PRIORITY_BOOST: Record<string, number> = {
  subhd: 12,
  assrt: 4,
};

export function rankSubtitleCandidates(
  request: NormalizedSubtitleRequest,
  candidates: ProviderSubtitleResult[],
  limit = candidates.length,
): RankedSubtitleResult[] {
  const scored = candidates.map((candidate) => scoreSubtitleCandidate(request, candidate));

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.downloads !== left.downloads) {
      return right.downloads - left.downloads;
    }

    const providerOrder = left.providerId.localeCompare(right.providerId);
    if (providerOrder !== 0) {
      return providerOrder;
    }

    return left.id.localeCompare(right.id);
  });

  return scored.slice(0, limit).map((item, index) => ({
    ...item,
    rank: index + 1,
  }));
}

export function scoreSubtitleCandidate(
  request: NormalizedSubtitleRequest,
  candidate: ProviderSubtitleResult,
): Omit<RankedSubtitleResult, "rank"> {
  const reasons: string[] = [];
  let score = 0;

  const titleTokens = new Set(tokenize(candidate.title));
  const overlapCount = request.queryTokens.reduce(
    (count, token) => count + (titleTokens.has(token) ? 1 : 0),
    0,
  );

  if (request.queryTokens.length > 0) {
    const overlapRatio = overlapCount / request.queryTokens.length;
    score += overlapRatio * 60;
    reasons.push(`query-overlap:${overlapRatio.toFixed(3)}`);
  }

  const preferredIndex = request.languagePreferences.findIndex(
    (item) => item === candidate.language,
  );
  if (preferredIndex === 0) {
    score += 30;
    reasons.push("lang:primary");
  } else if (preferredIndex > 0) {
    score += 20;
    reasons.push("lang:secondary");
  } else if (request.languagePreferences.length > 0) {
    score -= 10;
    reasons.push("lang:mismatch");
  }

  const providerBoost = PROVIDER_PRIORITY_BOOST[candidate.providerId] ?? 0;
  if (providerBoost !== 0) {
    score += providerBoost;
    reasons.push(`provider:${candidate.providerId}:+${providerBoost.toFixed(3)}`);
  }

  const downloadBoost = Math.min(15, Math.log10(candidate.downloads + 1) * 5);
  score += downloadBoost;
  reasons.push(`downloads:+${downloadBoost.toFixed(3)}`);

  if (candidate.format === "srt") {
    score += 8;
    reasons.push("format:srt");
  } else if (candidate.format === "ass") {
    score += 5;
    reasons.push("format:ass");
  } else {
    score += 4;
    reasons.push("format:vtt");
  }

  if (candidate.hearingImpaired) {
    score -= 2;
    reasons.push("hi:-2");
  }

  return {
    ...candidate,
    score: roundScore(score),
    reasons,
  };
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}
