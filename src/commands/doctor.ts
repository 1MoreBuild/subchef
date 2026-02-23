import { CliAppError, type CliErrorCode } from "../core/index.js";

import type { SubtitleProvider } from "../domain/types.js";

type DoctorLevel = "info" | "warn" | "error";

export interface DoctorCheck {
  id: string;
  level: DoctorLevel;
  ok: boolean;
  message: string;
  details?: unknown;
  errorCode?: CliErrorCode;
}

export interface DoctorSummary {
  total: number;
  infos: number;
  warnings: number;
  errors: number;
}

export interface DoctorCommandOutput {
  checks: DoctorCheck[];
  summary: DoctorSummary;
}

export interface DoctorCommandInput {
  provider: SubtitleProvider;
}

const MIN_NODE_VERSION = "22.12.0";

export async function runDoctorCommand(input: DoctorCommandInput): Promise<DoctorCommandOutput> {
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeVersion());
  checks.push({
    id: "provider-registered",
    level: "info",
    ok: true,
    message: `Provider is available: ${input.provider.descriptor.id}`,
    details: {
      provider: input.provider.descriptor,
    },
  });

  if (typeof input.provider.doctor !== "function") {
    checks.push({
      id: "provider-health",
      level: "warn",
      ok: false,
      message: "Provider does not expose a health check.",
    });
  } else {
    try {
      const report = await input.provider.doctor();
      checks.push({
        id: "provider-health",
        level: report.ok ? "info" : "error",
        ok: report.ok,
        message: report.message,
        details: report.details,
        errorCode: report.ok ? undefined : "E_UPSTREAM_BAD_RESPONSE",
      });
    } catch (error) {
      const appError = toCliError(error, "E_UPSTREAM_NETWORK");
      checks.push({
        id: "provider-health",
        level: "error",
        ok: false,
        message: appError.message,
        details: appError.details,
        errorCode: appError.code,
      });
    }
  }

  return {
    checks,
    summary: summarizeChecks(checks),
  };
}

export function getDoctorFailureCode(report: DoctorCommandOutput): CliErrorCode | undefined {
  const errorCheck = report.checks.find((check) => check.level === "error");
  return errorCheck?.errorCode ?? (errorCheck ? "E_UNKNOWN" : undefined);
}

export function renderDoctorOutput(output: DoctorCommandOutput): string {
  const lines = [
    `Doctor summary: ${output.summary.errors} error(s), ${output.summary.warnings} warning(s), ${output.summary.infos} info`,
    ...output.checks.map((check) => `[${check.level}] ${check.id}: ${check.message}`),
  ];

  return lines.join("\n");
}

function checkNodeVersion(): DoctorCheck {
  const current = process.versions.node;

  if (compareSemver(current, MIN_NODE_VERSION) >= 0) {
    return {
      id: "node-version",
      level: "info",
      ok: true,
      message: `Node.js ${current} satisfies >= ${MIN_NODE_VERSION}`,
    };
  }

  return {
    id: "node-version",
    level: "error",
    ok: false,
    message: `Node.js ${current} is below required >= ${MIN_NODE_VERSION}`,
    errorCode: "E_UNKNOWN",
  };
}

function compareSemver(left: string, right: string): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }

  return 0;
}

function parseSemver(value: string): number[] {
  return value
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function summarizeChecks(checks: DoctorCheck[]): DoctorSummary {
  let infos = 0;
  let warnings = 0;
  let errors = 0;

  for (const check of checks) {
    if (check.level === "info") {
      infos += 1;
      continue;
    }

    if (check.level === "warn") {
      warnings += 1;
      continue;
    }

    errors += 1;
  }

  return {
    total: checks.length,
    infos,
    warnings,
    errors,
  };
}

function toCliError(error: unknown, fallbackCode: CliErrorCode): CliAppError {
  if (error instanceof CliAppError) {
    return error;
  }

  if (error instanceof Error) {
    return new CliAppError({
      code: fallbackCode,
      message: error.message,
      details: {
        name: error.name,
      },
      cause: error,
    });
  }

  return new CliAppError({
    code: fallbackCode,
    message: "Unknown error",
    details: error,
  });
}
