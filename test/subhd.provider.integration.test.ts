import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSubhdProvider } from "../src/domain/providers/subhd.js";

type FetchImpl = typeof fetch;

type MockCall = {
  method: string;
  url: URL;
  body: string;
  headers: Headers;
};

function createMockFetch(handler: (call: MockCall) => Response | Promise<Response>): {
  fetchImpl: FetchImpl;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];

  const fetchImpl: FetchImpl = async (input, init) => {
    const request = new Request(input, init);
    const body = request.body === null ? "" : await request.text();

    const call: MockCall = {
      method: request.method,
      url: new URL(request.url),
      body,
      headers: new Headers(request.headers),
    };

    calls.push(call);
    return handler(call);
  };

  return { fetchImpl, calls };
}

const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "subhd");

describe("SubHD provider integration (mocked upstream)", () => {
  it("searches, resolves download plan, and downloads subtitle bytes", async () => {
    const searchHtml = await readFile(join(FIXTURE_DIR, "search.matrix.html"), "utf8");
    const downHtml = await readFile(join(FIXTURE_DIR, "down.xD0xeo.html"), "utf8");

    const { fetchImpl, calls } = createMockFetch((call) => {
      if (call.method === "GET" && call.url.pathname === "/search/The%20Matrix") {
        return new Response(searchHtml, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (call.method === "GET" && call.url.pathname === "/down/xD0xeo") {
        return new Response(downHtml, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "set-cookie": "tk_mock=abc123; Path=/; HttpOnly",
          },
        });
      }

      if (call.method === "POST" && call.url.pathname === "/api/sub/down") {
        return new Response(
          JSON.stringify({
            success: true,
            pass: true,
            msg: "ok",
            url: "https://dl.subhd.test/files/The.Matrix.1999.ass",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (call.method === "GET" && call.url.hostname === "dl.subhd.test") {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }

      return new Response("not found", { status: 404 });
    });

    const provider = createSubhdProvider({
      baseUrl: "https://subhd.test",
      fetchImpl,
      retries: 0,
    });

    const request = {
      query: "The Matrix",
      normalizedQuery: "the matrix",
      queryTokens: ["matrix", "the"],
      year: 1999,
      languagePreferences: ["zh-cn", "en"],
      fingerprint: "the matrix|1999|||zh-cn,en",
    };

    const results = await provider.search(request);
    expect(results[0]).toMatchObject({
      id: "subhd:xD0xeo",
      providerId: "subhd",
      format: "ass",
    });

    const plan = await provider.getDownloadPlan("subhd:xD0xeo");
    expect(plan).toMatchObject({
      id: "subhd:xD0xeo",
      providerId: "subhd",
      sourceUrl: "https://dl.subhd.test/files/The.Matrix.1999.ass",
      fileName: "The.Matrix.1999.ass",
      format: "ass",
    });

    const payload = await provider.downloadSubtitle("subhd:xD0xeo");
    expect(Array.from(payload.content)).toEqual([1, 2, 3, 4]);

    const apiCall = calls.find(
      (call) => call.method === "POST" && call.url.pathname === "/api/sub/down",
    );

    expect(apiCall?.headers.get("cookie")).toContain("tk_mock=abc123");
  });
});
