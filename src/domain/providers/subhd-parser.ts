import type { SubtitleFormat } from "../types.js";

export interface SubhdSearchItem {
  sid: string;
  title: string;
  language: string;
  format: SubtitleFormat;
  downloads: number;
  hearingImpaired?: boolean;
}

export interface SubhdDownloadPage {
  sid: string;
  title: string;
  fileStem: string;
  format?: SubtitleFormat;
}

const SUBHD_CARD_MARKER = '<div class="bg-white shadow-sm rounded-3 mb-4">';

export function parseSubhdSearchItems(html: string): SubhdSearchItem[] {
  const cards = html.split(SUBHD_CARD_MARKER).slice(1);
  const deduped = new Map<string, SubhdSearchItem>();

  for (const card of cards) {
    const sid = extractSubhdSid(card);
    if (sid === undefined) {
      continue;
    }

    const title =
      extractFirstText(card, [
        /<div class="view-text[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/iu,
        /<a[^>]*class="link-dark align-middle"[^>]*>([\s\S]*?)<\/a>/iu,
      ]) ?? `SubHD subtitle ${sid}`;

    const languageLine =
      extractFirstText(card, [/<div class="text-truncate py-2 f11">([\s\S]*?)<\/div>/iu]) ?? "";

    const format = inferSubtitleFormat(`${languageLine}\n${title}`) ?? "srt";
    const downloads = extractDownloadCount(card);
    const hearingImpaired = /听障|聋哑|sdh|\bhi\b/iu.test(`${title} ${languageLine}`);

    deduped.set(sid, {
      sid,
      title,
      language: inferLanguage(languageLine, title),
      format,
      downloads,
      hearingImpaired: hearingImpaired || undefined,
    });
  }

  return Array.from(deduped.values());
}

export function parseSubhdDownloadPage(html: string, sid: string): SubhdDownloadPage {
  const title =
    extractFirstText(html, [
      /<h5 class="card-header">([\s\S]*?)<\/h5>/iu,
      /<div class="f16 fw-bold mb-2">([\s\S]*?)<\/div>/iu,
    ]) ?? `subhd-${sid}`;

  const versionCell =
    extractFirstText(html, [/<th[^>]*>字幕版本<\/th>\s*<td>([\s\S]*?)<\/td>/iu]) ?? "";

  const format = inferSubtitleFormat(`${versionCell}\n${title}`);

  return {
    sid,
    title,
    fileStem: sanitizeFileStem(title),
    format: format ?? undefined,
  };
}

export function inferSubtitleFormat(text: string): SubtitleFormat | undefined {
  const normalized = text.toUpperCase();

  if (/\bASS\b|\bSSA\b/u.test(normalized)) {
    return "ass";
  }

  if (/\bSRT\b/u.test(normalized)) {
    return "srt";
  }

  if (/\bVTT\b/u.test(normalized)) {
    return "vtt";
  }

  return undefined;
}

export function sanitizeFileStem(value: string): string {
  const normalized = collapseWhitespace(value)
    .replace(/[\\/:*?"<>|]/g, " ")
    .trim();

  const clipped = normalized.slice(0, 96).trim();
  return clipped.length > 0 ? clipped : "subtitle";
}

function extractSubhdSid(cardHtml: string): string | undefined {
  const match = /href=['"]\/a\/([A-Za-z0-9]+)['"]/u.exec(cardHtml);
  return match?.[1];
}

function extractDownloadCount(cardHtml: string): number {
  const match =
    /bi bi-download[\s\S]*?<span[^>]*>\s*([0-9][0-9,]*)\s*<\/span>/iu.exec(cardHtml) ??
    /下载[^0-9]*([0-9][0-9,]*)/iu.exec(cardHtml);

  if (match?.[1] === undefined) {
    return 0;
  }

  const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function inferLanguage(languageLine: string, title: string): string {
  const text = `${languageLine} ${title}`;

  if (/简体|简中|chs|zh-cn/iu.test(text)) {
    return "zh-cn";
  }

  if (/繁体|繁中|cht|zh-tw/iu.test(text)) {
    return "zh-tw";
  }

  if (/英语|英文|\beng\b|\ben\b/iu.test(text)) {
    return "en";
  }

  if (/双语|中英|中字|中文/iu.test(text)) {
    return "zh-cn";
  }

  return "zh";
}

function extractFirstText(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1] !== undefined) {
      const cleaned = cleanText(match[1]);
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  }

  return undefined;
}

function cleanText(value: string): string {
  return collapseWhitespace(decodeHtmlEntities(value).replace(/<[^>]*>/g, " "));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  const named = value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

  return named.replace(/&#(\d+);/gu, (_, digits: string) => {
    const codePoint = Number.parseInt(digits, 10);
    if (!Number.isFinite(codePoint) || codePoint <= 0) {
      return "";
    }

    return String.fromCodePoint(codePoint);
  });
}
