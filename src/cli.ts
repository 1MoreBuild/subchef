import { stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createRequire } from "node:module";

import {
  CliAppError,
  createCommandContext,
  createErrorEnvelope,
  createSuccessEnvelope,
  EXIT_CODES,
  mapErrorCodeToExitCode,
  toCliAppError,
} from "./core/index.js";

import { getDoctorFailureCode, renderDoctorOutput, runDoctorCommand } from "./commands/doctor.js";
import { renderDownloadOutput, runDownloadCommand } from "./commands/download.js";
import { renderFetchOutput, runFetchCommand } from "./commands/fetch.js";
import { renderProvidersOutput, runProvidersCommand } from "./commands/providers.js";
import { renderSearchOutput, runSearchCommand } from "./commands/search.js";
import {
  createDefaultProviderMap,
  listProviders,
  resolveProvider,
  type SubtitleProviderMap,
} from "./domain/providers.js";
import { normalizeSubtitleRequest } from "./domain/request-normalization.js";

type FlagValue = string | string[] | boolean;

interface WritableLike {
  write(chunk: string): unknown;
}

export interface SubCliDeps {
  providers?: SubtitleProviderMap;
  stdout?: WritableLike;
  stderr?: WritableLike;
  fileWriter?: (path: string, content: Uint8Array) => Promise<void>;
  clock?: () => number;
  now?: () => Date;
  requestIdFactory?: () => string;
}

interface ParsedArgs {
  command: string | undefined;
  flags: Map<string, FlagValue>;
  positional: string[];
}

interface HelpTarget {
  command?: string;
}

interface VersionInfo {
  name: string;
  version: string;
}

interface DispatchResult {
  data: unknown;
  humanOutput: string;
}

const SHORT_FLAG_ALIASES: Record<string, string> = {
  "-h": "help",
  "-V": "version",
  "-v": "verbose",
};

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_FETCH_LIMIT = 5;
const CLI_VERSION = loadVersionInfo();

export async function runCli(argv: string[], deps: SubCliDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const parsed = parseArgs(argv);
  const json = getBooleanFlag(parsed.flags, "json");
  const verbose = getBooleanFlag(parsed.flags, "verbose");

  const context = createCommandContext({
    clock: deps.clock,
    now: deps.now,
    requestIdFactory: deps.requestIdFactory,
    verbose,
  });

  if (hasFlag(parsed.flags, "version") || parsed.command === "version") {
    if (json) {
      stdout.write(`${JSON.stringify(createSuccessEnvelope(CLI_VERSION, context.toMeta()))}\n`);
    } else {
      stdout.write(`${CLI_VERSION.name} ${CLI_VERSION.version}\n`);
    }
    return EXIT_CODES.SUCCESS;
  }

  if (parsed.command === undefined || parsed.command === "help" || hasFlag(parsed.flags, "help")) {
    const helpTarget = resolveHelpTarget(parsed);
    const help = renderHelp(helpTarget.command);
    if (json) {
      const payload: Record<string, unknown> = {
        help,
      };
      if (helpTarget.command) {
        payload.command = helpTarget.command;
      }
      stdout.write(`${JSON.stringify(createSuccessEnvelope(payload, context.toMeta()))}\n`);
    } else {
      stdout.write(`${help}\n`);
    }
    return EXIT_CODES.SUCCESS;
  }

  try {
    const result = await dispatch(parsed, {
      providers: deps.providers ?? createDefaultProviderMap(),
      fileWriter: deps.fileWriter ?? writeFile,
    });

    if (json) {
      stdout.write(`${JSON.stringify(createSuccessEnvelope(result.data, context.toMeta()))}\n`);
    } else {
      stdout.write(`${result.humanOutput}\n`);
    }

    return EXIT_CODES.SUCCESS;
  } catch (error) {
    const appError = toCliAppError(error);
    const exitCode = mapErrorCodeToExitCode(appError.code);

    if (json) {
      stdout.write(
        `${JSON.stringify(createErrorEnvelope(appError.code, appError.message, appError.details))}\n`,
      );
    } else {
      stderr.write(formatHumanError(appError));
    }

    return exitCode;
  }
}

interface DispatchDeps {
  providers: SubtitleProviderMap;
  fileWriter: (path: string, content: Uint8Array) => Promise<void>;
}

