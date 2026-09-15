import { describe, expect, it } from 'vitest'
import { commandStateFromRow, confirmedStateAge, deviceStateFromRow, displayedNukiState, gatewayFromRow, gatewayIsOnline, isHardwareAction, shouldBootstrapBoilerStatusAt } from './hardwareGateway'

describe('hardware gateway contracts', () => {
  it('allows only device-specific commands', () => {
    expect(isHardwareAction('camera', 'open_live')).toBe(true)
    expect(isHardwareAction('boiler', 'on')).toBe(true)
    expect(isHardwareAction('nuki', 'unlock')).toBe(true)
    expect(isHardwareAction('nuki', 'lock')).toBe(true)
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
  it('retries boiler status bootstrap after cooldown without duplicating active work', () => {
    const now = Date.parse('2026-09-13T12:00:00Z')
    expect(shouldBootstrapBoilerStatusAt([], [], now)).toBe(true)
    expect(shouldBootstrapBoilerStatusAt([
      deviceStateFromRow({ device: 'boiler', state: 'unknown', availability: 'error' }),
    ], [], now)).toBe(true)
    expect(shouldBootstrapBoilerStatusAt([], [commandStateFromRow({ id: 'c', device: 'boiler', action: 'status', status: 'failed', requested_at: '2026-09-13T11:58:00Z' })], now)).toBe(false)
    expect(shouldBootstrapBoilerStatusAt([], [commandStateFromRow({ id: 'c', device: 'boiler', action: 'status', status: 'failed', requested_at: '2026-09-13T11:50:00Z' })], now)).toBe(true)
    expect(shouldBootstrapBoilerStatusAt([], [commandStateFromRow({ id: 'c', device: 'boiler', action: 'status', status: 'running', requested_at: '2026-09-13T11:50:00Z' })], now)).toBe(false)
  })
  it('shows only fresh confirmed Nuki state', () => {
    const now = Date.parse('2026-09-13T12:00:00Z')
    const locked = deviceStateFromRow({ device: 'nuki', state: 'locked', availability: 'available', observed_at: '2026-09-13T11:50:00Z' })
    expect(displayedNukiState(locked, now).state).toBe('locked')
    expect(displayedNukiState({ ...locked, state: 'unlocked' }, now).state).toBe('unlocked')
    expect(displayedNukiState({ ...locked, observedAt: '2026-09-13T11:40:00Z' }, now).state).toBe('unknown')
    expect(displayedNukiState({ ...locked, availability: 'stale' }, now).state).toBe('unknown')
  })
})
