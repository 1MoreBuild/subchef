import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import type { NormalizedSubtitleRequest, SubtitleProvider } from "../src/domain/types.js";

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

describe("dry-run behavior", () => {
  it("download --dry-run does not write files", async () => {
    let getPlanCalls = 0;
    let downloadCalls = 0;
    let writeCalls = 0;

    const provider: SubtitleProvider = {
      descriptor: {
        id: "assrt",
        name: "ASSRT mock test",
        mock: true,
        capabilities: {
          search: true,
          download: true,
          doctor: false,
        },
      },
      async search() {
        return [];
      },
      async getDownloadPlan(id) {
        getPlanCalls += 1;
        return {
          id,
          providerId: "assrt",
          fileName: `${id}.srt`,
          sourceUrl: `https://mock.assrt.net/sub/${id}`,
          format: "srt",
        };
      },
      async downloadSubtitle(id) {
        downloadCalls += 1;
        return {
          id,
          providerId: "assrt",
          fileName: `${id}.srt`,
          sourceUrl: `https://mock.assrt.net/sub/${id}`,
          format: "srt",
          content: new TextEncoder().encode("payload"),
        };
      },
    };

    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const exitCode = await runCli(
      ["download", "--id", "assrt-1002", "--output", "/tmp/assrt-1002.srt", "--dry-run", "--json"],
      {
        providers: {
          assrt: provider,
        },
        stdout,
        stderr,
        fileWriter: async () => {
          writeCalls += 1;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(getPlanCalls).toBe(1);
    expect(downloadCalls).toBe(0);
    expect(writeCalls).toBe(0);
    expect(JSON.parse(stdout.read())).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        bytesWritten: 0,
      },
    });
    expect(stderr.read()).toBe("");
  });

  it("fetch --dry-run does not write files", async () => {
    let searchCalls = 0;
    let getPlanCalls = 0;
    let downloadCalls = 0;
    let writeCalls = 0;

    const provider: SubtitleProvider = {
      descriptor: {
        id: "assrt",
        name: "ASSRT mock test",
        mock: true,
        capabilities: {
          search: true,
          download: true,
          doctor: false,
        },
      },
      async search(_request: NormalizedSubtitleRequest) {
        searchCalls += 1;
        return [
          {
            id: "assrt-1002",
            providerId: "assrt",
            title: "The Matrix (1999) 蓝光版",
            language: "zh-cn",
            format: "srt",
            downloads: 2000,
          },
        ];
      },
      async getDownloadPlan(id) {
        getPlanCalls += 1;
        return {
          id,
          providerId: "assrt",
          fileName: `${id}.srt`,
          sourceUrl: `https://mock.assrt.net/sub/${id}`,
          format: "srt",
        };
      },
      async downloadSubtitle(id) {
        downloadCalls += 1;
        return {
          id,
          providerId: "assrt",
          fileName: `${id}.srt`,
          sourceUrl: `https://mock.assrt.net/sub/${id}`,
          format: "srt",
          content: new TextEncoder().encode("payload"),
        };
      },
    };

    const stdout = new BufferWriter();
    const stderr = new BufferWriter();

    const exitCode = await runCli(
      [
        "fetch",
        "--query",
        "matrix",
        "--lang",
        "zh-cn",
        "--output",
        "/tmp/assrt-1002.srt",
        "--dry-run",
        "--json",
      ],
      {
        providers: {
          assrt: provider,
        },
        stdout,
        stderr,
        fileWriter: async () => {
          writeCalls += 1;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(searchCalls).toBe(1);
    expect(getPlanCalls).toBe(1);
    expect(downloadCalls).toBe(0);
    expect(writeCalls).toBe(0);
    expect(JSON.parse(stdout.read())).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        selected: {
          id: "assrt-1002",
        },
      },
    });
    expect(stderr.read()).toBe("");
  });
});
