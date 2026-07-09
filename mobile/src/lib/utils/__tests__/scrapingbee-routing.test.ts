import { getScrapingBeeMode } from '../scrapingbee-routing';

describe('getScrapingBeeMode', () => {
  // --- MUST route through ScrapingBee (premium) ---
  test('macys.com → premium', () => {
    expect(getScrapingBeeMode('https://www.macys.com/shop/product/abc')).toBe('premium');
  });
  test('hollisterco.com → premium', () => {
    expect(getScrapingBeeMode('https://hollisterco.com/p/123')).toBe('premium');
  });
  test('abercrombie.com → premium', () => {
    expect(getScrapingBeeMode('https://www.abercrombie.com/shop/us/p/abc')).toBe('premium');
  });
  test('bloomingdales.com → premium', () => {
    expect(getScrapingBeeMode('https://www.bloomingdales.com/shop/product/abc')).toBe('premium');
  });
  test('kohls.com → premium', () => {
    expect(getScrapingBeeMode('https://www.kohls.com/product/abc.jsp')).toBe('premium');
  });

  // --- MUST route through ScrapingBee (render_js) ---
  test('nordstrom.com → render_js', () => {
    expect(getScrapingBeeMode('https://www.nordstrom.com/s/foo/4334920')).toBe('render_js');
  });
  test('dillards.com → render_js', () => {
    expect(getScrapingBeeMode('https://www.dillards.com/p/x/p/123')).toBe('render_js');
  });

  // --- Subdomain matching ---
  test('subdomain of macys.com → premium', () => {
    expect(getScrapingBeeMode('https://m.macys.com/shop/product/abc')).toBe('premium');
  });

  // --- MUST NOT route through ScrapingBee (free path) ---
  test('amazon.com → null', () => {
    expect(getScrapingBeeMode('https://www.amazon.com/dp/B0ABC')).toBeNull();
  });
  test('a.co → null', () => {
    expect(getScrapingBeeMode('https://a.co/d/abc')).toBeNull();
  });
  test('zara.com → null', () => {
    expect(getScrapingBeeMode('https://www.zara.com/us/en/abc')).toBeNull();
  });
  test('oldnavy.gap.com → null', () => {
    expect(getScrapingBeeMode('https://oldnavy.gap.com/abc')).toBeNull();
  });
  test('revolve.com → null', () => {
    expect(getScrapingBeeMode('https://www.revolve.com/abc')).toBeNull();
  });
  test('jcpenney.com → null', () => {
    expect(getScrapingBeeMode('https://www.jcpenney.com/p/abc')).toBeNull();
  });
  test('shopmy.us → null', () => {
    expect(getScrapingBeeMode('https://shopmy.us/abc')).toBeNull();
  });
  test('etsy.com → null', () => {
    expect(getScrapingBeeMode('https://www.etsy.com/listing/abc')).toBeNull();
  });
  test('target.com → null', () => {
    expect(getScrapingBeeMode('https://www.target.com/p/abc')).toBeNull();
  });
  test('walmart.com → null', () => {
    expect(getScrapingBeeMode('https://www.walmart.com/ip/abc')).toBeNull();
  });
  test('hm.com → null', () => {
    expect(getScrapingBeeMode('https://www.hm.com/us/product/abc')).toBeNull();
  });
  test('uniqlo.com → null', () => {
    expect(getScrapingBeeMode('https://www.uniqlo.com/us/en/products/abc')).toBeNull();
  });
  test('asos.com → null', () => {
    expect(getScrapingBeeMode('https://www.asos.com/product/abc')).toBeNull();
  });

  // --- Edge cases: must NOT be tricked ---
  test('fakemacys.com → null', () => {
    expect(getScrapingBeeMode('https://fakemacys.com/abc')).toBeNull();
  });
  test('macys.com.evil.com → null', () => {
    expect(getScrapingBeeMode('https://macys.com.evil.com/abc')).toBeNull();
  });
  test('invalid URL → null', () => {
    expect(getScrapingBeeMode('not a url')).toBeNull();
  });
  test('empty string → null', () => {
    expect(getScrapingBeeMode('')).toBeNull();
  });
});
