// auto-tag-look v13 — tuned for Pinterest's validated trending aesthetics.
//
// v12 → v13 changes:
//   - Pinterest Trends now surfaces "pilates princess", "yoga mom",
//     "laced up festival", "bandana aesthetic", "night out fashion"
//     as high-growth fashion searches. Added them to the preferred
//     style_vibe / occasion lists so new looks get tagged with the
//     terms Pinterest's algorithm is actively pushing.
//   - Encouragement to use specific Pinterest-trend terms when they
//     fit, since those exact tags drive the most discovery traffic.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { look_id } = await req.json()
    if (!look_id) throw new Error('look_id is required')

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: look, error: lookError } = await supabaseAdmin
      .from('looks')
      .select('id, title, caption, hashtags, cover_photo_url, look_items(sort_order, creator_items(name, category, brand, price, archived))')
      .eq('id', look_id)
      .single()

    if (lookError || !look) throw new Error('Look not found: ' + lookError?.message)

    const items = ((look as any).look_items || [])
      .map((li: any) => ({ ...(li.creator_items || {}), sort_order: li.sort_order }))
      .filter((ci: any) => ci && ci.name && !ci.archived)
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    const itemDescriptions = items
      .map((item: any) => `${item.name} — ${item.category} — ${item.brand} — ${item.price}`)
      .join('\n')

    const systemPrompt = `You are a fashion editor tagging outfits for Styled in Motion, a creator-driven styling app. Your tags power how shoppers discover looks by mood, occasion, and aesthetic — and also drive what gets surfaced on Pinterest, where Styled in Motion runs aesthetic-curated boards.

Return ONLY valid JSON with these exact keys:
{
  "occasion": ["date night", "brunch", ...],
  "season": ["fall", "winter", ...],
  "style_vibe": ["coquette", "pilates princess", ...],
  "color_palette": ["white", "gold", "blush", ...],
  "clothing_type": ["dress", "heels", "clutch", ...]
}

Guidance per dimension:

**occasion** — context the outfit fits. PREFERRED values include:
  casual, work, date night, night out, wedding guest, brunch, party,
  vacation, formal, athletic, festival, holiday, everyday, school,
  concert, graduation, church, eid, travel, beach, weekend,
  girls night out
  Pinterest is currently surging on: "night out fashion" — prefer
  this over generic "party" when fitting.
  You may add unlisted occasions if they're clearly common.

**season** — spring, summer, fall, winter, all-season.

**style_vibe** — the aesthetic. PREFERRED values include evergreen +
currently-trending Pinterest aesthetics:
  Evergreen: minimalist, romantic, edgy, classic, bohemian, sporty,
    glamorous, streetwear, preppy, vintage, trendy, cozy
  Current 2026 aesthetics (Pinterest is actively boosting these):
    coquette, coastal grandma, dark academia, cottagecore, balletcore,
    y2k, indie sleaze, mob wife, blokette, tomato girl, quiet luxury,
    old money, western, grunge, athleisure, business casual, soft girl,
    downtown girl, clean girl, french girl, model off duty,
    pilates princess, yoga mom, laced festival, bandana aesthetic,
    denim on denim
  IMPORTANT:
  - Pinterest's trending search categories include Bandana Hairstyles
    (+500% MoM), Denim Clothing Styles (+200%), Night Out Fashion
    (+80%), and 2000s Yoga Mom Vibes / Pilates Princess. Use those
    terms when they fit — they drive the most discovery traffic.
  - Prefer specific aesthetics (coquette, pilates princess,
    mob wife) over generic ones (trendy, classic) when applicable.
  - Don't default to "trendy" — every look is trendy by definition;
    say what KIND of trendy.
  - If a current well-known aesthetic better fits the look, USE IT
    even if it's not on this list.

**color_palette** — dominant colors. Common color names:
  white, black, ivory, cream, beige, tan, brown, camel, chocolate,
  red, burgundy, pink, blush, rose, coral, peach, orange, rust,
  yellow, butter, gold, mustard, olive, green, sage, emerald, mint,
  teal, blue, navy, denim, royal, baby blue, purple, lavender, plum,
  grey, silver, charcoal, multi-color, pastel, neutral, mocha

**clothing_type** — specific garment types in the look:
  dress, midi dress, maxi dress, mini dress, skirt, mini skirt,
  midi skirt, jeans, baggy jeans, flared jeans, capris, leggings,
  trousers, joggers, sweatpants, shorts, lace shorts,
  blouse, t-shirt, tank top, crop top, sweater, cardigan, hoodie,
  blazer, jacket, coat, trench, leather jacket, denim jacket, vest,
  sneakers, heels, boots, ankle boots, knee boots, cowboy boots,
  loafers, sandals, flats, ballet flats,
  handbag, clutch, tote, crossbody, backpack, belt, scarf, bandana,
  earrings, necklace, bracelet, watch, sunglasses, hat

General rules:
- 1-7 values per array, lowercase, hyphens or spaces ok
- Be generous: if an outfit fits multiple occasions or aesthetics,
  tag them all
- For style_vibe specifically, prefer specific Pinterest-trending
  aesthetics over generic ones
- Infer from BOTH the photo AND the item metadata
- When in doubt between two terms, include both`

    const userMessage = `Look title: "${look.title}"
Caption: "${look.caption || 'none'}"
Hashtags: ${(look.hashtags || []).join(', ') || 'none'}

Items in this look:
${itemDescriptions || 'No item details available'}

Analyze the outfit photo (if provided) and generate descriptive tags. Lean toward MORE tags rather than fewer — a look should be discoverable from many angles.`

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) throw new Error('OPENAI_API_KEY not set')

    const messages: any[] = [{ role: 'system', content: systemPrompt }]

    if (look.cover_photo_url) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: look.cover_photo_url, detail: 'low' } },
          { type: 'text', text: userMessage },
        ],
      })
    } else {
      messages.push({ role: 'user', content: userMessage })
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 700,
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    })

    if (!openaiResponse.ok) {
      throw new Error('OpenAI API error: ' + (await openaiResponse.text()))
    }

    const aiResult = await openaiResponse.json()
    const rawContent = aiResult.choices?.[0]?.message?.content
    if (!rawContent) throw new Error('No content in OpenAI response')

    const tags = JSON.parse(rawContent)

    const validArrayField = (val: any): string[] => {
      if (!Array.isArray(val)) return []
      return val
        .filter((v: any) => typeof v === 'string')
        .map((v: string) => v.toLowerCase().trim())
        .filter((v: string) => v.length > 0 && v.length <= 50)
        .slice(0, 7)
    }

    const occasion = validArrayField(tags.occasion)
    const season = validArrayField(tags.season)
    const style_vibe = validArrayField(tags.style_vibe)
    const color_palette = validArrayField(tags.color_palette)
    const clothing_type = validArrayField(tags.clothing_type)

    const creator_tags = (look.hashtags || [])
      .map((h: string) => h.toLowerCase().replace(/^#/, '').trim())
      .filter((h: string) => h.length > 0)

    const { error: updateError } = await supabaseAdmin
      .from('looks')
      .update({
        occasion, season, style_vibe, color_palette, clothing_type,
        creator_tags,
        ai_tags_generated: true,
        ai_tags_raw: tags,
      })
      .eq('id', look_id)

    if (updateError) throw new Error('Failed to update look: ' + updateError.message)

    return new Response(
      JSON.stringify({ success: true, tags: { occasion, season, style_vibe, color_palette, clothing_type, creator_tags } }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
