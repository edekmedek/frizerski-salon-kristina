import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate, formatDateTime } from './lib/date'
import { supabase } from './lib/supabase'
import { requestStatusLabel } from './lib/adminInbox'
import { pushErrorMessage, SALON_VAPID_PUBLIC_KEY } from './lib/pushNotifications'
import { countClientUnreadMessages, subscribeToAppForeground, updateAppBadge } from './lib/appBadge'
import { closeReadClientMessageNotifications, isClientMessagesLocation, isClientNotificationsLocation, registerSalonPushWorker } from './lib/clientPush'
import { detectNotificationPlatform, getLastSuccessfulPushTest, saveLastSuccessfulPushTest } from './lib/notificationSetup'
import './Portal.css'

type Section = 'home' | 'request' | 'appointments' | 'prices' | 'messages' | 'photos' | 'notifications'
type PushState = 'unsupported' | 'available' | 'enabled' | 'denied' | 'working'
interface ClientRow { id: string; first_name: string; last_name: string }
interface AppointmentRow { id: string; starts_at: string; ends_at: string | null; service: string | null; service_name_snapshot: string | null; service_price_snapshot: number | null; service_duration_snapshot: number | null; notes: string | null; status: string; confirmation_status?: string }
interface RequestRow { id: string; kind: string; service: string | null; preferred_dates: string[]; day_period: string; client_message: string; status: string; admin_reply: string; client_reply: string; proposed_starts_at: string | null; proposed_duration_minutes: number | null; appointment_id: string | null; created_at: string; updated_at: string }
interface MessageRow { id: string; sender: string; subject?: string; message: string; is_read: boolean; read_at: string | null; client_read_at: string | null; created_at: string }
interface ReminderRow { id: string; title: string; body: string; scheduled_for: string; status: string }
interface TreatmentPhotoRow { id: string; image_path: string; thumbnail_path: string; phase: 'before' | 'after'; sort_order: number }
interface TreatmentSetRow { id: string; client_id: string; notes: string | null; taken_at: string; visible_to_client: boolean; treatment_photos: TreatmentPhotoRow[] }
interface ClientPhoto { id: string; phase: 'before' | 'after'; notes: string | null; taken_at: string; url: string }
interface PublicService { id?: string; categoryName: string; name: string; price: number; durationMinutes?: number }

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0))
}

async function removeOlderClientPushSubscriptions(activeEndpoint: string) {
  if (!supabase) return
  const { error } = await supabase.functions.invoke('send-web-push', {
    body: { action: 'deduplicate-client-subscriptions', activeEndpoint },
  })
  if (error) throw error
}

