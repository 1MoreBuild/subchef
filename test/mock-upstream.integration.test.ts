import { describe, expect, it } from "vitest";

import { createAssrtMockProvider } from "../src/domain/providers/assrt-mock.js";
import { normalizeSubtitleRequest } from "../src/domain/request-normalization.js";

describe("mock upstream integration", () => {
  it("search + plan + download returns consistent ids", async () => {
    const provider = createAssrtMockProvider();
    const request = normalizeSubtitleRequest({
      query: "matrix",
      languages: ["zh-cn", "en"],
    });

    const candidates = await provider.search(request);
    expect(candidates.length).toBeGreaterThan(0);

    const plan = await provider.getDownloadPlan(candidates[0].id);
    const payload = await provider.downloadSubtitle(plan.id);

    expect(plan.id).toBe(payload.id);
    expect(plan.fileName).toBe(payload.fileName);
    expect(payload.sourceUrl).toContain(payload.id);
    expect(payload.content.byteLength).toBeGreaterThan(0);
  });
});
