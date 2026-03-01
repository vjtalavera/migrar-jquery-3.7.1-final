const cheerio = require("cheerio");
const { fetchText } = require("../utils/http");
const { normalizeWhitespace, truncate } = require("../utils/text");

const SEARCH_URL = "https://duckduckgo.com/html/?q=";

function extractCorrectionText(pageText) {
  const normalized = normalizeWhitespace(pageText);

  const patterns = [
    /La Corrección[:\s]+(.{30,320}?)(?:\.|\n|$)/i,
    /Código Corregido[:\s]+(.{30,320}?)(?:\.|\n|$)/i,
    /Code Fixed[:\s]+(.{30,320}?)(?:\.|\n|$)/i,
    /Corrected Code[:\s]+(.{30,320}?)(?:\.|\n|$)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return truncate(match[1], 260);
    }
  }

  return null;
}

async function searchWebCorrection(problemLine) {
  const query = `en el proceso de migrar a la jquery 3.7.1 cual es la solucion correcta: ${problemLine}`;
  const searchHtml = await fetchText(`${SEARCH_URL}${encodeURIComponent(query)}`, {
    timeoutMs: 18000,
    retries: 1,
  });
  const $ = cheerio.load(searchHtml);

  const links = [];
  $("a.result__a").each((_, element) => {
    const href = $(element).attr("href");
    if (href && /^https?:\/\//i.test(href)) {
      links.push(href);
    }
  });

  for (const url of links.slice(0, 3)) {
    try {
      const html = await fetchText(url, { timeoutMs: 12000, retries: 0 });
      const page$ = cheerio.load(html);
      const text = extractCorrectionText(page$.text());
      if (text) {
        return {
          query,
          sourceUrl: url,
          correction: text,
        };
      }
    } catch {
      // Ignorar errores de proveedores externos para mantener resiliencia.
    }
  }

  return null;
}

module.exports = {
  searchWebCorrection,
};
