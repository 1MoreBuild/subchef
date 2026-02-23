import { CliAppError } from "../core/index.js";

import { rankSubtitleCandidates } from "../domain/ranking.js";
import type {
  NormalizedSubtitleRequest,
  RankedSubtitleResult,
  SubtitleProvider,
} from "../domain/types.js";

export interface SearchCommandInput {
  provider: SubtitleProvider;
  request: NormalizedSubtitleRequest;
  limit: number;
}

export interface SearchCommandOutput {
  provider: string;
  request: NormalizedSubtitleRequest;
  returned: number;
  totalCandidates: number;
  items: RankedSubtitleResult[];
}

export async function runSearchCommand(input: SearchCommandInput): Promise<SearchCommandOutput> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    throw new CliAppError({
      code: "E_ARG_INVALID",
      message: "--limit must be a positive integer",
      details: {
        arg: "limit",
        value: input.limit,
      },
    });
  }

  const candidates = await input.provider.search(input.request);
  const ranked = rankSubtitleCandidates(input.request, candidates, input.limit);

  return {
    provider: input.provider.descriptor.id,
    request: input.request,
    returned: ranked.length,
    totalCandidates: candidates.length,
    items: ranked,
  };
}

export function renderSearchOutput(output: SearchCommandOutput): string {
  const lines: string[] = [
    `Provider: ${output.provider}`,
    `Query: ${output.request.query}`,
    `Fingerprint: ${output.request.fingerprint}`,
    `Returned: ${output.returned}/${output.totalCandidates}`,
  ];

  for (const item of output.items) {
    lines.push(
      `${item.rank}. ${item.id} | ${item.title} | ${item.language} | ${item.format} | score:${item.score.toFixed(3)}`,
    );
  }

  return lines.join("\n");
}
