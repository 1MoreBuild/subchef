import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseSubhdDownloadPage,
  parseSubhdSearchItems,
} from "../src/domain/providers/subhd-parser.js";

const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "subhd");

describe("SubHD parser fixtures", () => {
  it("parses search cards into normalized candidates", async () => {
    const html = await readFile(join(FIXTURE_DIR, "search.matrix.html"), "utf8");
    const items = parseSubhdSearchItems(html);

    expect(items).toMatchObject([
      {
        sid: "xD0xeo",
        language: "zh-cn",
        format: "ass",
        downloads: 247,
      },
      {
        sid: "MWFf2n",
        language: "zh-tw",
        format: "srt",
        downloads: 52,
      },
    ]);

    expect(items[0]?.title).toContain("The.Matrix.1999");
  });

  it("parses download page metadata", async () => {
    const html = await readFile(join(FIXTURE_DIR, "down.xD0xeo.html"), "utf8");
    const page = parseSubhdDownloadPage(html, "xD0xeo");

    expect(page).toMatchObject({
      sid: "xD0xeo",
      format: "ass",
    });
    expect(page.fileStem).toContain("The.Matrix.1999");
  });
});
