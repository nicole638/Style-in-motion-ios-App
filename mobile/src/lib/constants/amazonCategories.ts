/**
 * Amazon browse map for the Amazon marketplace brand page.
 *
 * Unlike our affiliate brands, Amazon has no product catalog in our database —
 * so its category buttons cannot filter a local grid. They navigate INTO Amazon
 * instead: each one opens amazon.com inside the in-app web shop, where the
 * floating "Add to Closet" button links the piece straight into the creator's
 * closet.
 *
 * Two levels, matching the department vocabulary we use everywhere else
 * (Clothing / Shoes / Bags / Jewelry / …), so the Amazon page reads the same as
 * every other brand page:
 *
 *     Clothing  →  Tops · Dresses · Jeans · Skirts · Sweaters · …
 *
 * URLs use Amazon's search-alias form (`/s?i=<alias>&k=<keywords>`) rather than
 * browse-node ids. Node ids (`node=1045024`) get retired and silently 404 into
 * an empty results page; the search aliases are stable and always resolve.
 */

export interface AmazonType {
  label: string;
  url: string;
}

export interface AmazonDepartment {
  /** Matches our own department vocabulary — see affiliate_products.department. */
  label: string;
  /** "Browse all of <department>" — the department landing page. */
  url: string;
  types: AmazonType[];
}

const BASE = 'https://www.amazon.com/s';

/** Build an Amazon search URL from a department alias and optional keywords. */
function az(alias: string, keywords?: string): string {
  const params = new URLSearchParams({ i: alias });
  if (keywords) params.set('k', keywords);
  return `${BASE}?${params.toString()}`;
}

/** Amazon's women's-fashion landing page — the "Shop amazon.com" entry point. */
export const AMAZON_HOME_URL = az('fashion-womens');

export const AMAZON_DEPARTMENTS: AmazonDepartment[] = [
  {
    label: 'Clothing',
    url: az('fashion-womens-clothing'),
    types: [
      { label: 'Tops', url: az('fashion-womens-clothing', 'tops') },
      { label: 'Dresses', url: az('fashion-womens-clothing', 'dresses') },
      { label: 'Jeans', url: az('fashion-womens-clothing', 'jeans') },
      { label: 'Pants', url: az('fashion-womens-clothing', 'pants') },
      { label: 'Skirts', url: az('fashion-womens-clothing', 'skirts') },
      { label: 'Shorts', url: az('fashion-womens-clothing', 'shorts') },
      { label: 'Sweaters', url: az('fashion-womens-clothing', 'sweaters') },
      { label: 'Blazers', url: az('fashion-womens-clothing', 'blazers') },
      { label: 'Jumpsuits', url: az('fashion-womens-clothing', 'jumpsuits') },
    ],
  },
  {
    label: 'Shoes',
    url: az('fashion-womens-shoes'),
    types: [
      { label: 'Sneakers', url: az('fashion-womens-shoes', 'sneakers') },
      { label: 'Boots', url: az('fashion-womens-shoes', 'boots') },
      { label: 'Heels', url: az('fashion-womens-shoes', 'heels') },
      { label: 'Sandals', url: az('fashion-womens-shoes', 'sandals') },
      { label: 'Flats', url: az('fashion-womens-shoes', 'flats') },
      { label: 'Loafers', url: az('fashion-womens-shoes', 'loafers') },
    ],
  },
  {
    label: 'Bags',
    url: az('fashion-womens-handbags'),
    types: [
      { label: 'Totes', url: az('fashion-womens-handbags', 'tote bags') },
      { label: 'Crossbody', url: az('fashion-womens-handbags', 'crossbody bags') },
      { label: 'Shoulder', url: az('fashion-womens-handbags', 'shoulder bags') },
      { label: 'Clutches', url: az('fashion-womens-handbags', 'clutches') },
      { label: 'Backpacks', url: az('fashion-womens-handbags', 'backpacks') },
      { label: 'Wallets', url: az('fashion-womens-handbags', 'wallets') },
    ],
  },
  {
    label: 'Jewelry',
    url: az('fashion-womens-jewelry'),
    types: [
      { label: 'Necklaces', url: az('fashion-womens-jewelry', 'necklaces') },
      { label: 'Earrings', url: az('fashion-womens-jewelry', 'earrings') },
      { label: 'Bracelets', url: az('fashion-womens-jewelry', 'bracelets') },
      { label: 'Rings', url: az('fashion-womens-jewelry', 'rings') },
    ],
  },
  {
    label: 'Outerwear',
    url: az('fashion-womens-clothing', 'coats and jackets'),
    types: [
      { label: 'Coats', url: az('fashion-womens-clothing', 'coats') },
      { label: 'Jackets', url: az('fashion-womens-clothing', 'jackets') },
      { label: 'Trench', url: az('fashion-womens-clothing', 'trench coats') },
      { label: 'Puffers', url: az('fashion-womens-clothing', 'puffer jackets') },
    ],
  },
  {
    label: 'Activewear',
    url: az('fashion-womens-clothing', 'activewear'),
    types: [
      { label: 'Leggings', url: az('fashion-womens-clothing', 'leggings') },
      { label: 'Sports bras', url: az('fashion-womens-clothing', 'sports bras') },
      { label: 'Sets', url: az('fashion-womens-clothing', 'workout sets') },
    ],
  },
  {
    label: 'Accessories',
    url: az('fashion-womens', 'accessories'),
    types: [
      { label: 'Sunglasses', url: az('fashion-womens', 'sunglasses') },
      { label: 'Belts', url: az('fashion-womens', 'belts') },
      { label: 'Scarves', url: az('fashion-womens', 'scarves') },
      { label: 'Hats', url: az('fashion-womens', 'hats') },
      { label: 'Watches', url: az('fashion-womens-watches') },
    ],
  },
  {
    label: 'Beauty',
    url: az('beauty'),
    types: [
      { label: 'Skincare', url: az('beauty', 'skincare') },
      { label: 'Makeup', url: az('beauty', 'makeup') },
      { label: 'Hair', url: az('beauty', 'hair care') },
      { label: 'Fragrance', url: az('beauty', 'fragrance') },
    ],
  },
];
