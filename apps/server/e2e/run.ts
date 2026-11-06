import { checkImages } from './check-images.js';
import { API_KEY, withServer } from './server.js';

const controller = new AbortController();
const onInterrupt = () => controller.abort(new Error('E2E interrupted by SIGINT'));
const onTerminate = () => controller.abort(new Error('E2E interrupted by SIGTERM'));
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);

try {
  await withServer((baseUrl, signal) => checkImages({ baseUrl, apiKey: API_KEY, signal }), {
    signal: controller.signal,
  });
  console.log('Server E2E passed: Neutral cat and Sexy bikini predictions.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onTerminate);
}
