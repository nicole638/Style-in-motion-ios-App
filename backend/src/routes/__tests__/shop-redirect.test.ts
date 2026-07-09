import { describe, expect, test } from "bun:test";
import {
  buildAmazonSpecialLink,
  buildCjClickLink,
  buildCjDeepLink,
  buildRakutenDeepLink,
  extractAwinMerchantDomain,
  extractRakutenMerchantDomain,
  isAmazonHost,
  isAwinUrl,
  isPartnerBoostTrackUrl,
  isRakutenUrl,
  resolveAmazonTag,
  rewriteAwinUrl,
  rewriteRakutenUrl,
  sourceFromUserAgent,
  stampPartnerBoostSubId,
} from "../shop-redirect";

const RAKUTEN_DEEPLINK =
  "https://click.linksynergy.com/deeplink?id=PubABC&mid=12345&murl=https%3A%2F%2Fwww.verabradley.com%2Fproduct%2Ftote&u1=old";

describe("isRakutenUrl", () => {
  test("matches click.linksynergy.com", () => {
    expect(isRakutenUrl(RAKUTEN_DEEPLINK)).toBe(true);
  });
  test("matches bare linksynergy.com", () => {
    expect(isRakutenUrl("https://linksynergy.com/deeplink?id=1&mid=2")).toBe(true);
  });
  test("rejects non-Rakuten host", () => {
    expect(isRakutenUrl("https://www.verabradley.com/product/tote")).toBe(false);
  });
  test("rejects Awin host (no cross-network false positive)", () => {
    expect(isRakutenUrl("https://www.awin1.com/cread.php?awinmid=1&awinaffid=2")).toBe(false);
  });
  test("rejects malformed URL", () => {
    expect(isRakutenUrl("not a url")).toBe(false);
  });
});

describe("rewriteRakutenUrl — u1 sub-id stamping", () => {
  test("replaces existing u1 with click_event_id (does not duplicate)", () => {
    const out = rewriteRakutenUrl(RAKUTEN_DEEPLINK, "click-uuid-9");
    const u = new URL(out);
    expect(u.searchParams.get("u1")).toBe("click-uuid-9");
    expect(u.searchParams.getAll("u1")).toHaveLength(1);
  });
  test("adds u1 when missing", () => {
    const out = rewriteRakutenUrl(
      "https://click.linksynergy.com/deeplink?id=PubABC&mid=12345&murl=https%3A%2F%2Fwww.verabradley.com%2Fp",
      "click-uuid-10",
    );
    expect(new URL(out).searchParams.get("u1")).toBe("click-uuid-10");
  });
  test("preserves id, mid, and murl untouched", () => {
    const out = rewriteRakutenUrl(RAKUTEN_DEEPLINK, "click-uuid-11");
    const u = new URL(out);
    expect(u.searchParams.get("id")).toBe("PubABC");
    expect(u.searchParams.get("mid")).toBe("12345");
    expect(u.searchParams.get("murl")).toBe("https://www.verabradley.com/product/tote");
  });
});

describe("extractRakutenMerchantDomain", () => {
  test("returns murl hostname stripped of www", () => {
    expect(extractRakutenMerchantDomain(RAKUTEN_DEEPLINK)).toBe("verabradley.com");
  });
  test("returns null for the offerid form (no murl)", () => {
    expect(
      extractRakutenMerchantDomain("https://click.linksynergy.com/link?id=PubABC&offerid=99"),
    ).toBeNull();
  });
  test("returns null on malformed URL", () => {
    expect(extractRakutenMerchantDomain("not a url")).toBeNull();
  });
});

