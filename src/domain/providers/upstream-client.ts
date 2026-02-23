import { CliAppError } from "../../core/index.js";

export interface UpstreamClientOptions {
  providerId: string;
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  sleep?: (ms: number) => Promise<void>;
}

export interface UpstreamRequestOptions {
  pathOrUrl: string;
  method?: "GET" | "POST";
  headers?: RequestInit["headers"];
  body?: RequestInit["body"];
}

export interface ClassifiedResponseErrorDetails {
  provider: string;
  url: string;
  status: number;
  classification: "rate-limit" | "anti-bot" | "bad-response";
  snippet?: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class UpstreamClient {
  private readonly providerId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cookieJar = new Map<string, string>();
  private readonly baseOrigin: string;

  public constructor(options: UpstreamClientOptions) {
    this.providerId = options.providerId;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = normalizePositiveInt(options.timeoutMs, 12_000);
    this.retries = normalizeNonNegativeInt(options.retries, 2);
    this.backoffMs = normalizePositiveInt(options.backoffMs, 250);
    this.maxBackoffMs = normalizePositiveInt(options.maxBackoffMs, 3_000);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? "subtitle-cli/subhd";
    this.sleep = options.sleep ?? defaultSleep;
    this.baseOrigin = new URL(this.baseUrl).origin;

    if (typeof this.fetchImpl !== "function") {
      throw new CliAppError({
        code: "E_UNKNOWN",
        message: "Global fetch is unavailable. Use Node 18+ or provide fetchImpl.",
      });
    }
  }

  public async requestText(options: UpstreamRequestOptions): Promise<string> {
    const response = await this.request(options);
    return response.text();
  }

  public async requestJson<T>(options: UpstreamRequestOptions): Promise<T> {
    const response = await this.request(options);
    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new CliAppError({
        code: "E_UPSTREAM_BAD_RESPONSE",
        message: `${this.providerId} upstream returned invalid JSON`,
        details: {
          provider: this.providerId,
          url: resolveUrl(this.baseUrl, options.pathOrUrl).toString(),
          classification: "bad-response",
          reason: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      });
    }

    return payload as T;
  }

  public async requestBinary(options: UpstreamRequestOptions): Promise<Uint8Array> {
    const response = await this.request(options);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  public async request(options: UpstreamRequestOptions): Promise<Response> {
    const url = resolveUrl(this.baseUrl, options.pathOrUrl);
    const maxAttempts = this.retries + 1;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;

      try {
        const response = await this.fetchWithTimeout(url, options);
        this.mergeResponseCookies(url, response.headers);

        if (response.ok) {
          return response;
        }

        const snippet = await readSnippet(response);
        const classified = classifyResponseError(this.providerId, url, response.status, snippet);

        if (attempt < maxAttempts && RETRYABLE_STATUS.has(response.status)) {
          await this.sleep(computeBackoff(this.backoffMs, this.maxBackoffMs, attempt));
          continue;
        }

        throw classified;
      } catch (error) {
        const mapped = mapFetchError(error, this.providerId, url, this.timeoutMs);
        if (
          attempt < maxAttempts &&
          (mapped.code === "E_UPSTREAM_NETWORK" || mapped.code === "E_UPSTREAM_TIMEOUT")
        ) {
          await this.sleep(computeBackoff(this.backoffMs, this.maxBackoffMs, attempt));
          continue;
        }

        throw mapped;
      }
    }

    throw new CliAppError({
      code: "E_UNKNOWN",
      message: `${this.providerId} upstream request failed unexpectedly`,
      details: {
        provider: this.providerId,
        url: url.toString(),
      },
    });
  }

  private async fetchWithTimeout(url: URL, options: UpstreamRequestOptions): Promise<Response> {
    const headers = new Headers(options.headers);
    if (!headers.has("user-agent")) {
      headers.set("user-agent", this.userAgent);
    }

    const cookie = this.serializeCookies();
    if (cookie.length > 0 && url.origin === this.baseOrigin) {
      headers.set("cookie", cookie);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private mergeResponseCookies(url: URL, headers: Headers): void {
    if (url.origin !== this.baseOrigin) {
      return;
    }

    const cookies = readSetCookieHeaders(headers);
    for (const cookie of cookies) {
      mergeCookie(this.cookieJar, cookie);
    }
  }

  private serializeCookies(): string {
    return Array.from(this.cookieJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

export function classifyResponseError(
  providerId: string,
  url: URL,
  status: number,
  snippet: string,
): CliAppError {
  const classification = classifyResponse(status, snippet);

  return new CliAppError({
    code: "E_UPSTREAM_BAD_RESPONSE",
    message: `${providerId} upstream returned HTTP ${status}`,
    details: {
      provider: providerId,
      url: url.toString(),
      status,
      classification,
      snippet,
    } satisfies ClassifiedResponseErrorDetails,
  });
}

export function classifyResponse(
  status: number,
  snippet: string,
): ClassifiedResponseErrorDetails["classification"] {
  if (status === 429 || /too\s+many\s+requests|rate\s*limit/iu.test(snippet)) {
    return "rate-limit";
  }

  if (status === 403 || status === 401 || looksLikeAntiBotChallenge(snippet)) {
    return "anti-bot";
  }

  return "bad-response";
}

export function looksLikeAntiBotChallenge(text: string): boolean {
  const snippet = text.toLowerCase();
  return [
    "challenge-platform",
    "cloudflare",
    "cf-challenge",
    "captcha",
    "验证码",
    "验证获取下载地址",
    "jsd/main.js",
    "attention required",
  ].some((needle) => snippet.includes(needle));
}

function mapFetchError(
  error: unknown,
  providerId: string,
  url: URL,
  timeoutMs: number,
): CliAppError {
  if (error instanceof CliAppError) {
    return error;
  }

  if (isAbortError(error)) {
    return new CliAppError({
      code: "E_UPSTREAM_TIMEOUT",
      message: `${providerId} upstream request timed out after ${timeoutMs}ms`,
      details: {
        provider: providerId,
        url: url.toString(),
        timeoutMs,
      },
      cause: error,
    });
  }

  return new CliAppError({
    code: "E_UPSTREAM_NETWORK",
    message: `Failed to reach ${providerId} upstream`,
    details: {
      provider: providerId,
      url: url.toString(),
      reason: error instanceof Error ? error.message : String(error),
    },
    cause: error,
  });
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.name === "TimeoutError";
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return "https://subhd.tv/";
  }

  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function resolveUrl(baseUrl: string, pathOrUrl: string): URL {
  if (/^https?:\/\//iu.test(pathOrUrl)) {
    return new URL(pathOrUrl);
  }

  return new URL(pathOrUrl, baseUrl);
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeNonNegativeInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function computeBackoff(baseMs: number, maxMs: number, attempt: number): number {
  const multiplier = Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(maxMs, baseMs * multiplier);
}

async function readSnippet(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return collapseWhitespace(text).slice(0, 320);
  } catch {
    return "";
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mergeCookie(cookieJar: Map<string, string>, raw: string): void {
  const firstSegment = raw.split(";", 1)[0]?.trim();
  if (firstSegment === undefined || firstSegment.length === 0) {
    return;
  }

  const eqIndex = firstSegment.indexOf("=");
  if (eqIndex <= 0) {
    return;
  }

  const name = firstSegment.slice(0, eqIndex).trim();
  const value = firstSegment.slice(eqIndex + 1).trim();

  if (name.length === 0) {
    return;
  }

  if (value.length === 0 || value === "deleted") {
    cookieJar.delete(name);
    return;
  }

  cookieJar.set(name, value);
}

function readSetCookieHeaders(headers: Headers): string[] {
  const withSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };

  if (typeof withSetCookie.getSetCookie === "function") {
    return withSetCookie.getSetCookie();
  }

  if (typeof withSetCookie.raw === "function") {
    return withSetCookie.raw()["set-cookie"] ?? [];
  }

  const fallback = headers.get("set-cookie");
  if (fallback === null) {
    return [];
  }

  return splitCombinedSetCookieHeader(fallback);
}

function splitCombinedSetCookieHeader(raw: string): string[] {
  const parts: string[] = [];
  let buffer = "";
  let insideExpires = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const tail = raw.slice(index).toLowerCase();

    if (tail.startsWith("expires=")) {
      insideExpires = true;
    }

    if (char === "," && !insideExpires) {
      const normalized = buffer.trim();
      if (normalized.length > 0) {
        parts.push(normalized);
      }
      buffer = "";
      continue;
    }

    if (char === ";") {
      insideExpires = false;
    }

    buffer += char;
  }

  const normalized = buffer.trim();
  if (normalized.length > 0) {
    parts.push(normalized);
  }

  return parts;
}
