import { describe, expect, it } from 'vitest';
import {
  type Config,
  ConfigError,
  DEFAULT_MAX_BINARY_SIZE,
  DEFAULT_MAX_BODY_SIZE,
  DEFAULT_MAX_CONCURRENT_JOBS,
  DEFAULT_MAX_IMAGE_HEIGHT,
  DEFAULT_MAX_IMAGE_PIXELS,
  DEFAULT_MAX_IMAGE_WIDTH,
  DEFAULT_MAX_PARTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  unknownConfigKeys,
  validateConfig,
} from '../src/config.js';

const base: Config = { port: 3000, modelDir: '/models/nsfw', apiKey: 'secret' };

describe('validateConfig', () => {
  it('applies defaults for a minimal valid config (port + modelDir + apiKey)', () => {
    const resolved = validateConfig({ ...base });
    expect(resolved.listen).toEqual({ kind: 'port', port: 3000, host: '127.0.0.1' });
    expect(resolved.modelDir).toBe('/models/nsfw/'); // trailing slash appended
    expect(resolved.apiKey).toBe('secret');
    expect(resolved.allowUnauthenticatedTcp).toBe(false);
    expect(resolved.maxBinarySize).toBe(DEFAULT_MAX_BINARY_SIZE);
    expect(resolved.maxImageWidth).toBe(DEFAULT_MAX_IMAGE_WIDTH);
    expect(resolved.maxImageHeight).toBe(DEFAULT_MAX_IMAGE_HEIGHT);
    expect(resolved.maxImagePixels).toBe(DEFAULT_MAX_IMAGE_PIXELS);
    expect(resolved.maxConcurrentJobs).toBe(DEFAULT_MAX_CONCURRENT_JOBS);
    expect(resolved.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it('preserves an already trailing-slashed modelDir', () => {
    expect(validateConfig({ ...base, modelDir: '/models/nsfw/' }).modelDir).toBe('/models/nsfw/');
  });

  it('accepts socket instead of port', () => {
    const resolved = validateConfig({ socket: '/tmp/sd.sock', modelDir: '/m' });
    expect(resolved.listen).toEqual({ kind: 'socket', socket: '/tmp/sd.sock' });
  });

  it('rejects a non-object config', () => {
    expect(() => validateConfig(null)).toThrow(ConfigError);
    expect(() => validateConfig('x')).toThrow(ConfigError);
    expect(() => validateConfig([])).toThrow(ConfigError);
  });

  it('requires modelDir', () => {
    expect(() => validateConfig({ port: 3000 })).toThrow(ConfigError);
    expect(() => validateConfig({ port: 3000, modelDir: '' })).toThrow(ConfigError);
  });

  it('requires exactly one of port or socket', () => {
    expect(() => validateConfig({ modelDir: '/m' })).toThrow(/exactly one of port or socket/);
    expect(() => validateConfig({ port: 3000, socket: '/s', modelDir: '/m' })).toThrow(/exactly one of port or socket/);
  });

  it('validates port range and type', () => {
    expect(() => validateConfig({ port: 0, modelDir: '/m' })).toThrow(ConfigError);
    expect(() => validateConfig({ port: 70000, modelDir: '/m' })).toThrow(ConfigError);
    expect(() => validateConfig({ port: 3000.5, modelDir: '/m' })).toThrow(ConfigError);
    expect(() => validateConfig({ port: '3000' as unknown as number, modelDir: '/m' })).toThrow(ConfigError);
  });

  it('rejects an empty socket', () => {
    expect(() => validateConfig({ socket: '', modelDir: '/m' })).toThrow(ConfigError);
  });

  it('validates apiKey when present', () => {
    expect(validateConfig({ ...base, apiKey: 'secret' }).apiKey).toBe('secret');
    expect(() => validateConfig({ ...base, apiKey: '' })).toThrow(ConfigError);
    expect(() => validateConfig({ ...base, apiKey: 123 as unknown as string })).toThrow(ConfigError);
  });

  it('requires explicit opt-in for unauthenticated TCP listeners', () => {
    expect(() => validateConfig({ port: 3000, modelDir: '/m' })).toThrow(/apiKey/);

    const resolved = validateConfig({ port: 3000, modelDir: '/m', allowUnauthenticatedTcp: true });
    expect(resolved.listen).toEqual({ kind: 'port', port: 3000, host: '127.0.0.1' });
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.allowUnauthenticatedTcp).toBe(true);
  });

  it('allows socket listeners without apiKey by default', () => {
    const resolved = validateConfig({ socket: '/tmp/sd.sock', modelDir: '/m' });
    expect(resolved.listen).toEqual({ kind: 'socket', socket: '/tmp/sd.sock' });
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.allowUnauthenticatedTcp).toBe(false);
  });

  it('validates numeric fields as positive integers', () => {
    expect(validateConfig({ ...base, maxBinarySize: 2048 }).maxBinarySize).toBe(2048);
    expect(validateConfig({ ...base, maxImageWidth: 512 }).maxImageWidth).toBe(512);
    expect(validateConfig({ ...base, maxImageHeight: 512 }).maxImageHeight).toBe(512);
    expect(validateConfig({ ...base, maxImagePixels: 512 * 512 }).maxImagePixels).toBe(512 * 512);
    expect(validateConfig({ ...base, maxConcurrentJobs: 4 }).maxConcurrentJobs).toBe(4);
    expect(validateConfig({ ...base, requestTimeoutMs: 1000 }).requestTimeoutMs).toBe(1000);
    expect(validateConfig({ ...base, maxParts: 5 }).maxParts).toBe(5);
    expect(validateConfig({ ...base, maxBodySize: 1_048_576 }).maxBodySize).toBe(1_048_576);
    for (const field of [
      'maxBinarySize',
      'maxImageWidth',
      'maxImageHeight',
      'maxImagePixels',
      'maxConcurrentJobs',
      'requestTimeoutMs',
      'maxParts',
      'maxBodySize',
    ] as const) {
      expect(() => validateConfig({ ...base, [field]: 0 })).toThrow(ConfigError);
      expect(() => validateConfig({ ...base, [field]: -1 })).toThrow(ConfigError);
      expect(() => validateConfig({ ...base, [field]: 1.5 })).toThrow(ConfigError);
    }
  });

  it('applies defaults for maxParts and maxBodySize', () => {
    const resolved = validateConfig({ ...base });
    expect(resolved.maxParts).toBe(DEFAULT_MAX_PARTS);
    expect(resolved.maxBodySize).toBe(DEFAULT_MAX_BODY_SIZE);
  });

  it('defaults host to 127.0.0.1 and accepts an explicit host for port listeners', () => {
    expect(validateConfig({ ...base }).listen).toEqual({ kind: 'port', port: 3000, host: '127.0.0.1' });
    expect(validateConfig({ ...base, host: '0.0.0.0' }).listen).toEqual({
      kind: 'port',
      port: 3000,
      host: '0.0.0.0',
    });
  });

  it('rejects an invalid host', () => {
    expect(() => validateConfig({ ...base, host: '' })).toThrow(ConfigError);
    expect(() => validateConfig({ ...base, host: 123 as unknown as string })).toThrow(ConfigError);
  });

  it('rejects host together with a socket listener', () => {
    expect(() => validateConfig({ socket: '/tmp/sd.sock', modelDir: '/m', host: '0.0.0.0' })).toThrow(
      /host is only valid with a port/,
    );
  });

  it('rejects unsafe-integer numeric fields', () => {
    expect(() => validateConfig({ ...base, maxBodySize: Number.MAX_SAFE_INTEGER + 1 })).toThrow(ConfigError);
    expect(() => validateConfig({ ...base, maxBinarySize: Number.POSITIVE_INFINITY })).toThrow(ConfigError);
  });

  it('rejects requestTimeoutMs above the setTimeout 32-bit limit (would fire immediately)', () => {
    expect(validateConfig({ ...base, requestTimeoutMs: 2_147_483_647 }).requestTimeoutMs).toBe(2_147_483_647);
    expect(() => validateConfig({ ...base, requestTimeoutMs: 2_147_483_648 })).toThrow(/≤ 2147483647/);
  });
});

describe('unknownConfigKeys', () => {
  it('returns typo / unknown top-level keys', () => {
    expect(unknownConfigKeys({ ...base, maxBinarySie: 1 })).toEqual(['maxBinarySie']);
  });

  it('returns an empty array for a config with only known keys', () => {
    expect(unknownConfigKeys({ ...base, host: '0.0.0.0', maxParts: 5 })).toEqual([]);
  });

  it('returns an empty array for a non-object (validateConfig handles the error)', () => {
    expect(unknownConfigKeys(null)).toEqual([]);
    expect(unknownConfigKeys('nope')).toEqual([]);
  });
});