export function ClientPortal({ clientId, onLogout }: { clientId: string; onLogout: () => void }) {
  const [client, setClient] = useState<ClientRow | null>(null)
  const [appointments, setAppointments] = useState<AppointmentRow[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [, setReminders] = useState<ReminderRow[]>([])
  const [photos, setPhotos] = useState<ClientPhoto[]>([])
  const [priceList, setPriceList] = useState<PublicService[]>([])
  const [bookableServices, setBookableServices] = useState<PublicService[]>([])
  const [requestCategory, setRequestCategory] = useState('')
  const [requestServiceIds, setRequestServiceIds] = useState<string[]>([])
  const [openPriceCategory, setOpenPriceCategory] = useState('')
  const [section, setSection] = useState<Section>(() => isClientMessagesLocation(window.location.hash) ? 'messages' : isClientNotificationsLocation(window.location.hash) ? 'notifications' : 'home')
  const [detail, setDetail] = useState<AppointmentRow | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [portalLoadError, setPortalLoadError] = useState<{ kind: 'access' | 'data'; message: string } | null>(null)
  const [respondingRequestId, setRespondingRequestId] = useState('')
  const [highlightedMessageIds, setHighlightedMessageIds] = useState<string[]>([])
  const [messageDraft, setMessageDraft] = useState('')
  const [messageBusy, setMessageBusy] = useState(false)
  const [pushState, setPushState] = useState<PushState>(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
    return Notification.permission === 'denied' ? 'denied' : 'available'
  })
  const [serviceWorkerActive, setServiceWorkerActive] = useState(false)
  const [pushTestBusy, setPushTestBusy] = useState(false)
  const [lastPushTestAt, setLastPushTestAt] = useState(() => getLastSuccessfulPushTest())
  const platform = useMemo(() => detectNotificationPlatform(), [])
  const knownMessageIdsRef = useRef<Set<string>>(new Set())
  const knownRequestVersionsRef = useRef<Map<string, string>>(new Map())
  const messagesInitializedRef = useRef(false)
  const markingMessagesReadRef = useRef(false)
  const [portalNow] = useState(() => Date.now())
  const upcoming = useMemo(() => appointments.filter(item => item.status === 'confirmed' && item.confirmation_status !== 'pending' && new Date(item.starts_at).getTime() >= portalNow).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)), [appointments, portalNow])
  const visibleRequests = useMemo(() => requests.filter(item => item.status !== 'confirmed'), [requests])
  const inboxCount = useMemo(() => countClientUnreadMessages(messages), [messages])

  useEffect(() => {
    let active = true
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return
    }
    if (Notification.permission === 'denied') {
      return
    }

    async function refreshPushState() {
      try {
        const registration = await registerSalonPushWorker()
        const subscription = await registration.pushManager?.getSubscription()
        if (!active) return
        setServiceWorkerActive(Boolean(registration.active))
        if (!subscription || !supabase) {
          setPushState('available')
          return
        }
        const serialized = subscription.toJSON()
        const { error } = await supabase.rpc('client_save_push_subscription', {
          push_endpoint: serialized.endpoint,
          push_p256dh: serialized.keys?.p256dh,
          push_auth: serialized.keys?.auth,
          push_user_agent: navigator.userAgent,
        })
        if (error) throw error
        await removeOlderClientPushSubscriptions(serialized.endpoint ?? '')
        if (active) setPushState('enabled')
      } catch (error) {
        console.error('Provjera push pretplate nije uspjela.', error)
        if (active) setPushState(Notification.permission === 'denied' ? 'denied' : 'available')
      }
    }

    void refreshPushState()
    const refreshOnForeground = () => {
      if (document.visibilityState === 'visible') void refreshPushState()
    }
    window.addEventListener('focus', refreshOnForeground)
    document.addEventListener('visibilitychange', refreshOnForeground)
    return () => {
      active = false
      window.removeEventListener('focus', refreshOnForeground)
      document.removeEventListener('visibilitychange', refreshOnForeground)
    }
  }, [])

  async function enablePushNotifications() {
    if (!supabase || pushState === 'working') return
    const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || SALON_VAPID_PUBLIC_KEY
    setPushState('working')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushState('denied')
        setNotice('Obavijesti nisu dopuštene u postavkama uređaja.')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const serialized = subscription.toJSON()
      const { error } = await supabase.rpc('client_save_push_subscription', {
        push_endpoint: serialized.endpoint,
        push_p256dh: serialized.keys?.p256dh,
        push_auth: serialized.keys?.auth,
        push_user_agent: navigator.userAgent,
      })
      if (error) throw error
      await removeOlderClientPushSubscriptions(serialized.endpoint ?? '')
      setPushState('enabled')
      setNotice('Obavijesti su uključene i mogu stizati kada je aplikacija zatvorena.')
    } catch (error) {
      setPushState(Notification.permission === 'denied' ? 'denied' : 'available')
      setNotice(pushErrorMessage(error))
    }
  }

  async function sendTestPush() {
    if (!supabase || pushState !== 'enabled' || pushTestBusy) return
    setPushTestBusy(true)
    const { data, error } = await supabase.functions.invoke('send-web-push', {
      body: { action: 'test-client-push' },
    })
    setPushTestBusy(false)
    const result = data as { sent?: number } | null
    if (error || result?.sent !== 1) {
      console.error('Probna push obavijest nije poslana.', { error, result })
      setNotice('Probna obavijest nije poslana. Provjerite upute za uređaj.')
      return
    }
    const testedAt = new Date().toISOString()
    saveLastSuccessfulPushTest(testedAt)
    setLastPushTestAt(testedAt)
    setNotice('Probna obavijest je poslana. Obavijesti su spremne.')
  }

  function playNewMessageSound() {
    try {
      const audio = new AudioContext()
      const start = audio.currentTime
      ;[0, 0.16].forEach((offset, index) => {
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        oscillator.frequency.value = index === 0 ? 740 : 988
        gain.gain.setValueAtTime(0.0001, start + offset)
        gain.gain.exponentialRampToValueAtTime(0.14, start + offset + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.13)
        oscillator.connect(gain)
        gain.connect(audio.destination)
        oscillator.start(start + offset)
        oscillator.stop(start + offset + 0.14)
      })
      window.setTimeout(() => void audio.close(), 600)
    } catch {
      // Preglednik može blokirati zvuk prije prve korisničke interakcije.
    }
  }

  useEffect(() => {
    let active = true
    async function load() {
      const supabaseClient = supabase
      if (!supabaseClient) return
      const [clientResult, appointmentResult, requestResult, messageResult, reminderResult, photoResult, pricesResult, bookableResult] = await Promise.all([
        supabaseClient.from('clients').select('id,first_name,last_name').eq('id', clientId).maybeSingle(),
        supabaseClient.from('appointments').select('id,starts_at,ends_at,service,service_name_snapshot,service_price_snapshot,service_duration_snapshot,notes,status,confirmation_status').eq('client_id', clientId),
        supabaseClient.from('client_requests').select('id,kind,service,preferred_dates,day_period,client_message,status,admin_reply,client_reply,proposed_starts_at,proposed_duration_minutes,appointment_id,created_at,updated_at').eq('client_id', clientId),
        supabaseClient.from('messages').select('id,sender,subject,message,is_read,read_at,client_read_at,created_at').eq('client_id', clientId).eq('deleted_by_client', false).order('created_at', { ascending: false }),
        supabaseClient.from('appointment_reminders').select('id,title,body,scheduled_for,status').eq('client_id', clientId).eq('status', 'delivered').order('scheduled_for', { ascending: false }),
        supabaseClient.from('treatment_photo_sets').select('id,client_id,notes,taken_at,visible_to_client,treatment_photos(id,image_path,thumbnail_path,phase,sort_order)').eq('client_id', clientId).eq('visible_to_client', true).order('taken_at', { ascending: false }),
        supabaseClient.from('active_service_prices').select('category_name,name,price'),
        supabaseClient.from('bookable_service_prices').select('id,category_name,name,price,duration_minutes'),
      ])
      console.info('[client-portal] client account lookup', {
        clientId,
        found: Boolean(clientResult.data),
        status: clientResult.status,
      })
      if (clientResult.error) {
        console.error('[client-portal] client account lookup failed', {
          clientId,
          status: clientResult.status,
          error: clientResult.error,
        })
        if (active) {
          setPortalLoadError({
            kind: clientResult.status === 401 || clientResult.status === 403 ? 'access' : 'data',
            message: clientResult.error.message,
          })
          setLoading(false)
        }
        return
      }
      if (!clientResult.data) {
        console.error('[client-portal] client account link is unavailable', {
          clientId,
          status: clientResult.status,
        })
        if (active) {
          setPortalLoadError({
            kind: 'access',
            message: 'Prijavljeni račun nema pristup ovom klijentskom profilu.',
          })
          setLoading(false)
        }
        return
      }
      const portalResults = [
        ['appointments', appointmentResult],
        ['client_requests', requestResult],
        ['messages', messageResult],
        ['appointment_reminders', reminderResult],
        ['treatment_photo_sets', photoResult],
        ['active_service_prices', pricesResult],
        ['bookable_service_prices', bookableResult],
      ] as const
      const failedResult = portalResults.find(([, result]) => result.error)
      if (failedResult) {
        const [resource, result] = failedResult
        console.error('[client-portal] portal data load failed', {
          resource,
          status: result.status,
          error: result.error,
        })
        if (active) {
          setClient(clientResult.data as ClientRow)
          setPortalLoadError({
            kind: 'data',
            message: result.error?.message ?? 'Nepoznata pogreška pri učitavanju podataka.',
          })
          setLoading(false)
        }
        return
      }
      const signedPhotos = (await Promise.all(((photoResult.data ?? []) as TreatmentSetRow[]).flatMap(treatment =>
        treatment.treatment_photos.map(async photo => {
          const { data } = await supabaseClient.storage.from('client-photos').createSignedUrl(photo.thumbnail_path || photo.image_path, 300)
          return { id: photo.id, phase: photo.phase, notes: treatment.notes, taken_at: treatment.taken_at, url: data?.signedUrl ?? '', sortOrder: photo.sort_order }
        }),
      ))).sort((left, right) => right.taken_at.localeCompare(left.taken_at) || left.sortOrder - right.sortOrder)
      if (!active) return
      setClient(clientResult.data as ClientRow | null)
      setAppointments((appointmentResult.data ?? []) as AppointmentRow[])
      const initialRequests = (requestResult.data ?? []) as RequestRow[]
      setRequests(initialRequests)
      knownRequestVersionsRef.current = new Map(initialRequests.map(item => [item.id, `${item.updated_at}|${item.status}|${item.admin_reply}`]))
      setMessages((messageResult.data ?? []) as MessageRow[])
      knownMessageIdsRef.current = new Set((messageResult.data ?? []).map(item => item.id))
      messagesInitializedRef.current = true
      setReminders((reminderResult.data ?? []) as ReminderRow[])
      setPhotos(signedPhotos.filter(photo => photo.url))
      setPriceList((pricesResult.data ?? []).map(item=>({categoryName:item.category_name,name:item.name,price:Number(item.price)})))
      setBookableServices((bookableResult.data ?? []).map(item=>({id:item.id,categoryName:item.category_name,name:item.name,price:Number(item.price),durationMinutes:item.duration_minutes??undefined})))
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [clientId])

  useEffect(() => {
    const supabaseClient = supabase
    if (!supabaseClient) return
    async function refreshRequestsAndAppointments() {
      if (!supabase) return
      const [requestResult, appointmentResult, messageResult] = await Promise.all([
        supabase.from('client_requests').select('id,kind,service,preferred_dates,day_period,client_message,status,admin_reply,client_reply,proposed_starts_at,proposed_duration_minutes,appointment_id,created_at,updated_at').eq('client_id', clientId),
        supabase.from('appointments').select('id,starts_at,ends_at,service,service_name_snapshot,service_price_snapshot,service_duration_snapshot,notes,status,confirmation_status').eq('client_id', clientId),
        supabase.from('messages').select('id,sender,subject,message,is_read,read_at,client_read_at,created_at').eq('client_id', clientId).eq('deleted_by_client', false).order('created_at', { ascending: false }),
      ])
      if (!requestResult.error) {
        const nextRequests = (requestResult.data ?? []) as RequestRow[]
        const hasNewProposal = nextRequests.some(item =>
          item.status === 'in_review'
          && knownRequestVersionsRef.current.get(item.id) !== `${item.updated_at}|${item.status}|${item.admin_reply}`)
        knownRequestVersionsRef.current = new Map(nextRequests.map(item => [item.id, `${item.updated_at}|${item.status}|${item.admin_reply}`]))
        setRequests(nextRequests)
        if (hasNewProposal) {
          playNewMessageSound()
          setNotice('Stigao je novi prijedlog termina. Otvorite zahtjev i odgovorite Kristini.')
        }
      }
      if (!appointmentResult.error) setAppointments((appointmentResult.data ?? []) as AppointmentRow[])
      if (!messageResult.error) {
        const nextMessages = (messageResult.data ?? []) as MessageRow[]
        const newAdminMessageIds = messagesInitializedRef.current
          ? nextMessages.filter(item => item.sender === 'admin' && !knownMessageIdsRef.current.has(item.id)).map(item => item.id)
          : []
        knownMessageIdsRef.current = new Set(nextMessages.map(item => item.id))
        messagesInitializedRef.current = true
        setMessages(nextMessages)
        if (newAdminMessageIds.length) {
          setHighlightedMessageIds(newAdminMessageIds)
          playNewMessageSound()
          window.setTimeout(() => setHighlightedMessageIds([]), 8000)
        }
      }
    }
    const channel = supabaseClient
      .channel(`client-requests-${clientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_requests', filter: `client_id=eq.${clientId}` }, () => {
        void refreshRequestsAndAppointments()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `client_id=eq.${clientId}` }, () => {
        void refreshRequestsAndAppointments()
      })
      .subscribe()
    const unsubscribeForeground = subscribeToAppForeground(() => void refreshRequestsAndAppointments())
    const poll = window.setInterval(() => void refreshRequestsAndAppointments(), 3000)
    return () => {
      window.clearInterval(poll)
      unsubscribeForeground()
      void supabaseClient.removeChannel(channel)
    }
  }, [clientId, loadAttempt])

  useEffect(() => {
    const supabaseClient = supabase
    if (
      section !== 'messages'
      || !supabaseClient
      || markingMessagesReadRef.current
      || !messages.some(item => item.sender === 'admin' && !item.client_read_at)
    ) return

    markingMessagesReadRef.current = true
    void (async () => {
      try {
        const { error: markError } = await supabaseClient.rpc('client_mark_admin_messages_read')
        if (markError) return

        // RPC can legitimately return 0 after another device or refresh won the race.
        // Re-read the authoritative state instead of treating 0 as a failed update.
        const { data, error: refreshError } = await supabaseClient
          .from('messages')
          .select('id,sender,subject,message,is_read,read_at,client_read_at,created_at')
          .eq('client_id', clientId)
          .eq('deleted_by_client', false)
          .order('created_at', { ascending: false })
        if (refreshError) return

        const nextMessages = (data ?? []) as MessageRow[]
        setMessages(nextMessages)
        const nextUnreadCount = countClientUnreadMessages(nextMessages)
        if (nextUnreadCount === 0) await closeReadClientMessageNotifications()
        await updateAppBadge(nextUnreadCount)
      } finally {
        markingMessagesReadRef.current = false
      }
    })()
  }, [clientId, section, messages])

  useEffect(() => {
    const openNotificationTarget = () => {
      if (isClientMessagesLocation(window.location.hash)) setSection('messages')
      if (isClientNotificationsLocation(window.location.hash)) setSection('notifications')
    }
    window.addEventListener('hashchange', openNotificationTarget)
    return () => window.removeEventListener('hashchange', openNotificationTarget)
  }, [])

  useEffect(() => {
    void updateAppBadge(inboxCount)
  }, [inboxCount])

  async function sendClientMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || messageBusy || !messageDraft.trim()) return
    setMessageBusy(true)
    const { data, error } = await supabase.rpc('client_send_message', { message_subject: 'Poruka klijenta', message_body: messageDraft.trim() })
    setMessageBusy(false)
    if (error || !data) { setNotice('Poruku nije moguće poslati.'); return }
    setMessages(current => [data as MessageRow, ...current])
    knownMessageIdsRef.current.add((data as MessageRow).id)
    setMessageDraft('')
  }

  async function deleteClientMessage(message: MessageRow) {
    if (!supabase) return
    const { error } = await supabase.rpc('client_delete_message', { target_message_id: message.id })
    if (error) { setNotice('Poruku nije moguće obrisati.'); return }
    setMessages(current => current.filter(item => item.id !== message.id))
  }

  async function saveRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const form = new FormData(event.currentTarget)
    const preferredDates = form.getAll('preferredDates').map(String).filter(Boolean)
    if (!preferredDates.length) { setNotice('Dodajte barem jedan poželjni dan.'); return }
    if (!requestServiceIds.length) { setNotice('Odaberite barem jedan tretman.'); return }
    const selectedServices = bookableServices.filter(item => item.id && requestServiceIds.includes(item.id))
    const { data, error } = await supabase.rpc('client_submit_request', {
      request_kind: 'appointment',
      requested_service: selectedServices.map(item=>item.name).join(' + '),
      requested_service_ids: requestServiceIds,
      requested_dates: preferredDates,
      requested_day_period: String(form.get('dayPeriod')),
      request_message: String(form.get('message') || ''),
      related_appointment_id: null,
    })
    if (error) {
      console.error('client_submit_request nije uspio.', error)
      setNotice(`Zahtjev nije poslan: ${error.message || 'Supabase nije prihvatio zahtjev.'}`)
      return
    }
    setRequests(current => [data as RequestRow, ...current])
    setRequestServiceIds([])
    setNotice('Zahtjev poslan.')
    setSection('home')
  }

  async function requestChange(appointment: AppointmentRow, kind: 'change' | 'cancellation') {
    if (!supabase) return
    const text = window.prompt(kind === 'cancellation' ? 'Napišite razlog zahtjeva za otkazivanje:' : 'Napišite što želite promijeniti:')
    if (text === null) return
    const { data, error } = await supabase.rpc('client_submit_request', {
      request_kind: kind,
      requested_service: appointment.service,
      requested_dates: [appointment.starts_at.slice(0,10)],
      requested_day_period: 'any',
      request_message: text,
      related_appointment_id: appointment.id,
      requested_service_ids: [],
    })
    if (error) {
      console.error('client_submit_request nije uspio.', error)
      setNotice(`Zahtjev nije poslan: ${error.message || 'Supabase nije prihvatio zahtjev.'}`)
      return
    }
    setRequests(current => [data as RequestRow, ...current])
    setDetail(null)
    setNotice('Zahtjev je poslan. Termin se ne mijenja dok Kristina ne potvrdi.')
  }

  async function respondToProposal(request: RequestRow, accept: boolean) {
    if (!supabase || respondingRequestId) return
    const responseMessage = accept
      ? 'Termin mi odgovara.'
      : window.prompt('Napišite što vam ne odgovara ili kada biste mogli:')
    if (responseMessage === null) return
    setRespondingRequestId(request.id)
    const { data, error } = await supabase.rpc('client_respond_to_proposed_request', {
      target_request_id: request.id,
      accept_proposal: accept,
      response_message: responseMessage,
    })
    setRespondingRequestId('')
    if (error || !data) {
      setNotice('Odgovor nije spremljen. Provjerite je li nova Supabase migracija primijenjena.')
      return
    }
    setRequests(current => accept
      ? current.filter(item => item.id !== request.id)
      : current.map(item => item.id === request.id ? data as RequestRow : item))
    if (accept) {
      const { data: refreshedAppointments } = await supabase
        .from('appointments')
        .select('id,starts_at,ends_at,service,service_name_snapshot,service_price_snapshot,service_duration_snapshot,notes,status,confirmation_status')
        .eq('client_id', clientId)
      setAppointments((refreshedAppointments ?? []) as AppointmentRow[])
      setNotice('Termin je potvrđen i dodan u vaše termine.')
    } else {
      setNotice('Zahtjev za novi prijedlog poslan je Kristini.')
    }
  }

  if (loading) return <main className="access-page"><section className="access-card"><h1>Učitavanje portala…</h1></section></main>
  const retryPortalLoad = () => {
    setLoading(true)
    setPortalLoadError(null)
    setLoadAttempt(value=>value+1)
  }
  if (portalLoadError) return <main className="access-page"><section className="access-card"><h1>{portalLoadError.kind==='access'?'Pristup nije dopušten':'Portal trenutačno nije moguće učitati'}</h1><p>{portalLoadError.message}</p><button className="primary" onClick={retryPortalLoad}>Pokušaj ponovno</button>{portalLoadError.kind==='access'&&<button className="link" onClick={onLogout}>Odjava</button>}</section></main>
  if (!client) return <main className="access-page"><section className="access-card"><h1>Portal trenutačno nije moguće učitati</h1><p>Klijentski profil nije učitan.</p><button className="primary" onClick={retryPortalLoad}>Pokušaj ponovno</button></section></main>

  const appointmentService = (item: AppointmentRow) => item.service_name_snapshot ?? item.service ?? ''
  const requestCategories = [...new Set(bookableServices.map(item=>item.categoryName))]
  const priceCategories = [...new Set(priceList.map(item=>item.categoryName))]
  return <div className="client-portal">
    <header className="client-header"><div><p className="eyebrow">SALON KRISTINA</p><h1>Pozdrav, {client.first_name}</h1></div><button className="secondary" onClick={onLogout}>Odjava</button></header>
    <nav className="client-nav"><button className={section==='home'?'active':''} onClick={()=>setSection('home')}>Pregled</button><button className={section==='appointments'?'active':''} onClick={()=>setSection('appointments')}>Termini</button><button className={section==='prices'?'active':''} onClick={()=>{setOpenPriceCategory('');setSection('prices')}}>Cjenik</button><button className={section==='messages'?'active':''} onClick={()=>setSection('messages')}>Poruke{inboxCount>0&&<b className="client-nav-count">{inboxCount}</b>}</button><button className={section==='photos'?'active':''} onClick={()=>setSection('photos')}>Fotografije</button></nav>
    <main className="client-content">
      {notice&&<p className="portal-notice" role="status">{notice}</p>}
      {section==='home'&&inboxCount>0&&<button className="unread-message-alert" type="button" onClick={()=>setSection('messages')}><span>💬</span><div><strong>{inboxCount===1?'Imate novu poruku':`Imate ${inboxCount} nove poruke`}</strong><small>Dodirnite za pregled poruka</small></div><b>{inboxCount}</b></button>}
      {section==='home'&&<><section className="client-hero"><p className="eyebrow">SLJEDEĆI POTVRĐENI TERMIN</p>{upcoming[0]?<><h2>{formatDateTime(upcoming[0].starts_at)}</h2><p>{appointmentService(upcoming[0])}</p><button className="link" onClick={()=>setDetail(upcoming[0])}>Detalji termina →</button></>:<><h2>Još nema potvrđenog termina</h2><p>Pošaljite želju, a Kristina će vam se javiti.</p></>}</section><button className="primary wide-action" onClick={()=>setSection('request')}>Pošalji želju za termin</button>{pushState!=='unsupported'&&<button className={`push-notification-button ${pushState==='enabled'?'enabled':''}`} type="button" onClick={()=>setSection('notifications')}>{pushState==='enabled'?'🔔 Obavijesti uključene':'🔔 Uključi obavijesti'}</button>}{visibleRequests.length>0&&<section className="client-request-status"><h2>Moji zahtjevi</h2>{visibleRequests.map(item=><article key={item.id}><strong>{item.service||'Zahtjev za termin'}</strong><span>{requestStatusLabel(item.status as 'pending'|'in_review'|'confirmed'|'rejected')}</span>{item.admin_reply&&<p>{item.admin_reply}</p>}{item.status==='in_review'&&item.proposed_starts_at&&<div className="client-proposal-actions"><button className="primary" disabled={respondingRequestId===item.id} onClick={()=>void respondToProposal(item,true)}>{respondingRequestId===item.id?'Spremanje…':'Potvrđujem termin'}</button><button className="secondary" disabled={respondingRequestId===item.id} onClick={()=>void respondToProposal(item,false)}>Zatraži novi prijedlog</button></div>}{item.client_reply&&<small>{item.client_reply}</small>}</article>)}</section>}<div className="client-summary"><button onClick={()=>setSection('appointments')}><strong>{upcoming.length}</strong><span>Budući termini</span></button><button onClick={()=>setSection('messages')}><strong>{inboxCount}</strong><span>Poruke salona</span></button><button onClick={()=>setSection('photos')}><strong>{photos.length}</strong><span>Moje fotografije</span></button></div></>}
      {section==='home'&&pushState==='unsupported'&&<button className="push-notification-button" type="button" onClick={()=>setSection('notifications')}>🔔 Upute za obavijesti</button>}
      {section==='request'&&<section className="client-card-section"><h2>Želja za termin</h2><p className="important-note">Ovo nije rezervacija. Kristina će pregledati vašu želju i potvrditi termin.</p><form onSubmit={event=>void saveRequest(event)}><label>Kategorija<select value={requestCategory} onChange={event=>setRequestCategory(event.target.value)}><option value="">Sve kategorije</option>{requestCategories.map(category=><option key={category} value={category}>{category}</option>)}</select></label><fieldset className="client-treatment-picker"><legend>Odaberite jedan ili više tretmana</legend>{bookableServices.filter(item=>!requestCategory||item.categoryName===requestCategory).map(item=><label key={item.id}><input type="checkbox" checked={Boolean(item.id&&requestServiceIds.includes(item.id))} onChange={event=>{if(!item.id)return;setRequestServiceIds(current=>event.target.checked?[...current,item.id as string]:current.filter(id=>id!==item.id))}}/><span><strong>{item.name}</strong><small>{item.price.toLocaleString('hr-HR',{style:'currency',currency:'EUR'})}{item.durationMinutes?` · ${item.durationMinutes} min`:''}</small></span></label>)}</fieldset>{requestServiceIds.length>0&&<div className="client-treatment-summary"><strong>Odabrano</strong><p>{bookableServices.filter(item=>item.id&&requestServiceIds.includes(item.id)).map(item=>item.name).join(' + ')}</p><small>Procijenjeno trajanje: {bookableServices.filter(item=>item.id&&requestServiceIds.includes(item.id)).reduce((sum,item)=>sum+(item.durationMinutes??0),0)} min</small></div>}<fieldset><legend>Poželjni dani</legend><input required name="preferredDates" type="date"/><input name="preferredDates" type="date"/><input name="preferredDates" type="date"/></fieldset><label>Dio dana<select name="dayPeriod" defaultValue="any"><option value="morning">Prijepodne</option><option value="afternoon">Poslijepodne</option><option value="any">Svejedno</option></select></label><label>Dodatne želje<textarea name="message" rows={4}/></label><button className="primary" type="submit" disabled={!requestServiceIds.length}>Pošalji želju Kristini</button><button className="secondary" type="button" onClick={()=>setSection('home')}>Odustani</button></form></section>}
      {section==='appointments'&&<section className="client-card-section"><h2>Moji budući termini</h2>{upcoming.length?<div className="portal-list">{upcoming.map(item=><button key={item.id} onClick={()=>setDetail(item)}><div><strong>{formatDateTime(item.starts_at)}</strong><span>{appointmentService(item)}</span></div><b>Potvrđeno</b></button>)}</div>:<p className="empty-state">Nema budućih potvrđenih termina.</p>}</section>}
      {section==='prices'&&<section className="client-card-section client-price-section"><h2>Cjenik</h2><div className="client-price-accordion">{priceCategories.map(category=>{const open=openPriceCategory===category;const items=priceList.filter(item=>item.categoryName===category);return <section className={`client-price-category ${open?'open':''}`} key={category}><button type="button" aria-expanded={open} onClick={()=>setOpenPriceCategory(open?'':category)}><span className="category-chevron" aria-hidden="true">›</span><strong>{category}</strong></button>{open&&<div className="client-price-list">{items.map(item=><div key={item.name}><span>{item.name}</span><strong>{item.price.toLocaleString('hr-HR',{style:'currency',currency:'EUR'})}</strong></div>)}</div>}</section>})}</div><p className="privacy-note">U cijene su uključeni svi porezi.</p></section>}
      {section==='messages'&&<section className="client-card-section client-chat"><h2>Poruke s Kristinom</h2><div className="chat-thread">{[...messages].reverse().map(item=><article className={`chat-bubble ${item.sender} ${highlightedMessageIds.includes(item.id)?'new-message':''}`} key={item.id}>{item.subject&&item.subject!=='Poruka klijenta'&&<strong>{item.subject}</strong>}<p>{item.message}</p><footer><span>{formatDateTime(item.created_at)}</span>{item.sender==='client'&&<span className={item.read_at?'read-receipt read':'read-receipt'}>{item.read_at?'✓✓ Pročitano':'✓ Poslano'}</span>}<button type="button" onClick={()=>void deleteClientMessage(item)}>Obriši</button></footer></article>)}{!messages.length&&<p className="empty-state">Još nema poruka. Ovdje možete izravno pisati Kristini.</p>}</div><form className="chat-composer" onSubmit={event=>void sendClientMessage(event)}><textarea rows={2} value={messageDraft} onChange={event=>setMessageDraft(event.target.value)} placeholder="Napiši poruku…"/><button className="primary" disabled={messageBusy||!messageDraft.trim()} type="submit">{messageBusy?'Šaljem…':'Pošalji'}</button></form></section>}
      {section==='notifications'&&<section className="client-card-section notification-check"><button className="link" type="button" onClick={()=>setSection('home')}>← Natrag</button><h2>Provjera obavijesti</h2><p>Prođite korake redom. Dopuštenje tražimo samo kada pritisnete gumb.</p><div className="notification-status-list"><p><b>{platform.installed?'✓':'○'}</b><span>Aplikacija instalirana</span></p><p><b>{Notification.permission==='granted'?'✓':'○'}</b><span>Dopuštenje odobreno</span></p><p><b>{serviceWorkerActive?'✓':'○'}</b><span>Service worker aktivan</span></p><p><b>{pushState==='enabled'?'✓':'○'}</b><span>Push pretplata aktivna</span></p><p><b>{lastPushTestAt?'✓':'○'}</b><span>Zadnji uspješan test: {lastPushTestAt?formatDateTime(lastPushTestAt):'nije izvršen'}</span></p></div>{!platform.installed&&<div className="notification-help"><strong>1. Instalirajte aplikaciju</strong>{platform.ios?<p>U Safariju dodirnite Dijeli → Dodaj na početni zaslon, zatim otvorite Salon Kristina s početnog zaslona.</p>:<p>U izborniku preglednika odaberite „Instaliraj aplikaciju” ili „Dodaj na početni zaslon”, zatim je otvorite kao aplikaciju.</p>}</div>}<div className="notification-help"><strong>2. Dopustite obavijesti</strong><p>{platform.android?'Provjerite da su obavijesti dopuštene za Salon Kristina.':'Dopustite obavijesti kada ih aplikacija zatraži.'}</p><button className="primary" type="button" disabled={pushState==='working'||pushState==='enabled'} onClick={()=>void enablePushNotifications()}>{pushState==='working'?'Uključivanje…':pushState==='enabled'?'Pretplata je aktivna':'Uključi obavijesti'}</button></div><div className="notification-help"><strong>3. Pošaljite probnu obavijest</strong><p>Tek uspješan test potvrđuje da je pretplata spremna.</p><button className="secondary" type="button" disabled={pushState!=='enabled'||pushTestBusy} onClick={()=>void sendTestPush()}>{pushTestBusy?'Šaljem test…':'Pošalji probnu obavijest'}</button></div>{platform.samsung&&<div className="notification-help warning"><strong>Ako test ne stigne u pozadini na Samsungu</strong><p>Otvorite: Postavke → Aplikacije → Chrome → Baterija → Neograničeno. Po potrebi isto provjerite za Salon Kristina.</p><p>„Prisilno zaustavi” onemogućuje obavijesti dok ponovno ne otvorite aplikaciju.</p></div>}{platform.ios&&<div className="notification-help"><strong>iPhone/iPad</strong><p>Push radi samo iz aplikacije dodane na početni zaslon. U postavkama uređaja dopustite obavijesti za Salon Kristina.</p></div>}<p className="privacy-note">Aplikacija ne može sama mijenjati postavke baterije ili obavijesti vašeg uređaja.</p></section>}
      {section==='photos'&&<section className="client-card-section"><h2>Moje fotografije</h2>{photos.length?<div className="client-photo-grid">{photos.map(item=><article key={item.id}><img src={item.url} alt={item.phase==='before'?'Frizura prije tretmana':'Frizura poslije tretmana'}/><div><small>{item.phase==='before'?'Prije tretmana':'Poslije tretmana'}</small><strong>{formatDate(item.taken_at)}</strong><p>{item.notes}</p></div></article>)}</div>:<p className="empty-state">Kristina još nije podijelila fotografije s vama.</p>}<p className="privacy-note">Fotografije su privatne i koriste kratkotrajne autorizirane adrese.</p></section>}
    </main>
    {detail&&<div className="portal-modal-backdrop"><section className="portal-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={()=>setDetail(null)}>×</button><p className="eyebrow">POTVRĐENI TERMIN</p><h2>{formatDateTime(detail.starts_at)}</h2><p><strong>{appointmentService(detail)}</strong>{detail.service_price_snapshot!=null&&<> · {Number(detail.service_price_snapshot).toLocaleString('hr-HR',{style:'currency',currency:'EUR'})}</>}</p>{detail.notes&&<p>{detail.notes}</p>}<div className="portal-modal-actions"><button className="secondary" onClick={()=>void requestChange(detail,'change')}>Zatraži promjenu</button><button className="danger-action" onClick={()=>void requestChange(detail,'cancellation')}>Zatraži otkazivanje</button></div></section></div>}
  </div>
}
