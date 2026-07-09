import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return res.url
  } catch {
    clearTimeout(timeout)
    // Retry with GET if HEAD fails
    const controller2 = new AbortController()
    const timeout2 = setTimeout(() => controller2.abort(), 5000)
    try {
      const res = await fetch(shortUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller2.signal,
      })
      clearTimeout(timeout2)
      return res.url
    } catch {
      clearTimeout(timeout2)
      return null
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { item_id } = await req.json()
    console.log('[auto-tag-amazon] invoked', { item_id, ts: new Date().toISOString() })
    if (!item_id) throw new Error('item_id is required')

    const tag = Deno.env.get('AMAZON_ASSOCIATES_TAG')
    if (!tag) throw new Error('AMAZON_ASSOCIATES_TAG not set')

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Read the item
    const { data: item, error: itemError } = await supabaseAdmin
      .from('creator_items')
      .select('id, url, affiliate_url, affiliate_provider')
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
      console.log('[auto-tag-amazon] no_url', { item_id })
      return new Response(
        JSON.stringify({ ok: false, reason: 'no_url' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 2. Parse and detect Amazon domain
    let parsedUrl: URL
    try {
      parsedUrl = new URL(item.url)
    } catch {
      console.log('[auto-tag-amazon] invalid_url', { item_id, url: item.url })
      return new Response(
        JSON.stringify({ ok: false, reason: 'invalid_url' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    if (!isAmazonHost(parsedUrl.hostname)) {
      console.log('[auto-tag-amazon] not_amazon', { item_id, host: parsedUrl.hostname })
      return new Response(
        JSON.stringify({ ok: false, reason: 'not_amazon' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 3. Resolve shortlinks
    let resolvedUrl = item.url
    if (isShortlink(parsedUrl.hostname)) {
      const expanded = await resolveShortlink(item.url)
      if (!expanded) {
        console.log('[auto-tag-amazon] shortlink_timeout', { item_id, url: item.url })
        return new Response(
          JSON.stringify({ ok: false, reason: 'shortlink_timeout' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
      resolvedUrl = expanded
    }

    // 4. Extract ASIN
    const asin = extractAsin(resolvedUrl)
    if (!asin) {
      console.log('[auto-tag-amazon] no_asin', { item_id, resolvedUrl })
      return new Response(
        JSON.stringify({ ok: false, reason: 'no_asin' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 5. Build canonical affiliate URL (strip any existing tag= param)
    const affiliateUrl = `https://www.amazon.com/dp/${asin}?tag=${tag}`

    // 6. Write back
    const { error: updateError } = await supabaseAdmin
      .from('creator_items')
      .update({
        affiliate_url: affiliateUrl,
        affiliate_provider: 'amazon',
        affiliate_wrapped_at: new Date().toISOString(),
      })
      .eq('id', item_id)

    if (updateError) {
      console.error('[auto-tag-amazon] update_failed', { item_id, error: updateError.message })
      throw new Error('Failed to update item: ' + updateError.message)
    }

    console.log('[auto-tag-amazon] wrapped', { item_id, asin, affiliateUrl })
    return new Response(
      JSON.stringify({ ok: true, affiliate_url: affiliateUrl }),
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
