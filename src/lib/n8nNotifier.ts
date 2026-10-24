const REQUEST_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(
  url: string,
  payload: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        console.log(
          `[n8n] Notification sent (attempt ${attempt})`,
        );
        return;
      }

      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;

      if (!retryable) {
        console.error(
          `[n8n] Notification rejected: HTTP ${response.status}`,
        );
        return;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);

      if (attempt === MAX_ATTEMPTS) {
        console.error(
          `[n8n] Notification failed after ${attempt} attempts:`,
          message,
        );
        return;
      }

      console.warn(
        `[n8n] Attempt ${attempt} failed: ${message}. Retrying...`,
      );
    } finally {
      clearTimeout(timeout);
    }

    await wait(RETRY_DELAYS_MS[attempt - 1]);
  }
}

export function notifyN8n(
  payload: Record<string, unknown>,
): void {
  const url = process.env.N8N_WEBHOOK_URL;

  if (!url) {
    return;
  }

  // Fire-and-forget: never wait for n8n in the API handler.
  void sendWithRetry(url, payload).catch((error: unknown) => {
    console.error('[n8n] Unexpected notifier error:', error);
  });
}
