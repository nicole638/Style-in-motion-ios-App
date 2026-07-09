import { describe, expect, test } from "bun:test";
import {
  isAmazonHost,
  extractAsin,
  pickAmazonTrackingParams,
  canonicalizeAmazonFetchUrl,
  extractAmazonProductTitle,
  extractAmazonImageUrl,
  extractAmazonBrand,
  extractAmazonPrice,
} from "../productInfo";

describe("isAmazonHost", () => {
  test("recognizes amazon.com", () => {
    expect(isAmazonHost("https://www.amazon.com/dp/B0XYZ12345")).toBe(true);
  });

  test("recognizes a.co short domain", () => {
    expect(isAmazonHost("https://a.co/d/abc")).toBe(true);
  });

  test("recognizes amzn.to short domain", () => {
    expect(isAmazonHost("https://amzn.to/3xyz")).toBe(true);
  });

  test("rejects non-Amazon domains", () => {
    expect(isAmazonHost("https://example.com")).toBe(false);
  });
});

describe("extractAsin", () => {
  test("extracts ASIN from /dp/ URL with query params", () => {
    expect(extractAsin("https://www.amazon.com/dp/B0XYZ12345?tag=foo")).toBe("B0XYZ12345");
  });

  test("extracts ASIN from /gp/product/ URL with trailing slash", () => {
    expect(extractAsin("https://www.amazon.com/gp/product/B0XYZ12345/")).toBe("B0XYZ12345");
  });

  test("returns null when no ASIN present", () => {
    expect(extractAsin("https://example.com/x")).toBeNull();
  });
});

describe("pickAmazonTrackingParams", () => {
  test("preserves only known tracking params and drops unrelated", () => {
    const out = pickAmazonTrackingParams(
      "https://a.co/d/foo?tag=existingtag-20&linkCode=ll1&unrelated=x"
    );
    expect(out).toEqual({ tag: "existingtag-20", linkCode: "ll1" });
  });
});

describe("canonicalizeAmazonFetchUrl", () => {
  test("strips ref + campaignId from /dp/<ASIN> URLs (regression for empty-name bug)", () => {
    const out = canonicalizeAmazonFetchUrl(
      "https://www.amazon.com/dp/B09YCYYHB6?ref=t_ac_view_request_product_image&campaignId=amzn1.campaign.18DN613TT02TD"
    );
    expect(out).toBe("https://www.amazon.com/dp/B09YCYYHB6");
  });

  test("strips ref + campaignId for second failing URL", () => {
    const out = canonicalizeAmazonFetchUrl(
      "https://www.amazon.com/dp/B0B864M43K?ref=t_ac_view_request_product_image&campaignId=amzn1.campaign.1A6UJLMC3HFE"
    );
    expect(out).toBe("https://www.amazon.com/dp/B0B864M43K");
  });

  test("strips ref + campaignId for third failing URL", () => {
    const out = canonicalizeAmazonFetchUrl(
      "https://www.amazon.com/dp/B0D8CJYFH9?ref=t_ac_view_request_product_image&campaignId=amzn1.campaign.1HZV48SJYG33T"
    );
    expect(out).toBe("https://www.amazon.com/dp/B0D8CJYFH9");
  });

  test("strips associates tag, linkCode, and ascsubtag too", () => {
    const out = canonicalizeAmazonFetchUrl(
      "https://www.amazon.com/dp/B0XYZ12345?tag=mytag-20&linkCode=ll1&ascsubtag=foo&psc=1"
    );
    expect(out).toBe("https://www.amazon.com/dp/B0XYZ12345");
  });

  test("normalizes /gp/product/<ASIN> URLs to /dp/<ASIN>", () => {
    const out = canonicalizeAmazonFetchUrl(
      "https://www.amazon.com/gp/product/B0XYZ12345/?tag=foo"
    );
    expect(out).toBe("https://www.amazon.com/dp/B0XYZ12345");
  });

  test("is a no-op for /dp/<ASIN> URLs without query params", () => {
    const url = "https://www.amazon.com/dp/B0XYZ12345";
    expect(canonicalizeAmazonFetchUrl(url)).toBe(url);
  });

  test("normalizes regional Amazon hosts to www.amazon.com (canonical fetch host)", () => {
    const out = canonicalizeAmazonFetchUrl("https://www.amazon.co.uk/dp/B0XYZ12345?tag=foo");
    expect(out).toBe("https://www.amazon.com/dp/B0XYZ12345");
  });

  test("returns input unchanged for non-Amazon hosts", () => {
    const url = "https://www.zara.com/us/en/some-product-p123.html?v1=42";
    expect(canonicalizeAmazonFetchUrl(url)).toBe(url);
  });

  test("returns input unchanged for Amazon hosts that lack an extractable ASIN (e.g. unresolved a.co)", () => {
    const url = "https://a.co/d/abc123";
    expect(canonicalizeAmazonFetchUrl(url)).toBe(url);
  });
});

