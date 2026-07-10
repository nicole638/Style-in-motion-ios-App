import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_API="https://cj.partnerboost.com/api/get_products";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type, authorization, apikey","Access-Control-Allow-Methods":"POST, OPTIONS"};
function j(b,s=200){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
function parsePrice(s){ if(typeof s!=="string")return null; const n=parseFloat(s.replace(/[^0-9.]/g,"")); return Number.isFinite(n)?n:null; }
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return j({error:"method_not_allowed"},405);
  const softDeadline=110000; const started=Date.now();
  const supa=createClient(SUPABASE_URL,SERVICE_ROLE);
  const {data:cfg}=await supa.from("cj_publisher_config").select("website_id").eq("is_default",true).maybeSingle();
  const pid=cfg?.website_id?parseInt(String(cfg.website_id),10):NaN;
  if(!Number.isFinite(pid))return j({error:"no_pid"},500);
  let processed=0, found=0, miss=0, err=null;
  outer: while((Date.now()-started)<softDeadline){
    const {data:rows,error:re}=await supa.rpc("cc_asins_to_enrich",{p_limit:1000});
    if(re){err="rpc: "+re.message;break;}
    const asins=(rows??[]).map((r)=>r.asin).filter(Boolean);
    if(!asins.length) break;
    for(let i=0;i<asins.length && (Date.now()-started)<softDeadline;i+=50){
      const chunk=asins.slice(i,i+50);
      let json=null;
      try{
        const r=await fetch(PB_API,{method:"POST",headers:{"Content-Type":"application/json","Request-Source":"cj"},body:JSON.stringify({pid,page_num:1,page_size:50,country_code:"US",asins:chunk.join(",")}),signal:AbortSignal.timeout(25000)});
        json=await r.json();
      }catch(_e){ continue; }
      const list=(json && json.data && json.data.list)?json.data.list:[];
      const foundSet=new Set();
      const recs=[];
      for(const p of list){ const a=String(p.asin||"").toUpperCase(); if(!a)continue; foundSet.add(a); recs.push({asin:a, product_name:p.product_name??null, image_url:p.image??null, product_url:p.url??("https://www.amazon.com/dp/"+a), price:parsePrice(p.discount_price||p.original_price), currency:"USD", brand_name:p.brand_name??null, source:"partnerboost_api"}); }
      for(const a of chunk){ const A=String(a).toUpperCase(); if(!foundSet.has(A)) recs.push({asin:A, product_name:null, image_url:null, product_url:"https://www.amazon.com/dp/"+A, price:null, currency:null, brand_name:null, source:"partnerboost_miss"}); }
      const {error}=await supa.from("product_info_cache").upsert(recs,{onConflict:"asin"});
      if(error){err="upsert: "+error.message.slice(0,100);break outer;}
      processed+=chunk.length; found+=foundSet.size; miss+=(chunk.length-foundSet.size);
      await new Promise((r)=>setTimeout(r,60));
    }
  }
  const {count}=await supa.from("product_info_cache").select("*",{count:"exact",head:true});
  const {count:imgCount}=await supa.from("product_info_cache").select("*",{count:"exact",head:true}).not("image_url","is",null);
  return j({ok:!err, processed, found, miss, cache_total:count, with_image:imgCount, error:err});
});