describe("buildRakutenDeepLink — inline deeplink for raw Rakuten-merchant URLs", () => {
  test("builds id/mid/murl/u1 in the documented order with an encoded murl", () => {
    const out = buildRakutenDeepLink(
      "https://www.lamarquecollection.com/",
      "PubABC",
      "54272",
      "click-uuid-7",
    );
    expect(out).toBe(
      "https://click.linksynergy.com/deeplink?id=PubABC&mid=54272" +
        "&murl=https%3A%2F%2Fwww.lamarquecollection.com%2F&u1=click-uuid-7",
    );
  });

  test("is recognized by isRakutenUrl and round-trips the destination domain", () => {
    const out = buildRakutenDeepLink(
      "https://www.lamarquecollection.com/products/silk-dress",
      "PubABC",
      "54272",
      "click-uuid-8",
    );
    expect(isRakutenUrl(out)).toBe(true);
    expect(extractRakutenMerchantDomain(out)).toBe("lamarquecollection.com");
    const u = new URL(out);
    expect(u.searchParams.get("id")).toBe("PubABC");
    expect(u.searchParams.get("mid")).toBe("54272");
    expect(u.searchParams.get("u1")).toBe("click-uuid-8");
    expect(u.searchParams.get("murl")).toBe(
      "https://www.lamarquecollection.com/products/silk-dress",
    );
  });

  test("stamps u1 with the click_event_id (creator attribution key)", () => {
    const out = buildRakutenDeepLink("https://brand.com/p", "Pub1", "999", "evt-42");
    expect(new URL(out).searchParams.get("u1")).toBe("evt-42");
  });
});

describe("buildCjClickLink — per-advertiser click link (attributes in-app)", () => {
  test("builds click-{PID}-{AID}?url=&sid= with the App PID and encoded dest", () => {
    const out = buildCjClickLink(
      "https://www.quay.com/products/high-key",
      "101740603", // App PID (source=ios)
      "13343811", // Quay universal_link_ad_id
      "evt-quay-1",
    );
    expect(out).toBe(
      "https://www.anrdoezrs.net/click-101740603-13343811" +
        "?url=https%3A%2F%2Fwww.quay.com%2Fproducts%2Fhigh-key&sid=evt-quay-1",
    );
  });

  test("round-trips the destination and stamps sid = click_event_id", () => {
    const out = buildCjClickLink("https://brand.com/p?x=1", "101761822", "999", "evt-42");
    const u = new URL(out);
    expect(u.hostname).toBe("www.anrdoezrs.net");
    expect(u.pathname).toBe("/click-101761822-999");
    expect(u.searchParams.get("url")).toBe("https://brand.com/p?x=1");
    expect(u.searchParams.get("sid")).toBe("evt-42");
  });
});

describe("buildCjDeepLink — type/dlg fallback for advertisers without an ad id", () => {
  test("builds the links/{PID}/type/dlg/sid/{sid}/{dest} DPL format", () => {
    const out = buildCjDeepLink("https://coofandy.com/p", "101740603", "evt-cf-1");
    expect(out).toBe(
      "https://www.anrdoezrs.net/links/101740603/type/dlg/sid/evt-cf-1/" +
        "https%3A%2F%2Fcoofandy.com%2Fp",
    );
  });
});

describe("sourceFromUserAgent — UA backstop (only used when no param/referer)", () => {
  const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const MAC_SAFARI =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
  const WIN_CHROME =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
  const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36";

  test("iPhone Safari ⇒ 'ios' (covers the 124 param-less iOS rows)", () => {
    expect(sourceFromUserAgent(IPHONE_SAFARI)).toBe("ios");
  });

  test("desktop Safari (macOS) ⇒ 'web'", () => {
    expect(sourceFromUserAgent(MAC_SAFARI)).toBe("web");
  });

  test("desktop Chrome (Windows) ⇒ 'web'", () => {
    expect(sourceFromUserAgent(WIN_CHROME)).toBe("web");
  });

  test("Android Chrome ⇒ 'android' (not miscounted as desktop linux)", () => {
    expect(sourceFromUserAgent(ANDROID_CHROME)).toBe("android");
  });

  test("null / empty UA ⇒ null (true server-to-server stays unattributed)", () => {
    expect(sourceFromUserAgent(null)).toBeNull();
    expect(sourceFromUserAgent(undefined)).toBeNull();
    expect(sourceFromUserAgent("")).toBeNull();
  });

  test("link-preview bots ⇒ null (filterable, never web/ios)", () => {
    expect(sourceFromUserAgent("facebookexternalhit/1.1")).toBeNull();
    expect(sourceFromUserAgent("Twitterbot/1.0")).toBeNull();
    expect(sourceFromUserAgent("Slackbot-LinkExpanding 1.0")).toBeNull();
    // bot check runs before mobile/desktop, so an Android-token bot stays null
    expect(
      sourceFromUserAgent(
        "Mozilla/5.0 (Linux; Android 10) ... compatible; Googlebot/2.1",
      ),
    ).toBeNull();
  });

  test("server fetchers ⇒ null", () => {
    expect(sourceFromUserAgent("curl/8.4.0")).toBeNull();
    expect(sourceFromUserAgent("python-requests/2.31.0")).toBeNull();
    expect(sourceFromUserAgent("node-fetch/1.0")).toBeNull();
  });
});

