export function normalizeUrlInput(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/https?:\/\//i);
  if (!match || match.index === undefined) return null;

  const sliced = trimmed.slice(match.index);
  const proto = sliced.slice(0, match[0].length).toLowerCase();
  const rest = sliced.slice(match[0].length);
  const candidate = proto + rest;

  try {
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}

const AMAZON_SHORT_URL_RE = /^https?:\/\/(www\.)?(a\.co\/d\/[\w-]+|amzn\.to\/[\w-]+|amzn\.com\/[\w-]+)/i;
const ASIN_RE = /\/(?:[^/]+\/)?dp\/([A-Z0-9]{10})(?:[/?]|$)/i;
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function resolveShortUrl(url: string): Promise<string> {
  if (!AMAZON_SHORT_URL_RE.test(url)) return url;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": DESKTOP_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const finalUrl = res.url || url;
    const asinMatch = finalUrl.match(ASIN_RE);
    const asin = asinMatch?.[1];
    if (asin) {
      return `https://www.amazon.com/dp/${asin.toUpperCase()}`;
    }
    return finalUrl;
  } catch {
    return url;
  } finally {
    clearTimeout(timeout);
  }
}
