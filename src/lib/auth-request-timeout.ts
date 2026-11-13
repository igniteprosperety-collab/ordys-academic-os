export class AuthRequestTimeoutError extends Error {
  constructor() {
    super("O servidor demorou demais para responder.");
    this.name = "AuthRequestTimeoutError";
  }
}

/** Rejects with AuthRequestTimeoutError when the request does not settle in time. */
export function withAuthRequestTimeout<T>(request: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthRequestTimeoutError()), timeoutMs);
    request().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