describe("resolveAmazonTag — 3-tier Amazon attribution", () => {
  test("tier 1: own tag wins when use_own=true, enabled=true, and tag is non-empty", () => {
    expect(
      resolveAmazonTag({
        ownTag: "reillyrose-20",
        useOwnFlag: true,
        ownEnabledFlag: true,
        creatorTrackingId: "styledinmotio-jacq-20",
        masterTag: "styledinmotio-20",
      }),
    ).toEqual({ tag: "reillyrose-20", source: "own" });
  });

  test("tier 2: SiM subtag when use_own=false and tracking_id is non-empty", () => {
    expect(
      resolveAmazonTag({
        ownTag: null,
        useOwnFlag: false,
        ownEnabledFlag: false,
        creatorTrackingId: "styledinmotio-nicole-20",
        masterTag: "styledinmotio-20",
      }),
    ).toEqual({ tag: "styledinmotio-nicole-20", source: "creator_tracking_id" });
  });

  test("tier 2: SiM subtag also wins when use_own=true but enabled=false (opt-in incomplete)", () => {
    expect(
      resolveAmazonTag({
        ownTag: "reillyrose-20",
        useOwnFlag: true,
        ownEnabledFlag: false,
        creatorTrackingId: "styledinmotio-kerri-20",
        masterTag: "styledinmotio-20",
      }),
    ).toEqual({ tag: "styledinmotio-kerri-20", source: "creator_tracking_id" });
  });

  test("tier 2: subtag with whitespace is trimmed", () => {
    expect(
      resolveAmazonTag({
        ownTag: null,
        useOwnFlag: false,
        ownEnabledFlag: false,
        creatorTrackingId: "  styledinmotio-nicole-20  ",
        masterTag: "styledinmotio-20",
      }),
    ).toEqual({ tag: "styledinmotio-nicole-20", source: "creator_tracking_id" });
  });

  test("tier 3: master tag when both creator_profiles and creators.amazon_tracking_id are empty", () => {
    expect(
      resolveAmazonTag({
        ownTag: null,
        useOwnFlag: false,
        ownEnabledFlag: false,
        creatorTrackingId: null,
        masterTag: "styledinmotio-20",
      }),
    ).toEqual({ tag: "styledinmotio-20", source: "master" });
  });

  test("returns null when even master is absent (un-tagged fallback)", () => {
    expect(
      resolveAmazonTag({
        ownTag: null,
        useOwnFlag: false,
        ownEnabledFlag: false,
        creatorTrackingId: null,
        masterTag: null,
      }),
    ).toBeNull();
  });

  test("empty-string own tag falls through to subtag even if flags set", () => {
    expect(
      resolveAmazonTag({
        ownTag: "   ",
        useOwnFlag: true,
        ownEnabledFlag: true,
        creatorTrackingId: "styledinmotio-x-20",
        masterTag: "styledinmotio-20",
      }),
    ).toEqual({ tag: "styledinmotio-x-20", source: "creator_tracking_id" });
  });
});

describe("buildAmazonSpecialLink — attribution param preservation", () => {
  test("preserves campaignId and ref from a Creator Connections URL", () => {
    const original =
      "https://www.amazon.com/dp/B0XYZ12345?campaignId=foo123&ref=bar_baz";
    const out = buildAmazonSpecialLink(original, "styledinmotio-20", "click-uuid-1");
    const u = new URL(out);
    expect(u.searchParams.get("campaignId")).toBe("foo123");
    expect(u.searchParams.get("ref")).toBe("bar_baz");
    expect(u.searchParams.get("tag")).toBe("styledinmotio-20");
    expect(u.searchParams.get("ascsubtag")).toBe("click-uuid-1");
    expect(u.pathname).toBe("/dp/B0XYZ12345");
  });

  test("preserves linkCode=sl1 from a Creator Connections URL (not overwritten to ll1)", () => {
    const original =
      "https://www.amazon.com/dp/B0XYZ12345?linkCode=sl1&linkId=abc&kw=dress";
    const out = buildAmazonSpecialLink(original, "styledinmotio-20");
    const u = new URL(out);
    expect(u.searchParams.get("linkCode")).toBe("sl1");
    expect(u.searchParams.get("linkId")).toBe("abc");
    expect(u.searchParams.get("kw")).toBe("dress");
    expect(u.searchParams.get("tag")).toBe("styledinmotio-20");
  });

  test("preserves linkCode=ll1 from a SiteStripe-generated URL (not overwritten)", () => {
    const original =
      "https://www.amazon.com/dp/B0XYZ12345?linkCode=ll1&tag=oldtag-20&language=en_US";
    const out = buildAmazonSpecialLink(original, "styledinmotio-20", "click-uuid-2");
    const u = new URL(out);
    expect(u.searchParams.get("linkCode")).toBe("ll1");
    expect(u.searchParams.get("language")).toBe("en_US");
    expect(u.searchParams.get("tag")).toBe("styledinmotio-20");
    expect(u.searchParams.get("ascsubtag")).toBe("click-uuid-2");
  });
});

