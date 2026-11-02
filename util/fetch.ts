const DEFAULT_TIMEOUT = 10000; // default timeout in ms

// protection against calling itself recursively
const nativeFetch = globalThis.fetch.bind(globalThis);
const BODY_METHODS = new Set(['json', 'text', 'arrayBuffer', 'blob', 'formData', 'bytes']);

export async function fetch(input: RequestInfo | URL, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
  if (__DEV__) {
    console.log('fetch wrapper: ', input, init);
  }
  const { timeout = DEFAULT_TIMEOUT, ...rest } = init;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Request timed out after ${timeout}ms`));
    }, timeout);
  });

  try {
    const response = await Promise.race([nativeFetch(input, { ...rest, signal: controller.signal }), deadline]);
    // Expo fetch resolves when headers arrive. Keep the same deadline through body consumption.
    // Race body reads as well as aborting the native request, so even a stalled reader settles.
    return new Proxy(response, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof property === 'string' && BODY_METHODS.has(property) && typeof value === 'function') {
          return (...args: unknown[]) =>
            Promise.race([Promise.resolve().then(() => value.apply(target, args)), deadline]).finally(() => clearTimeout(timer));
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  } catch (error) {
    clearTimeout(timer!);
    throw error;
  }
}
