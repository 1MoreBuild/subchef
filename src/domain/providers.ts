import { createAssrtMockProvider } from "./providers/assrt-mock.js";
import { createSubhdProvider } from "./providers/subhd.js";
import type { SubtitleProvider, SubtitleProviderDescriptor } from "./types.js";

export type SubtitleProviderMap = Record<string, SubtitleProvider>;

export function createDefaultProviderMap(): SubtitleProviderMap {
  return {
    subhd: createSubhdProvider(),
    assrt: createAssrtMockProvider(),
  };
}

export function listProviders(providerMap: SubtitleProviderMap): SubtitleProviderDescriptor[] {
  return Object.values(providerMap)
    .map((provider) => provider.descriptor)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveProvider(
  providerMap: SubtitleProviderMap,
  providerId: string | undefined,
): SubtitleProvider | undefined {
  if (providerId === undefined || providerId.trim().length === 0) {
    return providerMap.subhd ?? providerMap.assrt;
  }

  return providerMap[providerId];
}
