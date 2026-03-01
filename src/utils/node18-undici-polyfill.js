"use strict";

// Undici (pulled by cheerio) expects globalThis.File.
// Node 18 may not expose it, so provide a minimal compatible polyfill.
if (typeof globalThis.File === "undefined") {
  const { Blob } = require("node:buffer");

  class FilePolyfill extends Blob {
    constructor(fileBits, fileName, options = {}) {
      const bits = Array.isArray(fileBits) ? fileBits : [fileBits];
      super(bits, options);
      this.name = String(fileName);
      this.lastModified =
        options.lastModified == null
          ? Date.now()
          : Number(options.lastModified);
    }

    get [Symbol.toStringTag]() {
      return "File";
    }
  }

  globalThis.File = FilePolyfill;
}

// Corporate VDIs often require explicit proxy env vars for outbound HTTPS.
// Node's global fetch does not always pick OS proxy settings automatically.
if (!globalThis.__JQUERY_ANALYZER_PROXY_READY__) {
  globalThis.__JQUERY_ANALYZER_PROXY_READY__ = true;

  try {
    const { setGlobalDispatcher, ProxyAgent } = require("undici");
    const proxyUrl =
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy;

    if (proxyUrl) {
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
    }
  } catch {
    // Keep default dispatcher if undici proxy setup is unavailable.
  }
}
