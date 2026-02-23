import { describe, expect, it } from "vitest";

import { createSubhdProvider } from "../src/domain/providers/subhd.js";

type FetchImpl = typeof fetch;

function createRequestStub(
  responseFactory: (request: Request) => Response | Promise<Response>,
): FetchImpl {
  const fetchImpl: FetchImpl = async (input, init) => {
    const request = new Request(input, init);
    return responseFactory(request);
  };

  return fetchImpl;
}

const BASE_REQUEST = {
  query: "The Matrix",
  normalizedQuery: "the matrix",
  queryTokens: ["matrix", "the"],
  languagePreferences: ["zh-cn"],
  fingerprint: "the matrix||||zh-cn",
};

describe("SubHD upstream error classification", () => {
  it("maps HTTP 429 to E_UPSTREAM_BAD_RESPONSE (rate-limit)", async () => {
    const provider = createSubhdProvider({
      baseUrl: "https://subhd.test",
      retries: 0,
      fetchImpl: createRequestStub(() => new Response("too many requests", { status: 429 })),
    });

    await expect(provider.search(BASE_REQUEST)).rejects.toMatchObject({
      code: "E_UPSTREAM_BAD_RESPONSE",
      details: {
        classification: "rate-limit",
        status: 429,
      },
    });
  });

  it("maps HTTP 403 challenge pages to anti-bot classification", async () => {
    const provider = createSubhdProvider({
      baseUrl: "https://subhd.test",
      retries: 0,
      fetchImpl: createRequestStub(
        () =>
          new Response("<html><body>Cloudflare challenge-platform captcha</body></html>", {
            status: 403,
          }),
      ),
    });

    await expect(provider.search(BASE_REQUEST)).rejects.toMatchObject({
      code: "E_UPSTREAM_BAD_RESPONSE",
      details: {
        classification: "anti-bot",
        status: 403,
      },
    });
  });

  it("maps AbortError to E_UPSTREAM_TIMEOUT", async () => {
    const provider = createSubhdProvider({
      baseUrl: "https://subhd.test",
      retries: 0,
      timeoutMs: 5,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });

    await expect(provider.search(BASE_REQUEST)).rejects.toMatchObject({
      code: "E_UPSTREAM_TIMEOUT",
    });
  });

  it("maps network failures to E_UPSTREAM_NETWORK", async () => {
    const provider = createSubhdProvider({
      baseUrl: "https://subhd.test",
      retries: 0,
      fetchImpl: async () => {
        throw new TypeError("getaddrinfo ENOTFOUND subhd.test");
      },
    });

    await expect(provider.search(BASE_REQUEST)).rejects.toMatchObject({
      code: "E_UPSTREAM_NETWORK",
    });
  });

  it("classifies SubHD download gate verification as anti-bot", async () => {
    const provider = createSubhdProvider({
      baseUrl: "https://subhd.test",
      retries: 0,
      fetchImpl: createRequestStub((request) => {
        if (request.method === "GET" && request.url.endsWith("/down/xD0xeo")) {
          return new Response('<h5 class="card-header">Matrix 1999</h5>', { status: 200 });
        }

        if (request.method === "POST" && request.url.endsWith("/api/sub/down")) {
          return new Response(
            JSON.stringify({
              success: false,
              pass: false,
              msg: "请进行验证码验证",
              url: null,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      }),
    });

    await expect(provider.getDownloadPlan("subhd:xD0xeo")).rejects.toMatchObject({
      code: "E_UPSTREAM_BAD_RESPONSE",
      details: {
        classification: "anti-bot",
      },
    });
  });
});
