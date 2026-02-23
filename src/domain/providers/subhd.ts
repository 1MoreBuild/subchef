import { CliAppError } from "../../core/index.js";

import { looksLikeAntiBotChallenge, UpstreamClient } from "./upstream-client.js";
import {
  inferSubtitleFormat,
  parseSubhdDownloadPage,
  parseSubhdSearchItems,
  sanitizeFileStem,
} from "./subhd-parser.js";
import type {
  NormalizedSubtitleRequest,
  ProviderSubtitleResult,
  SubtitleDownloadPlan,
  SubtitleFormat,
  SubtitlePayload,
  SubtitleProvider,
  SubtitleProviderDescriptor,
} from "../types.js";

export interface SubhdProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface SubhdDownloadApiPayload {
  success?: boolean;
  pass?: boolean;
  msg?: string;
  url?: string;
}

const SUBHD_DESCRIPTOR: SubtitleProviderDescriptor = {
  id: "subhd",
  name: "SubHD",
  mock: false,
  capabilities: {
    search: true,
    download: true,
    doctor: true,
  },
};

const SUBHD_ID_PREFIX = "subhd:";

export function createSubhdProvider(options: SubhdProviderOptions = {}): SubtitleProvider {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const client = new UpstreamClient({
    providerId: "subhd",
    baseUrl,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    backoffMs: options.backoffMs,
    maxBackoffMs: options.maxBackoffMs,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    userAgent: "subtitle-cli/subhd",
  });

  return {
    descriptor: SUBHD_DESCRIPTOR,

    async search(request: NormalizedSubtitleRequest): Promise<ProviderSubtitleResult[]> {
      if (request.queryTokens.length === 0) {
        return [];
      }

      const html = await client.requestText({
        pathOrUrl: `/search/${encodeURIComponent(request.query)}`,
        headers: {
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
        },
      });

      if (looksLikeAntiBotChallenge(html)) {
        throw createSubhdChallengeError({
          url: `${baseUrl}search/${encodeURIComponent(request.query)}`,
          reason: "search-page-challenge",
        });
      }

      return parseSubhdSearchItems(html)
        .filter((item) => matchesRequest(item.title, request))
        .map((item) => ({
          id: toSubhdProviderId(item.sid),
          providerId: "subhd",
          title: item.title,
          language: item.language,
          format: item.format,
          downloads: item.downloads,
          hearingImpaired: item.hearingImpaired,
          releaseName: item.title,
        }));
    },

    async getDownloadPlan(id: string): Promise<SubtitleDownloadPlan> {
      const sid = parseSubhdProviderId(id);
      const downPath = `/down/${encodeURIComponent(sid)}`;
      const downPageUrl = `${baseUrl}down/${encodeURIComponent(sid)}`;

      const html = await client.requestText({
        pathOrUrl: downPath,
        headers: {
          referer: `${baseUrl}a/${encodeURIComponent(sid)}`,
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
        },
      });

      if (looksLikeAntiBotChallenge(html)) {
        throw createSubhdChallengeError({
          url: downPageUrl,
          reason: "download-gate-challenge",
        });
      }

      const page = parseSubhdDownloadPage(html, sid);

      const apiPayload = await client.requestJson<SubhdDownloadApiPayload>({
        pathOrUrl: "/api/sub/down",
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*",
          origin: new URL(baseUrl).origin,
          referer: downPageUrl,
        },
        body: JSON.stringify({ sid, cap: "" }),
      });

      const sourceUrl = resolveSubhdDownloadUrl(baseUrl, apiPayload.url);
      if (sourceUrl === undefined || apiPayload.success !== true || apiPayload.pass !== true) {
        throw createSubhdDownloadApiError(sid, apiPayload, downPageUrl);
      }

      const sourceFormat = inferSubtitleFormatFromUrl(sourceUrl);
      const format = sourceFormat ?? page.format ?? "srt";
      const fileName = selectFileName(page.fileStem, sourceUrl, format);

      return {
        id: toSubhdProviderId(sid),
        providerId: "subhd",
        fileName,
        sourceUrl,
        format,
      };
    },

    async downloadSubtitle(id: string): Promise<SubtitlePayload> {
      const plan = await this.getDownloadPlan(id);
      const sid = parseSubhdProviderId(plan.id);
      const content = await client.requestBinary({
        pathOrUrl: plan.sourceUrl,
        headers: {
          referer: `${baseUrl}down/${encodeURIComponent(sid)}`,
        },
      });

      return {
        ...plan,
        content,
      };
    },

    async doctor() {
      try {
        const html = await client.requestText({
          pathOrUrl: "/",
          headers: {
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
          },
        });

        if (looksLikeAntiBotChallenge(html)) {
          return {
            ok: false,
            message: "SubHD reachable, but anti-bot challenge is active.",
            details: {
              provider: "subhd",
              baseUrl,
              classification: "anti-bot",
            },
          };
        }

        return {
          ok: true,
          message: "SubHD provider is reachable.",
          details: {
            provider: "subhd",
            baseUrl,
          },
        };
      } catch (error) {
        const appError = error instanceof CliAppError ? error : toSubhdUnknownError(error);
        return {
          ok: false,
          message: appError.message,
          details: {
            provider: "subhd",
            code: appError.code,
            details: appError.details,
          },
        };
      }
    },
  };
}

