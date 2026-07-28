// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminMessageInbox, AdminRequestInbox } from './AdminInboxViews'
import type { AdminMessage, AdminRequest } from './lib/adminInbox'

afterEach(cleanup)

const request: AdminRequest = {
  id: '4ef9f20a-603d-4c8d-955e-91ed2f67d946',
  clientId: 'client-1',
  clientName: 'TEST Klijent PIN Provjera',
  clientPhone: '0999302468',
  kind: 'appointment',
  treatments: [],
  service: 'Svečana frizura duga kosa',
  preferredDates: ['2026-07-27'],
  dayPeriod: 'any',
  message: 'Molim termin poslije posla.',
  status: 'pending',
  adminReply: '',
  createdAt: '2026-07-25T10:00:00Z',
  updatedAt: '2026-07-25T10:00:00Z',
}

const message: AdminMessage = {
  id: 'message-1',
  clientId: 'client-1',
  clientName: 'TEST Klijent PIN Provjera',
  clientPhone: '0999302468',
  sender: 'client',
  subject: 'Pitanje o terminu',
  message: 'Ovo je cijeli sadržaj poruke.',
  read: false,
  createdAt: '2026-07-25T11:00:00Z',
}

describe('administratorski zahtjevi', () => {
  it('otvara postojeći zahtjev tek pozivom trajne Supabase akcije', () => {
    const onOpen = vi.fn().mockResolvedValue(undefined)
    render(<AdminRequestInbox requests={[request]} busy={false} onOpen={onOpen} onAccept={vi.fn()} onRespond={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Novo')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /TEST Klijent/ }))
    expect(onOpen).toHaveBeenCalledWith(request)
  })

  it('prikazuje puni sadržaj te prihvaćanje i drugi prijedlog', async () => {
    const onAccept = vi.fn()
    const onRespond = vi.fn().mockResolvedValue(true)
    render(<AdminRequestInbox requests={[request]} selected={request} busy={false} onOpen={vi.fn()} onAccept={onAccept} onRespond={onRespond} onClose={vi.fn()} />)
    expect(screen.getByText('Molim termin poslije posla.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Prihvati i odaberi termin' }))
    expect(onAccept).toHaveBeenCalledWith(request)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Mogu 29. 7. u 15:30.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pošalji drugi prijedlog' }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith(request, 'in_review', 'Mogu 29. 7. u 15:30.'))
  })
})

describe('administratorske poruke', () => {
  it('otvara poruku i prikazuje naslov i cijeli sadržaj', () => {
    render(<AdminMessageInbox messages={[message]} selected={message} showArchive={false} busy={false} onToggleArchive={vi.fn()} onOpen={vi.fn()} onReply={vi.fn()} onArchive={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Pitanje o terminu' })).toBeInTheDocument()
    expect(screen.getByText('Ovo je cijeli sadržaj poruke.')).toBeInTheDocument()
  })

  it('šalje odgovor, arhivira i trajno briše samo kroz predane Supabase akcije', async () => {
    const onReply = vi.fn().mockResolvedValue(true)
    const onArchive = vi.fn().mockResolvedValue(true)
    const onDelete = vi.fn().mockResolvedValue(true)
    const { rerender } = render(<AdminMessageInbox messages={[message]} selected={message} showArchive={false} busy={false} onToggleArchive={vi.fn()} onOpen={vi.fn()} onReply={onReply} onArchive={onArchive} onDelete={onDelete} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Odgovor iz salona.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pošalji odgovor' }))
    await waitFor(() => expect(onReply).toHaveBeenCalledWith(message, 'Odgovor iz salona.'))
    fireEvent.click(screen.getByRole('button', { name: 'Arhiviraj' }))
    expect(onArchive).toHaveBeenCalledWith(message)

    const archived = { ...message, archivedAt: '2026-07-25T12:00:00Z' }
    rerender(<AdminMessageInbox messages={[archived]} selected={archived} showArchive busy={false} onToggleArchive={vi.fn()} onOpen={vi.fn()} onReply={onReply} onArchive={onArchive} onDelete={onDelete} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Trajno obriši' }))
    expect(onDelete).toHaveBeenCalledWith(archived)
  })
})
