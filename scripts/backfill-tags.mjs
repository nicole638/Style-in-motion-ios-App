/**
 * ONE-TIME BACKFILL SCRIPT
 * Generates AI tags for all existing looks using OpenAI gpt-4o-mini vision.
 * Replicates the logic from supabase/functions/auto-tag-look/index.ts.
 */

import { createClient } from '@supabase/supabase-js';

// --- Config ---
const SUPABASE_URL = 'https://rghlcnrttvlvphzahudf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnaGxjbnJ0dHZsdnBoemFodWRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MTc5NDIsImV4cCI6MjA5MTA5Mzk0Mn0.PlnMZUtd894pnb_ddx0Rp1T0IGOOKJTFqA6fFq5Bt9s';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

if (!OPENAI_API_KEY) {
  console.error('ERROR: Set OPENAI_API_KEY or CODEX_API_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- AI prompt (identical to edge function) ---
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
- Infer from both the photo AND the item metadata`;

function validArrayField(val) {
  if (!Array.isArray(val)) return [];
  return val.filter(v => typeof v === 'string').map(v => v.toLowerCase().trim()).slice(0, 5);
}

async function tagOneLook(look) {
  const itemDescriptions = (look.items || [])
    .map(item => `${item.name} — ${item.category} — ${item.brand} — ${item.price}`)
    .join('\n');

  const userMessage = `Look title: "${look.title}"
Caption: "${look.caption || 'none'}"
Hashtags: ${(look.hashtags || []).join(', ') || 'none'}

Items in this look:
${itemDescriptions || 'No item details available'}

Analyze the outfit photo and generate tags.`;

  const messages = [{ role: 'system', content: systemPrompt }];

  if (look.cover_photo_url) {
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: look.cover_photo_url, detail: 'low' } },
        { type: 'text', text: userMessage },
      ],
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 500,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errText}`);
  }

  const aiResult = await res.json();
  const rawContent = aiResult.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error('No content in OpenAI response');

  const tags = JSON.parse(rawContent);

  const occasion = validArrayField(tags.occasion);
  const season = validArrayField(tags.season);
  const style_vibe = validArrayField(tags.style_vibe);
  const color_palette = validArrayField(tags.color_palette);
  const clothing_type = validArrayField(tags.clothing_type);
  const creator_tags = (look.hashtags || [])
    .map(h => h.toLowerCase().replace(/^#/, '').trim())
    .filter(h => h.length > 0);

  // Update the look in Supabase
  const { error: updateError } = await supabase
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
    .eq('id', look.id);

  if (updateError) throw new Error(`DB update failed: ${updateError.message}`);

  return { occasion, season, style_vibe, color_palette, clothing_type, creator_tags };
}

// --- Main ---
async function main() {
  console.log('=== AI Tag Backfill Script ===\n');
  console.log(`OpenAI base URL: ${OPENAI_BASE_URL}`);
  console.log(`Supabase URL: ${SUPABASE_URL}\n`);

  // Fetch all looks (both tagged and untagged, to get total count)
  const { data: allLooks, error: countError } = await supabase
    .from('looks')
    .select('id, ai_tags_generated')
    .order('created_at', { ascending: true });

  if (countError) {
    console.error('Failed to fetch looks:', countError.message);
    process.exit(1);
  }

  const totalLooks = allLooks.length;
  const alreadyTagged = allLooks.filter(l => l.ai_tags_generated).length;

  // Fetch looks that need tagging (with full data)
  const { data: looks, error: fetchError } = await supabase
    .from('looks')
    .select('id, title, caption, hashtags, cover_photo_url, items(name, category, brand, price)')
    .eq('ai_tags_generated', false)
    .order('created_at', { ascending: true });

  if (fetchError) {
    console.error('Failed to fetch looks:', fetchError.message);
    process.exit(1);
  }

  console.log(`Total looks in database: ${totalLooks}`);
  console.log(`Already tagged: ${alreadyTagged}`);
  console.log(`Looks to backfill: ${looks.length}\n`);

  if (looks.length === 0) {
    console.log('Nothing to backfill! All looks are already tagged.');
    return;
  }

  let success = 0;
  let failed = 0;
  const errors = [];
  const samples = [];

  for (let i = 0; i < looks.length; i++) {
    const look = looks[i];
    const progress = `[${i + 1}/${looks.length}]`;

    try {
      console.log(`${progress} Tagging look "${look.title || look.id}"...`);
      const tags = await tagOneLook(look);
      success++;

      if (samples.length < 3) {
        samples.push({ id: look.id, title: look.title, tags });
      }

      console.log(`  -> OK: occasion=${tags.occasion.join(',')}, style=${tags.style_vibe.join(',')}, colors=${tags.color_palette.join(',')}`);
    } catch (err) {
      failed++;
      errors.push({ id: look.id, title: look.title, error: err.message });
      console.error(`  -> FAILED: ${err.message}`);
    }

    // 1-second delay between calls to avoid rate limiting
    if (i < looks.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // --- Report ---
  console.log('\n=== BACKFILL REPORT ===');
  console.log(`Total looks found: ${totalLooks}`);
  console.log(`Previously tagged: ${alreadyTagged}`);
  console.log(`Backfilled this run: ${success}`);
  console.log(`Failed: ${failed}`);

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(e => console.log(`  - ${e.title || e.id}: ${e.error}`));
  }

  if (samples.length > 0) {
    console.log('\nSample tags (first 2-3 looks):');
    samples.forEach(s => {
      console.log(`\n  Look: "${s.title}" (${s.id})`);
      console.log(`    occasion:      ${s.tags.occasion.join(', ')}`);
      console.log(`    season:        ${s.tags.season.join(', ')}`);
      console.log(`    style_vibe:    ${s.tags.style_vibe.join(', ')}`);
      console.log(`    color_palette: ${s.tags.color_palette.join(', ')}`);
      console.log(`    clothing_type: ${s.tags.clothing_type.join(', ')}`);
      console.log(`    creator_tags:  ${s.tags.creator_tags.join(', ')}`);
    });
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
