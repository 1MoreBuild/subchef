import type { CliErrorCode } from "./errors.js";

export type CliExitCode = 0 | 2 | 3 | 4 | 5 | 10;

export const EXIT_CODES = {
  SUCCESS: 0,
  ARGUMENT_ERROR: 2,
  AUTH_OR_CONFIG_ERROR: 3,
  NOT_FOUND: 4,
  UPSTREAM_ERROR: 5,
  UNKNOWN_ERROR: 10,
} as const satisfies Record<string, CliExitCode>;

export function mapErrorCodeToExitCode(code: CliErrorCode): CliExitCode {
  if (code.startsWith("E_ARG_")) {
    return EXIT_CODES.ARGUMENT_ERROR;
  }

  if (code.startsWith("E_AUTH_")) {
    return EXIT_CODES.AUTH_OR_CONFIG_ERROR;
  }

  if (code.startsWith("E_NOT_FOUND_")) {
    return EXIT_CODES.NOT_FOUND;
  }

  if (code.startsWith("E_UPSTREAM_")) {
    return EXIT_CODES.UPSTREAM_ERROR;
  }

  return EXIT_CODES.UNKNOWN_ERROR;
}
