export type SyncStatus = 'local' | 'synced' | 'error'

export function syncStatusLabel(status: SyncStatus) {
  if (status === 'synced') return 'Sinkronizirano'
  if (status === 'error') return 'Nije sinkronizirano'
  return 'Lokalno spremljeno'
}
