import type { SubtitleProviderDescriptor } from "../domain/types.js";

export interface ProvidersCommandOutput {
  total: number;
  providers: SubtitleProviderDescriptor[];
}

export function runProvidersCommand(
  descriptors: SubtitleProviderDescriptor[],
): ProvidersCommandOutput {
  return {
    total: descriptors.length,
    providers: descriptors,
  };
}

export function renderProvidersOutput(output: ProvidersCommandOutput): string {
  if (output.providers.length === 0) {
    return "No providers registered.";
  }

  return [
    `Providers: ${output.total}`,
    ...output.providers.map(
      (provider) =>
        `${provider.id} | ${provider.name} | mock:${provider.mock ? "yes" : "no"} | search:${provider.capabilities.search ? "yes" : "no"} download:${provider.capabilities.download ? "yes" : "no"}`,
    ),
  ].join("\n");
}
