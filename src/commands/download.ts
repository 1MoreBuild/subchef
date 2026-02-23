import { CliAppError } from "../core/index.js";

import type { SubtitleProvider } from "../domain/types.js";

export interface DownloadCommandInput {
  provider: SubtitleProvider;
  id: string;
  outputPath: string;
  dryRun: boolean;
  writeFile: (path: string, content: Uint8Array) => Promise<void>;
  resolveOutputPath?: (path: string, fileName: string) => Promise<string>;
}

export interface DownloadCommandOutput {
  provider: string;
  id: string;
  outputPath: string;
  fileName: string;
  sourceUrl: string;
  format: string;
  dryRun: boolean;
  bytesWritten: number;
}

export async function runDownloadCommand(
  input: DownloadCommandInput,
): Promise<DownloadCommandOutput> {
  if (input.id.trim().length === 0) {
    throw new CliAppError({
      code: "E_ARG_MISSING",
      message: "--id is required",
      details: {
        arg: "id",
      },
    });
  }

  if (input.outputPath.trim().length === 0) {
    throw new CliAppError({
      code: "E_ARG_MISSING",
      message: "--output is required",
      details: {
        arg: "output",
      },
    });
  }

  const resolveOutputPath = input.resolveOutputPath ?? (async (path: string) => path);

  if (input.dryRun) {
    const plan = await input.provider.getDownloadPlan(input.id);
    const outputPath = await resolveOutputPath(input.outputPath, plan.fileName);
    return {
      provider: input.provider.descriptor.id,
      id: plan.id,
      outputPath,
      fileName: plan.fileName,
      sourceUrl: plan.sourceUrl,
      format: plan.format,
      dryRun: true,
      bytesWritten: 0,
    };
  }

  const payload = await input.provider.downloadSubtitle(input.id);
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
    id: payload.id,
    outputPath,
    fileName: payload.fileName,
    sourceUrl: payload.sourceUrl,
    format: payload.format,
    dryRun: false,
    bytesWritten: payload.content.byteLength,
  };
}

export function renderDownloadOutput(output: DownloadCommandOutput): string {
  return [
    `Provider: ${output.provider}`,
    `ID: ${output.id}`,
    `File: ${output.fileName}`,
    `Output: ${output.outputPath}`,
    `Format: ${output.format}`,
    `Source: ${output.sourceUrl}`,
    `Dry run: ${output.dryRun ? "yes" : "no"}`,
    `Bytes written: ${output.bytesWritten}`,
  ].join("\n");
}