async function dispatch(parsed: ParsedArgs, deps: DispatchDeps): Promise<DispatchResult> {
  switch (parsed.command) {
    case "providers":
      return dispatchProviders(parsed, deps);
    case "doctor":
      return dispatchDoctor(parsed, deps);
    case "search":
      return dispatchSearch(parsed, deps);
    case "download":
      return dispatchDownload(parsed, deps);
    case "fetch":
      return dispatchFetch(parsed, deps);
    default:
      throw createArgumentError("E_ARG_UNSUPPORTED", `Unknown command: ${parsed.command}`, {
        command: parsed.command,
      });
  }
}

async function dispatchProviders(parsed: ParsedArgs, deps: DispatchDeps): Promise<DispatchResult> {
  if (parsed.positional.length > 0) {
    throw createArgumentError(
      "E_ARG_UNSUPPORTED",
      "providers command does not accept subcommands",
      {
        positional: parsed.positional,
      },
    );
  }

  const output = runProvidersCommand(listProviders(deps.providers));
  return {
    data: output,
    humanOutput: renderProvidersOutput(output),
  };
}

async function dispatchDoctor(parsed: ParsedArgs, deps: DispatchDeps): Promise<DispatchResult> {
  if (parsed.positional.length > 0) {
    throw createArgumentError("E_ARG_UNSUPPORTED", "doctor command does not accept subcommands", {
      positional: parsed.positional,
    });
  }

  const provider = getProviderOrThrow(parsed.flags, deps.providers);
  const output = await runDoctorCommand({ provider });

  const failureCode = getDoctorFailureCode(output);
  if (failureCode !== undefined) {
    throw new CliAppError({
      code: failureCode,
      message: `Doctor found ${output.summary.errors} error(s).`,
      details: output,
    });
  }

  return {
    data: output,
    humanOutput: renderDoctorOutput(output),
  };
}

async function dispatchSearch(parsed: ParsedArgs, deps: DispatchDeps): Promise<DispatchResult> {
  if (parsed.positional.length > 0) {
    throw createArgumentError("E_ARG_UNSUPPORTED", "search command does not accept subcommands", {
      positional: parsed.positional,
    });
  }

  const provider = getProviderOrThrow(parsed.flags, deps.providers);
  const query = getRequiredString(parsed.flags, "query");
  const year = getOptionalPositiveInteger(parsed.flags, "year");
  const season = getOptionalPositiveInteger(parsed.flags, "season");
  const episode = getOptionalPositiveInteger(parsed.flags, "episode");
  const limit = getPositiveInteger(parsed.flags, "limit", DEFAULT_SEARCH_LIMIT);
  const languages = [
    ...getStringValues(parsed.flags, "lang"),
    ...getStringValues(parsed.flags, "language"),
  ];

  const request = normalizeSubtitleRequest({
    query,
    year,
    season,
    episode,
    languages: splitCommaSeparated(languages),
  });

  const output = await runSearchCommand({
    provider,
    request,
    limit,
  });

  return {
    data: output,
    humanOutput: renderSearchOutput(output),
  };
}

async function dispatchDownload(parsed: ParsedArgs, deps: DispatchDeps): Promise<DispatchResult> {
  if (parsed.positional.length > 0) {
    throw createArgumentError("E_ARG_UNSUPPORTED", "download command does not accept subcommands", {
      positional: parsed.positional,
    });
  }

  const provider = getProviderOrThrow(parsed.flags, deps.providers);
  const id = getRequiredString(parsed.flags, "id");
  const outputPath = getRequiredString(parsed.flags, "output");
  const dryRun = getBooleanFlag(parsed.flags, "dry-run");

  const output = await runDownloadCommand({
    provider,
    id,
    outputPath,
    dryRun,
    writeFile: deps.fileWriter,
    resolveOutputPath: resolveDownloadOutputPath,
  });

  return {
    data: output,
    humanOutput: renderDownloadOutput(output),
  };
}

