// auto-tag-amazon v15 — per-creator tag resolution (fixes attribution leak).
//
// v14 bug: hardcoded AMAZON_ASSOCIATES_TAG env var as the wrap tag for every
// creator. That meant Kerri's items got tagged styledinmotio-20 (master) even
// though her creators.amazon_tracking_id = styledinmotio-kerri-20. Every click
// was attributed to the master tag instead of the creator's sub-tag.
//
// v15 resolution order (mirrors affiliate-wrap-url EF v8):
//   1. creator_profiles.amazon_use_own_tag + amazon_own_tag_enabled +
//      amazon_associates_tag IS NOT NULL → creator's personal Associates tag
//   2. creators.amazon_tracking_id IS NOT NULL → per-creator sub-tag under
//      master account (most common)
//   3. fallback → master env var (styledinmotio-20) only when no creator
//      tracking_id is set

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const AMAZON_HOST_RE = /^(www\.)?amazon\.(com|ca|co\.uk|de|fr|it|es|co\.jp|com\.au|com\.mx|in)$/i
const SHORTLINK_HOSTS = new Set(['a.co', 'amzn.to', 'amzn.eu', 'amzn.asia'])
const ASIN_RE = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/ASIN\/)([A-Z0-9]{10})(?:[\/?\s]|$)/i

function isAmazonHost(hostname: string): boolean {
  return AMAZON_HOST_RE.test(hostname) || SHORTLINK_HOSTS.has(hostname.toLowerCase())
}

function isShortlink(hostname: string): boolean {
  return SHORTLINK_HOSTS.has(hostname.toLowerCase())
}

function extractAsin(url: string): string | null {
  const match = url.match(ASIN_RE)
  return match ? match[1].toUpperCase() : null
}

async function resolveShortlink(shortUrl: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(shortUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    return res.url
  } catch {
    clearTimeout(timeout)
    return null
  }
}

async function resolveCreatorAmazonTag(
  supabaseAdmin: ReturnType<typeof createClient>,
  creatorId: string | null,
  masterTag: string,
): Promise<{ tag: string; source: 'own' | 'creator_tracking_id' | 'master' | 'master_no_creator' }> {
  if (!creatorId) return { tag: masterTag, source: 'master_no_creator' }

  // 1. Creator's own Amazon Associates account (founder/paid tier)
  const { data: prof } = await supabaseAdmin.from('creator_profiles')
    .select('amazon_use_own_tag, amazon_own_tag_enabled, amazon_associates_tag')
    .eq('creator_id', creatorId).maybeSingle()
  if (
    prof?.amazon_use_own_tag === true &&
    prof?.amazon_own_tag_enabled === true &&
    typeof prof?.amazon_associates_tag === 'string' &&
    prof.amazon_associates_tag.trim().length > 0
  ) {
    return { tag: prof.amazon_associates_tag.trim(), source: 'own' }
  }

  // 2. Per-creator sub-tag under master account (most common)
  const { data: c } = await supabaseAdmin.from('creators')
    .select('amazon_tracking_id').eq('id', creatorId).maybeSingle()
  if (typeof c?.amazon_tracking_id === 'string' && c.amazon_tracking_id.trim().length > 0) {
    return { tag: c.amazon_tracking_id.trim(), source: 'creator_tracking_id' }
  }

  return { tag: masterTag, source: 'master' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { item_id } = await req.json()
    console.log('[auto-tag-amazon] invoked', { item_id, ts: new Date().toISOString() })
    if (!item_id) throw new Error('item_id is required')

    const masterTag = Deno.env.get('AMAZON_ASSOCIATES_TAG')
    if (!masterTag) throw new Error('AMAZON_ASSOCIATES_TAG not set')

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Read the item (now also pull creator_id for tag resolution)
    const { data: item, error: itemError } = await supabaseAdmin
      .from('creator_items')
      .select('id, creator_id, url, affiliate_url, affiliate_provider')
      .eq('id', item_id)
      .single()

    if (itemError || !item) {
      console.log('[auto-tag-amazon] not_found', { item_id })
      return new Response(
        JSON.stringify({ ok: false, reason: 'not_found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Idempotent: already wrapped
    if (item.affiliate_url && item.affiliate_provider === 'amazon') {
      console.log('[auto-tag-amazon] already_wrapped', { item_id })
      return new Response(
        JSON.stringify({ ok: true, reason: 'already_wrapped', affiliate_url: item.affiliate_url }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    if (!item.url) {
      return new Response(
        JSON.stringify({ ok: false, reason: 'no_url' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(item.url)
    } catch {
      return new Response(
        JSON.stringify({ ok: false, reason: 'invalid_url' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    if (!isAmazonHost(parsedUrl.hostname)) {
      return new Response(
        JSON.stringify({ ok: false, reason: 'not_amazon' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    let resolvedUrl = item.url
    if (isShortlink(parsedUrl.hostname)) {
      const expanded = await resolveShortlink(item.url)
      if (!expanded) {
        return new Response(
          JSON.stringify({ ok: false, reason: 'shortlink_timeout' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
      resolvedUrl = expanded
    }

    const asin = extractAsin(resolvedUrl)
    if (!asin) {
      return new Response(
        JSON.stringify({ ok: false, reason: 'no_asin', resolvedUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 5. Resolve the per-creator tag (this is the fix)
    const { tag, source } = await resolveCreatorAmazonTag(
      supabaseAdmin, item.creator_id ?? null, masterTag,
    )
    const affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=${tag}`

    const { error: updateError } = await supabaseAdmin
      .from('creator_items')
      .update({
        affiliate_url: affiliateUrl,
        affiliate_provider: 'amazon',
        affiliate_wrapped_at: new Date().toISOString(),
      })
      .eq('id', item_id)

    if (updateError) {
      throw new Error('Failed to update item: ' + updateError.message)
    }

    console.log('[auto-tag-amazon] wrapped', { item_id, asin, tag, source })
    return new Response(
      JSON.stringify({ ok: true, affiliate_url: affiliateUrl, tag, tag_source: source }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('[auto-tag-amazon] error', (error as Error).message)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
