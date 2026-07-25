import { useEffect, useMemo, useState } from 'react'
import { formatDate, formatDateTime } from './lib/date'
import { supabase } from './lib/supabase'
import { requestStatusLabel } from './lib/adminInbox'
import './Portal.css'

type Section = 'home' | 'request' | 'appointments' | 'prices' | 'messages' | 'photos'
interface ClientRow { id: string; first_name: string; last_name: string }
interface AppointmentRow { id: string; starts_at: string; ends_at: string | null; service: string | null; service_name_snapshot: string | null; service_price_snapshot: number | null; service_duration_snapshot: number | null; notes: string | null; status: string }
interface RequestRow { id: string; kind: string; service: string | null; preferred_dates: string[]; day_period: string; client_message: string; status: string; admin_reply: string; appointment_id: string | null; created_at: string; updated_at: string }
interface MessageRow { id: string; sender: string; subject?: string; message: string; created_at: string }
interface ReminderRow { id: string; title: string; body: string; scheduled_for: string; status: string }
interface PhotoRow { id: string; image_path: string; thumbnail_path: string; notes: string | null; taken_at: string }
interface ClientPhoto extends PhotoRow { url: string }
interface PublicService { categoryName: string; name: string; price: number }

export function ClientPortal({ clientId, onLogout }: { clientId: string; onLogout: () => void }) {
  const [client, setClient] = useState<ClientRow | null>(null)
  const [appointments, setAppointments] = useState<AppointmentRow[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [reminders, setReminders] = useState<ReminderRow[]>([])
  const [photos, setPhotos] = useState<ClientPhoto[]>([])
  const [priceList, setPriceList] = useState<PublicService[]>([])
  const [bookableServices, setBookableServices] = useState<PublicService[]>([])
  const [requestCategory, setRequestCategory] = useState('')
  const [openPriceCategory, setOpenPriceCategory] = useState('')
  const [section, setSection] = useState<Section>('home')
  const [detail, setDetail] = useState<AppointmentRow | null>(null)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [portalNow] = useState(() => Date.now())
  const upcoming = useMemo(() => appointments.filter(item => item.status === 'confirmed' && new Date(item.starts_at).getTime() >= portalNow).sort((a,b)=>a.starts_at.localeCompare(b.starts_at)), [appointments, portalNow])

  useEffect(() => {
    let active = true
    async function load() {
      const supabaseClient = supabase
      if (!supabaseClient) return
      const [clientResult, appointmentResult, requestResult, messageResult, reminderResult, photoResult, pricesResult, bookableResult] = await Promise.all([
        supabaseClient.from('clients').select('id,first_name,last_name').eq('id', clientId).maybeSingle(),
        supabaseClient.from('appointments').select('id,starts_at,ends_at,service,service_name_snapshot,service_price_snapshot,service_duration_snapshot,notes,status').eq('client_id', clientId),
        supabaseClient.from('client_requests').select('id,kind,service,preferred_dates,day_period,client_message,status,admin_reply,appointment_id,created_at,updated_at').eq('client_id', clientId),
        supabaseClient.from('messages').select('id,sender,subject,message,created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
        supabaseClient.from('appointment_reminders').select('id,title,body,scheduled_for,status').eq('client_id', clientId).eq('status', 'delivered').order('scheduled_for', { ascending: false }),
        supabaseClient.from('hairstyle_photos').select('id,image_path,thumbnail_path,notes,taken_at').eq('client_id', clientId).eq('visible_to_client', true).order('taken_at', { ascending: false }),
        supabaseClient.from('active_service_prices').select('category_name,name,price'),
        supabaseClient.from('bookable_service_prices').select('category_name,name,price'),
      ])
      const firstError = [clientResult, appointmentResult, requestResult, messageResult, reminderResult, photoResult, pricesResult, bookableResult].find(result => result.error)?.error
      if (firstError) {
        if (active) { setNotice('Podatke portala trenutačno nije moguće učitati.'); setLoading(false) }
        return
      }
      const signedPhotos = await Promise.all(((photoResult.data ?? []) as PhotoRow[]).map(async photo => {
        const { data } = await supabaseClient.storage.from('client-photos').createSignedUrl(photo.thumbnail_path || photo.image_path, 300)
        return { ...photo, url: data?.signedUrl ?? '' }
      }))
      if (!active) return
      setClient(clientResult.data as ClientRow | null)
      setAppointments((appointmentResult.data ?? []) as AppointmentRow[])
      setRequests((requestResult.data ?? []) as RequestRow[])
      setMessages((messageResult.data ?? []) as MessageRow[])
      setReminders((reminderResult.data ?? []) as ReminderRow[])
      setPhotos(signedPhotos.filter(photo => photo.url))
      setPriceList((pricesResult.data ?? []).map(item=>({categoryName:item.category_name,name:item.name,price:Number(item.price)})))
      setBookableServices((bookableResult.data ?? []).map(item=>({categoryName:item.category_name,name:item.name,price:Number(item.price)})))
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [clientId])

  async function saveRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const form = new FormData(event.currentTarget)
    const preferredDates = form.getAll('preferredDates').map(String).filter(Boolean)
    if (!preferredDates.length) { setNotice('Dodajte barem jedan poželjni dan.'); return }
    const { data, error } = await supabase.rpc('client_submit_request', {
      request_kind: 'appointment',
      requested_service: String(form.get('service')),
      requested_dates: preferredDates,
      requested_day_period: String(form.get('dayPeriod')),
      request_message: String(form.get('message') || ''),
      related_appointment_id: null,
    })
    if (error) { setNotice('Zahtjev nije bilo moguće poslati.'); return }
    setRequests(current => [data as RequestRow, ...current])
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
    })
    if (error) { setNotice('Zahtjev nije bilo moguće poslati.'); return }
    setRequests(current => [data as RequestRow, ...current])
    setDetail(null)
    setNotice('Zahtjev je poslan. Termin se ne mijenja dok Kristina ne potvrdi.')
  }

  if (loading) return <main className="access-page"><section className="access-card"><h1>Učitavanje portala…</h1></section></main>
  if (!client) return <main className="access-page"><section className="access-card"><h1>Pristup nije dostupan</h1><p>Prijavite se ponovno.</p><button className="primary" onClick={onLogout}>Odjava</button></section></main>

  const inboxCount = messages.filter(item=>item.sender==='admin').length + reminders.length + requests.filter(item=>item.admin_reply).length
  const appointmentService = (item: AppointmentRow) => item.service_name_snapshot ?? item.service ?? ''
  const requestCategories = [...new Set(bookableServices.map(item=>item.categoryName))]
  const priceCategories = [...new Set(priceList.map(item=>item.categoryName))]
  return <div className="client-portal">
    <header className="client-header"><div><p className="eyebrow">SALON KRISTINA</p><h1>Pozdrav, {client.first_name}</h1></div><button className="secondary" onClick={onLogout}>Odjava</button></header>
    <nav className="client-nav"><button className={section==='home'?'active':''} onClick={()=>setSection('home')}>Pregled</button><button className={section==='appointments'?'active':''} onClick={()=>setSection('appointments')}>Termini</button><button className={section==='prices'?'active':''} onClick={()=>{setOpenPriceCategory('');setSection('prices')}}>Cjenik</button><button className={section==='messages'?'active':''} onClick={()=>setSection('messages')}>Poruke</button><button className={section==='photos'?'active':''} onClick={()=>setSection('photos')}>Fotografije</button></nav>
    <main className="client-content">
      {notice&&<p className="portal-notice" role="status">{notice}</p>}
      {section==='home'&&<><section className="client-hero"><p className="eyebrow">SLJEDEĆI POTVRĐENI TERMIN</p>{upcoming[0]?<><h2>{formatDateTime(upcoming[0].starts_at)}</h2><p>{appointmentService(upcoming[0])}</p><button className="link" onClick={()=>setDetail(upcoming[0])}>Detalji termina →</button></>:<><h2>Još nema potvrđenog termina</h2><p>Pošaljite želju, a Kristina će vam se javiti.</p></>}</section><button className="primary wide-action" onClick={()=>setSection('request')}>Pošalji želju za termin</button>{requests.length>0&&<section className="client-request-status"><h2>Moji zahtjevi</h2>{requests.map(item=><article key={item.id}><strong>{item.service||'Zahtjev za termin'}</strong><span>{requestStatusLabel(item.status as 'pending'|'in_review'|'confirmed'|'rejected')}</span>{item.admin_reply&&<p>{item.admin_reply}</p>}</article>)}</section>}<div className="client-summary"><button onClick={()=>setSection('appointments')}><strong>{upcoming.length}</strong><span>Budući termini</span></button><button onClick={()=>setSection('messages')}><strong>{inboxCount}</strong><span>Poruke salona</span></button><button onClick={()=>setSection('photos')}><strong>{photos.length}</strong><span>Moje fotografije</span></button></div></>}
      {section==='request'&&<section className="client-card-section"><h2>Želja za termin</h2><p className="important-note">Ovo nije rezervacija. Kristina će pregledati vašu želju i potvrditi termin.</p><form onSubmit={event=>void saveRequest(event)}><label>Kategorija<select required value={requestCategory} onChange={event=>setRequestCategory(event.target.value)}><option value="" disabled>Odaberite kategoriju</option>{requestCategories.map(category=><option key={category} value={category}>{category}</option>)}</select></label><label>Željena usluga<select required name="service" defaultValue="" disabled={!requestCategory} key={requestCategory}><option value="" disabled>{requestCategory?'Odaberite uslugu':'Prvo odaberite kategoriju'}</option>{bookableServices.filter(item=>item.categoryName===requestCategory).map(item=><option key={item.name} value={item.name}>{item.name} — {item.price.toLocaleString('hr-HR',{style:'currency',currency:'EUR'})}</option>)}</select></label><fieldset><legend>Poželjni dani</legend><input required name="preferredDates" type="date"/><input name="preferredDates" type="date"/><input name="preferredDates" type="date"/></fieldset><label>Dio dana<select name="dayPeriod" defaultValue="any"><option value="morning">Prijepodne</option><option value="afternoon">Poslijepodne</option><option value="any">Svejedno</option></select></label><label>Dodatne želje<textarea name="message" rows={4}/></label><button className="primary" type="submit">Pošalji želju Kristini</button><button className="secondary" type="button" onClick={()=>setSection('home')}>Odustani</button></form></section>}
      {section==='appointments'&&<section className="client-card-section"><h2>Moji budući termini</h2>{upcoming.length?<div className="portal-list">{upcoming.map(item=><button key={item.id} onClick={()=>setDetail(item)}><div><strong>{formatDateTime(item.starts_at)}</strong><span>{appointmentService(item)}</span></div><b>Potvrđeno</b></button>)}</div>:<p className="empty-state">Nema budućih potvrđenih termina.</p>}</section>}
      {section==='prices'&&<section className="client-card-section client-price-section"><h2>Cjenik</h2><div className="client-price-accordion">{priceCategories.map(category=>{const open=openPriceCategory===category;const items=priceList.filter(item=>item.categoryName===category);return <section className={`client-price-category ${open?'open':''}`} key={category}><button type="button" aria-expanded={open} onClick={()=>setOpenPriceCategory(open?'':category)}><span className="category-chevron" aria-hidden="true">›</span><strong>{category}</strong></button>{open&&<div className="client-price-list">{items.map(item=><div key={item.name}><span>{item.name}</span><strong>{item.price.toLocaleString('hr-HR',{style:'currency',currency:'EUR'})}</strong></div>)}</div>}</section>})}</div><p className="privacy-note">U cijene su uključeni svi porezi.</p></section>}
      {section==='messages'&&<section className="client-card-section"><h2>Poruke salona</h2><div className="portal-messages">{requests.filter(item=>item.admin_reply).map(item=><article key={item.id}><small>{formatDate(item.updated_at)}</small><strong>Odgovor na vaš zahtjev</strong><p>{item.admin_reply}</p></article>)}{messages.filter(item=>item.sender==='admin').map(item=><article key={item.id}><small>{formatDateTime(item.created_at)}</small><strong>{item.subject||'Poruka salona'}</strong><p>{item.message}</p></article>)}{reminders.map(item=><article key={item.id}><small>{formatDateTime(item.scheduled_for)}</small><strong>{item.title}</strong><p>{item.body}</p></article>)}{!inboxCount&&<p className="empty-state">Još nema poruka salona.</p>}</div></section>}
      {section==='photos'&&<section className="client-card-section"><h2>Moje fotografije</h2>{photos.length?<div className="client-photo-grid">{photos.map(item=><article key={item.id}><img src={item.url} alt="Frizura iz privatne arhive"/><div><strong>{formatDate(item.taken_at)}</strong><p>{item.notes}</p></div></article>)}</div>:<p className="empty-state">Kristina još nije podijelila fotografije s vama.</p>}<p className="privacy-note">Fotografije koriste kratkotrajne autorizirane adrese.</p></section>}
    </main>
    {detail&&<div className="portal-modal-backdrop"><section className="portal-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={()=>setDetail(null)}>×</button><p className="eyebrow">POTVRĐENI TERMIN</p><h2>{formatDateTime(detail.starts_at)}</h2><p><strong>{appointmentService(detail)}</strong>{detail.service_price_snapshot!=null&&<> · {Number(detail.service_price_snapshot).toLocaleString('hr-HR',{style:'currency',currency:'EUR'})}</>}</p>{detail.notes&&<p>{detail.notes}</p>}<div className="portal-modal-actions"><button className="secondary" onClick={()=>void requestChange(detail,'change')}>Zatraži promjenu</button><button className="danger-action" onClick={()=>void requestChange(detail,'cancellation')}>Zatraži otkazivanje</button></div></section></div>}
  </div>
}
