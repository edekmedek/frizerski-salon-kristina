import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260728_legacy_client_request_admin_actions.sql',
  'utf8',
)

describe('administratorske akcije nad legacy zahtjevima', () => {
  it('omogućuje administratoru precizno brisanje jednog zahtjeva', () => {
    expect(migration).toContain('create or replace function public.admin_delete_client_request')
    expect(migration).toContain('where id = target_request_id')
    expect(migration).toContain('not public.is_admin()')
    expect(migration).toContain('grant execute on function public.admin_delete_client_request(uuid)')
  })

  it('ne sadrži široko ili destruktivno čišćenje podataka', () => {
    expect(migration).not.toMatch(/truncate|drop table|delete\s+from\s+public\.client_requests\s*;/i)
  })
})