// The open-redirect guard for ?url= brand-catalog taps accepts a host when
// isAmazonHost(url) is true OR the host is an active affiliate_merchants row.
// Amazon is NOT a merchant row, so the guard leans entirely on isAmazonHost
// recognizing these hosts — otherwise an Amazon brand-catalog tap 400s.
describe("isAmazonHost — open-redirect guard acceptance for Amazon ?url=", () => {
  test("accepts amazon.com / www.amazon.com / smile.amazon.com", () => {
    expect(isAmazonHost("https://amazon.com/dp/B0XYZ12345")).toBe(true);
    expect(isAmazonHost("https://www.amazon.com/dp/B0XYZ12345")).toBe(true);
    expect(isAmazonHost("https://smile.amazon.com/dp/B0XYZ12345")).toBe(true);
  });
  test("accepts a.co and amzn.to short domains", () => {
    expect(isAmazonHost("https://a.co/d/abc")).toBe(true);
    expect(isAmazonHost("https://amzn.to/3xyz")).toBe(true);
  });
  test("rejects an arbitrary non-Amazon host (still 400s unless a merchant)", () => {
    expect(isAmazonHost("https://evil.example.com/dp/B0XYZ12345")).toBe(false);
  });
});

describe("isAwinUrl", () => {
  test("matches awin1.com/cread.php", () => {
    expect(
      isAwinUrl(
        "https://www.awin1.com/cread.php?awinmid=12345&awinaffid=99999&clickref=test&p=https%3A%2F%2Fwww.bolsanova.com%2Fproducts%2Fexample",
      ),
    ).toBe(true);
  });

  test("matches awin1.com (no www)", () => {
    expect(isAwinUrl("https://awin1.com/cread.php?awinmid=1&awinaffid=2&p=https%3A%2F%2Fexample.com")).toBe(true);
  });

  test("rejects Awin host but wrong path", () => {
    expect(isAwinUrl("https://www.awin1.com/about")).toBe(false);
  });

  test("rejects non-Awin host", () => {
    expect(isAwinUrl("https://www.bolsanova.com/products/example")).toBe(false);
  });

  test("rejects malformed URL", () => {
    expect(isAwinUrl("not a url")).toBe(false);
  });
});

describe("rewriteAwinUrl — clickref stamping", () => {
  test("replaces existing clickref with creator slug (does not duplicate)", () => {
    const original =
      "https://www.awin1.com/cread.php?awinmid=12345&awinaffid=99999&clickref=test&p=https%3A%2F%2Fwww.bolsanova.com%2Fproducts%2Fexample";
    const out = rewriteAwinUrl(original, "creator-uuid-1");
    const u = new URL(out);
    expect(u.searchParams.get("clickref")).toBe("creator-uuid-1");
    expect(u.searchParams.getAll("clickref")).toHaveLength(1);
  });

  test("adds clickref when missing", () => {
    const original =
      "https://www.awin1.com/cread.php?awinmid=12345&awinaffid=99999&p=https%3A%2F%2Fwww.bolsanova.com%2Fproducts%2Fexample";
    const out = rewriteAwinUrl(original, "creator-uuid-2");
    const u = new URL(out);
    expect(u.searchParams.get("clickref")).toBe("creator-uuid-2");
  });

  test("preserves awinmid, awinaffid, and p untouched", () => {
    const original =
      "https://www.awin1.com/cread.php?awinmid=12345&awinaffid=99999&clickref=old&p=https%3A%2F%2Fwww.bolsanova.com%2Fproducts%2Fexample";
    const out = rewriteAwinUrl(original, "creator-uuid-3");
    const u = new URL(out);
    expect(u.searchParams.get("awinmid")).toBe("12345");
    expect(u.searchParams.get("awinaffid")).toBe("99999");
    expect(u.searchParams.get("p")).toBe("https://www.bolsanova.com/products/example");
  });
});

