import { describe, expect, it } from 'vitest'
import { commandStateFromRow, confirmedStateAge, deviceStateFromRow, gatewayFromRow, gatewayIsOnline, isHardwareAction, shouldBootstrapBoilerStatus } from './hardwareGateway'

describe('hardware gateway contracts', () => {
  it('allows only device-specific commands', () => {
    expect(isHardwareAction('camera', 'open_live')).toBe(true)
    expect(isHardwareAction('boiler', 'on')).toBe(true)
    expect(isHardwareAction('nuki', 'unlock')).toBe(true)
    expect(isHardwareAction('camera', 'unlock')).toBe(false)
    expect(isHardwareAction('nuki', 'on')).toBe(false)
  })
  it('allows two missed 60-second heartbeats before marking the gateway offline', () => {
    const gateway = { id: '1', name: 'Tablet', enabled: true, lastSeenAt: '2026-09-08T10:00:00Z' }
    expect(gatewayIsOnline(gateway, Date.parse('2026-09-08T10:02:29Z'))).toBe(true)
    expect(gatewayIsOnline(gateway, Date.parse('2026-09-08T10:02:30Z'))).toBe(false)
  })
  it('keeps confirmed observation age separate from availability', () => {
    expect(confirmedStateAge('2026-09-08T10:00:00Z', Date.parse('2026-09-08T10:03:00Z'))).toBe(180_000)
    expect(confirmedStateAge(null)).toBeNull()
  })
  it('maps Realtime rows without requiring a database refetch', () => {
    expect(gatewayFromRow({ id: 'g', name: 'Tablet', enabled: true, last_seen_at: '2026-09-08T10:00:00Z' }).id).toBe('g')
    expect(deviceStateFromRow({ device: 'boiler', state: 'on', availability: 'stale', observed_at: '2026-09-08T09:57:00Z' }).state).toBe('on')
    expect(commandStateFromRow({ id: 'c', device: 'nuki', action: 'unlock', status: 'queued', requested_at: '2026-09-08T10:00:00Z' }).status).toBe('queued')
  })
  it('bootstraps boiler status only before any shared state or command exists', () => {
    expect(shouldBootstrapBoilerStatus([], [])).toBe(true)
    expect(shouldBootstrapBoilerStatus([
      deviceStateFromRow({ device: 'boiler', state: 'unknown', availability: 'error' }),
    ], [])).toBe(false)
    expect(shouldBootstrapBoilerStatus([], [
      commandStateFromRow({ id: 'c', device: 'boiler', action: 'status', status: 'failed', requested_at: '2026-09-08T10:00:00Z' }),
    ])).toBe(false)
  })
})
