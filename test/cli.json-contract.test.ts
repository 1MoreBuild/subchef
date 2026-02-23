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

describe("CLI JSON contract", () => {
  it("returns success envelope for providers", async () => {
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const exitCode = await runCli(["providers", "--json"], {
      stdout,
      stderr,
      requestIdFactory: () => "req-providers",
      clock: () => 1000,
      now: () => new Date("2026-02-18T12:00:00.000Z"),
    });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.read());
    expect(payload).toMatchObject({
      ok: true,
      data: {
        total: 2,
      },
      meta: {
        requestId: "req-providers",
      },
    });
    expect(payload.data.providers.map((item: { id: string }) => item.id)).toEqual([
      "assrt",
      "subhd",
    ]);
    expect(stderr.read()).toBe("");
  });

  it("returns success envelope for search", async () => {
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const exitCode = await runCli(
      [
        "search",
        "--query",
        "matrix",
        "--lang",
        "zh,en",
        "--limit",
        "2",
        "--provider",
        "assrt",
        "--json",
      ],
      {
        stdout,
        stderr,
        requestIdFactory: () => "req-search-json",
        clock: () => 1000,
        now: () => new Date("2026-02-18T12:00:00.000Z"),
      },
    );

    expect(exitCode).toBe(0);

    const payload = JSON.parse(stdout.read());
    expect(payload).toMatchObject({
      ok: true,
      data: {
        provider: "assrt",
        returned: 2,
      },
      meta: {
        requestId: "req-search-json",
      },
    });
    expect(payload.data.items.length).toBeGreaterThan(0);
    expect(payload.data.items[0]).toMatchObject({
      id: expect.any(String),
      score: expect.any(Number),
      rank: expect.any(Number),
    });
    expect(stderr.read()).toBe("");
  });

  it("returns error envelope for argument failures", async () => {
    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const exitCode = await runCli(["download", "--id", "assrt-1001", "--json"], {
      stdout,
      stderr,
      requestIdFactory: () => "req-error-json",
      clock: () => 1000,
      now: () => new Date("2026-02-18T12:00:00.000Z"),
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout.read())).toMatchObject({
      ok: false,
      error: {
        code: "E_ARG_MISSING",
      },
    });
    expect(stderr.read()).toBe("");
  });
});
