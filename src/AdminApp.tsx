import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import './ClientPicker.css'
import './TimePicker.css'
import './ServiceSelect.css'
import './Mobile.css'
import { ClientPhotoInput } from './ClientPhotoInput'
import { AdminPinInput } from './AdminPinInput'
import { AdminRequestInbox } from './AdminInboxViews'
import { AdminChatView } from './AdminChatView'
import { SalonDashboard } from './SalonDashboard'
import type { Appointment, Client, HairstyleArchiveEntry, SalonData, Service, ServiceCategory } from './types'
import { compressImageToAsset } from './lib/image'
import { formatDate, formatDateTime } from './lib/date'
import { addHairstyle, findClientName, loadSalonData, markMessageRead, saveSalonData, uid, upsertAppointment, upsertClient } from './lib/storage'
import type { PortalData } from './portalTypes'
import { loadPortalData, savePortalData } from './lib/portalStorage'
import { replaceAppointmentReminders } from './lib/reminders'
import { appointmentServices, appointmentStatusLabel, orderedCategories, orderedServices } from './lib/serviceRules'
import { calendarEventLayout, calendarOverlapDepth, calendarTimeMarks, calendarWorkingHours, calendarWorkingHoursLabel, timeFromCalendarPosition } from './lib/dayCalendar'
import { calendarDateAfterMove, canOpenMainCalendarDate, isArchivedAppointment } from './lib/calendarAccess'
import { createEmptyAdminPinFields, isValidAdminPin, isValidCurrentAdminPin } from './lib/adminPin'
import { addTreatmentPreservingOverrides, appointmentTreatmentLabel, finalAppointmentPrice, normalizeAppointmentTreatmentTotals, removeTreatmentPreservingOverrides, treatmentTotals } from './lib/appointmentTreatments'
import { isValidAppointmentDuration } from './lib/appointmentDuration'
import { addRequestTreatment, initialRequestTreatmentDraft, removeRequestTreatment, requestTreatmentDuration, updateRequestTreatmentDuration } from './lib/requestTreatmentDraft'
import { syncStatusLabel, type SyncStatus } from './lib/syncStatus'
import { adminInboxCounts, adminRequestNotificationVersion, hasNewUnreadAdminRequest, mapAdminMessages, mapAdminRequests, type AdminMessage, type AdminRequest } from './lib/adminInbox'
import { mapSupabaseAppointments, type SupabaseAppointmentRow, type SupabaseAppointmentServiceRow } from './lib/adminAppointmentSync'
import { updateAppBadge } from './lib/appBadge'
import { useAutoDismissNotice } from './lib/useAutoDismissNotice'
import { parseClientPushResult, savedMessagePushNotice, type ClientPushOutcome } from './lib/clientPush'
import { startSupabaseRefreshLoop, trackSupabaseCall } from './lib/supabaseTrafficGuard'
import { supabase } from './lib/supabase'
import { createTreatmentArchive, deleteTreatmentPhoto, loadTreatmentArchives, replaceTreatmentPhoto, type PendingTreatmentPhoto, type TreatmentPhotoSet } from './lib/treatmentPhotoArchive'
import { doorbellService } from './lib/doorbellService'
import { COMPANION_UNAVAILABLE_MESSAGE, isSupportedSalonTablet, openSalonDoorCompanion } from './lib/tapoApp'
import { claimAutomaticBoilerStatus, consumeAutomaticBoilerRetry, consumeBoilerResult, consumeBoilerResumeSignal, readCachedBoilerState, requestBoilerCommand, supportsAutomaticBoilerStatus, type BoilerCommand, type BoilerState } from './lib/boilerApp'
import { isTabletViewport } from './lib/tablet'
import './Portal.css'
import './AdminPortal.css'

