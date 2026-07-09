const SCRAPINGBEE_PREMIUM = [
  'macys.com',
  'hollisterco.com',
  'abercrombie.com',
  'bloomingdales.com',
  'kohls.com',
];

const SCRAPINGBEE_RENDER_JS = [
  'nordstrom.com',
  'dillards.com',
];

export function getScrapingBeeMode(url: string): 'premium' | 'render_js' | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
  for (const d of SCRAPINGBEE_PREMIUM) {
    if (host === d || host.endsWith('.' + d)) return 'premium';
  }
  for (const d of SCRAPINGBEE_RENDER_JS) {
    if (host === d || host.endsWith('.' + d)) return 'render_js';
  }
  return null;
}
