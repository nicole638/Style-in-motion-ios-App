import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Validate caller: pass the user's JWT in the Authorization header
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing auth' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Create an admin client
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Verify the JWT and get the user
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userId = user.id

  try {
    // 1. Delete storage files for this user from all buckets
    const buckets = ['profile-photos', 'look-photos', 'item-photos']
    for (const bucket of buckets) {
      // List files in the user's folder
      const { data: files } = await admin.storage.from(bucket).list(userId, { limit: 1000 })
      if (files && files.length > 0) {
        const paths = files.map((f: any) => `${userId}/${f.name}`)
        await admin.storage.from(bucket).remove(paths)
      }
      // Also check for nested folders (e.g., look-photos/covers/userId/)
      const { data: coverFiles } = await admin.storage.from(bucket).list(`covers/${userId}`, { limit: 1000 })
      if (coverFiles && coverFiles.length > 0) {
        const coverPaths = coverFiles.map((f: any) => `covers/${userId}/${f.name}`)
        await admin.storage.from(bucket).remove(coverPaths)
      }
    }

    // 2. Delete the auth user. The schema has ON DELETE CASCADE from
    //    creators/audience_accounts -> looks -> items -> likes/click_events,
    //    so deleting auth.users cleans the rest automatically.
    const { error: delErr } = await admin.auth.admin.deleteUser(userId)
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
