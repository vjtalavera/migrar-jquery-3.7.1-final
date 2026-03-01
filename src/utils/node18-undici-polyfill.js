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

