import type { CliErrorCode } from "./errors.js";

export interface Meta {
  requestId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  verbose: boolean;
}

export interface CliSuccess<T> {
  ok: true;
  data: T;
  meta: Meta;
}

export interface CliError {
  ok: false;
  error: {
    code: CliErrorCode;
    message: string;
    details?: unknown;
  };
}

export type CliEnvelope<T> = CliSuccess<T> | CliError;

export function createSuccessEnvelope<T>(data: T, meta: Meta): CliSuccess<T> {
  return { ok: true, data, meta };
}

export function createErrorEnvelope(
  code: CliErrorCode,
  message: string,
  details?: unknown,
): CliError {
  if (details === undefined) {
    return {
      ok: false,
      error: { code, message },
    };
  }

  return {
    ok: false,
    error: { code, message, details },
  };
}
