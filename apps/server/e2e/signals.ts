/** Keep signal handlers installed until the task has finished its cleanup. */
export async function withSignals<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const onInterrupt = () => controller.abort(new Error('E2E interrupted by SIGINT'));
  const onTerminate = () => controller.abort(new Error('E2E interrupted by SIGTERM'));
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    const result = await run(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}
