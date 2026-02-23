import { CliAppError } from "../core/index.js";

import { rankSubtitleCandidates } from "../domain/ranking.js";
import type {
  NormalizedSubtitleRequest,
  RankedSubtitleResult,
  SubtitleProvider,
} from "../domain/types.js";

export interface FetchCommandInput {
  provider: SubtitleProvider;
  request: NormalizedSubtitleRequest;
  outputPath: string;
  dryRun: boolean;
  limit: number;
  writeFile: (path: string, content: Uint8Array) => Promise<void>;
  resolveOutputPath?: (path: string, fileName: string) => Promise<string>;
}

export interface FetchCommandOutput {
  provider: string;
  request: NormalizedSubtitleRequest;
  selected: RankedSubtitleResult;
  candidates: RankedSubtitleResult[];
  outputPath: string;
  fileName: string;
  sourceUrl: string;
  format: string;
  dryRun: boolean;
  bytesWritten: number;
}

export async function runFetchCommand(input: FetchCommandInput): Promise<FetchCommandOutput> {
  if (input.outputPath.trim().length === 0) {
    throw new CliAppError({
      code: "E_ARG_MISSING",
      message: "--output is required",
      details: {
        arg: "output",
      },
    });
  }

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

  const resolveOutputPath = input.resolveOutputPath ?? (async (path: string) => path);
  const candidates = rankSubtitleCandidates(
    input.request,
    await input.provider.search(input.request),
    input.limit,
  );
  const selected = candidates[0];

  if (selected === undefined) {
    throw new CliAppError({
      code: "E_NOT_FOUND_RESOURCE",
      message: "No subtitle candidates found for the request",
      details: {
        query: input.request.query,
        provider: input.provider.descriptor.id,
      },
    });
  }

  if (input.dryRun) {
    const plan = await input.provider.getDownloadPlan(selected.id);
    const outputPath = await resolveOutputPath(input.outputPath, plan.fileName);
    return {
      provider: input.provider.descriptor.id,
      request: input.request,
      selected,
      candidates,
      outputPath,
      fileName: plan.fileName,
      sourceUrl: plan.sourceUrl,
      format: plan.format,
      dryRun: true,
      bytesWritten: 0,
    };
  }

  const payload = await input.provider.downloadSubtitle(selected.id);
  const outputPath = await resolveOutputPath(input.outputPath, payload.fileName);

  try {
    await input.writeFile(outputPath, payload.content);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EISDIR") {
      throw new CliAppError({
        code: "E_ARG_INVALID",
        message: "--output must be a file path, not a directory",
        details: {
          arg: "output",
          outputPath,
        },
      });
    }
    throw error;
  }

  return {
    provider: input.provider.descriptor.id,
    request: input.request,
    selected,
    candidates,
    outputPath,
    fileName: payload.fileName,
    sourceUrl: payload.sourceUrl,
    format: payload.format,
    dryRun: false,
    bytesWritten: payload.content.byteLength,
  };
}

export function renderFetchOutput(output: FetchCommandOutput): string {
  return [
    `Provider: ${output.provider}`,
    `Query: ${output.request.query}`,
    `Selected: ${output.selected.id} (${output.selected.language}, score ${output.selected.score.toFixed(3)})`,
    `Output: ${output.outputPath}`,
    `File: ${output.fileName}`,
    `Source: ${output.sourceUrl}`,
    `Dry run: ${output.dryRun ? "yes" : "no"}`,
    `Bytes written: ${output.bytesWritten}`,
  ].join("\n");
}