type View = 'salon-dashboard' | 'pregled' | 'klijenti' | 'cjenik' | 'zahtjevi' | 'poruke' | 'zahtjevi-live' | 'poruke-live' | 'arhiva' | 'postavke' | 'arhiva-termina'
const currentUserRole: 'administrator' | 'client' = 'administrator'
const nav: { id: View; label: string; icon: string }[] = [
  { id: 'salon-dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'pregled', label: 'Raspored', icon: '⌂' }, { id: 'klijenti', label: 'Klijenti', icon: '♡' },
  { id: 'zahtjevi-live', label: 'Zahtjevi', icon: '◇' },
  { id: 'cjenik', label: 'Cjenik', icon: '€' }, { id: 'poruke-live', label: 'Poruke', icon: '✉' }, { id: 'arhiva', label: 'Arhiva', icon: '▧' },
  { id: 'postavke', label: 'Postavke', icon: '⚙' },
]
type AdminIdentity = { mark: string; name: string; title: string }

function initialsFromName(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'A'
  const initials = words.slice(0, 2).map(word => word[0]?.toUpperCase() ?? '').join('')
  return initials || 'A'
}

function resolveAdminIdentity(emailValue: string, fullName: string): AdminIdentity {
  const email = emailValue.trim().toLowerCase()
  if (email.startsWith('edekmedek@') || email.includes('edekmedek')) {
    return { mark: 'E', name: 'Eduard Admin', title: 'Administrator' }
  }
  if (email.startsWith('kristina@') || email.includes('kristina')) {
    return { mark: 'K', name: 'Kristina', title: 'Vlasnica salona' }
  }
  const normalizedName = fullName.trim()
  if (normalizedName) {
    return { mark: initialsFromName(normalizedName), name: normalizedName, title: 'Administrator' }
  }
  const fallbackName = email.includes('@') ? email.split('@')[0] : 'Admin'
  const prettyName = fallbackName
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
  return { mark: initialsFromName(prettyName), name: prettyName, title: 'Administrator' }
}

const emptyClient = (): Client => ({ id: '', firstName: '', lastName: '', phone: '', note: '', createdAt: '', updatedAt: '' })
const timeOptions = Array.from({ length: 49 }, (_, index) => {
  const minutes = 8 * 60 + index * 15
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})
const durationDefaults = [
  { name: 'Žensko šišanje', totalDuration: 45, activeDuration: 45, waitingPhases: [] },
  { name: 'Muško šišanje', totalDuration: 30, activeDuration: 30, waitingPhases: [] },
  { name: 'Feniranje', totalDuration: 45, activeDuration: 45, waitingPhases: [] },
  { name: 'Bojanje', totalDuration: 120, activeDuration: 75, waitingPhases: [{ startOffset: 30, duration: 45 }] },
  { name: 'Pramenovi', totalDuration: 180, activeDuration: 90, waitingPhases: [{ startOffset: 45, duration: 90 }] },
  { name: 'Svečana frizura', totalDuration: 90, activeDuration: 90, waitingPhases: [] },
] as const
function serviceDefinition(service:string){
  const configured=durationDefaults.find(item=>item.name===service)
  if(configured)return configured
  const value=service.toLocaleLowerCase('hr')
  const totalDuration=value.includes('pramen')?180:value.includes('boj')?120:value.includes('sveč')||value.includes('punđ')?90:value.includes('tonir')||value.includes('fen')?75:60
  return{name:service,totalDuration,activeDuration:totalDuration,waitingPhases:[]}
}
function timeToMinutes(time:string){const [hours,minutes]=time.split(':').map(Number);return hours*60+minutes}
function minutesToTime(minutes:number){return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`}
function activeSegments(start:number,service:string,totalDurationOverride?:number){
  const definition=serviceDefinition(service)
  const totalDuration=totalDurationOverride&&totalDurationOverride>0?totalDurationOverride:definition.totalDuration
  const waits=[...definition.waitingPhases]
    .filter(wait=>wait.startOffset<totalDuration)
    .map(wait=>({...wait,duration:Math.min(wait.duration,totalDuration-wait.startOffset)}))
    .sort((a,b)=>a.startOffset-b.startOffset)
  const segments:{start:number;end:number}[]=[]
  let cursor=0
  waits.forEach(wait=>{if(wait.startOffset>cursor)segments.push({start:start+cursor,end:start+wait.startOffset});cursor=Math.max(cursor,wait.startOffset+wait.duration)})
  if(cursor<totalDuration)segments.push({start:start+cursor,end:start+totalDuration})
  return segments
}
// eslint-disable-next-line react-refresh/only-export-components
export function conflictingAppointments(date:string,time:string,service:string,appointments:Appointment[],editingId='',candidateDuration?:number){
  const candidate=activeSegments(timeToMinutes(time),service,candidateDuration)
  return appointments.filter(item=>{
    if(item.id===editingId||item.status==='otkazan'||item.dateTime.slice(0,10)!==date)return false
    const occupied=activeSegments(timeToMinutes(item.dateTime.slice(11,16)),item.service,item.serviceDuration)
    return candidate.some(a=>occupied.some(b=>a.start<b.end&&a.end>b.start))
  })
}
function isTimeUnavailable(date:string,time:string,service:string,appointments:Appointment[],editingId='',candidateDuration?:number){
  return conflictingAppointments(date,time,service,appointments,editingId,candidateDuration).length>0
}
function localDateString(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function firstAvailableTime(date:string,service:string,appointments:Appointment[],editingId='',futureOnly=false){
  const now=new Date(),today=localDateString(now),nextQuarter=Math.ceil((now.getHours()*60+now.getMinutes())/15)*15
  return timeOptions.find(time=>(!futureOnly||date!==today||timeToMinutes(time)>=nextQuarter)&&!isTimeUnavailable(date,time,service,appointments,editingId))||''
}
function emptyAppointment(appointments:Appointment[]):Appointment{
  const today=new Date()
  for(let offset=0;offset<14;offset+=1){
    const date=new Date(today);date.setDate(today.getDate()+offset);const dateValue=localDateString(date)
    const time=firstAvailableTime(dateValue,'',appointments,'',offset===0)
    if(time)return{id:'',clientId:'',dateTime:`${dateValue}T${time}`,service:'',treatments:[],servicePrice:0,serviceDuration:0,status:'zakazan',note:'',assignedBy:'Kristina',createdAt:'',updatedAt:''}
  }
  return{id:'',clientId:'',dateTime:'',service:'',treatments:[],servicePrice:0,serviceDuration:0,status:'zakazan',note:'',assignedBy:'Kristina',createdAt:'',updatedAt:''}
}

function AdminApp({ onLogout }: { onLogout: () => void }) {
  const initialAdminPinFields = createEmptyAdminPinFields()
  const [initialBoilerResult] = useState(() => consumeBoilerResult())
  const [initialBoilerResume] = useState(() => consumeBoilerResumeSignal())
  const [boilerState, setBoilerState] = useState<BoilerState>(() => {
    const result = initialBoilerResult?.result
    return result === 'on' || result === 'off' ? result : readCachedBoilerState()
  })
  const [boilerBusy, setBoilerBusy] = useState(false)
  const [boilerOperation, setBoilerOperation] = useState<BoilerCommand>('status')
  const [data, setData] = useState<SalonData>(() => loadSalonData())
  const [view, setView] = useState<View>(() => isTabletViewport() ? 'salon-dashboard' : 'pregled')
  const [query, setQuery] = useState('')
  const [clientForm, setClientForm] = useState<Client | null>(null)
  const [appointmentForm, setAppointmentForm] = useState<Appointment | null>(null)
  const [appointmentDetails, setAppointmentDetails] = useState<Appointment | null>(null)
  const [rescheduleDraft, setRescheduleDraft] = useState<Appointment | null>(null)
  const [cancellationTarget, setCancellationTarget] = useState<Appointment | null>(null)
  const [cancellationReason, setCancellationReason] = useState('')
  const [appointmentActionBusy, setAppointmentActionBusy] = useState(false)
  const [movingAppointment, setMovingAppointment] = useState<Appointment | null>(null)
  const [appointmentPlaced, setAppointmentPlaced] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [treatmentArchives, setTreatmentArchives] = useState<TreatmentPhotoSet[]>([])
  const [archiveFiles, setArchiveFiles] = useState<PendingTreatmentPhoto[]>([])
  const [archiveProgress, setArchiveProgress] = useState('')
  const [archiveSaving, setArchiveSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [isSavingClient, setIsSavingClient] = useState(false)
  const [portal, setPortal] = useState<PortalData>(() => loadPortalData())
  const [sourceRequestId, setSourceRequestId] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [pinClientId, setPinClientId] = useState('')
  const [temporaryPin, setTemporaryPin] = useState('')
  const [newClientPin, setNewClientPin] = useState('')
  const [deleteClientTarget, setDeleteClientTarget] = useState<Client | null>(null)
  const [deleteClientPin, setDeleteClientPin] = useState('')
  const [deleteClientError, setDeleteClientError] = useState('')
  const [pinError, setPinError] = useState('')
  const [issuedTemporaryPin, setIssuedTemporaryPin] = useState<{ clientId: string; pin: string } | null>(null)
  const [portalStatuses, setPortalStatuses] = useState<Record<string, { activated: boolean; temporary: boolean; currentPin?: string }>>({})
  const [serviceCatalog, setServiceCatalog] = useState<Service[]>([])
  const [serviceForm, setServiceForm] = useState<Service | null>(null)
  const [categoryCatalog, setCategoryCatalog] = useState<ServiceCategory[]>([])
  const [categoryForm, setCategoryForm] = useState<ServiceCategory | null>(null)
  const [openPriceCategoryId, setOpenPriceCategoryId] = useState('')
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => localDateString(new Date()))
  const [appointmentArchiveUnlocked, setAppointmentArchiveUnlocked] = useState(false)
  const [adminPinSet, setAdminPinSet] = useState<boolean | null>(null)
  const [adminPinDialog, setAdminPinDialog] = useState<'unlock' | 'setup' | 'change' | null>(null)
  const [adminPinPurpose, setAdminPinPurpose] = useState<'archive' | 'settings'>('settings')
  const [adminPin, setAdminPin] = useState(initialAdminPinFields.next)
  const [currentAdminPin, setCurrentAdminPin] = useState(initialAdminPinFields.current)
  const [adminPinConfirm, setAdminPinConfirm] = useState(initialAdminPinFields.confirmation)
  const [adminPinError, setAdminPinError] = useState('')
  const [adminPinBusy, setAdminPinBusy] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(supabase ? 'synced' : 'local')
  const [adminRequests, setAdminRequests] = useState<AdminRequest[]>([])
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([])
  const [selectedAdminRequest, setSelectedAdminRequest] = useState<AdminRequest>()
  const [requestDraftTime, setRequestDraftTime] = useState('')
  const [requestDurationOverride, setRequestDurationOverride] = useState<number>()
  const [selectedAdminMessage, setSelectedAdminMessage] = useState<AdminMessage>()
  const [inboxBusy, setInboxBusy] = useState(false)
  const [adminIdentity, setAdminIdentity] = useState<AdminIdentity>({ mark: 'A', name: 'Admin', title: 'Administrator' })
  const requestDraftDayChangeRef = useRef(0)
  const requestDraftRef = useRef<HTMLDivElement>(null)
  const requestNeedsScrollRef = useRef(false)
  const knownAdminRequestVersionsRef = useRef<Map<string, string>>(new Map())
  const knownAdminMessageIdsRef = useRef<Set<string>>(new Set())
  const adminInboxInitializedRef = useRef(false)
  const appointmentClickTimerRef = useRef<number | null>(null)
  const appointmentClickTargetRef = useRef('')
  const clientSavingRef = useRef(false)
  const imageFiles = useRef<{ before?: File; after?: File }>({})
  const previousNoChargeRef = useRef(false)
  const priceBeforeNoChargeRef = useRef<{ appointmentId: string; price: number; manual: boolean } | null>(null)
  const boilerBusyRef = useRef(false)
  useAutoDismissNotice(notice, setNotice)

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active || error || !data.user) return
      const metadataName = typeof data.user.user_metadata?.full_name === 'string'
        ? data.user.user_metadata.full_name
        : typeof data.user.user_metadata?.name === 'string'
          ? data.user.user_metadata.name
          : ''
      const identity = resolveAdminIdentity(data.user.email ?? '', metadataName)
      setAdminIdentity(identity)
    })
    return () => { active = false }
  }, [])

  useEffect(() => () => {
    if (appointmentClickTimerRef.current !== null) {
      window.clearTimeout(appointmentClickTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    loadTreatmentArchives(supabase)
      .then(items => { if (active) setTreatmentArchives(items) })
      .catch(error => { if (active) setNotice(error instanceof Error ? error.message : 'Arhivu nije moguće učitati.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!appointmentForm) {
      previousNoChargeRef.current = false
      priceBeforeNoChargeRef.current = null
      return
    }

    const totals = treatmentTotals(appointmentForm.treatments ?? [])
    if (appointmentForm.noCharge) {
      previousNoChargeRef.current = true
      return
    }

    if (previousNoChargeRef.current) {
      const saved = priceBeforeNoChargeRef.current
      const restoredPrice = saved?.appointmentId === appointmentForm.id && saved.manual
        ? saved.price
        : totals.price
      previousNoChargeRef.current = false
      priceBeforeNoChargeRef.current = null
      if (appointmentForm.servicePrice !== restoredPrice) {
        setAppointmentForm({ ...appointmentForm, servicePrice: restoredPrice, priceWasManuallyAdjusted: saved?.manual === true })
        return
      }
    }

    const normalized = normalizeAppointmentTreatmentTotals(appointmentForm)
    if (normalized.servicePrice !== appointmentForm.servicePrice
      || normalized.serviceDuration !== appointmentForm.serviceDuration
      || normalized.priceWasManuallyAdjusted !== appointmentForm.priceWasManuallyAdjusted) {
      setAppointmentForm(normalized)
      return
    }

    priceBeforeNoChargeRef.current = {
      appointmentId: appointmentForm.id,
      price: appointmentForm.servicePrice ?? totals.price,
      manual: appointmentForm.priceWasManuallyAdjusted === true,
    }
  }, [appointmentForm])
  useEffect(() => {
    if (!appointmentForm) return
    const durationInput = [...document.querySelectorAll<HTMLInputElement>('.modal input[type="number"]')]
      .find(input => input.closest('label')?.textContent?.includes('Ukupno trajanje'))
    durationInput?.setAttribute('min', '15')
    durationInput?.setAttribute('step', '15')
  }, [appointmentForm])
  function update(next: SalonData, message?: string) { setData(next); saveSalonData(next); if (message) setNotice(message) }
  function changeView(next: View) {
    if (next === 'poruke') next = 'poruke-live'
    if (next === 'zahtjevi') next = 'zahtjevi-live'
    if (next === 'cjenik') setOpenPriceCategoryId('')
    if (next === 'poruke-live') setSelectedAdminMessage(undefined)
    if (next === 'zahtjevi-live') setSelectedAdminRequest(undefined)
    setView(next)
  }
  function openVideoDoorbell() {
    openSalonDoorCompanion({
      onUnavailable: () => setNotice(COMPANION_UNAVAILABLE_MESSAGE),
    })
  }
  function showDoorLockUnavailable() {
    setNotice('Brava još nije povezana.')
  }
  function runBoilerCommand(command: BoilerCommand) {
    if (boilerBusyRef.current) return
    boilerBusyRef.current = true
    setBoilerBusy(true)
    setBoilerOperation(command)
    setBoilerState('unknown')
    requestBoilerCommand(command)
  }

  useEffect(() => { boilerBusyRef.current = boilerBusy }, [boilerBusy])

  useEffect(() => {
    if (!supportsAutomaticBoilerStatus()) return
    let debounceTimer = 0
    const scheduleStatus = () => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(debounceTimer)
      debounceTimer = window.setTimeout(() => {
        if (boilerBusyRef.current || !claimAutomaticBoilerStatus()) return
        runBoilerCommand('status')
      }, 600)
    }
    window.addEventListener('focus', scheduleStatus)
    window.addEventListener('pageshow', scheduleStatus)
    document.addEventListener('visibilitychange', scheduleStatus)
    return () => {
      window.clearTimeout(debounceTimer)
      window.removeEventListener('focus', scheduleStatus)
      window.removeEventListener('pageshow', scheduleStatus)
      document.removeEventListener('visibilitychange', scheduleStatus)
    }
  }, [])

  useEffect(() => {
    if (!initialBoilerResult || !supportsAutomaticBoilerStatus()
      || !consumeAutomaticBoilerRetry(initialBoilerResult.result)) return
    const retryTimer = window.setTimeout(() => {
      if (!boilerBusyRef.current) runBoilerCommand('status')
    }, 1_500)
    return () => window.clearTimeout(retryTimer)
  }, [initialBoilerResult])

  useEffect(() => {
    if (!initialBoilerResume || !supportsAutomaticBoilerStatus()) return
    const resumeTimer = window.setTimeout(() => {
      if (!boilerBusyRef.current && claimAutomaticBoilerStatus()) runBoilerCommand('status')
    }, 600)
    return () => window.clearTimeout(resumeTimer)
  }, [initialBoilerResume])
  const filteredClients = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('hr')
    return data.clients
      .filter(client => !term || `${client.firstName} ${client.lastName} ${client.phone}`.toLocaleLowerCase('hr').includes(term))
      .sort((left, right) => left.lastName.localeCompare(right.lastName, 'hr', { sensitivity: 'base' })
        || left.firstName.localeCompare(right.firstName, 'hr', { sensitivity: 'base' }))
  }, [data.clients, query])
  const calendarAppointments = data.appointments
    .filter(item => item.status !== 'otkazan' && item.dateTime.slice(0, 10) === selectedCalendarDate)
    .sort((left, right) => left.dateTime.localeCompare(right.dateTime))
  const calendarMarks = useMemo(() => calendarTimeMarks(), [])
  const workingHours = useMemo(() => calendarWorkingHours(selectedCalendarDate), [selectedCalendarDate])
  const workingHoursLabel = useMemo(() => calendarWorkingHoursLabel(selectedCalendarDate), [selectedCalendarDate])
  const openRequests = portal.requests.filter(item => item.status === 'novo' || item.status === 'u_razgovoru')

  function updatePortal(next: PortalData) { setPortal(next); savePortalData(next) }
  async function sendClientPush(clientId: string, tag = 'salon-kristina-message'): Promise<ClientPushOutcome> {
    if (!supabase) return { status: 'failed' }
    const { data: pushResult, error: pushError } = await supabase.functions.invoke('send-web-push', {
      body: { clientId, tag },
    })
    return parseClientPushResult(pushResult, Boolean(pushError))
  }
  function resetAdminPinFields() {
    const empty = createEmptyAdminPinFields()
    setAdminPin(empty.next)
    setCurrentAdminPin(empty.current)
    setAdminPinConfirm(empty.confirmation)
    setAdminPinError('')
  }
  function closeAdminPinDialog() {
    setAdminPinDialog(null)
    resetAdminPinFields()
  }
  async function requestCalendarDate(targetDate: string) {
    const today = localDateString(new Date())
    if (canOpenMainCalendarDate(targetDate, today)) {
      setSelectedCalendarDate(targetDate)
      setRescheduleDraft(current => current
        ? { ...current, dateTime: `${targetDate}T${current.dateTime.slice(11, 16)}` }
        : current)
      return
    }
    setNotice('Prošli termini dostupni su u Postavkama → Arhiva termina.')
  }
  function moveCalendarDay(offset: number) {
    void requestCalendarDate(calendarDateAfterMove(selectedCalendarDate, offset))
  }

  useEffect(() => {
    if (!selectedAdminRequest) return
    const draft = document.querySelector<HTMLElement>('.request-draft-event')
    if (!draft) return
    let verticalScrollFrame = 0
    let verticalScrollSpeed = 0
    let lastPointerY = 0

    draft.dataset.dragDate = new Date(`${selectedCalendarDate}T12:00:00`).toLocaleDateString('hr-HR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

    const continueVerticalScroll = () => {
      if (!verticalScrollSpeed) {
        verticalScrollFrame = 0
        return
      }
      window.scrollBy({ top: verticalScrollSpeed, behavior: 'auto' })
      const grid = draft.parentElement?.getBoundingClientRect()
      if (grid) setRequestDraftTime(timeFromCalendarPosition(lastPointerY - grid.top, grid.height))
      verticalScrollFrame = window.requestAnimationFrame(continueVerticalScroll)
    }

    const updateDraftAtEdges = (event: PointerEvent) => {
      if (!draft.hasPointerCapture(event.pointerId)) return
      const grid = draft.parentElement?.getBoundingClientRect()
      if (!grid) return
      lastPointerY = event.clientY
      const verticalEdgeSize = Math.min(120, Math.max(72, window.innerHeight * 0.12))
      verticalScrollSpeed = event.clientY < verticalEdgeSize
        ? -Math.max(3, Math.round((verticalEdgeSize - event.clientY) / 5))
        : event.clientY > window.innerHeight - verticalEdgeSize
          ? Math.max(3, Math.round((event.clientY - (window.innerHeight - verticalEdgeSize)) / 5))
          : 0
      if (verticalScrollSpeed && !verticalScrollFrame) {
        verticalScrollFrame = window.requestAnimationFrame(continueVerticalScroll)
      }
      const edgeSize = Math.min(80, Math.max(48, grid.width * 0.08))
      const direction = event.clientX <= grid.left + edgeSize ? -1 : event.clientX >= grid.right - edgeSize ? 1 : 0
      const now = Date.now()
      if (!direction || now - requestDraftDayChangeRef.current < 650) return
      requestDraftDayChangeRef.current = now
      setSelectedCalendarDate(current => {
        const target = calendarDateAfterMove(current, direction)
        return canOpenMainCalendarDate(target, localDateString(new Date())) ? target : current
      })
    }

    const stopVerticalScroll = () => {
      verticalScrollSpeed = 0
      if (verticalScrollFrame) window.cancelAnimationFrame(verticalScrollFrame)
      verticalScrollFrame = 0
    }

    draft.addEventListener('pointermove', updateDraftAtEdges)
    draft.addEventListener('pointerup', stopVerticalScroll)
    draft.addEventListener('pointercancel', stopVerticalScroll)
    return () => {
      stopVerticalScroll()
      draft.removeEventListener('pointermove', updateDraftAtEdges)
      draft.removeEventListener('pointerup', stopVerticalScroll)
      draft.removeEventListener('pointercancel', stopVerticalScroll)
    }
  }, [selectedAdminRequest, selectedCalendarDate])

  useLayoutEffect(() => {
    if (view !== 'pregled' || !selectedAdminRequest || !requestDraftTime || !requestNeedsScrollRef.current) return
    const frame = window.requestAnimationFrame(() => {
      const target = requestDraftRef.current
      if (!target) return
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      requestNeedsScrollRef.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [view, selectedAdminRequest, selectedCalendarDate, requestDraftTime])

  async function submitAdminPin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !adminPinDialog || adminPinBusy) return
    if (!isValidAdminPin(adminPin)) {
      setAdminPinError('PIN mora imati točno 4 znamenke.')
      return
    }
    if (adminPinDialog !== 'unlock' && adminPin !== adminPinConfirm) {
      setAdminPinError('Ponovljeni PIN se ne podudara.')
      return
    }
    setAdminPinBusy(true)
    setAdminPinError('')
    const submittedPin = adminPin
    const submittedCurrentPin = currentAdminPin
    resetAdminPinFields()
    const result = adminPinDialog === 'unlock'
      ? await supabase.rpc('admin_verify_calendar_pin', { pin_value: submittedPin })
      : await supabase.rpc('admin_set_calendar_pin', {
        new_pin: submittedPin,
        current_pin: adminPinDialog === 'change' ? submittedCurrentPin : null,
      })
    setAdminPinBusy(false)
    if (result.error || result.data !== true) {
      setAdminPinError(adminPinDialog === 'unlock' ? 'PIN nije ispravan.' : 'PIN nije moguće spremiti. Provjerite podatke.')
      return
    }
    setAdminPinSet(true)
    if (adminPinDialog === 'unlock' || adminPinDialog === 'setup') {
      if (adminPinPurpose === 'archive') {
        setAppointmentArchiveUnlocked(true)
        setView('arhiva-termina')
      }
    } else {
      setNotice('Administratorski PIN je promijenjen.')
    }
    closeAdminPinDialog()
  }
  async function openAdminPinSettings() {
    if (!supabase) {
      setNotice('Za administratorski PIN potrebna je sigurna Supabase veza.')
      return
    }
    const { data: isSet, error } = await supabase.rpc('admin_pin_is_set')
    if (error) {
      setNotice('Status administratorskog PIN-a nije moguće provjeriti.')
      return
    }
    setAdminPinSet(isSet === true)
    setAdminPinPurpose('settings')
    resetAdminPinFields()
    setAdminPinDialog(isSet === true ? 'change' : 'setup')
  }
  async function openAppointmentArchive() {
    if (appointmentArchiveUnlocked) {
      setView('arhiva-termina')
      return
    }
    if (!supabase) {
      setNotice('Za arhivu termina potrebna je sigurna Supabase veza.')
      return
    }
    const { data: isSet, error } = await supabase.rpc('admin_pin_is_set')
    if (error) {
      setNotice('Status administratorskog PIN-a nije moguće provjeriti.')
      return
    }
    setAdminPinSet(isSet === true)
    setAdminPinPurpose('archive')
    resetAdminPinFields()
    setAdminPinDialog(isSet === true ? 'unlock' : 'setup')
  }
  function openCalendarSlot(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('.calendar-event')) return
    if ((event.target as HTMLElement).closest('.request-draft-event')) return
    if (rescheduleDraft) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const time = timeFromCalendarPosition(event.clientY - bounds.top, bounds.height)
    if (selectedAdminRequest?.kind === 'appointment') {
      setRequestDraftTime(time)
      return
    }
    setSourceRequestId('')
    setAppointmentPlaced(false)
    setAppointmentForm({ ...emptyAppointment(data.appointments), dateTime: `${selectedCalendarDate}T${time}` })
  }

  async function sendSelectedRequestProposal() {
    if (!selectedAdminRequest || !requestDraftTime || !supabase || requestDraftDuration < 5 || requestDraftDuration % 5 !== 0) return
    const endTime = minutesToTime(timeToMinutes(requestDraftTime) + requestDraftDuration)
    const treatmentLabel = selectedAdminRequest.treatments.map(item => item.name).join(' + ')
    const proposal = `Prijedlog termina: ${formatDate(selectedCalendarDate)} od ${requestDraftTime} do ${endTime} (${requestDraftDuration} min)${treatmentLabel ? ` za uslugu ${treatmentLabel}` : ''}. Molimo potvrdite odgovara li vam termin.`
    setInboxBusy(true)
    const proposedStartsAt = new Date(`${selectedCalendarDate}T${requestDraftTime}`).toISOString()
    const proposalResult = await supabase.rpc('admin_create_custom_proposal_for_client_request', {
      target_request_id: selectedAdminRequest.id,
      target_starts_at: proposedStartsAt,
      target_total_duration: requestDraftDuration,
      target_lifecycle_status: 'confirmed',
      target_confirmation_status: 'pending',
      reply_message: proposal,
      target_notes: selectedAdminRequest.message,
      target_no_charge: false,
      target_treatments: selectedAdminRequest.treatments.map(item => ({
        service_id: item.serviceId,
        duration_minutes: item.durationMinutes,
      })),
    })
    if (proposalResult.error || !(proposalResult.data as { appointment_id: string }[] | null)?.[0]?.appointment_id) {
      setInboxBusy(false)
      console.error('admin_create_custom_proposal_for_client_request failed', proposalResult.error)
      setNotice(`Prijedlog nije spremljen. Termin nije dodan u kalendar.${proposalResult.error?.message ? ` ${proposalResult.error.message}` : ''}`)
      return
    }
    setInboxBusy(false)
    void sendClientPush(selectedAdminRequest.clientId, `appointment-proposal-${selectedAdminRequest.id}`)
    await refreshAdminServerState()
    setSelectedAdminRequest(undefined)
    setRequestDraftTime('')
    setRequestDurationOverride(undefined)
    setNotice('Prijedlog termina poslan je klijentu na potvrdu.')
  }

  async function loadSupabaseClients() {
      if (!supabase) return
      const [{ data: clients, error }, { data: statuses }, { data: appointments }, { data: services }, { data: categories }, { data: treatmentRows, error: treatmentError }] = await Promise.all([
        supabase.from('clients').select('id,first_name,last_name,phone,notes,created_at,updated_at').eq('is_active', true).order('last_name').order('first_name'),
        supabase.rpc('admin_client_portal_pin_status'),
        supabase.from('appointments').select('id,client_id,starts_at,service,status,confirmation_status,notes,created_at,updated_at,service_id,service_name_snapshot,service_price_snapshot,service_duration_snapshot,total_price_snapshot,total_duration_minutes,no_charge'),
        supabase.rpc('admin_list_services'),
        supabase.rpc('admin_list_service_categories'),
        supabase.from('appointment_services').select('appointment_id,service_id,service_name_snapshot,service_price_snapshot,service_duration_snapshot,display_order').order('display_order'),
      ])
      if (error || treatmentError) { setSyncStatus('error'); setNotice('Podatke nije moguće sinkronizirati sa Supabaseom.'); return }
      const mapped: Client[] = (clients ?? []).map(item => ({
        id: item.id,
        firstName: item.first_name,
        lastName: item.last_name,
        phone: item.phone,
        note: item.notes ?? '',
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }))
      const mappedAppointments = mapSupabaseAppointments(
        (appointments ?? []) as SupabaseAppointmentRow[],
        (treatmentRows ?? []) as SupabaseAppointmentServiceRow[],
      )
      setData(current => ({ ...current, clients: mapped, appointments: mappedAppointments }))
      setServiceCatalog((services ?? []).map((item: {
        id: string
        source_code: number | null
        category_id: string
        category_name: string
        name: string
        price: number | string
        duration_minutes: number | null
        is_active: boolean
        is_bookable: boolean
        display_order: number
      }) => ({
        id: item.id, sourceCode: item.source_code ?? undefined,
        categoryId: item.category_id, categoryName: item.category_name, name: item.name,
        price: Number(item.price), durationMinutes: item.duration_minutes ?? undefined,
        isActive: item.is_active, isBookable: item.is_bookable, displayOrder: item.display_order,
      })))
      setCategoryCatalog((categories ?? []).map((item: {
        id: string
        code: string | null
        name: string
        is_active: boolean
        display_order: number
      }) => ({
        id: item.id, code: item.code ?? undefined, name: item.name,
        isActive: item.is_active, displayOrder: item.display_order,
      })))
      const nextStatuses: Record<string, { activated: boolean; temporary: boolean; currentPin?: string }> = {}
      for (const item of statuses ?? []) nextStatuses[item.client_id] = {
        activated: item.portal_activated,
        temporary: item.pin_is_temporary,
        currentPin: item.current_pin ?? undefined,
      }
      setPortalStatuses(nextStatuses)
      setSyncStatus('synced')
  }

  useEffect(() => {
    void Promise.resolve().then(loadSupabaseClients)
  }, [])

  function playNewRequestSound() {
    try {
      const audio = new AudioContext()
      const start = audio.currentTime
      ;[0, 0.16].forEach((offset, index) => {
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = index === 0 ? 880 : 1046
        gain.gain.setValueAtTime(0.0001, start + offset)
        gain.gain.exponentialRampToValueAtTime(0.16, start + offset + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.13)
        oscillator.connect(gain)
        gain.connect(audio.destination)
        oscillator.start(start + offset)
        oscillator.stop(start + offset + 0.14)
      })
      window.setTimeout(() => void audio.close(), 600)
    } catch {
      // Preglednik može blokirati zvuk dok korisnik prvi put ne dodirne stranicu.
    }
  }

  async function loadAdminInbox(notifyAboutNewRequests = false) {
    if (!supabase) return false
    trackSupabaseCall('admin.loadAdminInbox')
    const [requestResult, requestServiceResult, messageResult] = await Promise.all([
      supabase.rpc('admin_list_client_request_inbox'),
      supabase.from('client_request_services').select('request_id,service_id,service_name_snapshot,service_price_snapshot,service_duration_snapshot,display_order').order('display_order'),
      supabase.rpc('admin_list_chat_messages'),
    ])
    if (requestResult.error || requestServiceResult.error || messageResult.error) {
      setSyncStatus('error')
      setNotice('Administratorski inbox nije moguće sinkronizirati.')
      return false
    }
    const nextRequests = mapAdminRequests(requestResult.data ?? [], requestServiceResult.data ?? [])
    const nextMessages = mapAdminMessages(messageResult.data ?? [])
    if (notifyAboutNewRequests && adminInboxInitializedRef.current) {
      const hasNewRequest = hasNewUnreadAdminRequest(nextRequests, knownAdminRequestVersionsRef.current)
      const hasNewClientMessage = nextMessages.some(item =>
        item.sender === 'client'
        && !item.read
        && !knownAdminMessageIdsRef.current.has(item.id))
      if (hasNewRequest || hasNewClientMessage) playNewRequestSound()
    }
    knownAdminRequestVersionsRef.current = new Map(nextRequests.map(item => [item.id, adminRequestNotificationVersion(item)]))
    knownAdminMessageIdsRef.current = new Set(nextMessages.map(item => item.id))
    adminInboxInitializedRef.current = true
    setAdminRequests(nextRequests)
    setAdminMessages(nextMessages)
    return true
  }

  async function loadAdminAppointments() {
    if (!supabase) return false
    trackSupabaseCall('admin.loadAdminAppointments')
    const [appointmentResult, treatmentResult] = await Promise.all([
      supabase.from('appointments').select('id,client_id,starts_at,service,status,confirmation_status,notes,created_at,updated_at,service_id,service_name_snapshot,service_price_snapshot,service_duration_snapshot,total_price_snapshot,total_duration_minutes,no_charge'),
      supabase.from('appointment_services').select('appointment_id,service_id,service_name_snapshot,service_price_snapshot,service_duration_snapshot,display_order').order('display_order'),
    ])
    if (appointmentResult.error || treatmentResult.error) {
      setSyncStatus('error')
      setNotice('Raspored nije moguće sinkronizirati.')
      return false
    }
    const appointments = mapSupabaseAppointments(
      (appointmentResult.data ?? []) as SupabaseAppointmentRow[],
      (treatmentResult.data ?? []) as SupabaseAppointmentServiceRow[],
    )
    setData(current => ({ ...current, appointments }))
    setSyncStatus('synced')
    return true
  }

  async function refreshAdminServerState() {
    await Promise.all([loadAdminInbox(), loadAdminAppointments()])
  }

  useEffect(() => {
    async function load() {
      await loadAdminInbox()
    }
    void load()
  }, [])

  useEffect(() => {
    const supabaseClient = supabase
    if (!supabaseClient) return
    let refreshInFlight: Promise<boolean> | null = null
    let queuedNotify = false
    const refreshAll = (notify = true) => {
      queuedNotify = queuedNotify || notify
      if (refreshInFlight) return refreshInFlight
      refreshInFlight = (async () => {
        let success = true
        while (queuedNotify) {
          const notifyNow = queuedNotify
          queuedNotify = false
          if (document.visibilityState !== 'visible') continue
          trackSupabaseCall('admin.refreshAll')
          const [inboxOk, appointmentsOk] = await Promise.all([loadAdminInbox(notifyNow), loadAdminAppointments()])
          success = success && inboxOk && appointmentsOk
        }
        return success
      })().finally(() => {
        refreshInFlight = null
      })
      return refreshInFlight
    }
    const channel = supabaseClient
      .channel('admin-client-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_requests' }, () => {
        void refreshAll(true)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
        void refreshAll(true)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        void refreshAll(true)
      })
      .subscribe()
    const refreshOnFocus = () => { void refreshAll(true) }
    window.addEventListener('focus', refreshOnFocus)
    const refreshOnVisibility = () => {
      if (document.visibilityState === 'visible') void refreshAll(true)
    }
    document.addEventListener('visibilitychange', refreshOnVisibility)
    const stopRefreshLoop = startSupabaseRefreshLoop({
      label: 'admin.refreshLoop',
      refresh: async () => {
        return refreshAll(true)
      },
      baseIntervalMs: 60_000,
      hiddenIntervalMs: 5 * 60_000,
      maxBackoffMs: 15 * 60_000,
    })
    return () => {
      stopRefreshLoop()
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnVisibility)
      void supabaseClient.removeChannel(channel)
    }
  }, [])

  async function openAdminRequest(request: AdminRequest) {
    if (!supabase) return
    setInboxBusy(true)
    const { data: readAt, error } = await supabase.rpc('admin_open_client_request', { target_request_id: request.id })
    setInboxBusy(false)
    if (error || !readAt) {
      console.error('admin_open_client_request failed', error)
      setNotice(`Zahtjev nije moguće otvoriti.${error?.message ? ` ${error.message}` : ''}`)
      return
    }
    const draftTreatments = initialRequestTreatmentDraft(request, serviceCatalog)
    const opened = { ...request, readAt, treatments: draftTreatments }
    setAdminRequests(current => current.map(item => item.id === request.id ? opened : item))
    setSelectedAdminRequest(opened)
    const requestedDuration = draftTreatments.reduce((sum, item) => sum + item.durationMinutes, 0)
    setRequestDurationOverride(Math.max(5, (request.proposedDurationMinutes ?? requestedDuration) || 30))
  }

  async function respondToAdminRequest(request: AdminRequest, status: 'in_review' | 'rejected', reply: string) {
    if (!supabase) return false
    setInboxBusy(true)
    const { error } = await supabase.rpc('admin_respond_client_request', {
      target_request_id: request.id,
      next_status: status,
      reply_message: reply,
    })
    setInboxBusy(false)
    if (error) {
      console.error('admin_respond_client_request failed', error)
      setNotice(`Odgovor na zahtjev nije spremljen. ${error.message}`)
      return false
    }
    await loadAdminInbox()
    setSelectedAdminRequest(undefined)
    setNotice(status === 'rejected' ? 'Zahtjev je odbijen.' : 'Drugi prijedlog je poslan klijentu.')
    return true
  }

  async function deleteAdminRequest(request: AdminRequest) {
    if (!supabase) return false
    if (!window.confirm(`Trajno obrisati zahtjev klijenta ${request.clientName}?`)) return false
    setInboxBusy(true)
    const { data: deleted, error } = await supabase.rpc('admin_delete_client_request', {
      target_request_id: request.id,
    })
    setInboxBusy(false)
    if (error || deleted !== true) {
      console.error('admin_delete_client_request failed', error)
      setNotice(`Zahtjev nije obrisan.${error?.message ? ` ${error.message}` : ''}`)
      return false
    }
    setAdminRequests(current => current.filter(item => item.id !== request.id))
    setSelectedAdminRequest(undefined)
    await loadAdminInbox()
    setNotice('Zahtjev je obrisan.')
    return true
  }

  function acceptAdminRequest(request: AdminRequest) {
    const date = request.preferredDates[0] || localDateString(new Date())
    const periodTimes = timeOptions.filter(time =>
      request.dayPeriod === 'any'
      || (request.dayPeriod === 'morning' ? time < '12:00' : time >= '12:00'))
    const serviceLabel = request.treatments.map(item=>item.name).join(' + ')
    const time = periodTimes.find(candidate => !isTimeUnavailable(date, candidate, serviceLabel, data.appointments)) ?? periodTimes[0] ?? '08:00'
    setRequestDraftTime(time)
    requestNeedsScrollRef.current = true
    void requestCalendarDate(date)
    setView('pregled')
  }

  async function openAdminMessage(message: AdminMessage) {
    if (!supabase) return
    setInboxBusy(true)
    const { error } = await supabase.rpc('admin_mark_client_conversation_read', { target_client_id: message.clientId })
    setInboxBusy(false)
    if (error) { setNotice('Poruku nije moguće otvoriti.'); return }
    const readAt = new Date().toISOString()
    const opened = { ...message, read: true, readAt }
    setAdminMessages(current => current.map(item => item.clientId === message.clientId && item.sender === 'client' ? { ...item, read: true, readAt } : item))
    setSelectedAdminMessage(opened)
  }

  async function sendNewAdminMessage(clientId: string, message: string) {
    if (!supabase) return false
    setInboxBusy(true)
    const { error } = await supabase.rpc('admin_send_message', { target_client_id: clientId, message_body: message })
    if (error) { setInboxBusy(false); setNotice('Poruku nije moguće poslati.'); return false }
    const pushOutcome = await sendClientPush(clientId)
    setInboxBusy(false)
    await loadAdminInbox()
    setNotice(savedMessagePushNotice(pushOutcome))
    return true
  }

  async function replyToAdminMessage(message: AdminMessage, reply: string) {
    if (!supabase) return false
    setInboxBusy(true)
    const { error } = await supabase.rpc('admin_send_message', { target_client_id: message.clientId, message_body: reply })
    if (error) { setInboxBusy(false); setNotice('Odgovor nije spremljen u Supabase.'); return false }
    const pushOutcome = await sendClientPush(message.clientId)
    setInboxBusy(false)
    await loadAdminInbox()
    setNotice(savedMessagePushNotice(pushOutcome))
    return true
  }

  async function deleteAdminMessage(message: AdminMessage) {
    if (!supabase) return false
    setInboxBusy(true)
    const { error } = await supabase.rpc('admin_delete_message', { target_message_id: message.id })
    setInboxBusy(false)
    if (error) { setNotice('Poruka nije obrisana iz Supabasea.'); return false }
    setAdminMessages(current => current.filter(item => item.id !== message.id))
    setNotice('Poruka je obrisana.')
    return true
  }

  async function sendPortalAccess(clientId: string) {
    if (!supabase) { setNotice('Supabase nije konfiguriran.'); return }
    const { data: token, error } = await supabase.rpc('admin_create_client_access', { target_client_id: clientId })
    if (error || !token) { setNotice('Adresu pristupa nije moguće izraditi.'); return }
    const link = `${window.location.href.split('#')[0]}#/client/access/${token}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Frizerski salon Kristina', text: 'Vaš pristup klijentskom portalu', url: link })
        setNotice('Pristup je podijeljen.')
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    setInviteLink(link)
  }

  void sendPortalAccess

  function openTemporaryPin(clientId: string) {
    setPinClientId(clientId)
    setTemporaryPin('')
    setPinError('')
  }

  async function prepareInitialPin(clientId: string) {
    if (!supabase) return
    const { error } = await supabase.rpc('admin_create_client_access', { target_client_id: clientId })
    if (error) {
      setNotice('Pristup klijenta nije moguće pripremiti.')
      return
    }
    openTemporaryPin(clientId)
  }

  async function openClientCard(client: Client) {
    if (supabase) {
      const { data: statuses } = await supabase.rpc('admin_client_portal_pin_status')
      const status = statuses?.find((item: {
        client_id: string
        portal_activated: boolean
        pin_is_temporary: boolean
        current_pin: string | null
      }) => item.client_id === client.id)
      if (status) {
        setPortalStatuses(current => ({
          ...current,
          [client.id]: {
            activated: status.portal_activated,
            temporary: status.pin_is_temporary,
            currentPin: status.current_pin ?? undefined,
          },
        }))
      }
    }
    setClientForm(client)
  }

  async function deleteClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !deleteClientTarget || !isValidAdminPin(deleteClientPin)) return
    setDeleteClientError('')
    const verification = await supabase.rpc('admin_verify_calendar_pin', { pin_value: deleteClientPin })
    if (verification.error || verification.data !== true) {
      setDeleteClientError('Administratorski PIN nije ispravan.')
      return
    }
    const deletion = await supabase.from('clients').update({ is_active: false }).eq('id', deleteClientTarget.id)
    if (deletion.error) {
      setDeleteClientError('Klijenta nije moguće obrisati.')
      return
    }
    const deletedId = deleteClientTarget.id
    setData(current => ({ ...current, clients: current.clients.filter(client => client.id !== deletedId) }))
    setPortalStatuses(current => {
      const next = { ...current }
      delete next[deletedId]
      return next
    })
    setDeleteClientTarget(null)
    setDeleteClientPin('')
    setNotice('Klijent je obrisan.')
  }

  async function saveTemporaryPin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPinError('')
    if (!/^\d{4}$/.test(temporaryPin)) {
      setPinError('PIN mora imati točno četiri znamenke.')
      return
    }
    if (!supabase) return
    const { error } = await supabase.rpc('admin_set_client_temporary_pin', {
      target_client_id: pinClientId,
      temporary_pin: temporaryPin,
    })
    if (error) { setPinError('Privremeni PIN nije bilo moguće spremiti.'); return }
    setPortalStatuses(current => ({ ...current, [pinClientId]: { activated: true, temporary: true, currentPin: temporaryPin } }))
    setIssuedTemporaryPin({ clientId: pinClientId, pin: temporaryPin })
    setPinClientId('')
    setTemporaryPin('')
  }

  async function saveClient(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!clientForm || clientSavingRef.current) return
    const isNewClient = !clientForm.id
    if (isNewClient && !/^\d{4}$/.test(newClientPin)) {
      setNotice('Kristina mora zadati početni PIN od točno četiri znamenke.')
      return
    }
    clientSavingRef.current=true;setIsSavingClient(true);setNotice('Spremanje klijenta…')
    try {
      const now = new Date().toISOString()
      let savedId = clientForm.id
      if (supabase) {
        const values = {
          first_name: clientForm.firstName.trim(),
          last_name: clientForm.lastName.trim(),
          phone: clientForm.phone.trim(),
          notes: clientForm.note.trim() || null,
        }
        const result = clientForm.id
          ? await supabase.from('clients').update(values).eq('id', clientForm.id).select('id').single()
          : await supabase.from('clients').insert(values).select('id').single()
        if (result.error || !result.data) {
          setSyncStatus('error')
          setNotice('Klijenta nije moguće spremiti u Supabase.')
          return
        }
        savedId = result.data.id
        if (isNewClient) {
          const credentialResult = await supabase.rpc('admin_generate_client_pin', { target_client_id: savedId })
          const pinResult = credentialResult.error
            ? credentialResult
            : await supabase.rpc('admin_set_client_temporary_pin', {
              target_client_id: savedId,
              temporary_pin: newClientPin,
            })
          if (pinResult.error) {
            setSyncStatus('error')
            setNotice('Klijent je spremljen, ali početni PIN nije postavljen.')
            return
          }
          setPortalStatuses(current => ({
            ...current,
            [savedId]: { activated: true, temporary: true, currentPin: newClientPin },
          }))
          setIssuedTemporaryPin({ clientId: savedId, pin: newClientPin })
        }
        setSyncStatus('synced')
      }
      const client = { ...clientForm, id: savedId || uid('client'), firstName: clientForm.firstName.trim(), lastName: clientForm.lastName.trim(), phone: clientForm.phone.trim(), createdAt: clientForm.createdAt || now, updatedAt: now }
      update({ ...data, clients: upsertClient(data.clients, client) }, supabase ? 'Klijent je sinkroniziran.' : 'Klijent je lokalno spremljen.'); setClientForm(null)
    } finally {
      clientSavingRef.current=false;setIsSavingClient(false)
    }
  }
  async function saveAppointment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!appointmentForm) return
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const confirmationAction = submitter?.value
    const confirmationStatus = confirmationAction === 'send'
      ? 'pending'
      : confirmationAction === 'confirm'
        ? 'confirmed'
        : appointmentForm.confirmationStatus ?? 'confirmed'
    if (confirmationAction === 'confirm' && !window.confirm('Potvrditi termin odmah bez potvrde klijenta?')) return
    const originalAppointment = appointmentForm.id
      ? data.appointments.find(item => item.id === appointmentForm.id)
      : undefined
    const appointmentWasMoved = Boolean(originalAppointment
      && originalAppointment.dateTime !== appointmentForm.dateTime)
    const appointmentWasCancelled = Boolean(originalAppointment
      && originalAppointment.status !== 'otkazan'
      && appointmentForm.status === 'otkazan')
    const appointmentConfirmedByAdmin = confirmationStatus === 'confirmed'
      && appointmentForm.status !== 'otkazan'
      && (
        originalAppointment?.confirmationStatus === 'pending'
        || !originalAppointment
      )
    if (!appointmentForm.clientId) { setNotice('Odaberite klijenta.'); return }
    if (!isValidAppointmentDuration(appointmentForm.serviceDuration)) { setNotice('Trajanje mora biti najmanje 15 minuta i u koracima od 15 minuta.'); return }
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(appointmentForm.dateTime)){setNotice('Odaberite datum i vrijeme.');return}
    const conflicts=conflictingAppointments(appointmentForm.dateTime.slice(0,10),appointmentForm.dateTime.slice(11,16),appointmentForm.service,data.appointments,appointmentForm.id)
    if(conflicts.length&&currentUserRole!=='administrator'){setNotice('Odabrani termin nije dostupan.');return}
    if(conflicts.length&&!window.confirm('Termin se preklapa s postojećim terminom. Želite li ga ipak spremiti?'))return
    const now = new Date().toISOString()
    let savedId = appointmentForm.id
    if (supabase) {
      const startsAt = new Date(appointmentForm.dateTime).toISOString()
      const appointmentValues = {
        target_starts_at: startsAt,
        target_notes: appointmentForm.note,
        target_no_charge: appointmentForm.noCharge === true,
        target_service_ids: (appointmentForm.treatments ?? []).map(item => item.serviceId),
        target_total_duration: appointmentForm.serviceDuration || null,
        target_total_price: finalAppointmentPrice(appointmentForm),
      }
      const acceptingRequest = Boolean(sourceRequestId && !appointmentForm.id)
      const lifecycleStatus = appointmentForm.status === 'otkazan'
        ? 'cancelled'
        : appointmentForm.status === 'zavrsen' ? 'completed' : 'confirmed'
      const result = acceptingRequest && sourceRequestId
        ? await supabase.rpc('admin_create_proposal_for_client_request', {
            target_request_id: sourceRequestId,
            target_lifecycle_status: lifecycleStatus,
            target_confirmation_status: confirmationStatus,
            reply_message: confirmationStatus === 'pending'
              ? 'Termin je poslan na potvrdu.'
              : 'Termin je potvrdila Kristina.',
            ...appointmentValues,
          })
        : await supabase.rpc('admin_save_appointment_with_services', {
            target_appointment_id: appointmentForm.id || null,
            target_client_id: appointmentForm.clientId,
            target_lifecycle_status: lifecycleStatus,
            target_confirmation_status: confirmationStatus,
            ...appointmentValues,
          })
      if (result.error || !result.data) { setSyncStatus('error'); setNotice('Termin nije sinkroniziran. Pokušajte ponovno.'); return }
      savedId = acceptingRequest
        ? (result.data as { appointment_id: string }[])[0]?.appointment_id
        : result.data as string
      if (!savedId) { setSyncStatus('error'); setNotice('Termin nije potvrđen.'); return }
      if (appointmentConfirmedByAdmin) {
        const confirmationMessage = await supabase.from('messages').upsert({
          client_id: appointmentForm.clientId,
          sender: 'admin',
          subject: 'Termin je potvrđen',
          message: `Kristina je potvrdila vaš termin ${formatDateTime(appointmentForm.dateTime)}${appointmentTreatmentLabel(appointmentForm)?` za: ${appointmentTreatmentLabel(appointmentForm)}`:''}.`,
          is_read: true,
          event_key: `appointment-confirmed:${savedId}`,
        }, { onConflict: 'event_key', ignoreDuplicates: true }).select('id')
        if (confirmationMessage.error) {
          setNotice('Termin je potvrđen, ali obavijest klijentu nije spremljena.')
        } else if ((confirmationMessage.data ?? []).length > 0) {
          void sendClientPush(appointmentForm.clientId, `appointment-confirmed-${savedId}`)
        }
      }
      if (confirmationStatus === 'pending' && !appointmentWasCancelled) {
        const notification = await supabase.from('messages').insert({
          client_id: appointmentForm.clientId,
          sender: 'admin',
          subject: 'Potvrdite predloženi termin',
          message: `Predložen vam je termin ${formatDateTime(appointmentForm.dateTime)} u trajanju ${appointmentForm.serviceDuration} minuta${appointmentTreatmentLabel(appointmentForm)?` za: ${appointmentTreatmentLabel(appointmentForm)}`:''}. Otvorite portal i potvrdite odgovara li vam termin.`,
          is_read: true,
        })
        if (!notification.error) void sendClientPush(appointmentForm.clientId, `appointment-confirmation-${savedId}`)
      }
      if (appointmentWasCancelled) {
        const cancellationText = `Vaš termin ${formatDateTime(appointmentForm.dateTime)} za uslugu ${appointmentTreatmentLabel(appointmentForm)} je otkazan.`
        const notification = await supabase.from('messages').insert({
          client_id: appointmentForm.clientId,
          sender: 'admin',
          subject: 'Termin je otkazan',
          message: cancellationText,
          is_read: true,
        })
        if (notification.error) {
          setNotice('Termin je otkazan, ali obavijest klijentu nije poslana.')
        } else {
          void sendClientPush(appointmentForm.clientId, `appointment-cancelled-${appointmentForm.id}`)
        }
      } else if (appointmentWasMoved) {
        const notification = await supabase.from('messages').insert({
          client_id: appointmentForm.clientId,
          sender: 'admin',
          subject: 'Termin je promijenjen',
          message: `Vaš termin je premješten na ${formatDateTime(appointmentForm.dateTime)}. Usluga: ${appointmentTreatmentLabel(appointmentForm)}.`,
          is_read: true,
        })
        if (notification.error) {
          setNotice('Termin je promijenjen, ali obavijest klijentu nije poslana.')
        } else {
          void sendClientPush(appointmentForm.clientId, `appointment-${appointmentForm.id}`)
        }
      }
      setSyncStatus('synced')
    }
    const appointment = {
      ...appointmentForm,
      confirmationStatus,
      id: savedId || uid('appointment'),
      service: appointmentTreatmentLabel(appointmentForm),
      servicePrice: finalAppointmentPrice(appointmentForm),
      createdAt: appointmentForm.createdAt || now,
      updatedAt: now,
      assignedBy: 'Kristina' as const,
    }
    update({ ...data, appointments: upsertAppointment(data.appointments, appointment) }, supabase ? 'Termin je sinkroniziran.' : 'Termin je lokalno spremljen.')
    const client = data.clients.find(item => item.id === appointment.clientId)
    const nextPortal: PortalData = { ...portal, notifications: replaceAppointmentReminders(portal.notifications, appointment, client) }
    if (sourceRequestId) await refreshAdminServerState()
    updatePortal(nextPortal); setSourceRequestId(''); setAppointmentPlaced(false); setAppointmentForm(null)
  }

  function beginAppointmentReschedule(appointment: Appointment) {
    if (appointment.status !== 'zakazan' || appointment.confirmationStatus === 'pending') {
      setNotice('Pomaknuti se može samo aktivan, potvrđen termin.')
      return
    }
    if (!window.confirm('Termin je već zakazan. Želite li ga odglaviti za pomicanje?')) return
    setAppointmentDetails(null)
    setSelectedCalendarDate(appointment.dateTime.slice(0, 10))
    setRescheduleDraft({ ...appointment })
  }

  function queueAppointmentReschedule(appointment: Appointment) {
    if (appointmentClickTimerRef.current !== null) {
      window.clearTimeout(appointmentClickTimerRef.current)
    }
    appointmentClickTargetRef.current = appointment.id
    appointmentClickTimerRef.current = window.setTimeout(() => {
      appointmentClickTimerRef.current = null
      if (appointmentClickTargetRef.current !== appointment.id) return
      appointmentClickTargetRef.current = ''
      beginAppointmentReschedule(appointment)
    }, 220)
  }

  function openAppointmentDetailsFromCalendar(appointment: Appointment) {
    if (appointmentClickTimerRef.current !== null) {
      window.clearTimeout(appointmentClickTimerRef.current)
      appointmentClickTimerRef.current = null
    }
    appointmentClickTargetRef.current = ''
    setAppointmentDetails(appointment)
  }

  async function saveRescheduledAppointment(droppedAppointment = rescheduleDraft) {
    if (!supabase || !droppedAppointment) return
    const original = data.appointments.find(item => item.id === droppedAppointment.id)
    if (!original) {
      setNotice('Izvorni termin više nije dostupan.')
      setRescheduleDraft(null)
      return
    }
    const restoreOriginalPreview = () => {
      setSelectedCalendarDate(original.dateTime.slice(0, 10))
      setRescheduleDraft({ ...original })
    }
    const duration = droppedAppointment.serviceDuration || 30
    const conflicts = conflictingAppointments(
      droppedAppointment.dateTime.slice(0, 10),
      droppedAppointment.dateTime.slice(11, 16),
      droppedAppointment.service,
      data.appointments,
      droppedAppointment.id,
      duration,
    )
    const conflictSummary = conflicts.map(item =>
      `${findClientName(data.clients, item.clientId)} ${item.dateTime.slice(11, 16)}–${minutesToTime(timeToMinutes(item.dateTime.slice(11, 16)) + (item.serviceDuration || 30))}`,
    ).join('\n')
    const overlapAllowed = conflicts.length > 0
      ? window.confirm(`Novo vrijeme preklapa se s:\n${conflictSummary}\n\nŽelite li ga ipak spremiti?`)
      : false
    if (conflicts.length > 0 && !overlapAllowed) {
      restoreOriginalPreview()
      return
    }
    const start = droppedAppointment.dateTime.slice(11, 16)
    const end = minutesToTime(timeToMinutes(start) + duration)
    if (!window.confirm(`Potvrditi pomicanje?\nStaro: ${formatDateTime(original.dateTime)}\nNovo: ${formatDateTime(droppedAppointment.dateTime)}\nZavršetak: ${end}`)) {
      restoreOriginalPreview()
      return
    }

    setAppointmentActionBusy(true)
    const { data: result, error } = await supabase.rpc('admin_reschedule_appointment', {
      target_appointment_id: droppedAppointment.id,
      target_starts_at: new Date(droppedAppointment.dateTime).toISOString(),
      allow_overlap: overlapAllowed,
    })
    setAppointmentActionBusy(false)
    const saved = (result as { client_id: string; notification_created: boolean }[] | null)?.[0]
    if (error || !saved) {
      console.error('admin_reschedule_appointment failed', error)
      setNotice(`Termin nije pomaknut.${error?.message ? ` ${error.message}` : ''}`)
      restoreOriginalPreview()
      return
    }
    if (saved.notification_created) {
      void sendClientPush(saved.client_id, `appointment-rescheduled-${droppedAppointment.id}`)
    }
    await loadAdminAppointments()
    setRescheduleDraft(null)
    setNotice('Termin je pomaknut i kalendar je osvježen.')
  }

  function beginAppointmentCancellation(appointment: Appointment) {
    if (appointment.status !== 'zakazan' || appointment.confirmationStatus === 'pending') {
      setNotice('Otkazati se može samo aktivan, potvrđen termin.')
      return
    }
    setAppointmentDetails(null)
    setCancellationReason('')
    setCancellationTarget(appointment)
  }

  async function cancelAdminAppointment() {
    if (!supabase || !cancellationTarget) return
    const clientName = findClientName(data.clients, cancellationTarget.clientId)
    const date = formatDate(cancellationTarget.dateTime.slice(0, 10))
    const time = cancellationTarget.dateTime.slice(11, 16)
    if (!window.confirm(`Želite li otkazati termin za ${clientName}, ${date} u ${time}?`)) return

    setAppointmentActionBusy(true)
    const { data: result, error } = await supabase.rpc('admin_cancel_appointment', {
      target_appointment_id: cancellationTarget.id,
      cancellation_reason: cancellationReason,
    })
    setAppointmentActionBusy(false)
    const cancelled = (result as { client_id: string; notification_created: boolean }[] | null)?.[0]
    if (error || !cancelled) {
      console.error('admin_cancel_appointment failed', error)
      setNotice(`Termin nije otkazan.${error?.message ? ` ${error.message}` : ''}`)
      return
    }
    if (cancelled.notification_created) {
      void sendClientPush(cancelled.client_id, `appointment-cancelled-${cancellationTarget.id}`)
    }
    await loadAdminAppointments()
    setCancellationTarget(null)
    setCancellationReason('')
    setNotice('Termin je otkazan i uklonjen iz aktivnog rasporeda.')
  }

  function placeAppointmentFromForm() {
    if (!appointmentForm?.clientId || !isValidAppointmentDuration(appointmentForm.serviceDuration)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(appointmentForm.dateTime)) {
      setNotice('Odaberite klijenta, datum, vrijeme i valjano trajanje.')
      return
    }
    setSelectedCalendarDate(appointmentForm.dateTime.slice(0,10))
    setMovingAppointment(appointmentForm)
    setAppointmentForm(null)
  }
  function submitPlacedAppointment(confirmationStatus: 'pending' | 'confirmed') {
    if (!appointmentForm) return
    if (confirmationStatus === 'confirmed' && !window.confirm('Potvrditi termin odmah bez potvrde klijenta?')) return
    setAppointmentForm({...appointmentForm,confirmationStatus})
    window.setTimeout(()=>document.querySelector<HTMLFormElement>('.modal form')?.requestSubmit(),0)
  }
  function replyToRequest(requestId: string, status: 'u_razgovoru' | 'odbijeno') {
    const reply = window.prompt(status === 'odbijeno' ? 'Napišite razlog odbijanja:' : 'Napišite odgovor ili zatražite drugi prijedlog:')
    if (reply === null) return
    updatePortal({ ...portal, requests: portal.requests.map(item => item.id === requestId ? { ...item, status, adminReply: reply, updatedAt: new Date().toISOString() } : item) })
  }
  function createAppointmentFromRequest(requestId: string) {
    const request = portal.requests.find(item => item.id === requestId)
    if (!request) return
    const appointment = emptyAppointment(data.appointments)
    const date = request.preferredDates[0] || appointment.dateTime.slice(0, 10)
    const time = firstAvailableTime(date, request.service, data.appointments)
    setAppointmentForm({ ...appointment, clientId: request.clientId, service: request.service, dateTime: time ? `${date}T${time}` : `${date}T` })
    setSourceRequestId(request.id)
  }
  async function saveService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !serviceForm) return
    const { data: savedId, error } = await supabase.rpc('admin_upsert_service', {
      service_id: serviceForm.id || null,
      service_category_id: serviceForm.categoryId,
      service_name: serviceForm.name.trim(),
      service_price: serviceForm.price,
      service_duration_minutes: serviceForm.durationMinutes ?? null,
      service_is_active: serviceForm.isActive,
      service_is_bookable: serviceForm.isBookable,
      service_display_order: serviceForm.displayOrder,
    })
    if (error || !savedId) { setSyncStatus('error'); setNotice('Stavku cjenika nije moguće sinkronizirati.'); return }
    setSyncStatus('synced')
    const saved = { ...serviceForm, id: savedId }
    setServiceCatalog(current => orderedServices([...current.filter(item => item.id !== saved.id), saved]))
    setServiceForm(null)
    setNotice('Cjenik je spremljen.')
  }
  async function saveCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !categoryForm) return
    const { data: savedId, error } = await supabase.rpc('admin_upsert_service_category', {
      category_id: categoryForm.id || null,
      category_name: categoryForm.name.trim(),
      category_is_active: categoryForm.isActive,
      category_display_order: categoryForm.displayOrder,
    })
    if (error || !savedId) { setSyncStatus('error'); setNotice('Kategoriju nije moguće sinkronizirati.'); return }
    setSyncStatus('synced')
    const saved = { ...categoryForm, id: savedId }
    setCategoryCatalog(current => orderedCategories([...current.filter(item => item.id !== saved.id), saved]))
    setServiceCatalog(current => current.map(item => item.categoryId === saved.id ? { ...item, categoryName: saved.name } : item))
    setCategoryForm(null)
    setNotice('Kategorija je spremljena.')
  }
  async function saveArchive(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    if (supabase) {
      setArchiveSaving(true)
      setArchiveProgress('Priprema fotografija…')
      try {
        await createTreatmentArchive(supabase, {
          clientId: String(form.get('clientId')),
          takenAt: String(form.get('date')),
          notes: String(form.get('note') || ''),
          visibleToClient: form.get('visibleToClient') === 'on',
          photos: archiveFiles,
        }, { onProgress: progress => setArchiveProgress(`${progress.label} (${progress.completed}/${progress.total})`) })
        setTreatmentArchives(await loadTreatmentArchives(supabase))
        setArchiveFiles([])
        setArchiveOpen(false)
        setNotice('Fotografije tretmana sigurno su spremljene.')
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Fotografije nije moguće spremiti.')
      } finally {
        setArchiveSaving(false)
        setArchiveProgress('')
      }
      return
    }
    const beforeFile = imageFiles.current.before
    if (!beforeFile) return
    setNotice('Fotografije se komprimiraju…')
    try {
      const before = await compressImageToAsset(beforeFile); const after = imageFiles.current.after ? await compressImageToAsset(imageFiles.current.after) : undefined
      const entry: HairstyleArchiveEntry = { id: uid('style'), clientId: String(form.get('clientId')), date: String(form.get('date')), note: String(form.get('note') || ''), before, after, visibleToClient: form.get('visibleToClient') === 'on', createdAt: new Date().toISOString() }
      update({ ...data, hairstyles: addHairstyle(data.hairstyles, entry) }, 'Frizura je dodana u arhivu.'); imageFiles.current = {}; setArchiveOpen(false)
    } catch { setNotice('Fotografije nije bilo moguće obraditi.') }
  }
  async function refreshTreatmentArchives() {
    if (supabase) setTreatmentArchives(await loadTreatmentArchives(supabase))
  }
  async function replaceArchivePhoto(photoSet: TreatmentPhotoSet, photoId: string, file?: File) {
    if (!supabase || !file) return
    const photo = photoSet.photos.find(item => item.id === photoId)
    if (!photo) return
    setArchiveProgress('Komprimiranje i zamjena fotografije…')
    try {
      await replaceTreatmentPhoto(supabase, photo, photoSet.clientId, file)
      await refreshTreatmentArchives()
      setNotice('Fotografija je zamijenjena.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Fotografiju nije moguće zamijeniti.')
    } finally { setArchiveProgress('') }
  }
  async function removeArchivePhoto(photoSet: TreatmentPhotoSet, photoId: string) {
    if (!supabase || !window.confirm('Obrisati ovu fotografiju?')) return
    const photo = photoSet.photos.find(item => item.id === photoId)
    if (!photo) return
    try {
      await deleteTreatmentPhoto(supabase, photo)
      await refreshTreatmentArchives()
      setNotice('Fotografija je obrisana.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Fotografiju nije moguće obrisati.') }
  }
  async function toggleArchiveVisibility(item: TreatmentPhotoSet) {
    if (!supabase) return
    const { error } = await supabase.from('treatment_photo_sets').update({ visible_to_client: !item.visibleToClient }).eq('id', item.id)
    if (error) { setNotice('Vidljivost nije spremljena.'); return }
    await refreshTreatmentArchives()
    setNotice(item.visibleToClient ? 'Fotografije su skrivene od klijenta.' : 'Fotografije su vidljive klijentu.')
  }
  const activeAdminRequests = adminRequests.filter(request =>
    request.status === 'pending' || request.status === 'in_review')
  const inboxCounts = adminInboxCounts(activeAdminRequests, adminMessages)
  useEffect(() => {
    const total = inboxCounts.requests + inboxCounts.messages
    void updateAppBadge(total)
  }, [inboxCounts.requests, inboxCounts.messages])
  const title = view === 'arhiva-termina' ? 'Arhiva termina' : nav.find(item => item.id === view)?.label
  const todayCalendarDate = localDateString(new Date())
  const viewingToday = selectedCalendarDate === todayCalendarDate
  const pastAppointments = data.appointments
    .filter(item => isArchivedAppointment(item.dateTime, todayCalendarDate))
    .sort((left, right) => right.dateTime.localeCompare(left.dateTime))
  const selectedAppointmentCategoryId = appointmentForm?.serviceCategoryId
    ?? serviceCatalog.find(item => item.id === appointmentForm?.serviceId)?.categoryId
    ?? ''
  const requestDraftDuration = selectedAdminRequest
    ? requestTreatmentDuration(selectedAdminRequest.treatments, requestDurationOverride ?? 30)
    : requestDurationOverride ?? 30
  const requestDraftLayout = selectedAdminRequest && requestDraftTime
    ? calendarEventLayout(`${selectedCalendarDate}T${requestDraftTime}`, requestDraftDuration)
    : undefined
  const requestDraftConflicts = selectedAdminRequest && requestDraftTime
    ? conflictingAppointments(selectedCalendarDate, requestDraftTime, selectedAdminRequest.treatments.map(item => item.name).join(' + '), data.appointments, '', requestDraftDuration)
    : []
  const rescheduleDuration = rescheduleDraft?.serviceDuration || 30
  const rescheduleConflicts = rescheduleDraft
    ? conflictingAppointments(
        rescheduleDraft.dateTime.slice(0, 10),
        rescheduleDraft.dateTime.slice(11, 16),
        rescheduleDraft.service,
        data.appointments,
        rescheduleDraft.id,
        rescheduleDuration,
      )
    : []
  const showDoorControls = isSupportedSalonTablet()
  return <div className={`app-shell${showDoorControls ? ' has-door-controls' : ''}`}>
    {showDoorControls && <div className="door-controls-fab">
      <div className={`boiler-control boiler-${boilerState}${boilerBusy ? ' busy' : ''}`}>
        {!boilerBusy && <button className="boiler-action" type="button" onClick={()=>runBoilerCommand(boilerState === 'on' ? 'off' : boilerState === 'off' ? 'on' : 'status')}>
          {boilerState === 'on' ? 'Isključi' : boilerState === 'off' ? 'Uključi' : 'Pokušaj ponovno'}
        </button>}
        <button className="boiler-status" type="button" disabled={boilerBusy} onClick={()=>runBoilerCommand('status')}>
          Bojler <span aria-hidden="true">●</span> {boilerBusy
            ? boilerOperation === 'on' ? 'UKLJUČUJEM…' : boilerOperation === 'off' ? 'ISKLJUČUJEM…' : 'PROVJERA…'
            : boilerState === 'on' ? 'UKLJUČEN' : boilerState === 'off' ? 'ISKLJUČEN' : 'STANJE NEPOZNATO'}
        </button>
      </div>
      <button className="video-doorbell-fab" type="button" onClick={openVideoDoorbell}>Kamera</button>
      <button className="door-open-placeholder" type="button" aria-disabled="true" onClick={showDoorLockUnavailable}><span aria-hidden="true">🔓</span> Otvori vrata</button>
    </div>}
    <aside className="sidebar"><div className="brand"><span className="brand-mark">K</span><div><strong>Salon Kristina</strong></div></div>
      <nav>{nav.map(item => {const count=item.id==='poruke-live'?inboxCounts.messages:item.id==='zahtjevi-live'?inboxCounts.requests:0;return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => changeView(item.id)}><span>{item.icon}</span>{item.label}{count>0&&<b className="nav-count">{count}</b>}</button>})}</nav>
      <div className="owner"><span>{adminIdentity.mark}</span><div><strong>{adminIdentity.name}</strong><small>{adminIdentity.title}</small></div><button className="owner-logout" onClick={onLogout}>Odjava</button></div>
    </aside>
    <main><header><div><p className="eyebrow">Salon Kristina</p><h1>{title}</h1></div><div className={`header-actions sync-${syncStatus}`}><span className="status-dot" /> {syncStatusLabel(syncStatus)}</div></header>
      {view === 'pregled' && <div className="dashboard-inbox-summary"><button onClick={()=>changeView('zahtjevi-live')}><strong>{inboxCounts.requests}</strong><span>Novi zahtjevi</span></button><button onClick={()=>changeView('poruke-live')}><strong>{inboxCounts.messages}</strong><span>Nove poruke</span></button></div>}
      {view === 'salon-dashboard' && <SalonDashboard appointments={data.appointments} clients={data.clients} unreadMessages={inboxCounts.messages} unreadRequests={inboxCounts.requests} doorbell={doorbellService} onOpenSchedule={()=>changeView('pregled')} onOpenMessages={()=>changeView('poruke-live')} onOpenRequests={()=>changeView('zahtjevi-live')}/>}
      {view === 'pregled' && <section className="day-schedule"><div className="schedule-toolbar"><div><p className="eyebrow">DANAŠNJI RASPORED</p><h2>{new Date(`${selectedCalendarDate}T12:00:00`).toLocaleDateString('hr-HR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</h2></div><div className="schedule-navigation">{!viewingToday&&<button className="secondary day-arrow" type="button" aria-label="Prethodni dan" onClick={()=>moveCalendarDay(-1)}>‹</button>}<button className="secondary today-button" type="button" onClick={()=>void requestCalendarDate(todayCalendarDate)}>Danas</button><button className="secondary day-arrow" type="button" aria-label="Sljedeći dan" onClick={()=>moveCalendarDay(1)}>›</button><input aria-label="Odaberite datum rasporeda" type="date" min={todayCalendarDate} value={selectedCalendarDate} onChange={event=>void requestCalendarDate(event.target.value)}/></div></div><p className={`working-hours-label ${workingHours?'':'closed'}`}>{workingHoursLabel}</p><p className="schedule-hint">Radno vrijeme označeno je toplom pozadinom; termini izvan njega i dalje su dopušteni.</p><div className="calendar-scroll"><div className="day-calendar"><div className="calendar-time-axis" aria-hidden="true">{calendarMarks.map(mark=><span className={mark.isHour?'hour':'half-hour'} style={{top:`${mark.topPercent}%`}} key={mark.label}>{mark.label}</span>)}</div><div className={`calendar-grid ${workingHours?'has-working-hours':'closed-day'}`} onClick={openCalendarSlot}>{workingHours&&<span className="working-hours-band" aria-hidden="true" style={{top:`${workingHours.topPercent}%`,height:`${workingHours.heightPercent}%`}}/>}{calendarMarks.map(mark=><span className={mark.isHour?'calendar-line hour':'calendar-line half-hour'} style={{top:`${mark.topPercent}%`}} key={mark.label}/>)}{selectedAdminRequest&&requestDraftLayout?.visible&&<div ref={requestDraftRef} data-request-id={selectedAdminRequest.id} className={`request-draft-event ${requestDraftConflicts.length?'has-conflict':''}`} style={{top:`${requestDraftLayout.topPercent}%`,height:`max(${requestDraftLayout.heightPercent}%, 52px)`}} onPointerDown={event=>{if((event.target as HTMLElement).closest('button'))return;event.currentTarget.setPointerCapture(event.pointerId)}} onPointerMove={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;const grid=event.currentTarget.parentElement?.getBoundingClientRect();if(grid)setRequestDraftTime(timeFromCalendarPosition(event.clientY-grid.top,grid.height))}} onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}} onClick={event=>event.stopPropagation()}><div className="request-draft-time"><strong>{requestDraftTime}–{minutesToTime(timeToMinutes(requestDraftTime)+requestDraftDuration)}</strong><span>{requestDraftDuration} min</span></div><div className="request-draft-summary"><strong>{selectedAdminRequest.clientName}</strong>{selectedAdminRequest.treatments.length?<ul>{selectedAdminRequest.treatments.map(item=><li key={item.serviceId}>{item.name} · {item.durationMinutes} min</li>)}</ul>:<span>Bez odabrane usluge</span>}{(selectedAdminRequest.clientReply||selectedAdminRequest.message)&&<small>{selectedAdminRequest.clientReply?`Nova želja klijenta: ${selectedAdminRequest.clientReply}`:selectedAdminRequest.message}</small>}</div><div className="request-draft-controls">{requestDraftConflicts.length>0&&<em>Preklapanje s {requestDraftConflicts.length} {requestDraftConflicts.length===1?'terminom':'termina'} je dopušteno</em>}<button type="button" disabled={inboxBusy} onClick={()=>void sendSelectedRequestProposal()}>{inboxBusy?'Slanje…':'Pošalji prijedlog termina'}</button><button type="button" className="request-draft-close" aria-label="Zatvori probni termin" onClick={()=>{setSelectedAdminRequest(undefined);setRequestDraftTime('')}}>×</button></div></div>}{calendarAppointments.map((item,index)=>{const catalogDuration=serviceCatalog.find(service=>service.id===item.serviceId)?.durationMinutes;const layout=calendarEventLayout(item.dateTime,item.serviceDuration??catalogDuration);if(!layout.visible)return null;const overlap=calendarOverlapDepth(calendarAppointments,index);const start=item.dateTime.slice(11,16);const end=minutesToTime(timeToMinutes(start)+layout.displayDuration);const pending=item.confirmationStatus==='pending';const zIndex=1000-Math.max(1,layout.displayDuration);return <button type="button" data-appointment-id={item.id} className={`calendar-event ${item.status} ${item.noCharge?'no-charge':''} ${pending?'pending-confirmation':''} ${overlap.overlaps?'has-overlap':''} ${overlap.depth>0?'overlap-top':''}`} style={{top:`${layout.topPercent}%`,height:`max(${layout.heightPercent}%, 34px)`,left:`${8+Math.min(overlap.depth,3)*12}px`,zIndex}} key={item.id} onClick={event=>{event.stopPropagation();queueAppointmentReschedule(item)}} onDoubleClick={event=>{event.stopPropagation();openAppointmentDetailsFromCalendar(item)}}><time>{start}–{end}</time><strong>{findClientName(data.clients,item.clientId)}</strong><span>{item.service||'Termin bez tretmana'}</span><small>{pending?'Čeka potvrdu':item.noCharge?'Gratis':appointmentStatusLabel(item.status)}</small></button>})}</div></div></div></section>}
      {view === 'klijenti' && <section className="panel"><div className="panel-head stack-mobile"><div><p className="eyebrow">KARTOTEKA</p><h2>Moji klijenti</h2></div><div className="toolbar"><input aria-label="Pretraži klijente" placeholder="Pretraži ime ili telefon…" value={query} onChange={e => setQuery(e.target.value)} /><button className="primary" onClick={() => {setNewClientPin('');setClientForm(emptyClient())}}>+ Novi klijent</button></div></div>
        <div className="client-grid">{filteredClients.map(client => { const portalStatus=portalStatuses[client.id];const portalActive=portalStatus?.activated===true;const clientUnreadMessages=adminMessages.filter(item=>item.clientId===client.id&&item.sender==='client'&&!item.read&&!item.archivedAt).length;const clientNewRequests=adminRequests.filter(item=>item.clientId===client.id&&item.status==='pending'&&!item.readAt).length;const nextAppointment=data.appointments.filter(item=>item.clientId===client.id&&item.status==='zakazan'&&new Date(item.dateTime).getTime()>=Date.now()).sort((left,right)=>left.dateTime.localeCompare(right.dateTime))[0];return <article className="client-card clickable" role="button" tabIndex={0} key={client.id} onClick={()=>void openClientCard(client)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void openClientCard(client)}}}>{client.photo ? <img src={client.photo.thumb} alt="" /> : <span className="avatar">{client.firstName[0]}{client.lastName[0]}</span>}<div><h3>{client.lastName}, {client.firstName}</h3><a href={`tel:${client.phone}`} onClick={event=>event.stopPropagation()}>{client.phone}</a>{(clientUnreadMessages>0||clientNewRequests>0)&&<div className="client-alerts">{clientUnreadMessages>0&&<span>{clientUnreadMessages} novih poruka</span>}{clientNewRequests>0&&<span>{clientNewRequests} novih zahtjeva</span>}</div>}<small className={portalActive?'portal-row-active':'portal-row-inactive'}>{portalActive?'Portal aktivan':'Portal nije aktiviran'}</small></div><div className="client-next-appointment"><small>Sljedeći termin</small>{nextAppointment?<><strong>{formatDateTime(nextAppointment.dateTime)}</strong><span>{nextAppointment.service}</span></>:<span>Nema budućeg termina</span>}</div></article> })}</div></section>}
      {view === 'cjenik' && <section className="panel price-panel"><div className="panel-head"><div><p className="eyebrow">USLUGE I CIJENE</p><h2>Cjenik</h2></div><button className="secondary compact-action" onClick={() => setCategoryForm({id:'',name:'',isActive:true,displayOrder:categoryCatalog.length+1})}>+ Kategorija</button></div><div className="admin-price-accordion">{orderedCategories(categoryCatalog).map(category=>{const open=openPriceCategoryId===category.id;const categoryServices=orderedServices(serviceCatalog.filter(item=>item.categoryId===category.id));return <article className={`admin-price-category ${open?'open':''}`} key={category.id}><div className="admin-category-row"><button className="category-toggle" type="button" aria-expanded={open} onClick={()=>setOpenPriceCategoryId(open?'':category.id)}><span className="category-chevron" aria-hidden="true">›</span><span><strong>{category.name}</strong><small>{categoryServices.length} {categoryServices.length===1?'stavka':'stavki'} · {category.isActive?'Aktivna':'Neaktivna'}</small></span></button><button className="link compact-edit" type="button" onClick={()=>setCategoryForm(category)}>Uredi</button></div>{open&&<div className="admin-category-items">{categoryServices.map(item=><div className="admin-price-row" key={item.id}><div><span>{item.name}</span><small>{item.durationMinutes?`${item.durationMinutes} min`:'Trajanje nije uneseno'} · {item.isActive?'Aktivna':'Neaktivna'} · {item.isBookable?'Za termin':'Dodatak'}</small></div><strong>{item.price.toLocaleString('hr-HR',{style:'currency',currency:'EUR'})}</strong><button className="link compact-edit" type="button" onClick={()=>setServiceForm(item)}>Uredi</button></div>)}<button className="link add-category-service" type="button" onClick={()=>setServiceForm({id:'',categoryId:category.id,categoryName:category.name,name:'',price:0,isActive:true,isBookable:true,displayOrder:categoryServices.length+1})}>+ Dodaj uslugu</button></div>}</article>})}</div></section>}
      {view === 'zahtjevi' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">KLIJENTSKI PORTAL</p><h2>Zahtjevi klijenata</h2></div><span className="request-count">{openRequests.length} otvorenih</span></div><div className="request-inbox">{portal.requests.length ? portal.requests.map(request => <article key={request.id} className={`request-card ${request.status}`}><div className="request-card-head"><div><strong>{findClientName(data.clients,request.clientId)}</strong><small>{formatDateTime(request.createdAt)}</small></div><span>{request.status.replace('_',' ')}</span></div><p><b>{request.kind === 'termin' ? request.service : request.kind === 'promjena' ? 'Zahtjev za promjenu' : 'Zahtjev za otkazivanje'}</b></p>{request.preferredDates.length > 0 && <p>Poželjni dani: {request.preferredDates.map(formatDate).join(', ')} · {request.dayPeriod}</p>}<p>{request.message || 'Bez dodatne poruke.'}</p>{request.adminReply && <p className="admin-reply">Odgovor: {request.adminReply}</p>}<div className="request-actions">{request.kind === 'termin' && request.status !== 'potvrđeno' && <button className="primary" onClick={() => createAppointmentFromRequest(request.id)}>Izradi termin</button>}<button className="secondary" onClick={() => replyToRequest(request.id,'u_razgovoru')}>Odgovori / drugi prijedlog</button><button className="danger-action" onClick={() => replyToRequest(request.id,'odbijeno')}>Odbij</button></div></article>) : <p className="empty-state">Još nema zahtjeva iz klijentskog portala.</p>}</div></section>}
      {view === 'poruke' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">INBOX</p><h2>Poruke klijenata</h2></div></div><div className="message-list">{[...data.messages].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(message => <button key={message.id} className={`message ${message.read?'':'unread'}`} onClick={() => update({...data,messages:markMessageRead(data.messages,message.id)})}><span className="avatar">{message.senderName.split(' ').map(x=>x[0]).join('').slice(0,2)}</span><div><div><strong>{message.senderName}</strong><time>{formatDateTime(message.createdAt)}</time></div><p>{message.text}</p><small>{message.senderPhone}</small></div></button>)}</div></section>}
      {view === 'arhiva' && <section className="panel"><div className="panel-head"><div><p className="eyebrow">INSPIRACIJA I POVIJEST</p><h2>Arhiva frizura</h2></div><button className="primary" onClick={() => { setArchiveFiles([]); setArchiveOpen(true) }}>+ Dodaj tretman</button></div>{archiveProgress&&<p className="archive-progress" role="status">{archiveProgress}</p>}<div className="gallery">{supabase?treatmentArchives.map(entry => <article className="treatment-archive-card" key={entry.id}><div className="treatment-photo-grid">{entry.photos.map(photo=><figure key={photo.id}><a href={photo.imageUrl} target="_blank" rel="noreferrer"><img src={photo.thumbnailUrl||photo.imageUrl} alt={photo.phase==='before'?'Prije tretmana':'Poslije tretmana'} /></a><figcaption>{photo.phase==='before'?'Prije':'Poslije'}</figcaption><div className="archive-photo-actions"><label className="link">Zamijeni<input type="file" accept="image/*,.heic,.heif" onChange={event=>void replaceArchivePhoto(entry,photo.id,event.target.files?.[0])}/></label><button className="link danger-link" type="button" onClick={()=>void removeArchivePhoto(entry,photo.id)}>Obriši</button></div></figure>)}</div><div><small>{formatDate(entry.takenAt)}</small><h3>{findClientName(data.clients,entry.clientId)}</h3><p>{entry.notes}</p><button className="link" onClick={()=>void toggleArchiveVisibility(entry)}>{entry.visibleToClient?'Sakrij od klijenta':'Podijeli s klijentom'}</button></div></article>):data.hairstyles.map(entry => <article key={entry.id}><div className="photo-pair"><figure><img src={entry.before.thumb} alt="Prije" /><figcaption>Prije</figcaption></figure>{entry.after&&<figure><img src={entry.after.thumb} alt="Poslije" /><figcaption>Poslije</figcaption></figure>}</div><div><small>{formatDate(entry.date)}</small><h3>{findClientName(data.clients,entry.clientId)}</h3><p>{entry.note}</p></div></article>)}</div></section>}
      {view === 'postavke' && <section className="panel settings-panel"><div className="panel-head"><div><p className="eyebrow">SIGURNOST</p><h2>Postavke</h2></div></div><div className="settings-list"><div><div><strong>Administratorski PIN</strong><p>Postavite ili promijenite PIN koji štiti arhivu termina.</p></div><button className="secondary" type="button" onClick={()=>void openAdminPinSettings()}>{adminPinSet===false?'Postavi PIN':'Postavi ili promijeni PIN'}</button></div><div><div><strong>Arhiva termina</strong><p>Pregled prošlih termina zaštićen administratorskim PIN-om.</p></div><button className="secondary" type="button" onClick={()=>void openAppointmentArchive()}>Otvori arhivu</button></div></div></section>}
      {view === 'arhiva-termina' && appointmentArchiveUnlocked && <section className="panel appointment-archive"><div className="panel-head"><div><p className="eyebrow">ZAŠTIĆENI PREGLED</p><h2>Arhiva termina</h2></div><button className="secondary" type="button" onClick={()=>setView('postavke')}>Natrag</button></div><div className="table-wrap"><table><thead><tr><th>Datum i vrijeme</th><th>Klijent</th><th>Usluga</th><th>Status</th><th /></tr></thead><tbody>{pastAppointments.map(item=><tr key={item.id}><td>{formatDateTime(item.dateTime)}</td><td>{findClientName(data.clients,item.clientId)}</td><td>{item.service}</td><td><span className={`badge ${item.noCharge?'no-charge':item.status}`}>{item.noCharge?'Privatno / gratis – bez naplate':appointmentStatusLabel(item.status)}</span></td><td><button className="link" type="button" onClick={()=>setAppointmentDetails(item)}>Detalji</button></td></tr>)}</tbody></table>{pastAppointments.length===0&&<p className="empty-state">Nema evidentiranih prošlih termina.</p>}</div></section>}
      {view === 'zahtjevi-live' && <AdminRequestInbox
        requests={activeAdminRequests}
        selected={selectedAdminRequest}
        busy={inboxBusy}
        duration={requestDraftDuration}
        onDurationChange={setRequestDurationOverride}
        services={serviceCatalog}
        categories={categoryCatalog}
        onAddTreatment={service => setSelectedAdminRequest(current => current
          ? { ...current, treatments: addRequestTreatment(current.treatments, service) }
          : current)}
        onRemoveTreatment={serviceId => setSelectedAdminRequest(current => current
          ? { ...current, treatments: removeRequestTreatment(current.treatments, serviceId) }
          : current)}
        onTreatmentDurationChange={(serviceId, duration) => setSelectedAdminRequest(current => current
          ? { ...current, treatments: updateRequestTreatmentDuration(current.treatments, serviceId, duration) }
          : current)}
        onOpen={openAdminRequest}
        onAccept={acceptAdminRequest}
        onRespond={respondToAdminRequest}
        onDelete={deleteAdminRequest}
        onClose={()=>setSelectedAdminRequest(undefined)}
      />}
      {view === 'poruke-live' && <AdminChatView messages={adminMessages} selected={selectedAdminMessage} busy={inboxBusy} clients={data.clients} onOpen={openAdminMessage} onReply={replyToAdminMessage} onNew={sendNewAdminMessage} onDelete={deleteAdminMessage} onClose={()=>setSelectedAdminMessage(undefined)}/>}
    </main>
    <div className="mobile-nav">{nav.map(item => {const count=item.id==='poruke-live'?inboxCounts.messages:item.id==='zahtjevi-live'?inboxCounts.requests:0;return <button key={item.id} className={view===item.id?'active':''} onClick={() => changeView(item.id)}><span>{item.icon}</span>{item.label}{count>0&&<b className="nav-count">{count}</b>}</button>})}</div>{notice&&<div className="toast">{notice}</div>}
    {movingAppointment&&<MovingAppointment appointment={movingAppointment} selectedDate={selectedCalendarDate} onChange={setMovingAppointment} onDateChange={setSelectedCalendarDate} onEdit={()=>{setAppointmentPlaced(true);setAppointmentForm(movingAppointment);setMovingAppointment(null)}} onCancel={()=>setMovingAppointment(null)}/>}
    {rescheduleDraft&&<><div className="reschedule-unlocked-banner" role="status"><strong>Termin je spreman za pomicanje</strong><span>Povucite blok prstom ili mišem. Vrijeme se poravnava na 15 minuta.</span>{rescheduleConflicts.length>0&&<em>Preview se preklapa s {rescheduleConflicts.length} {rescheduleConflicts.length===1?'terminom':'termina'}.</em>}<div><button type="button" className="secondary" onClick={()=>void requestCalendarDate(calendarDateAfterMove(selectedCalendarDate,-1))}>Prethodni dan</button><button type="button" className="secondary" onClick={()=>void requestCalendarDate(calendarDateAfterMove(selectedCalendarDate,1))}>Sljedeći dan</button><button type="button" className="link" onClick={()=>{const original=data.appointments.find(item=>item.id===rescheduleDraft.id);if(original)setSelectedCalendarDate(original.dateTime.slice(0,10));setRescheduleDraft(null)}}>Odustani</button></div></div><MovingAppointment appointment={rescheduleDraft} selectedDate={selectedCalendarDate} onChange={setRescheduleDraft} onDateChange={date=>{setSelectedCalendarDate(date);setRescheduleDraft(current=>current?{...current,dateTime:`${date}T${current.dateTime.slice(11,16)}`}:current)}} onEdit={()=>void saveRescheduledAppointment(rescheduleDraft)} onDrop={appointment=>void saveRescheduledAppointment(appointment)} onCancel={()=>{const original=data.appointments.find(item=>item.id===rescheduleDraft.id);if(original)setSelectedCalendarDate(original.dateTime.slice(0,10));setRescheduleDraft(null)}}/></>}
    {appointmentForm&&!appointmentForm.id&&!appointmentPlaced&&<div className="appointment-quick-actions"><button type="button" className="primary" onClick={placeAppointmentFromForm}>Postavi u kalendar</button></div>}
    {appointmentForm&&(appointmentPlaced||appointmentForm.confirmationStatus==='pending')&&<div className="appointment-confirmation-actions"><button type="button" className="secondary" disabled={!portalStatuses[appointmentForm.clientId]?.activated} onClick={()=>submitPlacedAppointment('pending')}>Pošalji klijentu na potvrdu</button><button type="button" className="primary" onClick={()=>submitPlacedAppointment('confirmed')}>Potvrdi termin odmah</button>{!portalStatuses[appointmentForm.clientId]?.activated&&<small>Portal klijenta nije aktiviran; termin možete potvrditi odmah.</small>}</div>}
    {inviteLink&&<Modal title="Pošalji pristup" onClose={() => setInviteLink('')}><div className="invite-modal"><p>Ovaj uređaj nema izvorni izbornik za dijeljenje. Kopirajte adresu i pošaljite je klijentu.</p><textarea readOnly rows={4} value={inviteLink}/><button className="primary" onClick={() => void navigator.clipboard.writeText(inviteLink)}>Kopiraj adresu</button></div></Modal>}
    {pinClientId&&<Modal title="Novi privremeni PIN" onClose={() => setPinClientId('')}><form onSubmit={event => void saveTemporaryPin(event)}><p className="pin-guidance">Postavite četveroznamenkasti PIN. Klijent će ga morati promijeniti pri prvoj prijavi.</p><label>Privremeni PIN<input required type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} value={temporaryPin} onChange={event => setTemporaryPin(event.target.value.replace(/\D/g, '').slice(0, 4))}/></label>{pinError&&<p className="form-error" role="alert">{pinError}</p>}<FormActions disabled={temporaryPin.length !== 4} onCancel={() => setPinClientId('')}/></form></Modal>}
    {issuedTemporaryPin&&<Modal title="Privremeni PIN je postavljen" onClose={() => setIssuedTemporaryPin(null)}><div className="issued-pin"><p>Klijent se prijavljuje brojem mobitela i ovim privremenim PIN-om:</p><output aria-label="Novi privremeni PIN">{issuedTemporaryPin.pin}</output><button className="primary" type="button" onClick={() => void navigator.clipboard.writeText(issuedTemporaryPin.pin)}>Kopiraj PIN</button><p className="pin-warning" role="status">PIN će ostati vidljiv u kartici klijenta dok ga klijent ne promijeni pri prvoj prijavi.</p></div></Modal>}
    {deleteClientTarget&&<Modal title="Obriši klijenta" onClose={()=>setDeleteClientTarget(null)}><form onSubmit={event=>void deleteClient(event)}><p>Za brisanje klijenta <strong>{deleteClientTarget.firstName} {deleteClientTarget.lastName}</strong> unesite administratorski PIN.</p><AdminPinInput label="Administratorski PIN" autoFocus value={deleteClientPin} onChange={setDeleteClientPin}/>{deleteClientError&&<p className="form-error" role="alert">{deleteClientError}</p>}<div className="form-actions"><button className="secondary" type="button" onClick={()=>setDeleteClientTarget(null)}>Odustani</button><button className="danger-action" type="submit" disabled={!isValidAdminPin(deleteClientPin)}>Obriši klijenta</button></div></form></Modal>}
    {adminPinDialog&&<Modal title={adminPinDialog==='unlock'?'Otključaj arhivu termina':adminPinDialog==='change'?'Promijeni administratorski PIN':'Postavi administratorski PIN'} onClose={closeAdminPinDialog}><form className="admin-pin-form" autoComplete="off" onSubmit={submitAdminPin}>{adminPinDialog==='change'&&<AdminPinInput label="Trenutačni PIN" slots={6} value={currentAdminPin} onChange={setCurrentAdminPin}/>}<AdminPinInput label={adminPinDialog==='unlock'?'Administratorski PIN':'Novi PIN'} autoFocus value={adminPin} onChange={setAdminPin}/>{adminPinDialog!=='unlock'&&<AdminPinInput label="Ponovite novi PIN" value={adminPinConfirm} onChange={setAdminPinConfirm}/>}<small className="pin-format-hint">{adminPinDialog==='change'?'Trenutačni PIN može imati 4 do 6 znamenki. Novi PIN mora imati točno 4 znamenke.':'PIN mora imati točno 4 znamenke.'}</small>{adminPinError&&<p className="form-message" role="alert">{adminPinError}</p>}<div className="form-actions"><button className="secondary" type="button" onClick={closeAdminPinDialog}>Odustani</button><button className="primary" type="submit" disabled={adminPinBusy||!isValidAdminPin(adminPin)||(adminPinDialog!=='unlock'&&!isValidAdminPin(adminPinConfirm))||(adminPinDialog==='change'&&!isValidCurrentAdminPin(currentAdminPin))}>{adminPinBusy?'Provjera…':adminPinDialog==='unlock'?'Otključaj':'Spremi PIN'}</button></div></form></Modal>}
    {clientForm&&<Modal title={clientForm.id?'Kartica klijenta':'Novi klijent'} onClose={() => setClientForm(null)}><form onSubmit={saveClient}><div className="form-grid"><label>Ime<input required value={clientForm.firstName} onChange={e=>setClientForm({...clientForm,firstName:e.target.value})}/></label><label>Prezime<input required value={clientForm.lastName} onChange={e=>setClientForm({...clientForm,lastName:e.target.value})}/></label></div><label>Telefon<input required type="tel" inputMode="tel" autoComplete="tel" value={clientForm.phone} onChange={e=>setClientForm({...clientForm,phone:e.target.value})}/></label>{!clientForm.id&&<label>Početni PIN koji zadaje Kristina<input required type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{4}" maxLength={4} value={newClientPin} onChange={event=>setNewClientPin(event.target.value.replace(/\D/g,'').slice(0,4))}/><small>Klijent ga mora promijeniti pri prvoj prijavi.</small></label>}{clientForm.id&&<section className="client-portal-access"><strong>Pristup klijentskom portalu</strong><span className={portalStatuses[clientForm.id]?.activated?'portal-active':'portal-inactive'}>{portalStatuses[clientForm.id]?.activated?(portalStatuses[clientForm.id]?.temporary?'Aktivan · promjena PIN-a obavezna':'Aktivan'):'Portal nije aktiviran'}</span>{portalStatuses[clientForm.id]?.currentPin&&<output className="client-temporary-pin">Trenutačni PIN: <b>{portalStatuses[clientForm.id]?.currentPin}</b></output>}<button className="invite-action" type="button" onClick={()=>{const id=clientForm.id;setClientForm(null);if(portalStatuses[id]?.activated)openTemporaryPin(id);else void prepareInitialPin(id)}}>{portalStatuses[clientForm.id]?.activated?'Postavi novi privremeni PIN':'Aktiviraj pristup i postavi PIN'}</button></section>}<div className="form-field"><span>Profilna fotografija</span><ClientPhotoInput value={clientForm.photo} onChange={photo=>setClientForm({...clientForm,photo})}/></div><label>Bilješka<textarea rows={4} value={clientForm.note} onChange={e=>setClientForm({...clientForm,note:e.target.value})}/></label>{clientForm.id&&<button className="danger-action" type="button" onClick={()=>{const target=clientForm;setClientForm(null);setDeleteClientPin('');setDeleteClientError('');setDeleteClientTarget(target)}}>Obriši klijenta</button>}<FormActions disabled={isSavingClient||(!clientForm.id&&newClientPin.length!==4)} submitting={isSavingClient} onCancel={()=>setClientForm(null)}/></form></Modal>}
    {appointmentDetails&&<Modal title="Detalji termina" onClose={()=>setAppointmentDetails(null)}><section className="appointment-detail-view"><dl className="detail-grid"><div><dt>Klijent</dt><dd>{findClientName(data.clients,appointmentDetails.clientId)}</dd></div><div><dt>Datum</dt><dd>{formatDate(appointmentDetails.dateTime.slice(0,10))}</dd></div><div><dt>Vrijeme</dt><dd>{appointmentDetails.dateTime.slice(11,16)}–{minutesToTime(timeToMinutes(appointmentDetails.dateTime.slice(11,16))+(appointmentDetails.serviceDuration||30))}</dd></div><div><dt>Ukupno trajanje</dt><dd>{appointmentDetails.serviceDuration||30} min</dd></div><div><dt>Status</dt><dd>{appointmentDetails.confirmationStatus==='pending'?'Čeka potvrdu':appointmentStatusLabel(appointmentDetails.status)}</dd></div></dl><div className="appointment-detail-treatments"><strong>Usluge i trajanja</strong>{appointmentDetails.treatments?.length?<ul>{appointmentDetails.treatments.map(item=><li key={item.serviceId}><span>{item.name}</span><b>{item.durationMinutes??0} min</b></li>)}</ul>:<p>Termin bez tretmana.</p>}</div><div className="form-actions"><button type="button" className="secondary" onClick={()=>setAppointmentDetails(null)}>Zatvori</button><button type="button" className="secondary" disabled={appointmentDetails.status!=='zakazan'||appointmentDetails.confirmationStatus==='pending'} onClick={()=>beginAppointmentReschedule(appointmentDetails)}>Pomakni termin</button><button type="button" className="danger-action" disabled={appointmentDetails.status!=='zakazan'||appointmentDetails.confirmationStatus==='pending'} onClick={()=>beginAppointmentCancellation(appointmentDetails)}>Otkaži termin</button></div></section></Modal>}
    {cancellationTarget&&<Modal title="Otkaži termin" onClose={()=>{if(!appointmentActionBusy)setCancellationTarget(null)}}><section className="cancellation-form"><p>Termin za <strong>{findClientName(data.clients,cancellationTarget.clientId)}</strong>, {formatDate(cancellationTarget.dateTime.slice(0,10))} u {cancellationTarget.dateTime.slice(11,16)}.</p><label>Razlog otkazivanja (neobavezno)<textarea rows={3} value={cancellationReason} onChange={event=>setCancellationReason(event.target.value)}/></label><div className="form-actions"><button type="button" className="secondary" disabled={appointmentActionBusy} onClick={()=>setCancellationTarget(null)}>Odustani</button><button type="button" className="danger-action" disabled={appointmentActionBusy} onClick={()=>void cancelAdminAppointment()}>{appointmentActionBusy?'Otkazivanje…':'Potvrdi otkazivanje'}</button></div></section></Modal>}
    {appointmentForm&&<Modal title={appointmentForm.id?'Uredi termin':'Novi termin'} onClose={()=>setAppointmentForm(null)}><form onSubmit={event=>void saveAppointment(event)}><div className="form-field"><span id="client-picker-label">Klijent</span><ClientPicker clients={data.clients} value={appointmentForm.clientId} onChange={clientId=>setAppointmentForm({...appointmentForm,clientId})}/></div><div className="date-time-fields"><label>Datum<input required type="date" value={appointmentForm.dateTime.slice(0,10)} onChange={e=>{const date=e.target.value;const time=firstAvailableTime(date,appointmentForm.service,data.appointments,appointmentForm.id);setAppointmentForm({...appointmentForm,dateTime:time?`${date}T${time}`:`${date}T`})}}/></label><div className="form-field"><span id="time-picker-label">Vrijeme</span><TimePicker date={appointmentForm.dateTime.slice(0,10)} value={appointmentForm.dateTime.slice(11,16)} service={appointmentForm.service} appointments={data.appointments} clients={data.clients} editingId={appointmentForm.id} allowOverride={currentUserRole==='administrator'} onChange={time=>setAppointmentForm({...appointmentForm,dateTime:`${appointmentForm.dateTime.slice(0,10)}T${time}`})}/></div></div><label>Kategorija tretmana<select value={selectedAppointmentCategoryId} onChange={event=>setAppointmentForm({...appointmentForm,serviceCategoryId:event.target.value})}><option value="">Odaberite kategoriju</option>{orderedCategories(categoryCatalog).filter(category=>category.isActive&&appointmentServices(serviceCatalog,category.id).length).map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Dodaj tretman<span className="service-select"><select disabled={!selectedAppointmentCategoryId} value="" onChange={event=>{const selected=serviceCatalog.find(item=>item.id===event.target.value);if(selected)setAppointmentForm(addTreatmentPreservingOverrides(appointmentForm,selected))}}><option value="">{selectedAppointmentCategoryId?'Odaberite tretman':'Prvo odaberite kategoriju'}</option>{appointmentServices(serviceCatalog,selectedAppointmentCategoryId).filter(item=>!appointmentForm.treatments?.some(selected=>selected.serviceId===item.id)).map(item=><option key={item.id} value={item.id}>{item.name} — {item.price.toLocaleString('hr-HR',{style:'currency',currency:'EUR'})}{item.durationMinutes?` · ${item.durationMinutes} min`:''}</option>)}</select><span aria-hidden="true">⌄</span></span></label><div className="selected-treatments">{appointmentForm.treatments?.map(item=><div key={item.serviceId}><span>{item.name}</span><small>{item.price.toLocaleString('hr-HR',{style:'currency',currency:'EUR'})}{item.durationMinutes?` · ${item.durationMinutes} min`:''}</small><button className="link" type="button" onClick={()=>setAppointmentForm(removeTreatmentPreservingOverrides(appointmentForm,item.serviceId))}>Ukloni</button></div>)}</div><div className="form-grid"><label>Ukupno trajanje (min)<input type="number" min="15" step="15" value={appointmentForm.serviceDuration??''} onChange={event=>setAppointmentForm({...appointmentForm,serviceDuration:Number(event.target.value)})}/></label><label>Konačna cijena (€)<input type="number" min="0" step="0.01" disabled={appointmentForm.noCharge} value={finalAppointmentPrice(appointmentForm)} onChange={event=>setAppointmentForm({...appointmentForm,servicePrice:Number(event.target.value)})}/></label></div><div className="form-grid"><label>Status<select value={appointmentForm.status} onChange={e=>setAppointmentForm({...appointmentForm,status:e.target.value as Appointment['status']})}><option value="zakazan">Zakazan</option><option value="zavrsen">Završen</option><option value="otkazan">Otkazan</option></select></label><label>Termin unosi<input value="Kristina" disabled/></label></div><label className="checkbox-field"><input type="checkbox" checked={appointmentForm.noCharge===true} onChange={event=>setAppointmentForm({...appointmentForm,noCharge:event.target.checked,servicePrice:event.target.checked?0:undefined})}/> Privatno / gratis – bez naplate</label><p className="hint no-charge-hint">Oznaka samo evidentira da naplate nije bilo; ne određuje fiskalni tretman.</p><label>Bilješka<textarea rows={3} value={appointmentForm.note} onChange={e=>setAppointmentForm({...appointmentForm,note:e.target.value})}/></label><FormActions disabled={!appointmentForm.clientId||!isValidAppointmentDuration(appointmentForm.serviceDuration)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(appointmentForm.dateTime)} onCancel={()=>setAppointmentForm(null)}/></form></Modal>}
    {serviceForm&&<Modal title={serviceForm.id?'Uredi stavku cjenika':'Nova stavka cjenika'} onClose={()=>setServiceForm(null)}><form onSubmit={event=>void saveService(event)}><label>Kategorija<select required value={serviceForm.categoryId} onChange={event=>{const category=categoryCatalog.find(item=>item.id===event.target.value);setServiceForm({...serviceForm,categoryId:event.target.value,categoryName:category?.name??''})}}>{orderedCategories(categoryCatalog).map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Naziv<input required value={serviceForm.name} onChange={event=>setServiceForm({...serviceForm,name:event.target.value})}/></label><div className="form-grid"><label>Cijena (€)<input required type="number" min="0" step="0.01" value={serviceForm.price} onChange={event=>setServiceForm({...serviceForm,price:Number(event.target.value)})}/></label><label>Trajanje (min)<input type="number" min="1" step="1" value={serviceForm.durationMinutes??''} onChange={event=>setServiceForm({...serviceForm,durationMinutes:event.target.value?Number(event.target.value):undefined})}/></label></div><label>Redoslijed unutar kategorije<input required type="number" min="0" step="1" value={serviceForm.displayOrder} onChange={event=>setServiceForm({...serviceForm,displayOrder:Number(event.target.value)})}/></label><label className="checkbox-field"><input type="checkbox" checked={serviceForm.isActive} onChange={event=>setServiceForm({...serviceForm,isActive:event.target.checked})}/> Aktivna stavka</label><label className="checkbox-field"><input type="checkbox" checked={serviceForm.isBookable} onChange={event=>setServiceForm({...serviceForm,isBookable:event.target.checked})}/> Može se samostalno odabrati u terminu</label><FormActions onCancel={()=>setServiceForm(null)}/></form></Modal>}
    {categoryForm&&<Modal title={categoryForm.id?'Uredi kategoriju':'Nova kategorija'} onClose={()=>setCategoryForm(null)}><form onSubmit={event=>void saveCategory(event)}><label>Naziv kategorije<input required value={categoryForm.name} onChange={event=>setCategoryForm({...categoryForm,name:event.target.value})}/></label><label>Redoslijed prikaza<input required type="number" min="0" step="1" value={categoryForm.displayOrder} onChange={event=>setCategoryForm({...categoryForm,displayOrder:Number(event.target.value)})}/></label><label className="checkbox-field"><input type="checkbox" checked={categoryForm.isActive} onChange={event=>setCategoryForm({...categoryForm,isActive:event.target.checked})}/> Aktivna kategorija</label><FormActions onCancel={()=>setCategoryForm(null)}/></form></Modal>}
    {archiveOpen&&<Modal title="Dodaj fotografije tretmana" onClose={()=>{if(!archiveSaving)setArchiveOpen(false)}}><form onSubmit={e=>void saveArchive(e)}><label>Klijent<select required name="clientId" disabled={archiveSaving}><option value="">Odaberite klijenta</option>{data.clients.map(c=><option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></label><label>Datum tretmana<input required name="date" type="date" disabled={archiveSaving} defaultValue={new Date().toISOString().slice(0,10)}/></label><div className="form-grid"><label>Fotografije prije<input required={supabase?archiveFiles.every(item=>item.phase!=='before'):true} multiple type="file" accept="image/*,.heic,.heif" disabled={archiveSaving} onChange={e=>{const files=Array.from(e.target.files??[]);if(supabase)setArchiveFiles(current=>[...current.filter(item=>item.phase!=='before'),...files.map(file=>({file,phase:'before' as const}))]);else imageFiles.current.before=files[0]}}/></label><label>Fotografije poslije<input multiple type="file" accept="image/*,.heic,.heif" disabled={archiveSaving} onChange={e=>{const files=Array.from(e.target.files??[]);if(supabase)setArchiveFiles(current=>[...current.filter(item=>item.phase!=='after'),...files.map(file=>({file,phase:'after' as const}))]);else imageFiles.current.after=files[0]}}/></label></div>{supabase&&archiveFiles.length>0&&<ul className="archive-file-list">{archiveFiles.map((item,index)=><li key={`${item.file.name}-${index}`}><span>{item.phase==='before'?'Prije':'Poslije'}: {item.file.name}</span><button type="button" className="link" disabled={archiveSaving} onClick={()=>setArchiveFiles(current=>current.filter((_,fileIndex)=>fileIndex!==index))}>Ukloni</button></li>)}</ul>}<label>Bilješka<textarea name="note" rows={3} disabled={archiveSaving}/></label><label className="checkbox-field"><input name="visibleToClient" type="checkbox" disabled={archiveSaving}/> Vidljivo klijentu u portalu</label><p className="hint">Fotografije se prije slanja ispravno okreću, pretvaraju u WebP, smanjuju na najviše 1920 px i dobivaju mali pregled.</p>{archiveProgress&&<p className="archive-progress" role="status">{archiveProgress}</p>}<FormActions disabled={archiveSaving||(Boolean(supabase)&&archiveFiles.length===0)} submitting={archiveSaving} onCancel={()=>setArchiveOpen(false)}/></form></Modal>}
  </div>
}
function MovingAppointment({appointment,selectedDate,onChange,onDateChange,onEdit,onDrop,onCancel}:{appointment:Appointment;selectedDate:string;onChange:(appointment:Appointment)=>void;onDateChange:(date:string)=>void;onEdit:()=>void;onDrop?:(appointment:Appointment)=>void;onCancel:()=>void}){
  const lastDayChange=useRef(0)
  const latestAppointmentRef=useRef(appointment)
  const movedRef=useRef(false)
  useEffect(()=>{latestAppointmentRef.current=appointment},[appointment])
  const grid=document.querySelector<HTMLElement>('.calendar-grid')
  if(!grid)return null
  const duration=appointment.serviceDuration||60
  const time=appointment.dateTime.slice(11,16)
  const layout=calendarEventLayout(`${selectedDate}T${time}`,duration)
  const move=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!event.currentTarget.hasPointerCapture(event.pointerId))return
    event.preventDefault()
    const bounds=grid.getBoundingClientRect()
    const nextTime=timeFromCalendarPosition(event.clientY-bounds.top,bounds.height)
    const nextAppointment={...latestAppointmentRef.current,dateTime:`${selectedDate}T${nextTime}`}
    if(nextAppointment.dateTime!==latestAppointmentRef.current.dateTime)movedRef.current=true
    latestAppointmentRef.current=nextAppointment
    onChange(nextAppointment)
    const verticalEdge=Math.min(120,Math.max(72,window.innerHeight*.12))
    if(event.clientY<verticalEdge)window.scrollBy({top:-Math.max(4,Math.round((verticalEdge-event.clientY)/4)),behavior:'auto'})
    if(event.clientY>window.innerHeight-verticalEdge)window.scrollBy({top:Math.max(4,Math.round((event.clientY-(window.innerHeight-verticalEdge))/4)),behavior:'auto'})
    const horizontalEdge=Math.min(80,Math.max(48,bounds.width*.08))
    const direction=event.clientX<=bounds.left+horizontalEdge?-1:event.clientX>=bounds.right-horizontalEdge?1:0
    if(direction&&Date.now()-lastDayChange.current>650){
      const target=calendarDateAfterMove(selectedDate,direction)
      if(canOpenMainCalendarDate(target,localDateString(new Date()))){
        lastDayChange.current=Date.now()
        onDateChange(target)
        const movedAppointment={...latestAppointmentRef.current,dateTime:`${target}T${nextTime}`}
        movedRef.current=true
        latestAppointmentRef.current=movedAppointment
        onChange(movedAppointment)
      }
    }
  }
  return createPortal(<div className="moving-appointment" style={{top:`${layout.topPercent}%`,height:`max(${layout.heightPercent}%, 62px)`}} onPointerDown={event=>{if((event.target as HTMLElement).closest('button'))return;movedRef.current=false;latestAppointmentRef.current=appointment;event.currentTarget.setPointerCapture(event.pointerId)}} onPointerMove={move} onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(movedRef.current)onDrop?.(latestAppointmentRef.current)}} onPointerCancel={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}}><time>{time}–{minutesToTime(timeToMinutes(time)+duration)}</time><strong>{appointment.service}</strong><span>{duration} min · {formatDate(selectedDate)}</span><div><button type="button" className="primary" onClick={onEdit}>Spremi promjenu</button><button type="button" className="secondary" onClick={onCancel}>Odustani</button></div></div>,grid)
}

function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  const dialogRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow='hidden';dialogRef.current?.focus();return()=>{document.body.style.overflow=previous}},[])
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} onKeyDown={e=>{if(e.key==='Escape')onClose()}}><div className="modal-head"><h2 id="modal-title">{title}</h2><button type="button" onClick={onClose} aria-label="Zatvori">×</button></div>{children}</div></div>
}
function ClientPicker({clients,value,onChange}:{clients:Client[];value:string;onChange:(id:string)=>void}){
  const [open,setOpen]=useState(false)
  const [activeIndex,setActiveIndex]=useState(Math.max(0,clients.findIndex(client=>client.id===value)))
  const rootRef=useRef<HTMLDivElement>(null)
  const triggerRef=useRef<HTMLButtonElement>(null)
  const selected=clients.find(client=>client.id===value)
  const listboxId='appointment-client-listbox'
  useEffect(()=>{function close(event:PointerEvent){if(!rootRef.current?.contains(event.target as Node))setOpen(false)}document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[])
  function choose(index:number){const client=clients[index];if(client){onChange(client.id);setActiveIndex(index);setOpen(false);triggerRef.current?.focus()}}
  function handleKeyDown(e:React.KeyboardEvent<HTMLButtonElement>){
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const direction=e.key==='ArrowDown'?1:-1;if(!open){setOpen(true);setActiveIndex(Math.max(0,clients.findIndex(client=>client.id===value)))}else setActiveIndex(index=>(index+direction+clients.length)%clients.length)}
    if(e.key==='Enter'||e.key===' '){e.preventDefault();if(open)choose(activeIndex);else setOpen(true)}
    if(e.key==='Escape'&&open){e.preventDefault();setOpen(false)}
    if(e.key==='Home'&&open){e.preventDefault();setActiveIndex(0)}
    if(e.key==='End'&&open){e.preventDefault();setActiveIndex(clients.length-1)}
  }
  return <div className="client-picker" ref={rootRef}>
    <button ref={triggerRef} type="button" className={`picker-trigger ${open?'open':''}`} aria-labelledby="client-picker-label" aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} aria-required="true" onKeyDown={handleKeyDown} onClick={()=>setOpen(!open)}>
      {selected?<><ClientMiniAvatar client={selected}/><span>{selected.firstName} {selected.lastName}</span></>:<span className="picker-placeholder">Odaberite klijenta</span>}<span className="picker-chevron">⌄</span>
    </button>
    {open&&<div id={listboxId} className="picker-options" role="listbox" aria-label="Klijenti">{clients.map((client,index)=><button type="button" role="option" aria-selected={client.id===value} className={`${client.id===value?'selected ':''}${index===activeIndex?'active':''}`} key={client.id} onPointerMove={()=>setActiveIndex(index)} onClick={()=>choose(index)}><ClientMiniAvatar client={client}/><span>{client.firstName} {client.lastName}</span>{client.id===value&&<b aria-hidden="true">✓</b>}</button>)}</div>}
  </div>
}
function TimePicker({date,value,service,appointments,clients,editingId,allowOverride,onChange}:{date:string;value:string;service:string;appointments:Appointment[];clients:Client[];editingId:string;allowOverride:boolean;onChange:(time:string)=>void}){
  const [open,setOpen]=useState(false)
  const [manual,setManual]=useState(false)
  const rootRef=useRef<HTMLDivElement>(null)
  const triggerRef=useRef<HTMLButtonElement>(null)
  const listboxId='appointment-time-listbox'
  const conflictsByTime=timeOptions.map(time=>conflictingAppointments(date,time,service,appointments,editingId))
  const selectedConflicts=value?conflictingAppointments(date,value,service,appointments,editingId):[]
  useEffect(()=>{function close(event:PointerEvent){if(!rootRef.current?.contains(event.target as Node))setOpen(false)}document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[])
  function move(direction:number){
    const current=Math.max(0,timeOptions.indexOf(value))
    const index=(current+direction+timeOptions.length)%timeOptions.length
    onChange(timeOptions[index])
  }
  return <div className="time-picker" ref={rootRef}>
    <button ref={triggerRef} type="button" className={`time-trigger ${open?'open':''}`} disabled={!date} aria-labelledby="time-picker-label" aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} aria-required="true" onClick={()=>setOpen(!open)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open)setOpen(true);else move(e.key==='ArrowDown'?1:-1)}if(e.key==='Escape'){setOpen(false)}}}>
      <span className={value?'':'time-placeholder'}>{value||'Odaberite vrijeme'}</span><span aria-hidden="true">⌄</span>
    </button>
    {open&&<div id={listboxId} className="time-options" role="listbox" aria-label="Vrijeme termina">{timeOptions.map((time,index)=>{const overlaps=conflictsByTime[index].length>0;return <button type="button" role="option" key={time} disabled={!allowOverride&&overlaps} aria-selected={time===value} className={`${time===value?'selected ':''}${overlaps?'overlap':'free'}`} onClick={()=>{onChange(time);setOpen(false);triggerRef.current?.focus()}}><span>{time}</span>{overlaps?<small>Preklapanje</small>:<b>{time===value?'Odabrano':'Slobodno'}</b>}</button>})}</div>}
    {allowOverride&&<button type="button" className="manual-time-toggle" onClick={()=>{setManual(!manual);setOpen(false)}}>{manual?'Sakrij ručni unos':'Ručno unesi vrijeme'}</button>}
    {allowOverride&&manual&&<label className="manual-time"><span>Početak termina</span><input type="time" min="08:00" max="20:00" step="900" value={value} onChange={e=>{if(!e.target.value||timeOptions.includes(e.target.value))onChange(e.target.value)}}/><small>Samo administratorski unos, u koracima od 15 minuta.</small></label>}
    {selectedConflicts.length>0&&<div className="overlap-warning" role="alert"><strong>Upozorenje: termin se preklapa.</strong>{selectedConflicts.map(item=><span key={item.id}>{findClientName(clients,item.clientId)} · {item.service} · {item.dateTime.slice(11,16)}–{minutesToTime(timeToMinutes(item.dateTime.slice(11,16))+serviceDefinition(item.service).totalDuration)}</span>)}</div>}
  </div>
}
function ClientMiniAvatar({client}:{client:Client}){return client.photo?<img className="client-mini-avatar" src={client.photo.thumb} alt=""/>:<span className="client-mini-avatar initials">{client.firstName[0]}{client.lastName[0]}</span>}
function FormActions({onCancel,disabled=false,submitting=false}:{onCancel:()=>void;disabled?:boolean;submitting?:boolean}){return <div className="form-actions"><button type="button" className="secondary" disabled={submitting} onClick={onCancel}>Odustani</button><button className="primary" type="submit" disabled={disabled}>{submitting?'Spremanje…':'Spremi'}</button></div>}
export default AdminApp

