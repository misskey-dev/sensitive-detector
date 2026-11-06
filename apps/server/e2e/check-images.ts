import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLASSES = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'] as const;
export type Fixture = { file: URL; expectedClass: (typeof CLASSES)[number] };
export const FIXTURES = [
  { file: new URL('./fixtures/neutral-synthetic-cat.png', import.meta.url), expectedClass: 'Neutral' },
  { file: new URL('./fixtures/sexy-synthetic-swimwear.png', import.meta.url), expectedClass: 'Sexy' },
] as const satisfies readonly Fixture[];
export const HTTP_TIMEOUT_MS = 60_000;

/** These are regression expectations for fixed images, not a sensitive-content policy. */
export function assertPredictions(body: unknown, fixtures: readonly Fixture[]): void {
  type Prediction = { className: string; probability: number };
  type Item = { success?: boolean; predictions?: Prediction[] };
  const batch = body as {
    success?: boolean;
    result?: { results?: Item[] };
  } | null;
  assert.equal(batch?.success, true, 'batch did not succeed');
  const results = batch?.result?.results;
  assert(Array.isArray(results), 'missing results array');
  assert.equal(results.length, fixtures.length, 'wrong result count');
  for (const [index, fixture] of fixtures.entries()) {
    const label = basename(fileURLToPath(fixture.file));
    const item: Item | undefined = results[index];
    assert.equal(item?.success, true, `${label}: inference failed`);
    const predictions: Prediction[] | undefined = item?.predictions;
    assert(Array.isArray(predictions), `${label}: missing predictions`);
    assert.equal(predictions.length, 5, `${label}: expected five classes`);
    for (const prediction of predictions) {
      assert(prediction && typeof prediction === 'object', `${label}: invalid prediction`);
      assert(
        Number.isFinite(prediction.probability) && prediction.probability >= 0 && prediction.probability <= 1,
        `${label}: invalid probability for ${prediction.className}`,
      );
    }
    assert.deepEqual(
      predictions.map((p) => p.className).sort(),
      [...CLASSES].sort(),
      `${label}: unexpected or duplicate classes`,
    );
    const expected = predictions.find((p) => p.className === fixture.expectedClass);
    assert(
      expected && predictions.every((p) => p === expected || p.probability < expected.probability),
      `${label}: expected ${fixture.expectedClass} to have the highest probability: ${JSON.stringify(predictions)}`,
    );
  }
}

/** Works against either a local server or a published Docker port. No model access is needed here. */
export async function checkImages({
  baseUrl,
  apiKey,
  fixtures = FIXTURES,
  signal,
  requestTimeoutMs = HTTP_TIMEOUT_MS,
}: {
  baseUrl: string;
  apiKey: string;
  fixtures?: readonly Fixture[];
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}): Promise<void> {
  assert(fixtures.length > 0, 'at least one fixture is required');
  const form = new FormData();
  for (const [index, fixture] of fixtures.entries()) {
    const data = await readFile(fixture.file); // Missing fixtures must fail, never skip.
    form.append(
      `image${index}`,
      new Blob([new Uint8Array(data)], { type: 'image/png' }),
      basename(fileURLToPath(fixture.file)),
    );
  }
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  const response = await fetch(new URL('/v1/detect-images', baseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  try {
    assert.equal(response.status, 200, `detect-images returned HTTP ${response.status}`);
    assertPredictions(await response.json(), fixtures);
  } finally {
    await response.body?.cancel().catch(() => {});
  }
}