describe("extractAmazonProductTitle", () => {
  test("extracts whitespace-padded title from #productTitle span", () => {
    const html = `<html><body><span id="productTitle" class="a-size-large product-title-word-break">        Ekouaer Silk Pajamas for Women Short Sleeve Sleepwear       </span></body></html>`;
    expect(extractAmazonProductTitle(html)).toBe(
      "Ekouaer Silk Pajamas for Women Short Sleeve Sleepwear"
    );
  });

  test("returns null when no #productTitle is present", () => {
    expect(extractAmazonProductTitle("<html><body>x</body></html>")).toBeNull();
  });
});

describe("extractAmazonImageUrl", () => {
  test("picks the highest-resolution variant from #landingImage data-a-dynamic-image", () => {
    const html =
      `<img id="landingImage" data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/x._AC_SX342_.jpg&quot;:[443,342],&quot;https://m.media-amazon.com/images/I/x._AC_SY879_.jpg&quot;:[879,678]}">`;
    expect(extractAmazonImageUrl(html)).toBe(
      "https://m.media-amazon.com/images/I/x._AC_SY879_.jpg"
    );
  });

  test("falls back to src attribute when data-a-dynamic-image is absent", () => {
    const html = `<img id="landingImage" src="https://m.media-amazon.com/images/I/y.jpg">`;
    expect(extractAmazonImageUrl(html)).toBe(
      "https://m.media-amazon.com/images/I/y.jpg"
    );
  });

  test("returns null when no #landingImage is present", () => {
    expect(extractAmazonImageUrl("<html></html>")).toBeNull();
  });
});

describe("extractAmazonBrand", () => {
  test('strips "Visit the X Store" wrapper', () => {
    const html = `<a id="bylineInfo" class="a-link-normal" href="/stores/EKOUAER/page/...">Visit the Ekouaer Store</a>`;
    expect(extractAmazonBrand(html)).toBe("Ekouaer");
  });

  test('strips "Brand: X" prefix', () => {
    const html = `<a id="bylineInfo" href="/x">Brand: Acme</a>`;
    expect(extractAmazonBrand(html)).toBe("Acme");
  });

  test("returns plain text when no known prefix matches", () => {
    const html = `<a id="bylineInfo" href="/x">SomeStorefront</a>`;
    expect(extractAmazonBrand(html)).toBe("SomeStorefront");
  });

  test("returns null when bylineInfo absent", () => {
    expect(extractAmazonBrand("<html></html>")).toBeNull();
  });
});

describe("extractAmazonPrice", () => {
  test("extracts dollar price from a-offscreen span", () => {
    const html = `<span class="a-offscreen">$19.99</span>`;
    expect(extractAmazonPrice(html)).toBe("$19.99");
  });

  test("extracts integer dollar price", () => {
    const html = `<span class="a-offscreen">$45</span>`;
    expect(extractAmazonPrice(html)).toBe("$45");
  });

  test("returns null when no a-offscreen price is present", () => {
    expect(extractAmazonPrice("<html><body>nothing</body></html>")).toBeNull();
  });
});
