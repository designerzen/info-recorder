export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = `Timed out after ${timeoutMs}ms.`
) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (cause) => {
        globalThis.clearTimeout(timeoutId);
        reject(cause);
      }
    );
  });
}
