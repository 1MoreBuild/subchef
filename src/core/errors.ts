export const CLI_ERROR_CODES = [
  "E_ARG_INVALID",
  "E_ARG_MISSING",
  "E_ARG_CONFLICT",
  "E_ARG_UNSUPPORTED",
  "E_AUTH_REQUIRED",
  "E_AUTH_INVALID",
  "E_NOT_FOUND_RESOURCE",
  "E_UPSTREAM_NETWORK",
  "E_UPSTREAM_TIMEOUT",
  "E_UPSTREAM_BAD_RESPONSE",
  "E_UNKNOWN",
] as const;

export type CliErrorCode = (typeof CLI_ERROR_CODES)[number];

export interface CliAppErrorOptions {
  code: CliErrorCode;
  message: string;
  details?: unknown;
  cause?: unknown;
}

export class CliAppError extends Error {
  public readonly code: CliErrorCode;
  public readonly details?: unknown;

  public constructor(options: CliAppErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "CliAppError";
    this.code = options.code;
    this.details = options.details;
  }
}

export function isCliAppError(value: unknown): value is CliAppError {
  return value instanceof CliAppError;
}

export function toCliAppError(value: unknown): CliAppError {
  if (isCliAppError(value)) {
    return value;
  }

  if (value instanceof Error) {
    return new CliAppError({
      code: "E_UNKNOWN",
      message: value.message,
      details: { name: value.name },
      cause: value,
    });
  }

  return new CliAppError({
    code: "E_UNKNOWN",
    message: "Unknown error",
    details: value,
  });
}
