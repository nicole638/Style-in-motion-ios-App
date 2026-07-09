import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { look_id } = await req.json()
    console.log('[auto-tag-look] invoked', { look_id, ts: new Date().toISOString() })
    if (!look_id) throw new Error('look_id is required')

    // Create Supabase admin client (uses service role key for writes)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Fetch the look + items
    const { data: look, error: lookError } = await supabaseAdmin
      .from('looks')
      .select('id, title, caption, hashtags, cover_photo_url, look_items(sort_order, creator_items(name, category, brand, price))')
      .eq('id', look_id)
      .single()

    if (lookError || !look) throw new Error('Look not found: ' + lookError?.message)

    // 2. Build the AI prompt
    const itemDescriptions = ((look.look_items as any[]) || [])
      .map((li: any) => li.creator_items)
      .filter((item: any) => item)
      .map((item: any) => `${item.name} — ${item.category} — ${item.brand} — ${item.price}`)
      .join('\n')

    const systemPrompt = `You are a fashion AI tagging system for a styling app called Styled in Motion.
Analyze the outfit photo and metadata to generate structured tags.

Return ONLY valid JSON with these exact keys:
{
  "occasion": ["date night", "wedding guest", ...],
  "season": ["fall", "winter", ...],
  "style_vibe": ["minimalist", "romantic", "edgy", ...],
  "color_palette": ["white", "gold", "blush", ...],
  "clothing_type": ["dress", "heels", "clutch", ...]
}

Rules:
- Each array should have 1-5 values, lowercase
- occasion values: casual, work, date night, wedding guest, brunch, party,
  vacation, formal, athletic, festival, holiday, everyday
- season values: spring, summer, fall, winter, all-season
- style_vibe values: minimalist, romantic, edgy, classic, bohemian, sporty,
  glamorous, streetwear, preppy, vintage, trendy, cozy
- color_palette: use common color names (white, black, red, blue, navy,
  blush, gold, silver, beige, cream, olive, burgundy, etc.)
- clothing_type: use specific garment types (dress, skirt, jeans, blazer,
  sneakers, heels, boots, handbag, clutch, earrings, etc.)
- Be generous with tags — if an outfit COULD work for multiple occasions,
  tag all of them
- Infer from both the photo AND the item metadata`

    const userMessage = `Look title: "${look.title}"
Caption: "${look.caption || 'none'}"
Hashtags: ${(look.hashtags || []).join(', ') || 'none'}

Items in this look:
${itemDescriptions || 'No item details available'}

Analyze the outfit photo and generate tags.`

    // 3. Call OpenAI Vision API
    const openaiKey = Deno.env.get('openai_api_key')
    if (!openaiKey) throw new Error('openai_api_key not set')

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
    ]

    // If we have a cover photo, include it as a vision message
    if (look.cover_photo_url) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: look.cover_photo_url, detail: 'low' } },
          { type: 'text', text: userMessage },
        ],
      })
    } else {
      // No photo — tag from metadata only
      messages.push({ role: 'user', content: userMessage })
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 500,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    })

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text()
      throw new Error('OpenAI API error: ' + errText)
    }

    const aiResult = await openaiResponse.json()
    const rawContent = aiResult.choices?.[0]?.message?.content
    if (!rawContent) throw new Error('No content in OpenAI response')

    const tags = JSON.parse(rawContent)

    // 4. Validate and normalize
    const validArrayField = (val: any): string[] => {
      if (!Array.isArray(val)) return []
      return val.filter((v: any) => typeof v === 'string').map((v: string) => v.toLowerCase().trim()).slice(0, 5)
    }

    const occasion = validArrayField(tags.occasion)
    const season = validArrayField(tags.season)
    const style_vibe = validArrayField(tags.style_vibe)
    const color_palette = validArrayField(tags.color_palette)
    const clothing_type = validArrayField(tags.clothing_type)

    // 5. Normalize creator hashtags as searchable tags
    const creator_tags = (look.hashtags || [])
      .map((h: string) => h.toLowerCase().replace(/^#/, '').trim())
      .filter((h: string) => h.length > 0)

    // 6. Update the look record
    const { error: updateError } = await supabaseAdmin
      .from('looks')
      .update({
        occasion,
        season,
        style_vibe,
        color_palette,
        clothing_type,
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