describe("extractAwinMerchantDomain", () => {
  test("returns hostname stripped of www", () => {
    expect(
      extractAwinMerchantDomain(
        "https://www.awin1.com/cread.php?awinmid=12345&awinaffid=99999&p=https%3A%2F%2Fwww.bolsanova.com%2Fproducts%2Fexample",
      ),
    ).toBe("bolsanova.com");
  });

  test("lowercases hostname", () => {
    expect(
      extractAwinMerchantDomain(
        "https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&p=https%3A%2F%2FBolsaNova.COM%2Fx",
      ),
    ).toBe("bolsanova.com");
  });

  test("returns null when p= is missing", () => {
    expect(extractAwinMerchantDomain("https://www.awin1.com/cread.php?awinmid=1&awinaffid=2")).toBeNull();
  });

  test("returns null when p= is not a valid URL", () => {
    expect(
      extractAwinMerchantDomain("https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&p=garbage"),
    ).toBeNull();
  });

  test("returns null on malformed Awin URL", () => {
    expect(extractAwinMerchantDomain("not a url")).toBeNull();
  });
});

const PB_TRACK =
  "https://app.partnerboost.com/track/ABC123LONGTOKEN?url=https%3A%2F%2Fwww.somebrand.com%2Fproduct%3Fcolor%3Dred%26size%3DM";

describe("isPartnerBoostTrackUrl", () => {
  test("matches app.partnerboost.com /track/ links", () => {
    expect(isPartnerBoostTrackUrl(PB_TRACK)).toBe(true);
  });
  test("rejects partnerboost host without a /track/ path", () => {
    expect(isPartnerBoostTrackUrl("https://app.partnerboost.com/dashboard")).toBe(false);
  });
  test("rejects other affiliate networks (no cross-network false positive)", () => {
    expect(isPartnerBoostTrackUrl(RAKUTEN_DEEPLINK)).toBe(false);
    expect(isPartnerBoostTrackUrl("https://www.anrdoezrs.net/links/123/type/dlg/sid/x/y")).toBe(false);
  });
  test("rejects malformed URL", () => {
    expect(isPartnerBoostTrackUrl("not a url")).toBe(false);
  });
});

describe("stampPartnerBoostSubId — sub-id stamping", () => {
  test("appends uid=click_event_id", () => {
    const out = stampPartnerBoostSubId(PB_TRACK, "click-uuid-42");
    expect(new URL(out).searchParams.get("uid")).toBe("click-uuid-42");
  });

  test("leaves the track token and ?url= destination byte-for-byte intact", () => {
    const out = stampPartnerBoostSubId(PB_TRACK, "click-uuid-42");
    // Pure string append — the original substring is untouched, only &uid=… is added.
    expect(out).toBe(`${PB_TRACK}&uid=click-uuid-42`);
    // The encoded destination is not re-encoded.
    expect(out).toContain(
      "url=https%3A%2F%2Fwww.somebrand.com%2Fproduct%3Fcolor%3Dred%26size%3DM",
    );
  });

  test("does not double-stamp an already-stamped link", () => {
    const once = stampPartnerBoostSubId(PB_TRACK, "click-uuid-1");
    const twice = stampPartnerBoostSubId(once, "click-uuid-2");
    expect(twice).toBe(once);
    expect(new URL(twice).searchParams.getAll("uid")).toHaveLength(1);
  });

  test("no-op for non-PartnerBoost URLs (other networks untouched)", () => {
    expect(stampPartnerBoostSubId(RAKUTEN_DEEPLINK, "x")).toBe(RAKUTEN_DEEPLINK);
    const cj = "https://www.anrdoezrs.net/links/123/type/dlg/sid/x/y";
    expect(stampPartnerBoostSubId(cj, "x")).toBe(cj);
  });

  test("no-op when subId is empty", () => {
    expect(stampPartnerBoostSubId(PB_TRACK, "")).toBe(PB_TRACK);
  });
});
