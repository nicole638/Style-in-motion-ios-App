const FORTRESS_MERCHANTS: Record<string, string> = {
  "dickssportinggoods.com": "Dick's Sporting Goods",
  "aritzia.com": "Aritzia",
  "macys.com": "Macy's",
  "nordstrom.com": "Nordstrom",
  "bloomingdales.com": "Bloomingdale's",
  "ulta.com": "Ulta",
  "sephora.com": "Sephora",
};

export function detectFortressDomain(url: string): { domain: string; name: string } | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    for (const [domain, name] of Object.entries(FORTRESS_MERCHANTS)) {
      if (host === domain || host.endsWith("." + domain)) {
        return { domain, name };
      }
    }
    return null;
  } catch {
    return null;
  }
}