export function toSubhdProviderId(sid: string): string {
  return `${SUBHD_ID_PREFIX}${sid}`;
}

export function parseSubhdProviderId(id: string): string {
  const normalized = id.trim();
  if (normalized.startsWith(SUBHD_ID_PREFIX)) {
    const sid = normalized.slice(SUBHD_ID_PREFIX.length);
    if (/^[A-Za-z0-9]+$/u.test(sid)) {
      return sid;
    }
  }

  if (/^[A-Za-z0-9]+$/u.test(normalized)) {
    return normalized;
  }

  throw new CliAppError({
    code: "E_NOT_FOUND_RESOURCE",
    message: `SubHD subtitle not found: ${id}`,
    details: {
      provider: "subhd",
      id,
    },
  });
}

function resolveSubhdDownloadUrl(baseUrl: string, value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function createSubhdDownloadApiError(
  sid: string,
  payload: SubhdDownloadApiPayload,
  url: string,
): CliAppError {
  const message = normalizeErrorMessage(payload.msg);

  if (
    payload.success === false &&
    (looksLikeAntiBotChallenge(message) || /临时页面|验证|验证码/u.test(message))
  ) {
    return createSubhdChallengeError({
      url,
      reason: "download-gate-rejected",
      sid,
      message,
    });
  }

  if (payload.success === false && /频繁|次数|rate\s*limit|too\s*many/iu.test(message)) {
    return new CliAppError({
      code: "E_UPSTREAM_BAD_RESPONSE",
      message: "SubHD rate limited the download request",
      details: {
        provider: "subhd",
        sid,
        url,
        classification: "rate-limit",
        message,
      },
    });
  }

  return new CliAppError({
    code: "E_UPSTREAM_BAD_RESPONSE",
    message: "SubHD download gate returned an unexpected response",
    details: {
      provider: "subhd",
      sid,
      url,
      classification: "bad-response",
      payload,
    },
  });
}

function createSubhdChallengeError(input: {
  url: string;
  reason: string;
  sid?: string;
  message?: string;
}): CliAppError {
  return new CliAppError({
    code: "E_UPSTREAM_BAD_RESPONSE",
    message: "SubHD requires anti-bot verification before download",
    details: {
      provider: "subhd",
      classification: "anti-bot",
      url: input.url,
      reason: input.reason,
      sid: input.sid,
      message: input.message,
    },
  });
}

function inferSubtitleFormatFromUrl(url: string): SubtitleFormat | undefined {
  const match = /\.([A-Za-z0-9]{2,5})(?:$|[?#])/u.exec(url);
  if (match?.[1] === undefined) {
    return undefined;
  }

  return inferSubtitleFormat(match[1]);
}

function selectFileName(fileStem: string, sourceUrl: string, format: SubtitleFormat): string {
  const pathname = (() => {
    try {
      return new URL(sourceUrl).pathname;
    } catch {
      return "";
    }
  })();

  const baseName = pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .at(-1);
  if (baseName !== undefined && baseName.length > 0) {
    return decodeURIComponent(baseName);
  }

  return `${sanitizeFileStem(fileStem)}.${format}`;
}

function matchesRequest(title: string, request: NormalizedSubtitleRequest): boolean {
  const normalizedTitle = title.toLowerCase();

  if (typeof request.year === "number" && !normalizedTitle.includes(String(request.year))) {
    return false;
  }

  if (typeof request.season === "number") {
    const seasonToken = `s${String(request.season).padStart(2, "0")}`;
    if (!normalizedTitle.includes(seasonToken)) {
      return false;
    }
  }

  if (typeof request.episode === "number") {
    const episodeToken = `e${String(request.episode).padStart(2, "0")}`;
    if (!normalizedTitle.includes(episodeToken)) {
      return false;
    }
  }

  return true;
}

function normalizeErrorMessage(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}

function normalizeBaseUrl(value: string | undefined): string {
  if (typeof value !== "string") {
    return "https://subhd.tv/";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "https://subhd.tv/";
  }

  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function toSubhdUnknownError(error: unknown): CliAppError {
  if (error instanceof CliAppError) {
    return error;
  }

  return new CliAppError({
    code: "E_UNKNOWN",
    message: error instanceof Error ? error.message : "Unknown SubHD provider failure",
    details: {
      name: error instanceof Error ? error.name : undefined,
    },
    cause: error,
  });
}
