import { randomUUID } from "node:crypto";

import type { Meta } from "./envelope.js";

export interface CreateCommandContextOptions {
  clock?: () => number;
  now?: () => Date;
  requestIdFactory?: () => string;
  verbose?: boolean;
}

export interface CommandContext {
  requestId: string;
  startedAt: string;
  verbose: boolean;
  toMeta: () => Meta;
}

export function createCommandContext(options: CreateCommandContextOptions = {}): CommandContext {
  const clock = options.clock ?? Date.now;
  const now = options.now ?? (() => new Date());
  const requestIdFactory = options.requestIdFactory ?? randomUUID;
  const verbose = options.verbose ?? false;

  const startTimeMs = clock();
  const startedAt = now().toISOString();
  const requestId = requestIdFactory();

  return {
    requestId,
    startedAt,
    verbose,
    toMeta: () => {
      const endTimeMs = clock();
      const durationMs = Math.max(0, endTimeMs - startTimeMs);
      return {
        requestId,
        startedAt,
        finishedAt: now().toISOString(),
        durationMs,
        verbose,
      };
    },
  };
}
