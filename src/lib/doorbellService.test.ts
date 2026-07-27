import { describe, expect, it } from 'vitest'
import { MockDoorbellService } from './doorbellService'

describe('mock doorbell service', () => {
  it('keeps the dashboard independent from a real doorbell provider', async () => {
    const service = new MockDoorbellService()
    await expect(service.isOnline()).resolves.toBe(false)
    await expect(service.lastRing()).resolves.toBeNull()
    await expect(service.batteryLevel()).resolves.toBeNull()
    await expect(service.startLiveView()).resolves.toBeUndefined()
    await expect(service.openDoor()).resolves.toBeUndefined()
  })
})
