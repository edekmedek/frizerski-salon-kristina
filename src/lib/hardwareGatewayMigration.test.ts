import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20260908_hardware_gateway.sql', 'utf8')

describe('hardware gateway migration security and confirmed-state rules', () => {
  it('requires admin authorization and restricts device/action pairs', () => {
    expect(sql).toContain('not public.is_admin()')
    expect(sql).toContain("device = 'camera' and action = 'open_live'")
    expect(sql).toContain("device = 'nuki' and action in ('lock', 'unlock')")
  })
  it('keeps the previous confirmed state after an unsuccessful observation', () => {
    expect(sql).toContain('state = coalesce(published_state, public.hardware_device_states.state)')
    expect(sql).toContain('observed_at = coalesce(published_observed_at, public.hardware_device_states.observed_at)')
  })
  it('does not grant hardware table writes to authenticated browser users', () => {
    expect(sql).toContain('revoke all on public.hardware_commands from anon, authenticated')
    expect(sql).not.toContain('grant insert on public.hardware_commands to authenticated')
  })
  it('keeps requests idempotent and allows only one active command per device', () => {
    expect(sql).toContain('unique (requested_by, client_request_id)')
    expect(sql).toContain('hardware_commands_one_active_device_idx')
    expect(sql).toContain('on conflict (requested_by, client_request_id) do nothing')
  })
})
