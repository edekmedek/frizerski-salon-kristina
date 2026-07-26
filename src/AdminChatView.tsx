import { useState } from 'react'
import { formatDateTime } from './lib/date'
import type { AdminMessage } from './lib/adminInbox'

interface Props {
  messages: AdminMessage[]; selected?: AdminMessage; busy: boolean
  clients: { id: string; firstName: string; lastName: string }[]
  onOpen: (message: AdminMessage) => Promise<void>
  onReply: (message: AdminMessage, reply: string) => Promise<boolean>
  onNew: (clientId: string, message: string) => Promise<boolean>
  onDelete: (message: AdminMessage) => Promise<boolean>
  onClose: () => void
}

export function AdminChatView({ messages, selected, busy, clients, onOpen, onReply, onNew, onDelete, onClose }: Props) {
  const [reply, setReply] = useState('')
  const [composing, setComposing] = useState(false)
  const [newClientId, setNewClientId] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const active = messages.filter(item => !item.archivedAt)
  const conversations = [...active.reduce((latest, message) => {
    const current = latest.get(message.clientId)
    if (!current || current.createdAt < message.createdAt) latest.set(message.clientId, message)
    return latest
  }, new Map<string, AdminMessage>()).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  if (selected) {
    const conversation = active.filter(item => item.clientId === selected.clientId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return <section className="admin-card admin-chat">
      <header className="admin-chat-header"><button className="secondary" type="button" onClick={onClose}>← Poruke</button><div><h2>{selected.clientName}</h2><p>{selected.clientPhone}</p></div></header>
      <div className="chat-thread">{conversation.map(message => <article className={`chat-bubble ${message.sender}`} key={message.id}>
        {message.subject && <strong>{message.subject}</strong>}<p>{message.message}</p>
        <footer><span>{formatDateTime(message.createdAt)}</span>{message.sender === 'admin' && <span className={message.clientReadAt ? 'read-receipt read' : 'read-receipt'}>{message.clientReadAt ? '✓✓ Pročitano' : '✓ Poslano'}</span>}<button type="button" disabled={busy} onClick={() => void onDelete(message)}>Obriši</button></footer>
      </article>)}</div>
      <form className="chat-composer" onSubmit={async event => { event.preventDefault(); const text = reply.trim(); if (text && !busy && await onReply(selected, text)) setReply('') }}>
        <textarea aria-label="Nova poruka" rows={2} value={reply} onChange={event => setReply(event.target.value)} placeholder="Napiši poruku…"/><button className="primary" disabled={busy || !reply.trim()} type="submit">Pošalji</button>
      </form>
    </section>
  }
  return <section className="admin-card admin-chat"><div className="panel-head"><h2>Poruke</h2><button className="primary" type="button" onClick={() => setComposing(value => !value)}>+ Nova poruka</button></div>
    {composing && <form className="new-chat-form" onSubmit={async event => { event.preventDefault(); if (newClientId && newMessage.trim() && await onNew(newClientId, newMessage.trim())) { setComposing(false); setNewMessage('') } }}>
      <label>Klijent<select required value={newClientId} onChange={event => setNewClientId(event.target.value)}><option value="">Odaberite klijenta</option>{[...clients].sort((a,b)=>`${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`,'hr')).map(client=><option value={client.id} key={client.id}>{client.firstName} {client.lastName}</option>)}</select></label>
      <label>Poruka<textarea required rows={3} value={newMessage} onChange={event=>setNewMessage(event.target.value)} placeholder="Napiši poruku…"/></label>
      <button className="primary" disabled={busy || !newClientId || !newMessage.trim()} type="submit">Pošalji</button>
    </form>}
    <div className="chat-conversation-list">
    {conversations.map(latest => { const unread = active.filter(item => item.clientId === latest.clientId && item.sender === 'client' && !item.read).length; return <button className={unread ? 'unread' : ''} type="button" key={latest.clientId} onClick={() => void onOpen(latest)}><span className="chat-avatar">{latest.clientName.slice(0, 1).toUpperCase()}</span><span className="chat-conversation-copy"><strong>{latest.clientName}</strong><small>{latest.sender === 'admin' ? 'Vi: ' : ''}{latest.message}</small></span><span className="chat-conversation-meta"><small>{formatDateTime(latest.createdAt)}</small>{unread > 0 && <b>{unread}</b>}</span></button> })}
    {!conversations.length && <p className="empty-state">Još nema poruka.</p>}
  </div></section>
}
