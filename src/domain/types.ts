export type SubtitleFormat = "srt" | "ass" | "vtt";

export interface SubtitleRequestInput {
  query: string;
  year?: number;
  season?: number;
  episode?: number;
  languages?: string[];
}

export interface NormalizedSubtitleRequest {
  query: string;
  normalizedQuery: string;
  queryTokens: string[];
  year?: number;
  season?: number;
  episode?: number;
  languagePreferences: string[];
  fingerprint: string;
}

export interface ProviderSubtitleResult {
  id: string;
  providerId: string;
  title: string;
  language: string;
  format: SubtitleFormat;
  downloads: number;
  hearingImpaired?: boolean;
  releaseName?: string;
}

export interface RankedSubtitleResult extends ProviderSubtitleResult {
  rank: number;
  score: number;
  reasons: string[];
}

export interface SubtitleDownloadPlan {
  id: string;
  providerId: string;
  fileName: string;
  sourceUrl: string;
  format: SubtitleFormat;
}

export interface SubtitlePayload extends SubtitleDownloadPlan {
  content: Uint8Array;
}

export interface SubtitleProviderDoctor {
  ok: boolean;
  message: string;
  details?: unknown;
}

export interface SubtitleProviderDescriptor {
  id: string;
  name: string;
  mock: boolean;
  capabilities: {
    search: boolean;
    download: boolean;
    doctor: boolean;
  };
}

export interface SubtitleProvider {
  descriptor: SubtitleProviderDescriptor;
  search(request: NormalizedSubtitleRequest): Promise<ProviderSubtitleResult[]>;
  getDownloadPlan(id: string): Promise<SubtitleDownloadPlan>;
  downloadSubtitle(id: string): Promise<SubtitlePayload>;
  doctor?(): Promise<SubtitleProviderDoctor>;
}
