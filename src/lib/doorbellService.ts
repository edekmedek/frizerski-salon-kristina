export interface DoorbellService {
  isOnline(): Promise<boolean>
  lastRing(): Promise<Date | null>
  batteryLevel(): Promise<number | null>
  startLiveView(): Promise<void>
  openDoor(): Promise<void>
}

export class MockDoorbellService implements DoorbellService {
  async isOnline() { return false }
  async lastRing() { return null }
  async batteryLevel() { return null }
  async startLiveView() { return undefined }
  async openDoor() { return undefined }
}

export const doorbellService: DoorbellService = new MockDoorbellService()
