import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) throw new Error('Authorization is required')

    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')!
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')!
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:salon@example.com'

    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData.user) throw new Error('Not authenticated')
    const { data: role } = await caller.from('user_roles').select('role').eq('user_id', userData.user.id).maybeSingle()
    if (role?.role !== 'admin') throw new Error('Not authorized')

    const { clientId, tag } = await request.json()
    if (!clientId) throw new Error('clientId is required')

    const admin = createClient(url, serviceKey)
    const { data: subscriptions, error } = await admin
      .from('client_push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('client_id', clientId)
    if (error) throw error
    const { count: unreadCount, error: unreadError } = await admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('sender', 'admin')
      .is('client_read_at', null)
    if (unreadError) throw unreadError

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
    const payload = JSON.stringify({
      title: 'Salon Kristina',
      body: 'Imate novu poruku iz Salona Kristina.',
      url: 'https://frizerskisalonkristina.hr/#/client/messages',
      tag: tag ?? 'salon-kristina-message',
      unreadCount: unreadCount ?? 1,
    })

    const expired: string[] = []
    let sent = 0
    let failed = 0
    await Promise.all((subscriptions ?? []).map(async subscription => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload)
        sent += 1
      } catch (pushError) {
        const statusCode = (pushError as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) expired.push(subscription.id)
        failed += 1
      }
    }))
    if (expired.length) await admin.from('client_push_subscriptions').delete().in('id', expired)

    return new Response(JSON.stringify({
      subscriptionsFound: subscriptions?.length ?? 0,
      sent,
      failed,
      expiredRemoved: expired.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
