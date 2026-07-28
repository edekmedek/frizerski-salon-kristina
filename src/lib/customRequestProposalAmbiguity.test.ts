import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260728_fix_custom_proposal_ambiguous_columns.sql',
  'utf8',
)

describe('RPC prijedloga bez dvosmislenih stupaca', () => {
  it('kvalificira request_id pri brisanju snapshot stavki', () => {
    expect(migration).toContain(
      'where request_service_row.request_id = locked_request.id',
    )
    expect(migration).not.toMatch(/\bwhere\s+request_id\s*=/i)
  })

  it('kvalificira identifikatore i statusne stupce u čitanju i ažuriranju', () => {
    expect(migration).toContain('where request_row.id = target_request_id')
    expect(migration).toContain('where client_row.id = locked_request.client_id')
    expect(migration).toContain('where request_row.id = locked_request.id')
    expect(migration).toContain(
      'admin_read_at = coalesce(request_row.admin_read_at, now())',
    )
  })

  it('zadržava isti potpis, administratorsku provjeru i atomsku transakciju', () => {
    expect(migration).toContain(
      'create or replace function public.admin_create_custom_proposal_for_client_request',
    )
    expect(migration).toContain('not public.is_admin()')
    expect(migration.trimStart()).toMatch(/^begin;/)
    expect(migration.trimEnd()).toMatch(/commit;$/)
  })
})
