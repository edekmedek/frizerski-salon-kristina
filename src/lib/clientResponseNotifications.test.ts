/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20260806_client_response_admin_unread.sql'), 'utf8')
const adminSource = readFileSync(join(process.cwd(), 'src', 'AdminApp.tsx'), 'utf8')
const clientSource = readFileSync(join(process.cwd(), 'src', 'ClientPortal.tsx'), 'utf8')

describe('obavijesti o odgovoru na prijedlog termina', () => {
  it('potvrdu i zahtjev za promjenu ponovno označava nepročitanima za admina', () => {
    expect(migration).toContain('new.admin_read_at := null')
    expect(migration).toContain('new.client_reply is distinct from old.client_reply')
    expect(migration).toContain('client.user_id = auth.uid()')
  })

  it('admin prati promjenu verzije postojećeg zahtjeva i uključuje app badge', () => {
    expect(adminSource).toContain('hasNewUnreadAdminRequest')
    expect(adminSource).toContain('updateAppBadge')
    expect(adminSource).toContain('appointment-proposal-')
  })

  it('klijent dobiva zvuk i badge za ažurirani prijedlog, ne samo novu poruku', () => {
    expect(clientSource).toContain('hasNewProposal')
    expect(clientSource).toContain("item.status === 'in_review'")
    expect(clientSource).toContain('playNewMessageSound()')
  })
})