async function dispatchFetch(parsed: ParsedArgs, deps: DispatchDeps): Promise<DispatchResult> {
  if (parsed.positional.length > 0) {
    throw createArgumentError("E_ARG_UNSUPPORTED", "fetch command does not accept subcommands", {
      positional: parsed.positional,
    });
  }

  const provider = getProviderOrThrow(parsed.flags, deps.providers);
  const query = getRequiredString(parsed.flags, "query");
  const year = getOptionalPositiveInteger(parsed.flags, "year");
  const season = getOptionalPositiveInteger(parsed.flags, "season");
  const episode = getOptionalPositiveInteger(parsed.flags, "episode");
  const outputPath = getRequiredString(parsed.flags, "output");
  const dryRun = getBooleanFlag(parsed.flags, "dry-run");
  const limit = getPositiveInteger(parsed.flags, "limit", DEFAULT_FETCH_LIMIT);
  const languages = [
    ...getStringValues(parsed.flags, "lang"),
    ...getStringValues(parsed.flags, "language"),
  ];

  const request = normalizeSubtitleRequest({
    query,
    year,
    season,
    episode,
    languages: splitCommaSeparated(languages),
  });

  const output = await runFetchCommand({
    provider,
    request,
    outputPath,
    dryRun,
    limit,
    writeFile: deps.fileWriter,
    resolveOutputPath: resolveDownloadOutputPath,
  });

  return {
    data: output,
    humanOutput: renderFetchOutput(output),
  };
}

async function resolveDownloadOutputPath(path: string, fileName: string): Promise<string> {
  try {
    const fileStat = await stat(path);
    if (fileStat.isDirectory()) {
      return join(path, basename(fileName));
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  return path;
}

function getProviderOrThrow(
  flags: Map<string, FlagValue>,
  providers: SubtitleProviderMap,
): SubtitleProviderMap[string] {
  const providerId = getOptionalString(flags, "provider");
  const provider = resolveProvider(providers, providerId);

  if (provider !== undefined) {
    return provider;
  }

  throw createArgumentError("E_ARG_INVALID", `Unknown provider: ${providerId}`, {
    arg: "provider",
    value: providerId,
    allowed: listProviders(providers).map((item) => item.id),
  });
}

function parseArgs(argv: string[]): ParsedArgs {
  let command: string | undefined;
  const flags = new Map<string, FlagValue>();
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    const shortAlias = SHORT_FLAG_ALIASES[token];
    if (shortAlias !== undefined) {
      flags.set(shortAlias, true);
      continue;
    }

    if (token.startsWith("--")) {
      const stripped = token.slice(2);
      const eqIndex = stripped.indexOf("=");
      if (eqIndex >= 0) {
        const key = stripped.slice(0, eqIndex);
        const value = stripped.slice(eqIndex + 1);
        appendFlagValue(flags, key, value);
        continue;
      }

      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        appendFlagValue(flags, stripped, next);
        index += 1;
        continue;
      }

      flags.set(stripped, true);
      continue;
    }

    if (command === undefined) {
      command = token;
      continue;
    }

    positional.push(token);
  }

  return {
    command,
    flags,
    positional,
  };
}

function hasFlag(flags: Map<string, FlagValue>, key: string): boolean {
  return flags.has(key);
}

function appendFlagValue(flags: Map<string, FlagValue>, key: string, value: string): void {
  const previous = flags.get(key);
  if (previous === undefined) {
    flags.set(key, value);
    return;
  }

  if (Array.isArray(previous)) {
    flags.set(key, [...previous, value]);
    return;
  }

  if (typeof previous === "string") {
    flags.set(key, [previous, value]);
    return;
  }

  flags.set(key, value);
}

function getBooleanFlag(flags: Map<string, FlagValue>, key: string): boolean {
  const value = flags.get(key);
  if (value === undefined) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const candidate = value.at(-1);
    if (candidate === "true") {
      return true;
    }
    if (candidate === "false") {
      return false;
    }
    throw createArgumentError("E_ARG_INVALID", `--${key} must be true or false`, {
      arg: key,
      value: candidate,
    });
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw createArgumentError("E_ARG_INVALID", `--${key} must be true or false`, {
    arg: key,
    value,
  });
}

function getRequiredString(flags: Map<string, FlagValue>, key: string): string {
  const value = getOptionalString(flags, key);
  if (value === undefined || value.trim().length === 0) {
    throw createArgumentError("E_ARG_MISSING", `--${key} is required`, {
      arg: key,
    });
  }

  return value;
}

function getOptionalString(flags: Map<string, FlagValue>, key: string): string | undefined {
  const value = flags.get(key);

  if (value === undefined || typeof value === "boolean") {
    return undefined;
  }

  if (Array.isArray(value)) {
    const candidate = value.at(-1);
    return candidate !== undefined && candidate.trim().length > 0 ? candidate : undefined;
  }

  return value.trim().length > 0 ? value : undefined;
}

