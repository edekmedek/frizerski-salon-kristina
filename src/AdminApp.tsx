import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import './ClientPicker.css'
import './TimePicker.css'
import './ServiceSelect.css'
import './Mobile.css'
import { ClientPhotoInput } from './ClientPhotoInput'
import type { Appointment, Client, HairstyleArchiveEntry, SalonData } from './types'
import { compressImageToAsset } from './lib/image'
import { formatDate, formatDateTime } from './lib/date'
import { addHairstyle, findClientName, loadSalonData, markMessageRead, saveSalonData, uid, upsertAppointment, upsertClient } from './lib/storage'
import type { ClientNotification, PortalData } from './portalTypes'
import { loadPortalData, savePortalData } from './lib/portalStorage'
import { createClientInvitation } from './lib/demoAuth'
import { localDemoClientCredentialProvider } from './lib/clientCredentialProvider'
import { replaceAppointmentReminders } from './lib/reminders'
import './Portal.css'
import './AdminPortal.css'

type View = 'pregled' | 'klijenti' | 'termini' | 'zahtjevi' | 'poruke' | 'arhiva'
const currentUserRole: 'administrator' | 'client' = 'administrator'
const nav: { id: View; label: string; icon: string }[] = [
  { id: 'pregled', label: 'Pregled', icon: '⌂' }, { id: 'klijenti', label: 'Klijenti', icon: '♡' },
  { id: 'termini', label: 'Termini', icon: '◷' }, { id: 'zahtjevi', label: 'Zahtjevi', icon: '◇' },
  { id: 'poruke', label: 'Poruke', icon: '✉' }, { id: 'arhiva', label: 'Arhiva', icon: '▧' },
]
const emptyClient = (): Client => ({ id: '', firstName: '', lastName: '', phone: '', note: '', createdAt: '', updatedAt: '' })
const timeOptions = Array.from({ length: 49 }, (_, index) => {
  const minutes = 8 * 60 + index * 15
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})
const services = [
  { name: 'Žensko šišanje', totalDuration: 45, activeDuration: 45, waitingPhases: [] },
  { name: 'Muško šišanje', totalDuration: 30, activeDuration: 30, waitingPhases: [] },
  { name: 'Feniranje', totalDuration: 45, activeDuration: 45, waitingPhases: [] },
  { name: 'Bojanje', totalDuration: 120, activeDuration: 75, waitingPhases: [{ startOffset: 30, duration: 45 }] },
  { name: 'Pramenovi', totalDuration: 180, activeDuration: 90, waitingPhases: [{ startOffset: 45, duration: 90 }] },
  { name: 'Svečana frizura', totalDuration: 90, activeDuration: 90, waitingPhases: [] },
] as const
function serviceDefinition(service:string){
  const configured=services.find(item=>item.name===service)
  if(configured)return configured
  const value=service.toLocaleLowerCase('hr')
  const totalDuration=value.includes('pramen')?180:value.includes('boj')?120:value.includes('sveč')||value.includes('punđ')?90:value.includes('tonir')||value.includes('fen')?75:60
  return{name:service,totalDuration,activeDuration:totalDuration,waitingPhases:[]}
}
function timeToMinutes(time:string){const [hours,minutes]=time.split(':').map(Number);return hours*60+minutes}
function minutesToTime(minutes:number){return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`}
function activeSegments(start:number,service:string){
  const definition=serviceDefinition(service)
  const waits=[...definition.waitingPhases].sort((a,b)=>a.startOffset-b.startOffset)
  const segments:{start:number;end:number}[]=[]
  let cursor=0
  waits.forEach(wait=>{if(wait.startOffset>cursor)segments.push({start:start+cursor,end:start+wait.startOffset});cursor=Math.max(cursor,wait.startOffset+wait.duration)})
  if(cursor<definition.totalDuration)segments.push({start:start+cursor,end:start+definition.totalDuration})
  return segments
}
function conflictingAppointments(date:string,time:string,service:string,appointments:Appointment[],editingId=''){
  const candidate=activeSegments(timeToMinutes(time),service)
  return appointments.filter(item=>{
    if(item.id===editingId||item.status==='otkazan'||item.dateTime.slice(0,10)!==date)return false
    const occupied=activeSegments(timeToMinutes(item.dateTime.slice(11,16)),item.service)
    return candidate.some(a=>occupied.some(b=>a.start<b.end&&a.end>b.start))
  })
}
function isTimeUnavailable(date:string,time:string,service:string,appointments:Appointment[],editingId=''){
  return conflictingAppointments(date,time,service,appointments,editingId).length>0
}
function localDateString(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function firstAvailableTime(date:string,service:string,appointments:Appointment[],editingId='',futureOnly=false){
  const now=new Date(),today=localDateString(now),nextQuarter=Math.ceil((now.getHours()*60+now.getMinutes())/15)*15
  return timeOptions.find(time=>(!futureOnly||date!==today||timeToMinutes(time)>=nextQuarter)&&!isTimeUnavailable(date,time,service,appointments,editingId))||''
}
function emptyAppointment(appointments:Appointment[]):Appointment{
  const today=new Date()
  for(let offset=0;offset<14;offset+=1){
    const date=new Date(today);date.setDate(today.getDate()+offset);const dateValue=localDateString(date)
    const time=firstAvailableTime(dateValue,'',appointments,'',offset===0)
    if(time)return{id:'',clientId:'',dateTime:`${dateValue}T${time}`,service:'',status:'zakazan',note:'',assignedBy:'Kristina',createdAt:'',updatedAt:''}
  }
  return{id:'',clientId:'',dateTime:'',service:'',status:'zakazan',note:'',assignedBy:'Kristina',createdAt:'',updatedAt:''}
}

function AdminApp({ onLogout }: { onLogout: () => void }) {
  const [data, setData] = useState<SalonData>(() => loadSalonData())
  const [view, setView] = useState<View>('pregled')
  const [query, setQuery] = useState('')
  const [clientForm, setClientForm] = useState<Client | null>(null)
  const [appointmentForm, setAppointmentForm] = useState<Appointment | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [isSavingClient, setIsSavingClient] = useState(false)
  const [portal, setPortal] = useState<PortalData>(() => loadPortalData())
  const [sourceRequestId, setSourceRequestId] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [pinClientId, setPinClientId] = useState('')
  const [temporaryPin, setTemporaryPin] = useState('')
  const [temporaryPinConfirm, setTemporaryPinConfirm] = useState('')
  const [pinError, setPinError] = useState('')
  const [issuedTemporaryPin, setIssuedTemporaryPin] = useState<{ clientId: string; pin: string } | null>(null)
  const clientSavingRef = useRef(false)
  const imageFiles = useRef<{ before?: File; after?: File }>({})
  function update(next: SalonData, message?: string) { setData(next); saveSalonData(next); if (message) { setNotice(message); window.setTimeout(() => setNotice(''), 2600) } }
  const filteredClients = useMemo(() => { const term = query.trim().toLocaleLowerCase('hr'); return term ? data.clients.filter(c => `${c.firstName} ${c.lastName} ${c.phone}`.toLocaleLowerCase('hr').includes(term)) : data.clients }, [data.clients, query])
  const upcoming = [...data.appointments].filter(a => a.status === 'zakazan').sort((a,b) => a.dateTime.localeCompare(b.dateTime))
  const openRequests = portal.requests.filter(item => item.status === 'novo' || item.status === 'u_razgovoru')

  function updatePortal(next: PortalData) { setPortal(next); savePortalData(next) }

  async function makeInvitation(clientId: string) {
    const { token, invitation } = await createClientInvitation(clientId)
    updatePortal({ ...portal, invitations: [invitation, ...portal.invitations] })
    const link = `${window.location.href.split('#')[0]}#/client/invite/${token}`
    setInviteLink(link)
    try { await navigator.clipboard.writeText(link); setNotice('Osobna pozivnica je izrađena i kopirana.') } catch { setNotice('Osobna pozivnica je izrađena.') }
  }

  function openTemporaryPin(clientId: string) {
    setPinClientId(clientId)
    setTemporaryPin('')
    setTemporaryPinConfirm('')
    setPinError('')
  }

  async function saveTemporaryPin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPinError('')
    if (!/^\d{4}$/.test(temporaryPin)) {
      setPinError('PIN mora imati točno četiri znamenke.')
      return
    }
    if (temporaryPin !== temporaryPinConfirm) {
      setPinError('Uneseni PIN-ovi nisu jednaki.')
      return
    }
    const credential = await localDemoClientCredentialProvider.setTemporaryPin(pinClientId, temporaryPin)
    updatePortal({
      ...portal,
      credentials: [...portal.credentials.filter(item => item.clientId !== pinClientId), credential],
    })
    setIssuedTemporaryPin({ clientId: pinClientId, pin: temporaryPin })
    setPinClientId('')
    setTemporaryPin('')
    setTemporaryPinConfirm('')
  }

  async function saveClient(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!clientForm || clientSavingRef.current) return
    clientSavingRef.current=true;setIsSavingClient(true);setNotice('Spremanje klijenta…')
    try {
      await Promise.resolve()
      const now = new Date().toISOString()
      const client = { ...clientForm, id: clientForm.id || uid('client'), firstName: clientForm.firstName.trim(), lastName: clientForm.lastName.trim(), phone: clientForm.phone.trim(), createdAt: clientForm.createdAt || now, updatedAt: now }
      update({ ...data, clients: upsertClient(data.clients, client) }, 'Kartoteka i privatna fotografija su spremljene lokalno.'); setClientForm(null)
    } finally {
      clientSavingRef.current=false;setIsSavingClient(false)
    }
  }
  function saveAppointment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!appointmentForm) return
    if (!appointmentForm.clientId) { setNotice('Odaberite klijenta.'); return }
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(appointmentForm.dateTime)){setNotice('Odaberite datum i vrijeme.');return}
    const conflicts=conflictingAppointments(appointmentForm.dateTime.slice(0,10),appointmentForm.dateTime.slice(11,16),appointmentForm.service,data.appointments,appointmentForm.id)
    if(conflicts.length&&currentUserRole!=='administrator'){setNotice('Odabrani termin nije dostupan.');return}
    if(conflicts.length&&!window.confirm('Termin se preklapa s postojećim terminom. Želite li ga ipak spremiti?'))return
    const now = new Date().toISOString()
    const appointment = { ...appointmentForm, id: appointmentForm.id || uid('appointment'), createdAt: appointmentForm.createdAt || now, updatedAt: now, assignedBy: 'Kristina' as const }
    update({ ...data, appointments: upsertAppointment(data.appointments, appointment) }, 'Termin je potvrđen i spremljen.')
    const client = data.clients.find(item => item.id === appointment.clientId)
    let nextPortal: PortalData = { ...portal, notifications: replaceAppointmentReminders(portal.notifications, appointment, client) }
    if (sourceRequestId) nextPortal = { ...nextPortal, requests: nextPortal.requests.map(item => item.id === sourceRequestId ? { ...item, status: 'potvrđeno', appointmentId: appointment.id, updatedAt: now } : item) }
    updatePortal(nextPortal); setSourceRequestId(''); setAppointmentForm(null)
  }
  function replyToRequest(requestId: string, status: 'u_razgovoru' | 'odbijeno') {
    const reply = window.prompt(status === 'odbijeno' ? 'Napišite razlog odbijanja:' : 'Napišite odgovor ili zatražite drugi prijedlog:')
    if (reply === null) return
    updatePortal({ ...portal, requests: portal.requests.map(item => item.id === requestId ? { ...item, status, adminReply: reply, updatedAt: new Date().toISOString() } : item) })
  }
  function createAppointmentFromRequest(requestId: string) {
    const request = portal.requests.find(item => item.id === requestId)
    if (!request) return
    const appointment = emptyAppointment(data.appointments)
    const date = request.preferredDates[0] || appointment.dateTime.slice(0, 10)
    const time = firstAvailableTime(date, request.service, data.appointments)
    setAppointmentForm({ ...appointment, clientId: request.clientId, service: request.service, dateTime: time ? `${date}T${time}` : `${date}T` })
    setSourceRequestId(request.id)
  }
  function sendAppointmentMessage(appointment: Appointment) {
    const text = window.prompt('Poruka klijentu povezana s terminom:')
    if (!text) return
    const notification: ClientNotification = { id: uid('notification'), clientId: appointment.clientId, appointmentId: appointment.id, kind: 'manual', title: 'Poruka salona o terminu', text, scheduledFor: new Date().toISOString(), status: 'delivered', createdAt: new Date().toISOString() }
    updatePortal({ ...portal, notifications: [notification, ...portal.notifications] }); setNotice('Poruka je dostupna klijentu u portalu.')
  }
  async function saveArchive(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); const beforeFile = imageFiles.current.before; if (!beforeFile) return
    setNotice('Fotografije se komprimiraju…')
    try {
      const before = await compressImageToAsset(beforeFile); const after = imageFiles.current.after ? await compressImageToAsset(imageFiles.current.after) : undefined
      const entry: HairstyleArchiveEntry = { id: uid('style'), clientId: String(form.get('clientId')), date: String(form.get('date')), note: String(form.get('note') || ''), before, after, visibleToClient: form.get('visibleToClient') === 'on', createdAt: new Date().toISOString() }
      update({ ...data, hairstyles: addHairstyle(data.hairstyles, entry) }, 'Frizura je dodana u arhivu.'); imageFiles.current = {}; setArchiveOpen(false)
    } catch { setNotice('Fotografije nije bilo moguće obraditi.') }
  }
  const title = nav.find(item => item.id === view)?.label
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">K</span><div><strong>Salon Kristina</strong><small>Topla elegancija</small></div></div>
      <nav>{nav.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}{item.id === 'poruke' && data.messages.some(m => !m.read) && <i />}</button>)}</nav>
      <div className="owner"><span>K</span><div><strong>Kristina</strong><small>Vlasnica salona</small></div><button className="owner-logout" onClick={onLogout}>Odjava</button></div>
    </aside>
    <main><header><div><p className="eyebrow">Salon Kristina</p><h1>{title}</h1></div><div className="header-actions"><span className="status-dot" /> Lokalno spremljeno</div></header>
      {view === 'pregled' && <><section className="welcome"><div><p className="eyebrow">DOBAR DAN, KRISTINA</p><h2>Što vas danas očekuje?</h2><p>Sve važne informacije na jednom mirnom mjestu.</p></div><button className="primary" onClick={() => { setAppointmentForm(emptyAppointment(data.appointments)); setView('termini') }}>+ Novi termin</button></section>
        <div className="stats"><article><span>◷</span><div><strong>{upcoming.length}</strong><small>Aktivnih termina</small></div></article><article><span>♡</span><div><strong>{data.clients.length}</strong><small>Klijenata u kartoteci</small></div></article><article><span>✉</span><div><strong>{data.messages.filter(m => !m.read).length}</strong><small>Nepročitanih poruka</small></div></article><article><span>▧</span><div><strong>{data.hairstyles.length}</strong><small>Frizura u arhivi</small></div></article></div>
        <section className="panel"><div className="panel-head"><div><p className="eyebrow">RASPORED</p><h2>Nadolazeći termini</h2></div><button className="link" onClick={() => setView('termini')}>Prikaži sve →</button></div><div className="appointment-list">{upcoming.slice(0,4).map(item => <button className="appointment-row" key={item.id} onClick={() => { setAppointmentForm(item); setView('termini') }}><time>{new Date(item.dateTime).toLocaleTimeString('hr-HR',{hour:'2-digit',minute:'2-digit'})}</time><div><strong>{findClientName(data.clients,item.clientId)}</strong><small>{item.service}</small></div><span>{formatDateTime(item.dateTime).split(',')[0]}</span></button>)}</div></section></>}
      {view === 'klijenti' && <section className="panel"><div className="panel-head stack-mobile"><div><p className="eyebrow">KARTOTEKA</p><h2>Moji klijenti</h2></div><div className="toolbar"><input aria-label="Pretraži klijente" placeholder="Pretraži ime ili telefon…" value={query} onChange={e => setQuery(e.target.value)} /><button className="primary" onClick={() => setClientForm(emptyClient())}>+ Novi klijent</button></div></div>
        <div className="client-grid">{filteredClients.map(client => { const portalActive = portal.credentials.some(item => item.clientId === client.id && item.pinHash && item.pinSalt); return <article className="client-card" key={client.id}>{client.photo ? <img src={client.photo.thumb} alt="" /> : <span className="avatar">{client.firstName[0]}{client.lastName[0]}</span>}<div><h3>{client.firstName} {client.lastName}</h3><a href={`tel:${client.phone}`}>{client.phone}</a><p>{client.note || 'Nema zabilješke.'}</p><section className="client-portal-access"><strong>Pristup klijentskom portalu</strong><span className={portalActive ? 'portal-active' : 'portal-inactive'}>{portalActive ? 'Portal aktiviran' : 'Portal nije aktiviran'}</span>{portalActive ? <button className="invite-action" onClick={() => openTemporaryPin(client.id)}>Postavi novi privremeni PIN</button> : <button className="invite-action" onClick={() => void makeInvitation(client.id)}>Izradi pozivnicu</button>}</section></div><button className="more" onClick={() => setClientForm(client)}>Uredi</button></article> })}</div></section>}
      {view === 'termini' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">KRISTININ RASPORED</p><h2>Termini</h2></div><button className="primary" onClick={() => setAppointmentForm(emptyAppointment(data.appointments))}>+ Novi termin</button></div><div className="table-wrap"><table><thead><tr><th>Datum i vrijeme</th><th>Klijent</th><th>Usluga</th><th>Status</th><th /></tr></thead><tbody>{[...data.appointments].sort((a,b) => a.dateTime.localeCompare(b.dateTime)).map(item => <tr key={item.id}><td>{formatDateTime(item.dateTime)}</td><td>{findClientName(data.clients,item.clientId)}</td><td>{item.service}</td><td><span className={`badge ${item.status}`}>{item.status === 'zakazan' ? 'Potvrđeno' : 'Otkazano'}</span></td><td><button className="link" onClick={() => setAppointmentForm(item)}>Uredi</button><button className="link" onClick={() => sendAppointmentMessage(item)}>Poruka</button></td></tr>)}</tbody></table></div></section>}
      {view === 'zahtjevi' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">KLIJENTSKI PORTAL</p><h2>Zahtjevi klijenata</h2></div><span className="request-count">{openRequests.length} otvorenih</span></div><div className="request-inbox">{portal.requests.length ? portal.requests.map(request => <article key={request.id} className={`request-card ${request.status}`}><div className="request-card-head"><div><strong>{findClientName(data.clients,request.clientId)}</strong><small>{formatDateTime(request.createdAt)}</small></div><span>{request.status.replace('_',' ')}</span></div><p><b>{request.kind === 'termin' ? request.service : request.kind === 'promjena' ? 'Zahtjev za promjenu' : 'Zahtjev za otkazivanje'}</b></p>{request.preferredDates.length > 0 && <p>Poželjni dani: {request.preferredDates.map(formatDate).join(', ')} · {request.dayPeriod}</p>}<p>{request.message || 'Bez dodatne poruke.'}</p>{request.adminReply && <p className="admin-reply">Odgovor: {request.adminReply}</p>}<div className="request-actions">{request.kind === 'termin' && request.status !== 'potvrđeno' && <button className="primary" onClick={() => createAppointmentFromRequest(request.id)}>Izradi termin</button>}<button className="secondary" onClick={() => replyToRequest(request.id,'u_razgovoru')}>Odgovori / drugi prijedlog</button><button className="danger-action" onClick={() => replyToRequest(request.id,'odbijeno')}>Odbij</button></div></article>) : <p className="empty-state">Još nema zahtjeva iz klijentskog portala.</p>}</div></section>}
      {view === 'poruke' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">INBOX</p><h2>Poruke klijenata</h2></div></div><div className="message-list">{[...data.messages].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(message => <button key={message.id} className={`message ${message.read?'':'unread'}`} onClick={() => update({...data,messages:markMessageRead(data.messages,message.id)})}><span className="avatar">{message.senderName.split(' ').map(x=>x[0]).join('').slice(0,2)}</span><div><div><strong>{message.senderName}</strong><time>{formatDateTime(message.createdAt)}</time></div><p>{message.text}</p><small>{message.senderPhone}</small></div></button>)}</div></section>}
      {view === 'arhiva' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">INSPIRACIJA I POVIJEST</p><h2>Arhiva frizura</h2></div><button className="primary" onClick={() => setArchiveOpen(true)}>+ Dodaj frizuru</button></div><div className="gallery">{data.hairstyles.map(entry => <article key={entry.id}><div className="photo-pair"><figure><img src={entry.before.thumb} alt="Prije" /><figcaption>Prije</figcaption></figure>{entry.after&&<figure><img src={entry.after.thumb} alt="Poslije" /><figcaption>Poslije</figcaption></figure>}</div><div><small>{formatDate(entry.date)}</small><h3>{findClientName(data.clients,entry.clientId)}</h3><p>{entry.note}</p><button className="link" onClick={() => update({...data,hairstyles:data.hairstyles.map(item => item.id === entry.id ? {...item,visibleToClient:!item.visibleToClient}:item)},entry.visibleToClient?'Fotografija više nije vidljiva klijentu.':'Fotografija je vidljiva klijentu.')}>{entry.visibleToClient?'Sakrij od klijenta':'Podijeli s klijentom'}</button></div></article>)}</div></section>}
    </main>
    <div className="mobile-nav">{nav.map(item => <button key={item.id} className={view===item.id?'active':''} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</div>{notice&&<div className="toast">{notice}</div>}
    {inviteLink&&<Modal title="Osobna pozivnica" onClose={() => setInviteLink('')}><div className="invite-modal"><p>Link vrijedi 24 sata i može se iskoristiti samo jednom.</p><textarea readOnly rows={4} value={inviteLink}/><button className="primary" onClick={() => void navigator.clipboard.writeText(inviteLink)}>Kopiraj link</button></div></Modal>}
    {pinClientId&&<Modal title="Novi privremeni PIN" onClose={() => setPinClientId('')}><form onSubmit={event => void saveTemporaryPin(event)}><p className="pin-guidance">Postavite novi četveroznamenkasti PIN. Prethodni PIN odmah će prestati vrijediti.</p><label>Novi PIN<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} value={temporaryPin} onChange={event => setTemporaryPin(event.target.value.replace(/\D/g, '').slice(0, 4))}/></label><label>Potvrdite PIN<input required type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} value={temporaryPinConfirm} onChange={event => setTemporaryPinConfirm(event.target.value.replace(/\D/g, '').slice(0, 4))}/></label>{pinError&&<p className="form-error" role="alert">{pinError}</p>}<FormActions disabled={temporaryPin.length !== 4 || temporaryPinConfirm.length !== 4} onCancel={() => setPinClientId('')}/></form></Modal>}
    {issuedTemporaryPin&&<Modal title="Privremeni PIN je postavljen" onClose={() => setIssuedTemporaryPin(null)}><div className="issued-pin"><p>Novi privremeni PIN prikazuje se samo sada:</p><output aria-label="Novi privremeni PIN">{issuedTemporaryPin.pin}</output><button className="primary" type="button" onClick={() => void navigator.clipboard.writeText(issuedTemporaryPin.pin)}>Kopiraj PIN</button><p className="pin-warning" role="alert">Pošaljite ovaj PIN klijentu sigurnim putem. Nakon zatvaranja više ga nećete moći vidjeti.</p></div></Modal>}
    {clientForm&&<Modal title={clientForm.id?'Uredi kartoteku':'Novi klijent'} onClose={() => setClientForm(null)}><form onSubmit={saveClient}><div className="form-grid"><label>Ime<input required value={clientForm.firstName} onChange={e=>setClientForm({...clientForm,firstName:e.target.value})}/></label><label>Prezime<input required value={clientForm.lastName} onChange={e=>setClientForm({...clientForm,lastName:e.target.value})}/></label></div><label>Telefon<input required type="tel" inputMode="tel" autoComplete="tel" value={clientForm.phone} onChange={e=>setClientForm({...clientForm,phone:e.target.value})}/></label><div className="form-field"><span>Profilna fotografija</span><ClientPhotoInput value={clientForm.photo} onChange={photo=>setClientForm({...clientForm,photo})}/></div><label>Bilješka<textarea rows={4} value={clientForm.note} onChange={e=>setClientForm({...clientForm,note:e.target.value})}/></label><FormActions disabled={isSavingClient} submitting={isSavingClient} onCancel={()=>setClientForm(null)}/></form></Modal>}
    {appointmentForm&&<Modal title={appointmentForm.id?'Uredi termin':'Novi termin'} onClose={()=>setAppointmentForm(null)}><form onSubmit={saveAppointment}><div className="form-field"><span id="client-picker-label">Klijent</span><ClientPicker clients={data.clients} value={appointmentForm.clientId} onChange={clientId=>setAppointmentForm({...appointmentForm,clientId})}/></div><div className="date-time-fields"><label>Datum<input required type="date" value={appointmentForm.dateTime.slice(0,10)} onChange={e=>{const date=e.target.value;const time=firstAvailableTime(date,appointmentForm.service,data.appointments,appointmentForm.id);setAppointmentForm({...appointmentForm,dateTime:time?`${date}T${time}`:`${date}T`})}}/></label><div className="form-field"><span id="time-picker-label">Vrijeme</span><TimePicker date={appointmentForm.dateTime.slice(0,10)} value={appointmentForm.dateTime.slice(11,16)} service={appointmentForm.service} appointments={data.appointments} clients={data.clients} editingId={appointmentForm.id} allowOverride={currentUserRole==='administrator'} onChange={time=>setAppointmentForm({...appointmentForm,dateTime:`${appointmentForm.dateTime.slice(0,10)}T${time}`})}/></div></div><label>Usluga<span className="service-select"><select required value={appointmentForm.service} onChange={e=>setAppointmentForm({...appointmentForm,service:e.target.value})}><option value="" disabled>Odaberite uslugu</option>{services.map(item=><option key={item.name} value={item.name}>{item.name} — {item.totalDuration} min</option>)}</select><span aria-hidden="true">⌄</span></span></label><div className="form-grid"><label>Status<select value={appointmentForm.status} onChange={e=>setAppointmentForm({...appointmentForm,status:e.target.value as Appointment['status']})}><option value="zakazan">Zakazan</option><option value="otkazan">Otkazan</option></select></label><label>Termin unosi<input value="Kristina" disabled/></label></div><label>Bilješka<textarea rows={3} value={appointmentForm.note} onChange={e=>setAppointmentForm({...appointmentForm,note:e.target.value})}/></label><FormActions disabled={!appointmentForm.clientId||!appointmentForm.service||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(appointmentForm.dateTime)} onCancel={()=>setAppointmentForm(null)}/></form></Modal>}
    {archiveOpen&&<Modal title="Dodaj frizuru u arhivu" onClose={()=>setArchiveOpen(false)}><form onSubmit={e=>void saveArchive(e)}><label>Klijent<select required name="clientId"><option value="">Odaberite klijenta</option>{data.clients.map(c=><option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></label><label>Datum<input required name="date" type="date" defaultValue={new Date().toISOString().slice(0,10)}/></label><div className="form-grid"><label>Fotografija prije<input required type="file" accept="image/*" onChange={e=>{imageFiles.current.before=e.target.files?.[0]}}/></label><label>Fotografija poslije<input type="file" accept="image/*" onChange={e=>{imageFiles.current.after=e.target.files?.[0]}}/></label></div><label>Bilješka<textarea name="note" rows={3}/></label><label className="checkbox-field"><input name="visibleToClient" type="checkbox"/> Vidljivo klijentu u portalu</label><p className="hint">Slike se pretvaraju u WebP, smanjuju na najviše 1920 px i dobivaju thumbnail.</p><FormActions onCancel={()=>setArchiveOpen(false)}/></form></Modal>}
  </div>
}
function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  const dialogRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow='hidden';dialogRef.current?.focus();return()=>{document.body.style.overflow=previous}},[])
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape')onClose()}}><div className="modal-head"><h2 id="modal-title">{title}</h2><button type="button" onClick={onClose} aria-label="Zatvori">×</button></div>{children}</div></div>
}
function ClientPicker({clients,value,onChange}:{clients:Client[];value:string;onChange:(id:string)=>void}){
  const [open,setOpen]=useState(false)
  const [activeIndex,setActiveIndex]=useState(Math.max(0,clients.findIndex(client=>client.id===value)))
  const rootRef=useRef<HTMLDivElement>(null)
  const triggerRef=useRef<HTMLButtonElement>(null)
  const selected=clients.find(client=>client.id===value)
  const listboxId='appointment-client-listbox'
  useEffect(()=>{function close(event:PointerEvent){if(!rootRef.current?.contains(event.target as Node))setOpen(false)}document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[])
  function choose(index:number){const client=clients[index];if(client){onChange(client.id);setActiveIndex(index);setOpen(false);triggerRef.current?.focus()}}
  function handleKeyDown(e:React.KeyboardEvent<HTMLButtonElement>){
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const direction=e.key==='ArrowDown'?1:-1;if(!open){setOpen(true);setActiveIndex(Math.max(0,clients.findIndex(client=>client.id===value)))}else setActiveIndex(index=>(index+direction+clients.length)%clients.length)}
    if(e.key==='Enter'||e.key===' '){e.preventDefault();if(open)choose(activeIndex);else setOpen(true)}
    if(e.key==='Escape'&&open){e.preventDefault();setOpen(false)}
    if(e.key==='Home'&&open){e.preventDefault();setActiveIndex(0)}
    if(e.key==='End'&&open){e.preventDefault();setActiveIndex(clients.length-1)}
  }
  return <div className="client-picker" ref={rootRef}>
    <button ref={triggerRef} type="button" className={`picker-trigger ${open?'open':''}`} aria-labelledby="client-picker-label" aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} aria-required="true" onKeyDown={handleKeyDown} onClick={()=>setOpen(!open)}>
      {selected?<><ClientMiniAvatar client={selected}/><span>{selected.firstName} {selected.lastName}</span></>:<span className="picker-placeholder">Odaberite klijenta</span>}<span className="picker-chevron">⌄</span>
    </button>
    {open&&<div id={listboxId} className="picker-options" role="listbox" aria-label="Klijenti">{clients.map((client,index)=><button type="button" role="option" aria-selected={client.id===value} className={`${client.id===value?'selected ':''}${index===activeIndex?'active':''}`} key={client.id} onPointerMove={()=>setActiveIndex(index)} onClick={()=>choose(index)}><ClientMiniAvatar client={client}/><span>{client.firstName} {client.lastName}</span>{client.id===value&&<b aria-hidden="true">✓</b>}</button>)}</div>}
  </div>
}
function TimePicker({date,value,service,appointments,clients,editingId,allowOverride,onChange}:{date:string;value:string;service:string;appointments:Appointment[];clients:Client[];editingId:string;allowOverride:boolean;onChange:(time:string)=>void}){
  const [open,setOpen]=useState(false)
  const [manual,setManual]=useState(false)
  const rootRef=useRef<HTMLDivElement>(null)
  const triggerRef=useRef<HTMLButtonElement>(null)
  const listboxId='appointment-time-listbox'
  const conflictsByTime=timeOptions.map(time=>conflictingAppointments(date,time,service,appointments,editingId))
  const selectedConflicts=value?conflictingAppointments(date,value,service,appointments,editingId):[]
  useEffect(()=>{function close(event:PointerEvent){if(!rootRef.current?.contains(event.target as Node))setOpen(false)}document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[])
  function move(direction:number){
    const current=Math.max(0,timeOptions.indexOf(value))
    const index=(current+direction+timeOptions.length)%timeOptions.length
    onChange(timeOptions[index])
  }
  return <div className="time-picker" ref={rootRef}>
    <button ref={triggerRef} type="button" className={`time-trigger ${open?'open':''}`} disabled={!date} aria-labelledby="time-picker-label" aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} aria-required="true" onClick={()=>setOpen(!open)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open)setOpen(true);else move(e.key==='ArrowDown'?1:-1)}if(e.key==='Escape'){setOpen(false)}}}>
      <span className={value?'':'time-placeholder'}>{value||'Odaberite vrijeme'}</span><span aria-hidden="true">⌄</span>
    </button>
    {open&&<div id={listboxId} className="time-options" role="listbox" aria-label="Vrijeme termina">{timeOptions.map((time,index)=>{const overlaps=conflictsByTime[index].length>0;return <button type="button" role="option" key={time} disabled={!allowOverride&&overlaps} aria-selected={time===value} className={`${time===value?'selected ':''}${overlaps?'overlap':'free'}`} onClick={()=>{onChange(time);setOpen(false);triggerRef.current?.focus()}}><span>{time}</span>{overlaps?<small>Preklapanje</small>:<b>{time===value?'Odabrano':'Slobodno'}</b>}</button>})}</div>}
    {allowOverride&&<button type="button" className="manual-time-toggle" onClick={()=>{setManual(!manual);setOpen(false)}}>{manual?'Sakrij ručni unos':'Ručno unesi vrijeme'}</button>}
    {allowOverride&&manual&&<label className="manual-time"><span>Početak termina</span><input type="time" min="08:00" max="20:00" step="900" value={value} onChange={e=>{if(!e.target.value||timeOptions.includes(e.target.value))onChange(e.target.value)}}/><small>Samo administratorski unos, u koracima od 15 minuta.</small></label>}
    {selectedConflicts.length>0&&<div className="overlap-warning" role="alert"><strong>Upozorenje: termin se preklapa.</strong>{selectedConflicts.map(item=><span key={item.id}>{findClientName(clients,item.clientId)} · {item.service} · {item.dateTime.slice(11,16)}–{minutesToTime(timeToMinutes(item.dateTime.slice(11,16))+serviceDefinition(item.service).totalDuration)}</span>)}</div>}
  </div>
}
function ClientMiniAvatar({client}:{client:Client}){return client.photo?<img className="client-mini-avatar" src={client.photo.thumb} alt=""/>:<span className="client-mini-avatar initials">{client.firstName[0]}{client.lastName[0]}</span>}
function FormActions({onCancel,disabled=false,submitting=false}:{onCancel:()=>void;disabled?:boolean;submitting?:boolean}){return <div className="form-actions"><button type="button" className="secondary" disabled={submitting} onClick={onCancel}>Odustani</button><button className="primary" type="submit" disabled={disabled}>{submitting?'Spremanje…':'Spremi'}</button></div>}
export default AdminApp
