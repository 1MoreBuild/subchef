import { describe, expect, it } from "vitest";

import { createDefaultProviderMap, resolveProvider } from "../src/domain/providers.js";
import { normalizeSubtitleRequest } from "../src/domain/request-normalization.js";

describe("provider priority and fallback selection", () => {
  it("uses SubHD as default provider when none is specified", () => {
    const providers = createDefaultProviderMap();
    const resolved = resolveProvider(providers, undefined);

    expect(resolved?.descriptor.id).toBe("subhd");
  });

  it("keeps ASSRT fallback available via explicit provider override", async () => {
    const providers = createDefaultProviderMap();
    const assrt = resolveProvider(providers, "assrt");

    expect(assrt?.descriptor.id).toBe("assrt");

    const request = normalizeSubtitleRequest({
      query: "The Matrix",
      languages: ["zh-cn", "en"],
    });

    const results = await assrt?.search(request);
    expect(results?.length).toBeGreaterThan(0);
    expect(results?.[0]?.providerId).toBe("assrt");
  });
});
