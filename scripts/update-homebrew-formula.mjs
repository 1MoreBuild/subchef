#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

function parseArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args.set(key, value);
    index += 1;
  }

  return {
    formula: requiredArg(args, "formula"),
    version: requiredArg(args, "version"),
    url: requiredArg(args, "url"),
    sha256: requiredArg(args, "sha256"),
  };
}

function requiredArg(args, key) {
  const value = args.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`--${key} is required`);
  }
  return value.trim();
}

function replaceOrThrow(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Unable to find ${label} in formula`);
  }
  return source.replace(pattern, replacement);
}

function ensureVersionLine(source, version) {
  const versionPattern = /^(\s*version\s+)"[^"]+"$/m;
  if (versionPattern.test(source)) {
    return source.replace(versionPattern, `$1"${version}"`);
  }

  const homepagePattern = /^(\s*homepage\s+"[^"]+"\s*)$/m;
  if (!homepagePattern.test(source)) {
    throw new Error("Unable to find homepage line to insert version");
  }

  return source.replace(homepagePattern, `$1\n  version "${version}"`);
}

async function main() {
  const { formula, version, url, sha256 } = parseArgs(process.argv.slice(2));

  let content = await readFile(formula, "utf8");
  content = ensureVersionLine(content, version);
  content = replaceOrThrow(content, /^(\s*url\s+)"[^"]+"$/m, `$1"${url}"`, "url");
  content = replaceOrThrow(content, /^(\s*sha256\s+)"[^"]+"$/m, `$1"${sha256}"`, "sha256");

  await writeFile(formula, content, "utf8");
  process.stdout.write(`Updated ${formula} to ${version}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
