const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRIES = 2;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const headers = {
    "user-agent": "jquery-migration-analyzer/1.0",
    ...options.headers,
  };

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} en ${url}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await delay(350 * (attempt + 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

module.exports = {
  fetchText,
};
