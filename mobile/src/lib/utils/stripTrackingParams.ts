const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^gad_/i,
  /^(gclid|gclsrc|dclid|fbclid|msclkid|mc_eid|mc_cid|igshid|ttclid|kwid|tid|ap|_branch_match_id|_gl|_ga|gbraid|wbraid)$/i,
  /^ttd_/i,
  /^(ds_agid|vid)$/i,
];

export function stripTrackingParams(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const keep: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (!TRACKING_PARAM_PATTERNS.some(re => re.test(k))) {
        keep.push([k, v]);
      }
    }
    u.search = keep.length
      ? '?' + keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
    return u.toString();
  } catch {
    return rawUrl;
  }
}
