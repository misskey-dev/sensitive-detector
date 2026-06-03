import type { HttpBindings } from '@hono/node-server';
import type { Classifier, InferenceHealth, ResolvedConfig, Semaphore } from '@misskey-sensitive-detector/core';
import type { Logger } from 'pino';

/** createApp / 各ミドルウェアが共有する依存。 */
export type AppDeps = {
  config: ResolvedConfig;
  classifier: Classifier;
  semaphore: Semaphore;
  health: InferenceHealth;
  logger: Logger;
};

export type AppVariables = {
  requestId: string;
  clientIp: string;
  logger: Logger;
};

export type AppEnv = {
  Bindings: HttpBindings;
  Variables: AppVariables;
};
