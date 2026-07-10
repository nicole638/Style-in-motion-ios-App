import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"content-type, authorization, apikey", "Access-Control-Allow-Methods":"POST, OPTIONS" };
function j(b, s=200){ return new Response(JSON.stringify(b), {status:s, headers:{...CORS, "Content-Type":"application/json"}}); }
function toDate(ms){ const n=Number(ms); return (n && n>0)? new Date(n).toISOString().slice(0,10): null; }
Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:CORS});
  if(req.method!=="POST") return j({error:"method_not_allowed"},405);
  let body={}; try{ body=await req.json(); }catch(_e){}
  const camps = Array.isArray(body.campaigns)? body.campaigns: [];
  if(!camps.length) return j({error:"no_campaigns"},400);
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = new Date().toISOString();
  const rows = camps.map(c=>{
    const asins = Array.isArray(c.asins)? c.asins.map(a=>String(a).toUpperCase()): [];
    const amzPct = c.commissionPct!=null? Number(c.commissionPct): null;
    return {
      campaign_id_ext: String(c.cid),
      brand_name: c.brand ?? null, brand_id: c.brandId!=null?String(c.brandId):null,
      campaign_name: c.name ?? null,
      amazon_commission_pct: amzPct,
      creator_commission_pct: amzPct!=null? Math.round(amzPct*0.5*100)/100: null,
      promo_pct: c.promoPct!=null?Number(c.promoPct):null,
      start_date: toDate(c.startMs), end_date: toDate(c.endMs),
      total_budget: c.totalBudget!=null?Number(c.totalBudget):null,
      remaining_budget: c.remainingBudget!=null?Number(c.remainingBudget):null,
      currency: c.currency ?? null,
      ad_status: c.status ?? null, campaign_type: c.type ?? null,
      providing_sample: !!c.sample, clicks: c.clicks!=null?Number(c.clicks):null,
      asins, asin_count: asins.length, last_seen_at: now
    };
  }).filter(r=> r.campaign_id_ext && r.campaign_id_ext!=="undefined" && r.campaign_id_ext!=="null");
  let up=0, err=null;
  for(let i=0;i<rows.length;i+=50){
    const chunk=rows.slice(i,i+50);
    const { error } = await supa.from("cc_campaigns").upsert(chunk,{onConflict:"campaign_id_ext"});
    if(error){ err=error.message; break; }
    up+=chunk.length;
  }
  let synced=0;
  if(!err){ const { data, error:se } = await supa.rpc("sync_cc_to_campaigns"); if(se) err="sync: "+se.message; else synced = typeof data==="number"?data:0; }
  return j({ok:!err, received:camps.length, valid_rows:rows.length, upserted:up, synced_to_campaigns:synced, error:err});
});
