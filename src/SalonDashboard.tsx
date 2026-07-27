import { useEffect, useMemo, useState } from 'react'
import type { Appointment, Client } from './types'
import type { DoorbellService } from './lib/doorbellService'
import { formatDateTime } from './lib/date'

interface Props {
  appointments: Appointment[]
  clients: Client[]
  unreadMessages: number
  unreadRequests: number
  doorbell: DoorbellService
  onOpenSchedule: () => void
  onOpenMessages: () => void
  onOpenRequests: () => void
}

function clientName(clients: Client[], clientId: string) {
  const client = clients.find(item => item.id === clientId)
  return client ? `${client.firstName} ${client.lastName}` : 'Klijent'
}

export function SalonDashboard({
  appointments,
  clients,
  unreadMessages,
  unreadRequests,
  doorbell,
  onOpenSchedule,
  onOpenMessages,
  onOpenRequests,
}: Props) {
  const [doorbellOnline, setDoorbellOnline] = useState(false)
  const [dashboardNow] = useState(() => new Date())
  const now = dashboardNow.getTime()
  const today = dashboardNow.toISOString().slice(0, 10)
  const todayAppointments = useMemo(() => appointments
    .filter(item => item.dateTime.slice(0, 10) === today && item.status !== 'otkazan')
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime)), [appointments, today])
  const active = todayAppointments.find(item => {
    const starts = new Date(item.dateTime).getTime()
    const ends = starts + Math.max(item.serviceDuration || 30, 15) * 60_000
    return starts <= now && now < ends
  })
  const next = todayAppointments.find(item => new Date(item.dateTime).getTime() > now)

  useEffect(() => {
    let mounted = true
    void doorbell.isOnline().then(value => { if (mounted) setDoorbellOnline(value) })
    return () => { mounted = false }
  }, [doorbell])

  const appointmentCard = (item: Appointment | undefined, empty: string) => item
    ? <><strong>{item.dateTime.slice(11, 16)} · {clientName(clients, item.clientId)}</strong><span>{item.service || 'Usluga nije navedena'}</span></>
    : <span>{empty}</span>

  return <section className="salon-dashboard" aria-label="Salon Dashboard">
    <header><div><p className="eyebrow">SALON DASHBOARD</p><h2>Danas u salonu</h2></div><button className="secondary" type="button" onClick={onOpenSchedule}>Otvori raspored</button></header>
    <div className="salon-dashboard-grid">
      <article className="dashboard-focus-card active-appointment"><small>Trenutno aktivan termin</small>{appointmentCard(active, 'Trenutno nema aktivnog termina.')}</article>
      <article className="dashboard-focus-card"><small>Sljedeći termin</small>{appointmentCard(next, 'Nema sljedećeg termina danas.')}</article>
      <button className="dashboard-count-card" type="button" onClick={onOpenMessages}><strong>{unreadMessages}</strong><span>Nove poruke</span></button>
      <button className="dashboard-count-card" type="button" onClick={onOpenRequests}><strong>{unreadRequests}</strong><span>Novi zahtjevi</span></button>
      <article className="dashboard-doorbell-card"><div><small>ULAZ</small><h3>{doorbellOnline ? 'Zvono povezano' : 'Zvono nije povezano'}</h3></div><button className="secondary" type="button" onClick={() => void doorbell.startLiveView()}>Poveži zvono</button></article>
      <article className="dashboard-today-list"><div><h3>Današnji termini</h3><b>{todayAppointments.length}</b></div>{todayAppointments.length ? todayAppointments.map(item => <button type="button" key={item.id} onClick={onOpenSchedule}><time>{item.dateTime.slice(11, 16)}</time><span><strong>{clientName(clients, item.clientId)}</strong><small>{item.service}</small></span><em>{item.noCharge ? 'Gratis' : item.status}</em></button>) : <p>Danas nema termina.</p>}<footer>Ažurirano {formatDateTime(dashboardNow.toISOString())}</footer></article>
    </div>
  </section>
}
