import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

export type HardwareDevice = 'camera' | 'boiler' | 'nuki'
export type HardwareAction = 'open_live' | 'status' | 'on' | 'off' | 'lock' | 'unlock'
export type HardwareAvailability = 'available' | 'stale' | 'offline' | 'error'
export type HardwareGateway = { id: string; name: string; enabled: boolean; lastSeenAt: string | null }
export type HardwareDeviceState = {
  device: HardwareDevice; state: string; availability: HardwareAvailability
  observedAt: string | null; checkedAt: string | null; detail: string
}
export type HardwareCommandState = {
  id: string; device: HardwareDevice; action: HardwareAction; status: string
  resultCode: string; resultDetail: string; requestedAt: string
}
export type HardwareRealtimeChange = { table: 'hardware_gateways' | 'hardware_device_states' | 'hardware_commands'; row: Record<string, unknown> }

const ACTIONS: Record<HardwareDevice, readonly HardwareAction[]> = {
  camera: ['open_live'], boiler: ['status', 'on', 'off'], nuki: ['lock', 'unlock'],
}

export function isHardwareAction(device: HardwareDevice, action: string): action is HardwareAction {
  return ACTIONS[device].includes(action as HardwareAction)
}

export function gatewayIsOnline(gateway: HardwareGateway | null, now = Date.now()) {
  if (!gateway?.enabled || !gateway.lastSeenAt) return false
  return now - Date.parse(gateway.lastSeenAt) < 150_000
}

export function confirmedStateAge(observedAt: string | null, now = Date.now()) {
  if (!observedAt) return null
  const age = now - Date.parse(observedAt)
  return Number.isFinite(age) && age >= 0 ? age : null
}

export function shouldBootstrapBoilerStatus(states: HardwareDeviceState[], commands: HardwareCommandState[]) {
  return !states.some(item => item.device === 'boiler')
    && !commands.some(item => item.device === 'boiler')
}

export function gatewayFromRow(row: Record<string, unknown>): HardwareGateway {
  return { id: String(row.id), name: String(row.name), enabled: row.enabled === true,
    lastSeenAt: typeof row.last_seen_at === 'string' ? row.last_seen_at : null }
}

export function deviceStateFromRow(row: Record<string, unknown>): HardwareDeviceState {
  return { device: row.device as HardwareDevice, state: String(row.state),
    availability: row.availability as HardwareAvailability,
    observedAt: typeof row.observed_at === 'string' ? row.observed_at : null,
    checkedAt: typeof row.checked_at === 'string' ? row.checked_at : null,
    detail: typeof row.detail === 'string' ? row.detail : '' }
}

export function commandStateFromRow(row: Record<string, unknown>): HardwareCommandState {
  return { id: String(row.id), device: row.device as HardwareDevice, action: row.action as HardwareAction,
    status: String(row.status), resultCode: typeof row.result_code === 'string' ? row.result_code : '',
    resultDetail: typeof row.result_detail === 'string' ? row.result_detail : '', requestedAt: String(row.requested_at) }
}

export async function loadHardwareGateway(client: SupabaseClient) {
  const gatewayResult = await client.from('hardware_gateways')
    .select('id,name,enabled,last_seen_at').eq('enabled', true).order('created_at').limit(1).maybeSingle()
  if (gatewayResult.error) throw gatewayResult.error
  if (!gatewayResult.data) return { gateway: null, states: [] as HardwareDeviceState[], commands: [] as HardwareCommandState[] }
  const [stateResult, commandResult] = await Promise.all([
    client.from('hardware_device_states').select('device,state,availability,observed_at,checked_at,detail').eq('gateway_id', gatewayResult.data.id),
    client.from('hardware_commands').select('id,device,action,status,result_code,result_detail,requested_at')
      .eq('gateway_id', gatewayResult.data.id).order('requested_at', { ascending: false }).limit(20),
  ])
  if (stateResult.error) throw stateResult.error
  if (commandResult.error) throw commandResult.error
  return {
    gateway: gatewayFromRow(gatewayResult.data),
    states: (stateResult.data ?? []).map(deviceStateFromRow),
    commands: (commandResult.data ?? []).map(commandStateFromRow),
  }
}

export async function enqueueHardwareCommand(client: SupabaseClient, gatewayId: string,
  device: HardwareDevice, action: HardwareAction) {
  if (!isHardwareAction(device, action)) throw new Error('Nepodržana hardverska naredba.')
  const { data, error } = await client.rpc('admin_enqueue_hardware_command', {
    target_gateway_id: gatewayId, target_device: device, target_action: action,
    request_id: crypto.randomUUID(),
  })
  if (error) throw error
  return data as unknown
}

export function subscribeToHardware(client: SupabaseClient, gatewayId: string,
  onChange: (change: HardwareRealtimeChange) => void): RealtimeChannel {
  return client.channel(`hardware-${gatewayId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hardware_gateways', filter: `id=eq.${gatewayId}` },
      payload => onChange({ table: 'hardware_gateways', row: payload.new }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hardware_device_states', filter: `gateway_id=eq.${gatewayId}` },
      payload => onChange({ table: 'hardware_device_states', row: payload.new }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hardware_commands', filter: `gateway_id=eq.${gatewayId}` },
      payload => onChange({ table: 'hardware_commands', row: payload.new }))
    .subscribe()
}
