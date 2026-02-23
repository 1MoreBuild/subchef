import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

class BufferWriter {
  public chunks: string[] = [];

  public write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  public read(): string {
    return this.chunks.join("");
  }
}

describe("CLI argument validation", () => {
  it("fails when --query is missing for search", async () => {
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const exitCode = await runCli(["search"], {
      stdout,
      stderr,
      requestIdFactory: () => "req-search-missing",
      clock: () => 0,
      now: () => new Date("2026-02-18T12:00:00.000Z"),
    });

    expect(exitCode).toBe(2);
    expect(stderr.read()).toContain("E_ARG_MISSING");
    expect(stdout.read()).toBe("");
  });

  it("fails when provider is unknown", async () => {
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const exitCode = await runCli(["search", "--query", "matrix", "--provider", "unknown"], {
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(stderr.read()).toContain("E_ARG_INVALID");
  });

  it("fails with not-found when fetch gets no match", async () => {
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const exitCode = await runCli(
      ["fetch", "--query", "this should never match", "--output", "./x.srt", "--provider", "assrt"],
      {
        stdout,
        stderr,
      },
    );

    expect(exitCode).toBe(4);
    expect(stderr.read()).toContain("E_NOT_FOUND_RESOURCE");
  });

  it("fails with validation error for invalid integer flags", async () => {
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const exitCode = await runCli(["search", "--query", "matrix", "--limit", "0", "--json"], {
      stdout,
      stderr,
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout.read())).toMatchObject({
      ok: false,
      error: {
        code: "E_ARG_INVALID",
      },
    });
    expect(stderr.read()).toBe("");
  });
});
