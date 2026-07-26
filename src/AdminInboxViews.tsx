import { useState } from 'react'
import { formatDate, formatDateTime } from './lib/date'
import { dayPeriodLabel, requestStatusLabel, type AdminMessage, type AdminRequest } from './lib/adminInbox'

interface RequestInboxProps {
  requests: AdminRequest[]
  selected?: AdminRequest
  busy: boolean
  onOpen: (request: AdminRequest) => Promise<void>
  onAccept: (request: AdminRequest) => void
  onRespond: (request: AdminRequest, status: 'in_review' | 'rejected', reply: string) => Promise<boolean>
  onClose: () => void
}

export function AdminRequestInbox({ requests, selected, busy, onOpen, onAccept, onRespond, onClose }: RequestInboxProps) {
  const [proposal, setProposal] = useState('')
  const pending = requests.filter(item => item.status === 'pending' || item.status === 'in_review')

  if (selected) {
    return <section className="panel inbox-detail">
      <div className="panel-head"><div><p className="eyebrow">ZAHTJEV KLIJENTA</p><h2>{selected.clientName}</h2></div><button className="secondary" onClick={onClose}>Natrag</button></div>
      <dl className="detail-grid">
        <div><dt>Status</dt><dd>{requestStatusLabel(selected.status)}</dd></div>
        <div><dt>Poslano</dt><dd>{formatDateTime(selected.createdAt)}</dd></div>
        <div><dt>Tretman</dt><dd>{selected.service || 'Nije navedeno'}</dd></div>
        <div><dt>Željeni datum</dt><dd>{selected.preferredDates.map(formatDate).join(', ') || 'Nije naveden'}</dd></div>
        <div><dt>Dio dana</dt><dd>{dayPeriodLabel(selected.dayPeriod)}</dd></div>
        <div><dt>Telefon</dt><dd>{selected.clientPhone}</dd></div>
      </dl>
      <article className="full-message"><strong>Napomena klijenta</strong><p>{selected.message || 'Bez dodatne napomene.'}</p></article>
      {selected.clientReply && <article className="full-message"><strong>Odgovor klijenta na prijedlog</strong><p>{selected.clientReply}</p></article>}
      {selected.adminReply && <article className="admin-reply"><strong>Kristinin odgovor</strong><p>{selected.adminReply}</p></article>}
      {(selected.status === 'pending' || selected.status === 'in_review') && <div className="request-detail-actions">
        {selected.kind === 'appointment' && <button className="primary" disabled={busy} onClick={() => onAccept(selected)}>Prihvati i odaberi termin</button>}
        <label>Prijedlog drugog datuma i vremena ili poruka
          <textarea rows={3} value={proposal} onChange={event => setProposal(event.target.value)} placeholder="Npr. Mogu ponuditi 29. 7. u 15:30." />
        </label>
        <button className="secondary" disabled={busy || !proposal.trim()} onClick={async () => { if (await onRespond(selected, 'in_review', proposal)) setProposal('') }}>Pošalji drugi prijedlog</button>
        <button className="danger-action" disabled={busy} onClick={async () => {
          const reason = window.prompt('Napišite kratko obrazloženje odbijanja:')
          if (reason?.trim()) await onRespond(selected, 'rejected', reason)
        }}>Odbij zahtjev</button>
      </div>}
    </section>
  }

  return <section className="panel">
    <div className="panel-head"><div><p className="eyebrow">KLIJENTSKI PORTAL</p><h2>Zahtjevi klijenata</h2></div><span className="request-count">{pending.length} otvorenih</span></div>
    <div className="request-inbox">{pending.length ? pending.map(request =>
      <button type="button" key={request.id} className={`request-card inbox-row ${request.readAt ? '' : 'unread'}`} onClick={() => void onOpen(request)}>
        <div className="request-card-head"><div><strong>{request.clientName}</strong><small>{formatDateTime(request.createdAt)}</small></div><span>{requestStatusLabel(request.status)}</span></div>
        <p><b>{request.service || (request.kind === 'change' ? 'Zahtjev za promjenu' : 'Zahtjev za otkazivanje')}</b></p>
        <p>{request.preferredDates.map(formatDate).join(', ')} · {dayPeriodLabel(request.dayPeriod)}</p>
        {!request.readAt && <em className="new-badge">Novo</em>}
      </button>) : <p className="empty-state">Nema zahtjeva iz klijentskog portala.</p>}
    </div>
  </section>
}

interface MessageInboxProps {
  messages: AdminMessage[]
  selected?: AdminMessage
  showArchive: boolean
  busy: boolean
  onToggleArchive: () => void
  onOpen: (message: AdminMessage) => Promise<void>
  onReply: (message: AdminMessage, reply: string) => Promise<boolean>
  onArchive: (message: AdminMessage) => Promise<boolean>
  onDelete: (message: AdminMessage) => Promise<boolean>
  onClose: () => void
}

export function AdminMessageInbox({ messages, selected, showArchive, busy, onToggleArchive, onOpen, onReply, onArchive, onDelete, onClose }: MessageInboxProps) {
  const [reply, setReply] = useState('')
  const visible = messages.filter(item => item.sender === 'client' && (showArchive ? Boolean(item.archivedAt) : !item.archivedAt))

  if (selected) {
    return <section className="panel inbox-detail">
      <div className="panel-head"><div><p className="eyebrow">PORUKA KLIJENTA</p><h2>{selected.subject}</h2></div><button className="secondary" onClick={onClose}>Natrag</button></div>
      <dl className="detail-grid">
        <div><dt>Pošiljatelj</dt><dd>{selected.clientName}</dd></div>
        <div><dt>Datum i vrijeme</dt><dd>{formatDateTime(selected.createdAt)}</dd></div>
        <div><dt>Telefon</dt><dd>{selected.clientPhone}</dd></div>
      </dl>
      <article className="full-message"><p>{selected.message}</p></article>
      {!selected.archivedAt && <label>Odgovor klijentu<textarea rows={4} value={reply} onChange={event => setReply(event.target.value)} /></label>}
      <div className="request-actions">
        {!selected.archivedAt && <button className="primary" disabled={busy || !reply.trim()} onClick={async () => { if (await onReply(selected, reply)) setReply('') }}>Pošalji odgovor</button>}
        {!selected.archivedAt && <button className="secondary" disabled={busy} onClick={() => void onArchive(selected)}>Arhiviraj</button>}
        {selected.archivedAt && <button className="danger-action" disabled={busy} onClick={() => void onDelete(selected)}>Trajno obriši</button>}
      </div>
    </section>
  }

  return <section className="panel">
    <div className="panel-head"><div><p className="eyebrow">INBOX</p><h2>{showArchive ? 'Arhiva poruka' : 'Poruke klijenata'}</h2></div><button className="secondary" onClick={onToggleArchive}>{showArchive ? 'Aktivne poruke' : 'Arhiva'}</button></div>
    <div className="message-list">{visible.length ? visible.map(message =>
      <button key={message.id} className={`message ${message.read ? '' : 'unread'}`} onClick={() => void onOpen(message)}>
        <span className="avatar">{message.clientName.split(' ').map(part => part[0]).join('').slice(0, 2)}</span>
        <div><div><strong>{message.clientName}</strong><time>{formatDateTime(message.createdAt)}</time></div><b>{message.subject}</b><p>{message.message}</p>{!message.read && <em className="new-badge">Novo</em>}</div>
      </button>) : <p className="empty-state">{showArchive ? 'Arhiva je prazna.' : 'Nema poruka klijenata.'}</p>}
    </div>
  </section>
}
