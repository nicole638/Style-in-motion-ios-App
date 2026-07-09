export type ScraperSource = 'direct' | 'backend' | 'microlink' | 'jsonlink';

interface DomainRule {
  order: ScraperSource[];
  reason?: string;
}

const DEFAULT_ORDER: ScraperSource[] = ['direct', 'backend', 'microlink', 'jsonlink'];

const DOMAIN_RULES: Record<string, DomainRule> = {
  'zara.com': {
    order: ['backend', 'microlink', 'jsonlink'],
    reason: 'Direct fetch reliably blocked by Zara bot detection',
  },
  'asos.com': {
    order: ['backend', 'microlink', 'jsonlink'],
    reason: 'SPA — direct returns empty shell',
  },
  'hm.com': {
    order: ['backend', 'microlink', 'jsonlink'],
    reason: 'SPA — direct returns empty shell',
  },
};

export function getSourceOrder(url: string): ScraperSource[] {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (DOMAIN_RULES[host]) return DOMAIN_RULES[host]!.order;
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const suffix = parts.slice(i).join('.');
      if (DOMAIN_RULES[suffix]) return DOMAIN_RULES[suffix]!.order;
    }
  } catch {}
  return DEFAULT_ORDER;
}

export function getRoutingTag(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (DOMAIN_RULES[host]) return `${host}_skip`;
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const suffix = parts.slice(i).join('.');
      if (DOMAIN_RULES[suffix]) return `${suffix}_skip`;
    }
  } catch {}
  return null;
}
