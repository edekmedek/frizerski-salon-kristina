import { useEffect, useMemo, useState } from 'react'
import type { Appointment } from './types'
import type { ClientRequest, DayPeriod, PortalData, RequestKind } from './portalTypes'
import { formatDate, formatDateTime } from './lib/date'
import { loadSalonData, uid } from './lib/storage'
import { loadPortalData, savePortalData } from './lib/portalStorage'
import { DemoReminderProvider, runDueDemoReminders } from './lib/reminders'
import './Portal.css'

const serviceNames = ['Žensko šišanje', 'Muško šišanje', 'Feniranje', 'Bojanje', 'Pramenovi', 'Svečana frizura']

export function ClientPortal({ clientId, onLogout }: { clientId: string; onLogout: () => void }) {
  const salon = loadSalonData()
  const client = salon.clients.find((item) => item.id === clientId)
  const [portal, setPortal] = useState<PortalData>(() => loadPortalData())
  const [portalNow] = useState(() => Date.now())
  const [section, setSection] = useState<'home' | 'request' | 'appointments' | 'messages' | 'photos'>('home')
  const [detail, setDetail] = useState<Appointment | null>(null)
  const [notice, setNotice] = useState('')
  const ownAppointments = useMemo(
    () => salon.appointments
      .filter((item) => item.clientId === clientId && item.status === 'zakazan' && new Date(item.dateTime).getTime() >= portalNow)
      .sort((a, b) => a.dateTime.localeCompare(b.dateTime)),
    [salon.appointments, clientId, portalNow],
  )
  const ownRequests = portal.requests.filter((item) => item.clientId === clientId)
  const ownNotifications = portal.notifications
    .filter((item) => item.clientId === clientId && item.status === 'delivered')
    .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor))
  const ownPhotos = salon.hairstyles.filter(
    (item) => item.clientId === clientId && item.visibleToClient === true,
  )

  useEffect(() => {
    void runDueDemoReminders(loadPortalData().notifications, new DemoReminderProvider()).then(
      (notifications) => {
        const latest = loadPortalData()
        const next = { ...latest, notifications }
        savePortalData(next)
        setPortal(next)
      },
    )
  }, [])

  if (!client) {
    return <main className="access-page"><section className="access-card"><h1>Pristup nije dostupan</h1><p>Prijavite se ponovno osobnom poveznicom salona.</p><button className="primary" onClick={onLogout}>Odjava</button></section></main>
  }

  function saveRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const dates = form.getAll('preferredDates').map(String).filter(Boolean)
    if (!dates.length) { setNotice('Dodajte barem jedan poželjni dan.'); return }
    const now = new Date().toISOString()
    const request: ClientRequest = {
      id: uid('request'), clientId, kind: 'termin', service: String(form.get('service')),
      preferredDates: dates, dayPeriod: String(form.get('dayPeriod')) as DayPeriod,
      message: String(form.get('message') || ''), status: 'novo', adminReply: '',
      createdAt: now, updatedAt: now,
    }
    const next = { ...portal, requests: [request, ...portal.requests] }
    savePortalData(next); setPortal(next); setNotice('Želja je poslana Kristini.'); setSection('home')
  }

  function requestAppointmentChange(appointment: Appointment, kind: RequestKind) {
    const text = window.prompt(kind === 'otkazivanje' ? 'Napišite razlog zahtjeva za otkazivanje:' : 'Napišite što želite promijeniti:')
    if (text === null) return
    const now = new Date().toISOString()
    const request: ClientRequest = {
      id: uid('request'), clientId, kind, service: appointment.service,
      preferredDates: [appointment.dateTime.slice(0, 10)], dayPeriod: 'svejedno',
      message: text, status: 'novo', adminReply: '', appointmentId: appointment.id,
      createdAt: now, updatedAt: now,
    }
    const next = { ...portal, requests: [request, ...portal.requests] }
    savePortalData(next); setPortal(next); setDetail(null); setNotice('Zahtjev je poslan. Termin nije promijenjen dok Kristina ne potvrdi.')
  }

  return <div className="client-portal">
    <header className="client-header"><div><p className="eyebrow">SALON KRISTINA</p><h1>Pozdrav, {client.firstName}</h1></div><button className="secondary" onClick={onLogout}>Odjava</button></header>
    <nav className="client-nav">
      <button className={section === 'home' ? 'active' : ''} onClick={() => setSection('home')}>Pregled</button>
      <button className={section === 'appointments' ? 'active' : ''} onClick={() => setSection('appointments')}>Termini</button>
      <button className={section === 'messages' ? 'active' : ''} onClick={() => setSection('messages')}>Poruke</button>
      <button className={section === 'photos' ? 'active' : ''} onClick={() => setSection('photos')}>Fotografije</button>
    </nav>
    <main className="client-content">
      {notice && <p className="portal-notice" role="status">{notice}</p>}
      {section === 'home' && <>
        <section className="client-hero"><p className="eyebrow">SLJEDEĆI POTVRĐENI TERMIN</p>{ownAppointments[0] ? <><h2>{formatDateTime(ownAppointments[0].dateTime)}</h2><p>{ownAppointments[0].service}</p><button className="link" onClick={() => setDetail(ownAppointments[0])}>Detalji termina →</button></> : <><h2>Još nema potvrđenog termina</h2><p>Pošaljite želju, a Kristina će vam se javiti.</p></>}</section>
        <button className="primary wide-action" onClick={() => setSection('request')}>Pošalji želju za termin</button>
        <div className="client-summary">
          <button onClick={() => setSection('appointments')}><strong>{ownAppointments.length}</strong><span>Budući termini</span></button>
          <button onClick={() => setSection('messages')}><strong>{ownNotifications.length + ownRequests.filter((item) => item.adminReply).length}</strong><span>Poruke salona</span></button>
          <button onClick={() => setSection('photos')}><strong>{ownPhotos.length}</strong><span>Moje fotografije</span></button>
        </div>
      </>}

      {section === 'request' && <section className="client-card-section"><h2>Želja za termin</h2><p className="important-note">Ovo nije rezervacija. Kristina će pregledati vašu želju i potvrditi termin.</p><form onSubmit={saveRequest}>
        <label>Željena usluga<select required name="service" defaultValue=""><option value="" disabled>Odaberite uslugu</option>{serviceNames.map((name) => <option key={name}>{name}</option>)}</select></label>
        <fieldset><legend>Poželjni dani</legend><input required name="preferredDates" type="date" /><input name="preferredDates" type="date" /><input name="preferredDates" type="date" /></fieldset>
        <label>Dio dana<select name="dayPeriod" defaultValue="svejedno"><option value="prijepodne">Prijepodne</option><option value="poslijepodne">Poslijepodne</option><option value="svejedno">Svejedno</option></select></label>
        <label>Dodatne želje<textarea name="message" rows={4} placeholder="Napišite sve što je Kristini važno znati…" /></label>
        <button className="primary" type="submit">Pošalji želju Kristini</button>
        <button className="secondary" type="button" onClick={() => setSection('home')}>Odustani</button>
      </form></section>}

      {section === 'appointments' && <section className="client-card-section"><h2>Moji budući termini</h2>{ownAppointments.length ? <div className="portal-list">{ownAppointments.map((item) => <button key={item.id} onClick={() => setDetail(item)}><div><strong>{formatDateTime(item.dateTime)}</strong><span>{item.service}</span></div><b>Potvrđeno</b></button>)}</div> : <p className="empty-state">Nema budućih potvrđenih termina.</p>}</section>}

      {section === 'messages' && <section className="client-card-section"><h2>Poruke salona</h2><div className="portal-messages">{ownRequests.filter((item) => item.adminReply).map((item) => <article key={item.id}><small>{formatDate(item.updatedAt)}</small><strong>Odgovor na vaš zahtjev</strong><p>{item.adminReply}</p></article>)}{ownNotifications.map((item) => <article key={item.id}><small>{formatDateTime(item.scheduledFor)}</small><strong>{item.title}</strong><p>{item.text}</p></article>)}{!ownNotifications.length && !ownRequests.some((item) => item.adminReply) && <p className="empty-state">Još nema poruka salona.</p>}</div></section>}

      {section === 'photos' && <section className="client-card-section"><h2>Moje fotografije</h2>{ownPhotos.length ? <div className="client-photo-grid">{ownPhotos.map((item) => <article key={item.id}><img src={(item.after ?? item.before).thumb} alt="Frizura iz privatne arhive" /><div><strong>{formatDate(item.date)}</strong><p>{item.note}</p></div></article>)}</div> : <p className="empty-state">Kristina još nije podijelila fotografije s vama.</p>}<p className="privacy-note">Fotografije su privatne i dostupne samo vama i salonu.</p></section>}
    </main>
    {detail && <div className="portal-modal-backdrop"><section className="portal-modal" role="dialog" aria-modal="true"><button className="modal-close" onClick={() => setDetail(null)}>×</button><p className="eyebrow">POTVRĐENI TERMIN</p><h2>{formatDateTime(detail.dateTime)}</h2><p><strong>{detail.service}</strong></p>{detail.note && <p>{detail.note}</p>}<div className="portal-modal-actions"><button className="secondary" onClick={() => requestAppointmentChange(detail, 'promjena')}>Zatraži promjenu</button><button className="danger-action" onClick={() => requestAppointmentChange(detail, 'otkazivanje')}>Zatraži otkazivanje</button></div><p className="privacy-note">Zahtjev ne mijenja termin dok ga Kristina ne potvrdi.</p></section></div>}
  </div>
}
