import { CliAppError } from "../../core/index.js";

import { tokenize } from "../request-normalization.js";
import type {
  NormalizedSubtitleRequest,
  ProviderSubtitleResult,
  SubtitleProvider,
  SubtitleProviderDescriptor,
} from "../types.js";

const ASSRT_MOCK_DESCRIPTOR: SubtitleProviderDescriptor = {
  id: "assrt",
  name: "ASSRT (mock)",
  mock: true,
  capabilities: {
    search: true,
    download: true,
    doctor: true,
  },
};

const ASSRT_MOCK_DATA: ProviderSubtitleResult[] = [
  {
    id: "assrt-1001",
    providerId: "assrt",
    title: "The Matrix (1999) 1080p BluRay",
    language: "en",
    format: "srt",
    downloads: 1800,
  },
  {
    id: "assrt-1002",
    providerId: "assrt",
    title: "The Matrix (1999) 蓝光版",
    language: "zh-cn",
    format: "srt",
    downloads: 2100,
  },
  {
    id: "assrt-1003",
    providerId: "assrt",
    title: "The Matrix (1999) 繁中字幕",
    language: "zh-tw",
    format: "ass",
    downloads: 900,
  },
  {
    id: "assrt-2001",
    providerId: "assrt",
    title: "Interstellar (2014) 2160p UHD",
    language: "en",
    format: "srt",
    downloads: 1650,
  },
  {
    id: "assrt-3001",
    providerId: "assrt",
    title: "Breaking Bad S01E01 Pilot",
    language: "en",
    format: "vtt",
    downloads: 520,
    hearingImpaired: true,
  },
];

export function createAssrtMockProvider(
  data: ProviderSubtitleResult[] = ASSRT_MOCK_DATA,
): SubtitleProvider {
  return {
    descriptor: ASSRT_MOCK_DESCRIPTOR,

    async search(request: NormalizedSubtitleRequest): Promise<ProviderSubtitleResult[]> {
      if (request.queryTokens.length === 0) {
        return [];
      }

      return data.filter((item) => matchesRequest(request, item));
    },

    async getDownloadPlan(id: string) {
      const item = findById(data, id);
      return {
        id: item.id,
        providerId: item.providerId,
        fileName: `${safeFileStem(item.title)}.${item.format}`,
        sourceUrl: `https://mock.assrt.net/sub/${encodeURIComponent(item.id)}`,
        format: item.format,
      };
    },

    async downloadSubtitle(id: string) {
      const plan = await this.getDownloadPlan(id);
      const content = new TextEncoder().encode(
        [
          "1",
          "00:00:01,000 --> 00:00:03,000",
          `Mock subtitle payload from ${plan.providerId} for ${plan.id}`,
          "",
        ].join("\n"),
      );

      return {
        ...plan,
        content,
      };
    },

    async doctor() {
      return {
        ok: true,
        message: "ASSRT mock provider is ready.",
        details: {
          mock: true,
          records: data.length,
        },
      };
    },
  };
}

function matchesRequest(request: NormalizedSubtitleRequest, item: ProviderSubtitleResult): boolean {
  const titleTokens = new Set(tokenize(item.title));
  const hasToken = request.queryTokens.some((token) => titleTokens.has(token));
  if (!hasToken) {
    return false;
  }

  if (typeof request.year === "number" && !item.title.includes(String(request.year))) {
    return false;
  }

  if (typeof request.season === "number") {
    const seasonToken = `s${String(request.season).padStart(2, "0")}`;
    const normalizedTitle = item.title.toLowerCase();
    if (!normalizedTitle.includes(seasonToken)) {
      return false;
    }
  }

  if (typeof request.episode === "number") {
    const episodeToken = `e${String(request.episode).padStart(2, "0")}`;
    const normalizedTitle = item.title.toLowerCase();
    if (!normalizedTitle.includes(episodeToken)) {
      return false;
    }
  }

  return true;
}

function findById(data: ProviderSubtitleResult[], id: string): ProviderSubtitleResult {
  const item = data.find((candidate) => candidate.id === id);
  if (item !== undefined) {
    return item;
  }

  throw new CliAppError({
    code: "E_NOT_FOUND_RESOURCE",
    message: `Subtitle not found: ${id}`,
    details: {
      id,
      provider: "assrt",
    },
  });
}

function safeFileStem(title: string): string {
  const stem = title
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return stem.length > 0 ? stem : "subtitle";
}