function getStringValues(flags: Map<string, FlagValue>, key: string): string[] {
  const value = flags.get(key);

  if (value === undefined || typeof value === "boolean") {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  return values.filter((item) => item.trim().length > 0);
}

function getPositiveInteger(flags: Map<string, FlagValue>, key: string, fallback: number): number {
  const value = getOptionalString(flags, key);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createArgumentError("E_ARG_INVALID", `--${key} must be a positive integer`, {
      arg: key,
      value,
    });
  }

  return parsed;
}

function getOptionalPositiveInteger(
  flags: Map<string, FlagValue>,
  key: string,
): number | undefined {
  const value = getOptionalString(flags, key);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createArgumentError("E_ARG_INVALID", `--${key} must be a positive integer`, {
      arg: key,
      value,
    });
  }

  return parsed;
}

function splitCommaSeparated(values: string[]): string[] {
  return values
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveHelpTarget(parsed: ParsedArgs): HelpTarget {
  if (parsed.command === "help") {
    return {
      command: parsed.positional[0],
    };
  }

  if (hasFlag(parsed.flags, "help")) {
    return {
      command: parsed.command,
    };
  }

  return {};
}

function renderHelp(command?: string): string {
  if (command === "search") {
    return [
      "sub search",
      "",
      "Usage:",
      "  sub search --query <text> [--lang <code>] [--year <yyyy>] [--season <n>] [--episode <n>] [--provider <id>] [--limit <n, default 10>] [--json]",
    ].join("\n");
  }

  if (command === "fetch") {
    return [
      "sub fetch",
      "",
      "Usage:",
      "  sub fetch --query <text> --output <path|directory> [--lang <code>] [--year <yyyy>] [--season <n>] [--episode <n>] [--provider <id>] [--limit <n, default 5>] [--dry-run] [--json]",
      "Notes:",
      "  fetch = search + ranking + top candidate download",
    ].join("\n");
  }

  if (command === "download") {
    return [
      "sub download",
      "",
      "Usage:",
      "  sub download --id <subtitle-id> --output <path|directory> [--provider <id>] [--dry-run] [--json]",
    ].join("\n");
  }

  if (command === "doctor") {
    return ["sub doctor", "", "Usage:", "  sub doctor [--provider <id>] [--json]"].join("\n");
  }

  if (command === "providers") {
    return ["sub providers", "", "Usage:", "  sub providers [--json]"].join("\n");
  }

  if (command === "version") {
    return ["sub version", "", "Usage:", "  sub version [--json]"].join("\n");
  }

  return [
    "sub CLI",
    "",
    "Usage:",
    "  sub [--help|-h] [--version|-V]",
    "  sub help [command]",
    "  sub version [--json]",
    "  sub providers [--json]",
    "  sub doctor [--provider <id>] [--json]",
    "  sub search --query <text> [--lang <code>] [--year <yyyy>] [--season <n>] [--episode <n>] [--provider <id>] [--limit <n>] [--json]",
    "  sub fetch --query <text> --output <path|directory> [--lang <code>] [--year <yyyy>] [--season <n>] [--episode <n>] [--provider <id>] [--limit <n>] [--dry-run] [--json]",
    "  sub download --id <subtitle-id> --output <path|directory> [--provider <id>] [--dry-run] [--json]",
    "",
    "Flags:",
    "  -h, --help      Show help",
    "  -V, --version   Show CLI version",
    "  --json          Output CliEnvelope JSON",
    "  --dry-run       Validate and show write plan without writing files",
    "  -v, --verbose   Include verbose mode in metadata",
  ].join("\n");
}

function loadVersionInfo(): VersionInfo {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { name?: string; version?: string };
    return {
      name: typeof pkg.name === "string" ? pkg.name : "subtitle-cli",
      version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
    };
  } catch {
    return {
      name: "subtitle-cli",
      version: "0.0.0",
    };
  }
}

function createArgumentError(
  code: "E_ARG_INVALID" | "E_ARG_MISSING" | "E_ARG_CONFLICT" | "E_ARG_UNSUPPORTED",
  message: string,
  details?: unknown,
): CliAppError {
  return new CliAppError({
    code,
    message,
    details,
  });
}

function formatHumanError(error: CliAppError): string {
  const details = error.details === undefined ? "" : `\nDetails: ${JSON.stringify(error.details)}`;
  return `Error (${error.code}): ${error.message}${details}\n`;
}
