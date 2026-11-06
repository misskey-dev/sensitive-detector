import { checkImages } from './check-images.js';
import { API_KEY, withServer } from './server.js';
import { withSignals } from './signals.js';

try {
  await withSignals((signal) =>
    withServer((baseUrl, running) => checkImages({ baseUrl, apiKey: API_KEY, signal: running }), { signal }),
  );
  console.log('Server E2E passed: Neutral synthetic-cat and Sexy synthetic-swimwear predictions.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
