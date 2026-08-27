import fs from "fs";
import os from "os";
import path from "path";

import {
  PumpState,
  PUMP_STATE_LABELS,
  PUMP_STATE_COLORS,
  defaultSchedule,
  defaultGpioMappings,
  type AnalyticsSummary,
  type LiveStatus,
  type ManualReading,
  type PumpLogEntry,
  type Schedule,
  type SensorSnapshot,
  type NftChannel,
  type GpioMapping,
  type HarvestHistoryEntry,
  type NftCropEntry,
  calculateVpd,
  compensateEc,
  type CameraSettings,
  type CameraSnapshot,
} from "./tower-shared";
import { supabaseAdmin } from "../integrations/supabase/client.server";

export { PumpState, PUMP_STATE_LABELS, PUMP_STATE_COLORS };

type PumpLog = PumpLogEntry;

type PumpLogInput = Omit<PumpLog, "id" | "startedAt" | "endedAt" | "onDurationSeconds" | "offIntervalMinutes"> & {
  mode?: PumpLog["mode"];
  durationSeconds?: number;
  flowed?: boolean;
  fault?: string | null;
  onDurationSeconds?: number;
  offIntervalMinutes?: number;
  startedAtMs?: number;
  endedAtMs?: number;
  volumeLiters?: number | null;
  flowRateLpm?: number | null;
};

const DEFAULT_SCHEDULE: Schedule = defaultSchedule;

const DATA_DIR = process.env.TOWER_DATA_DIR ?? path.join(os.homedir(), ".smart-tower-garden");
const SCHEDULE_FILE = process.env.TOWER_SCHEDULE_FILE ?? path.join(DATA_DIR, "schedule.json");
const DEVICE_SCHEDULES_FILE = process.env.TOWER_DEVICE_SCHEDULES_FILE ?? path.join(DATA_DIR, "device-schedules.json");
const STATE_FILE = process.env.TOWER_STATE_FILE ?? path.join(DATA_DIR, "tower-state.json");
const NFT_CHANNELS_FILE = process.env.TOWER_NFT_CHANNELS_FILE ?? path.join(DATA_DIR, "nft-channels.json");
const GPIO_MAPPINGS_FILE = process.env.TOWER_GPIO_MAPPINGS_FILE ?? path.join(DATA_DIR, "gpio-mappings.json");
const HARVEST_HISTORY_FILE = process.env.TOWER_HARVEST_HISTORY_FILE ?? path.join(DATA_DIR, "harvest-history.json");
const EVENTS_TABLE = "tower_events";

const HAS_SUPABASE_EVENTS = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

let nftChannels: NftChannel[] = [];
let gpioMappings: GpioMapping[] = [];

const DEFAULT_NFT_CHANNELS: NftChannel[] = [
  { id: "PH01-B01-R01-L01-C01", name: "PH01-B01-R01-L01-C01", qrCode: "PH01-B01-R01-L01-C01", cropName: "", plantedAt: null, harvestedAt: null, notes: "", status: "empty", polyhouse: "PH01", block: "B01", row: "R01", level: "L01", channelIndex: 1, capacity: 50 },
  { id: "PH01-B01-R01-L01-C02", name: "PH01-B01-R01-L01-C02", qrCode: "PH01-B01-R01-L01-C02", cropName: "", plantedAt: null, harvestedAt: null, notes: "", status: "empty", polyhouse: "PH01", block: "B01", row: "R01", level: "L01", channelIndex: 2, capacity: 50 },
  { id: "PH01-B01-R01-L02-C01", name: "PH01-B01-R01-L02-C01", qrCode: "PH01-B01-R01-L02-C01", cropName: "", plantedAt: null, harvestedAt: null, notes: "", status: "empty", polyhouse: "PH01", block: "B01", row: "R01", level: "L02", channelIndex: 1, capacity: 50 },
  { id: "PH01-B01-R01-L02-C02", name: "PH01-B01-R01-L02-C02", qrCode: "PH01-B01-R01-L02-C02", cropName: "", plantedAt: null, harvestedAt: null, notes: "", status: "empty", polyhouse: "PH01", block: "B01", row: "R01", level: "L02", channelIndex: 2, capacity: 50 }
];

function loadNftChannelsFromDisk(): NftChannel[] {
  try {
    ensureDataDir();
    if (fs.existsSync(NFT_CHANNELS_FILE)) {
      const raw = fs.readFileSync(NFT_CHANNELS_FILE, "utf8");
      return JSON.parse(raw) as NftChannel[];
    }
  } catch (error) {
    console.error("Failed to load NFT channels from disk:", error);
  }
  return [...DEFAULT_NFT_CHANNELS];
}

function saveNftChannelsToDisk(channels: NftChannel[]) {
  try {
    ensureDataDir();
    fs.writeFileSync(NFT_CHANNELS_FILE, JSON.stringify(channels, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save NFT channels to disk:", error);
  }
}

function loadGpioMappingsFromDisk(): GpioMapping[] {
  try {
    ensureDataDir();
    if (fs.existsSync(GPIO_MAPPINGS_FILE)) {
      const raw = fs.readFileSync(GPIO_MAPPINGS_FILE, "utf8");
      return JSON.parse(raw) as GpioMapping[];
    }
  } catch (error) {
    console.error("Failed to load GPIO mappings from disk:", error);
  }
  return [...defaultGpioMappings];
}

function saveGpioMappingsToDisk(mappings: GpioMapping[]) {
  try {
    ensureDataDir();
    fs.writeFileSync(GPIO_MAPPINGS_FILE, JSON.stringify(mappings, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save GPIO mappings to disk:", error);
  }
}

// Initial NVS load equivalent on backend boot
nftChannels = loadNftChannelsFromDisk();
gpioMappings = loadGpioMappingsFromDisk();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadScheduleFromDisk(): Schedule {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const raw = fs.readFileSync(SCHEDULE_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<Schedule>;
      return { ...DEFAULT_SCHEDULE, ...parsed };
    }
  } catch (error) {
    console.error("Failed to load schedule from disk:", error);
  }

  return { ...DEFAULT_SCHEDULE };
}

function saveScheduleToDisk(nextSchedule: Schedule) {
  try {
    ensureDataDir();
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(nextSchedule, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save schedule to disk:", error);
  }
}

function loadDeviceSchedulesFromDisk(): Record<string, Schedule> {
  try {
    if (fs.existsSync(DEVICE_SCHEDULES_FILE)) {
      const raw = fs.readFileSync(DEVICE_SCHEDULES_FILE, "utf8");
      return JSON.parse(raw) as Record<string, Schedule>;
    }
  } catch (error) {
    console.error("Failed to load device schedules from disk:", error);
  }
  return {};
}

function saveDeviceSchedulesToDisk(schedules: Record<string, Schedule>) {
  try {
    ensureDataDir();
    fs.writeFileSync(DEVICE_SCHEDULES_FILE, JSON.stringify(schedules, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save device schedules to disk:", error);
  }
}

export type UserEntry = {
  username: string;
  passwordHash: string;
  role: "admin" | "operator";
};

type PersistedTowerState = {
  status?: LiveStatus | null;
  statuses?: Record<string, LiveStatus>;
  sensorHistory?: SensorSnapshot[];
  readings?: ManualReading[];
  pumpLogs?: PumpLog[];
  faultHistory?: Array<{ timestamp: number; fault: string; resolved?: number }>;
  geminiApiKey?: string;
  cameraSettings?: CameraSettings;
  cameraSnapshots?: CameraSnapshot[];
  users?: UserEntry[];
};

type TowerEventType =
  | "schedule_updated"
  | "status_updated"
  | "sensor_snapshot_added"
  | "reading_added"
  | "reading_deleted"
  | "pump_log_added"
  | "pump_log_updated"
  | "fault_recorded";

type TowerEventRow = {
  event_type: TowerEventType;
  payload: unknown;
};

function loadStateFromDisk() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;

    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as PersistedTowerState;

    if (parsed.statuses && typeof parsed.statuses === "object") {
      statuses = Object.fromEntries(
        Object.entries(parsed.statuses).map(([deviceId, deviceStatus]) => [deviceId, { ...deviceStatus, deviceId }]),
      );
    } else if (parsed.status && typeof parsed.status === "object") {
      const deviceId = parsed.status.deviceId ?? DEFAULT_DEVICE_ID;
      statuses[deviceId] = { ...parsed.status, deviceId };
    }

    if (Array.isArray(parsed.sensorHistory)) {
      sensorHistory = parsed.sensorHistory;
    }

    if (Array.isArray(parsed.readings)) {
      readings = parsed.readings;
    }

    if (Array.isArray(parsed.pumpLogs)) {
      pumpLogs = parsed.pumpLogs;
    }

    if (Array.isArray(parsed.faultHistory)) {
      faultHistory = parsed.faultHistory;
    }
    if (parsed.geminiApiKey) {
      geminiApiKey = parsed.geminiApiKey;
    }
    if (parsed.cameraSettings) {
      cameraSettings = { ...cameraSettings, ...parsed.cameraSettings };
    }
    if (Array.isArray(parsed.cameraSnapshots)) {
      cameraSnapshots = parsed.cameraSnapshots;
    }
    if (Array.isArray(parsed.users)) {
      users = parsed.users;
    }
  } catch (error) {
    console.error("Failed to load tower state from disk:", error);
  }
}

let users: UserEntry[] = [];

export function getUsers(): UserEntry[] {
  return users;
}

export function addUser(user: UserEntry) {
  if (users.some((u) => u.username.toLowerCase() === user.username.toLowerCase())) {
    throw new Error("User already exists");
  }
  users.push(user);
  saveStateToDisk();
}

export function deleteUser(username: string) {
  users = users.filter((u) => u.username.toLowerCase() !== username.toLowerCase());
  saveStateToDisk();
}

function saveStateToDisk() {
  try {
    ensureDataDir();
    const nextState: PersistedTowerState = {
      status: getPrimaryStatus(),
      statuses,
      sensorHistory,
      readings,
      pumpLogs,
      faultHistory,
      geminiApiKey,
      cameraSettings,
      cameraSnapshots,
      users,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save tower state to disk:", error);
  }
}

let geminiApiKey: string = "";

export function getGeminiApiKey(): string {
  return geminiApiKey;
}

export function saveGeminiApiKey(key: string) {
  geminiApiKey = key.trim();
  saveStateToDisk();
}

let cameraSettings: CameraSettings = { rtspUrl: "", liveStreamUrl: "", ezvizAppKey: "", ezvizAppSecret: "", autoCapture: false };
let cameraSnapshots: CameraSnapshot[] = [];

export function getCameraSettings() {
  return cameraSettings;
}

export function saveCameraSettings(newSettings: Partial<CameraSettings>) {
  cameraSettings = { ...cameraSettings, ...newSettings };
  saveStateToDisk();
}

export function getCameraSnapshots() {
  return cameraSnapshots;
}

export function addCameraSnapshot(snap: CameraSnapshot) {
  cameraSnapshots = [snap, ...cameraSnapshots].slice(0, 100);
  saveStateToDisk();
}

function getSupabaseAdminClient() {
  return supabaseAdmin as unknown as {
    from: (table: string) => {
      select: (columns?: string) => { order: (column: string, options?: { ascending?: boolean }) => Promise<{ data: TowerEventRow[] | null; error: unknown }> };
      insert: (value: unknown) => Promise<{ error: unknown }>;
      upsert: (value: unknown, options?: unknown) => Promise<{ error: unknown }>;
      delete: () => { eq: (column: string, value: unknown) => Promise<{ error: unknown }> };
    };
  };
}

function applyEvent(eventType: TowerEventType, payload: any) {
  const payloadDeviceId = typeof payload?.deviceId === "string" && payload.deviceId.trim() ? payload.deviceId.trim() : null;
  switch (eventType) {
    case "schedule_updated":
      schedule = { ...DEFAULT_SCHEDULE, ...payload };
      break;
    case "status_updated":
      if (payload) {
        const deviceId = payloadDeviceId ?? DEFAULT_DEVICE_ID;
        statuses[deviceId] = { ...payload, deviceId };
      }
      break;
    case "sensor_snapshot_added":
      if (payload) sensorHistory = [{ ...payload, deviceId: payloadDeviceId ?? null }, ...sensorHistory].slice(0, 1000);
      break;
    case "reading_added":
      if (payload) readings = [payload, ...readings];
      break;
    case "reading_deleted":
      if (payload?.id) readings = readings.filter((reading) => reading.id !== payload.id);
      break;
    case "pump_log_added":
      if (payload) pumpLogs = [{ ...payload, deviceId: payloadDeviceId ?? null }, ...pumpLogs];
      break;
    case "pump_log_updated":
      if (payload?.id) {
        const index = pumpLogs.findIndex((log) => log.id === payload.id);
        if (index >= 0) {
          pumpLogs[index] = { ...payload, deviceId: payloadDeviceId ?? pumpLogs[index].deviceId ?? null };
        }
      }
      break;
    case "fault_recorded":
      if (payload) faultHistory = [{ ...payload, deviceId: payloadDeviceId ?? null }, ...faultHistory];
      break;
  }
}

async function appendEvent(eventType: TowerEventType, payload: unknown) {
  if (!HAS_SUPABASE_EVENTS) return;
  try {
    const db = getSupabaseAdminClient();
    const { error } = await db.from(EVENTS_TABLE).insert({ event_type: eventType, payload });
    if (error) {
      console.error(`Failed to persist tower event ${eventType}:`, error);
    }
  } catch (error) {
    console.error(`Failed to persist tower event ${eventType}:`, error);
  }
}

async function loadStateFromDatabase() {
  if (!HAS_SUPABASE_EVENTS) return false;
  try {
    const db = getSupabaseAdminClient();
    const { data, error } = await db.from(EVENTS_TABLE).select("event_type,payload").order("created_at", { ascending: true });
    if (error) {
      console.error("Failed to load tower events from Supabase:", error);
      return false;
    }

    if (!Array.isArray(data) || data.length === 0) {
      return false;
    }

    schedule = { ...DEFAULT_SCHEDULE };
    statuses = {};
    sensorHistory = [];
    readings = [];
    pumpLogs = [];
    faultHistory = [];

    for (const row of data) {
      applyEvent(row.event_type, row.payload);
    }

    return true;
  } catch (error) {
    console.error("Failed to hydrate tower store from Supabase:", error);
    return false;
  }
}

let storeBootstrapPromise: Promise<void> | null = null;

export async function initializeTowerStore() {
  if (storeBootstrapPromise) return storeBootstrapPromise;

  storeBootstrapPromise = (async () => {
    const loadedFromDb = await loadStateFromDatabase();
    if (!loadedFromDb) {
      loadStateFromDisk();
    }
  })();

  return storeBootstrapPromise;
}

let schedule: Schedule = loadScheduleFromDisk();
let deviceSchedules: Record<string, Schedule> = loadDeviceSchedulesFromDisk();
const DEFAULT_DEVICE_ID = "default";
let statuses: Record<string, LiveStatus> = {};
let sensorHistory: SensorSnapshot[] = [];
let readings: ManualReading[] = [];
let pumpLogs: PumpLog[] = [];
let faultHistory: Array<{ timestamp: number; fault: string; deviceId?: string; resolved?: number }> = [];
let autoPumpStartedAtMs: number | null = null;
let autoPumpLogId: string | null = null;

loadStateFromDisk();

// Keep the device online long enough to cover the ESP32's idle heartbeat cadence.
const TELEMETRY_STALE_MS = 90000;
const IST_OFFSET_MS = 19800 * 1000;

function isFresh(timestamp: number | null | undefined, staleMs = TELEMETRY_STALE_MS): boolean {
  return timestamp != null && Date.now() - timestamp <= staleMs;
}

function getIstDate(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS);
}

function getIstHour(now = new Date()) {
  return getIstDate(now).getUTCHours();
}

function makeIstDateAtHour(now = new Date(), hour: number, dayOffset = 0) {
  const istNow = getIstDate(now);
  istNow.setUTCDate(istNow.getUTCDate() + dayOffset);
  return new Date(Date.UTC(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate(),
    hour,
    0,
    0,
    0,
  ) - IST_OFFSET_MS);
}

function getLatestDeviceSignalAt(status: LiveStatus | null | undefined): number | null {
  const timestamps = [status?.heartbeatUpdatedAt, status?.telemetryUpdatedAt]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function resolveSchedule(deviceId?: string | null): Schedule {
  const resolvedDeviceId = deviceId ? normalizeDeviceId(deviceId) : null;
  const sched = (resolvedDeviceId && deviceSchedules[resolvedDeviceId]) ? deviceSchedules[resolvedDeviceId] : schedule;

  // Legacy data migration: if interval fields are > 59, they were stored in seconds. Convert to minutes.
  const migrated = { ...sched };
  if (migrated.intervalMinutes > 59) migrated.intervalMinutes = migrated.intervalMinutes / 60;
  if (migrated.dayIntervalMinutes && migrated.dayIntervalMinutes > 59) migrated.dayIntervalMinutes = migrated.dayIntervalMinutes / 60;
  if (migrated.nightIntervalMinutes && migrated.nightIntervalMinutes > 59) migrated.nightIntervalMinutes = migrated.nightIntervalMinutes / 60;
  
  if (migrated.intervalMinutes_2 && migrated.intervalMinutes_2 > 59) migrated.intervalMinutes_2 = migrated.intervalMinutes_2 / 60;
  if (migrated.dayIntervalMinutes_2 && migrated.dayIntervalMinutes_2 > 59) migrated.dayIntervalMinutes_2 = migrated.dayIntervalMinutes_2 / 60;
  if (migrated.nightIntervalMinutes_2 && migrated.nightIntervalMinutes_2 > 59) migrated.nightIntervalMinutes_2 = migrated.nightIntervalMinutes_2 / 60;

  return migrated;
}

function getModeForNow(now = new Date(), deviceId?: string | null): "DAY" | "NIGHT" {
  const hour = getIstHour(now);
  const sched = resolveSchedule(deviceId);
  return hour >= sched.startHour && hour < sched.endHour ? "DAY" : "NIGHT";
}

function isNightModeEnabled(deviceId?: string | null): boolean {
  const sched = resolveSchedule(deviceId);
  return sched.nightEnabled !== false;
}

function isRetryableFlowFault(fault: string | null | undefined): boolean {
  if (!fault) return false;
  const upper = fault.toUpperCase();
  return upper.includes("FLOW") || upper.includes("DRY");
}

function normalizeDeviceId(deviceId?: string | null): string {
  const trimmed = deviceId?.trim();
  if (!trimmed || trimmed === "__current__") {
    return getPrimaryStatusDeviceId() ?? DEFAULT_DEVICE_ID;
  }
  return trimmed;
}

function getPrimaryStatusDeviceId() {
  const entries = Object.entries(statuses);
  if (entries.length === 0) return null;

  let freshestOnline: { deviceId: string; signalAt: number } | null = null;
  let freshestAny: { deviceId: string; signalAt: number } | null = null;

  for (const [deviceId, status] of entries) {
    const signalAt = getLatestDeviceSignalAt(status) ?? -1;

    if (!freshestAny || signalAt > freshestAny.signalAt) {
      freshestAny = { deviceId, signalAt };
    }

    if (status?.isOnline && (!freshestOnline || signalAt > freshestOnline.signalAt)) {
      freshestOnline = { deviceId, signalAt };
    }
  }

  return (freshestOnline ?? freshestAny)?.deviceId ?? entries[0][0];
}

function getPrimaryStatus() {
  const deviceId = getPrimaryStatusDeviceId();
  return deviceId ? statuses[deviceId] ?? null : null;
}

function getDeviceStatus(deviceId?: string | null) {
  const resolvedDeviceId = deviceId ? normalizeDeviceId(deviceId) : getPrimaryStatusDeviceId();
  if (!resolvedDeviceId) return null;
  return statuses[resolvedDeviceId] ?? null;
}

function ensureDeviceStatus(deviceId?: string | null, now = new Date()) {
  const resolvedDeviceId = normalizeDeviceId(deviceId);
  if (!statuses[resolvedDeviceId]) {
    statuses[resolvedDeviceId] = createBaseStatus(now, resolvedDeviceId);
  }
  return statuses[resolvedDeviceId];
}

function getLatestSensorSnapshot(deviceId?: string | null) {
  const resolvedDeviceId = deviceId ? normalizeDeviceId(deviceId) : null;
  return sensorHistory.find((snapshot) => !resolvedDeviceId || snapshot.deviceId === resolvedDeviceId) ?? null;
}



export function getCycleProfile(now = new Date(), deviceId?: string | null) {
  const mode = getModeForNow(now, deviceId);
  const isDay = mode === "DAY";
  const nightEnabled = isNightModeEnabled(deviceId);
  const sched = resolveSchedule(deviceId);
  const configuredDayIntervalMinutes = sched.dayIntervalMinutes ?? sched.intervalMinutes;

  return {
    mode,
    onDurationSeconds: isDay
      ? sched.dayDurationSeconds ?? sched.durationSeconds
      : nightEnabled
        ? sched.nightDurationSeconds ?? Math.max(15, Math.round(sched.durationSeconds * 0.75))
        : sched.dayDurationSeconds ?? sched.durationSeconds,
    offIntervalMinutes: isDay
      ? configuredDayIntervalMinutes
      : nightEnabled
        ? sched.nightIntervalMinutes ?? Math.max(sched.intervalMinutes, 15)
        : configuredDayIntervalMinutes,
  };
}

function pushSensorSnapshot(nextStatus: LiveStatus) {
  const compEc = compensateEc(nextStatus.ec, nextStatus.reservoirTempC);
  const calcVpd = calculateVpd(nextStatus.towerTempC, nextStatus.humidityPct);

  const nextSnapshot = {
    id: makeId(),
    deviceId: nextStatus.deviceId ?? DEFAULT_DEVICE_ID,
    timestamp: Date.now(),
    reservoirTempC: nextStatus.reservoirTempC,
    nftTempC: nextStatus.nftTempC ?? null,
    ph: nextStatus.ph ?? null,
    ec: compEc,
    waterLevel: nextStatus.waterLevel ?? null,
    humidityPct: nextStatus.humidityPct ?? null,
    towerTempC: nextStatus.towerTempC,
    pumpState: nextStatus.pumpState,
    fault: nextStatus.fault,
    vpd: calcVpd,
  };

  sensorHistory = [
    nextSnapshot,
    ...sensorHistory,
  ].slice(0, 1000);

  void appendEvent("sensor_snapshot_added", nextSnapshot);
}

function calculatePlannedNextCycle(now = new Date(), status?: LiveStatus | null): { nextCycleISO: string | null; nextCycleIn: number } {
  const deviceId = status?.deviceId ?? null;
  const sched = resolveSchedule(deviceId);
  if (!sched.enabled) {
    return { nextCycleISO: null, nextCycleIn: -1 };
  }

  const currentMode = getModeForNow(now, deviceId);
  const nightEnabled = isNightModeEnabled(deviceId);
  const { offIntervalMinutes, onDurationSeconds } = getCycleProfile(now, deviceId);
  const intervalMs = (offIntervalMinutes * 60 + onDurationSeconds) * 1000;
  const outsideDayWindow = currentMode === "NIGHT";
  const currentHour = getIstHour(now);

  const windowStart = currentMode === "DAY"
    ? makeIstDateAtHour(now, sched.startHour)
    : currentHour >= sched.endHour
      ? makeIstDateAtHour(now, sched.endHour)
      : makeIstDateAtHour(now, sched.endHour, -1);

  if (outsideDayWindow && !nightEnabled) {
    const tomorrow = makeIstDateAtHour(now, sched.startHour, 1);
    const secondsUntil = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
    return { nextCycleISO: tomorrow.toISOString(), nextCycleIn: secondsUntil };
  }

  let nextCycleTime: Date | null = null;

  // Try using actual last run time if present and valid
  const lastRunMs = status?.lastRunISO ? Date.parse(status.lastRunISO) : null;
  const lastRunMode = lastRunMs && Number.isFinite(lastRunMs) ? getModeForNow(new Date(lastRunMs), deviceId) : null;
  if (lastRunMs && Number.isFinite(lastRunMs) && (!lastRunMode || lastRunMode === currentMode)) {
    let targetTime = lastRunMs + intervalMs;
    if (targetTime < now.getTime()) {
      const elapsed = now.getTime() - targetTime;
      const additionalCycles = Math.ceil(elapsed / intervalMs);
      targetTime += additionalCycles * intervalMs;
    }
    nextCycleTime = new Date(targetTime);
  }

  // Fallback to slot-based prediction
  if (!nextCycleTime) {
    const elapsedMs = now.getTime() - windowStart.getTime();
    const slotsElapsed = Math.max(0, Math.ceil(elapsedMs / intervalMs));
    nextCycleTime = new Date(windowStart.getTime() + slotsElapsed * intervalMs);
  }

  const nextHour = getIstHour(nextCycleTime);
  if ((nextHour < sched.startHour || nextHour >= sched.endHour || nextCycleTime.getTime() < now.getTime()) && (!nightEnabled || currentMode === "DAY")) {
    const nextDay = makeIstDateAtHour(now, sched.startHour, 1);
    const secondsUntil = Math.floor((nextDay.getTime() - now.getTime()) / 1000);
    return { nextCycleISO: nextDay.toISOString(), nextCycleIn: secondsUntil };
  }

  const secondsUntil = Math.floor((nextCycleTime.getTime() - now.getTime()) / 1000);
  return { nextCycleISO: nextCycleTime.toISOString(), nextCycleIn: Math.max(0, secondsUntil) };
}

function calculatePlannedNextCycle_2(now = new Date(), status?: LiveStatus | null): { nextCycleISO: string | null; nextCycleIn: number } {
  const deviceId = status?.deviceId ?? null;
  const sched = resolveSchedule(deviceId);
  const enabled2 = sched.enabled_2 !== undefined ? sched.enabled_2 : sched.enabled;
  if (!enabled2) {
    return { nextCycleISO: null, nextCycleIn: -1 };
  }

  const currentMode = getModeForNow(now, deviceId);
  const nightEnabled = isNightModeEnabled(deviceId);
  
  const isDayMode = currentMode === "DAY";
  const offIntervalMinutes = isDayMode 
    ? (sched.dayIntervalMinutes_2 ?? sched.intervalMinutes_2 ?? sched.intervalMinutes)
    : (sched.nightIntervalMinutes_2 ?? sched.intervalMinutes_2 ?? sched.intervalMinutes);
  const onDurationSeconds = isDayMode
    ? (sched.dayDurationSeconds_2 ?? sched.durationSeconds_2 ?? sched.durationSeconds)
    : (sched.nightDurationSeconds_2 ?? sched.durationSeconds_2 ?? sched.durationSeconds);

  const intervalMs = (offIntervalMinutes * 60 + onDurationSeconds) * 1000;
  const outsideDayWindow = currentMode === "NIGHT";
  const currentHour = getIstHour(now);

  const windowStart = currentMode === "DAY"
    ? makeIstDateAtHour(now, sched.startHour)
    : currentHour >= sched.endHour
      ? makeIstDateAtHour(now, sched.endHour)
      : makeIstDateAtHour(now, sched.endHour, -1);

  if (outsideDayWindow && !nightEnabled) {
    const tomorrow = makeIstDateAtHour(now, sched.startHour, 1);
    const secondsUntil = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
    return { nextCycleISO: tomorrow.toISOString(), nextCycleIn: secondsUntil };
  }

  let nextCycleTime: Date | null = null;

  const lastRunMs = status?.lastRunISO_2 ? Date.parse(status.lastRunISO_2) : null;
  const lastRunMode = lastRunMs && Number.isFinite(lastRunMs) ? getModeForNow(new Date(lastRunMs), deviceId) : null;
  if (lastRunMs && Number.isFinite(lastRunMs) && (!lastRunMode || lastRunMode === currentMode)) {
    let targetTime = lastRunMs + intervalMs;
    if (targetTime < now.getTime()) {
      const elapsed = now.getTime() - targetTime;
      const additionalCycles = Math.ceil(elapsed / intervalMs);
      targetTime += additionalCycles * intervalMs;
    }
    nextCycleTime = new Date(targetTime);
  }

  if (!nextCycleTime) {
    const elapsedMs = now.getTime() - windowStart.getTime();
    const slotsElapsed = Math.max(0, Math.ceil(elapsedMs / intervalMs));
    nextCycleTime = new Date(windowStart.getTime() + slotsElapsed * intervalMs);
  }

  const nextHour = getIstHour(nextCycleTime);
  if ((nextHour < sched.startHour || nextHour >= sched.endHour || nextCycleTime.getTime() < now.getTime()) && (!nightEnabled || currentMode === "DAY")) {
    const nextDay = makeIstDateAtHour(now, sched.startHour, 1);
    const secondsUntil = Math.floor((nextDay.getTime() - now.getTime()) / 1000);
    return { nextCycleISO: nextDay.toISOString(), nextCycleIn: secondsUntil };
  }

  const secondsUntil = Math.floor((nextCycleTime.getTime() - now.getTime()) / 1000);
  return { nextCycleISO: nextCycleTime.toISOString(), nextCycleIn: Math.max(0, secondsUntil) };
}

function calculateRetryCycle(nextStatus: LiveStatus, now = new Date()): { retryNextCycleISO: string | null; retryNextCycleIn: number | null } {
  const deviceId = nextStatus.deviceId ?? null;
  const sched = resolveSchedule(deviceId);
  if (!sched.enabled) {
    return { retryNextCycleISO: null, retryNextCycleIn: null };
  }

  const withinActiveWindow = getIstHour(now) >= sched.startHour && getIstHour(now) < sched.endHour;
  if (!withinActiveWindow) {
    return { retryNextCycleISO: null, retryNextCycleIn: null };
  }

  const retryableFault = isRetryableFlowFault(nextStatus.fault);
  if (!retryableFault) {
    return { retryNextCycleISO: null, retryNextCycleIn: null };
  }

  return { retryNextCycleISO: new Date(now.getTime() + 1000).toISOString(), retryNextCycleIn: 1 };
}

function createBaseStatus(now = new Date(), deviceId?: string): LiveStatus {
  return {
    deviceId: deviceId ?? DEFAULT_DEVICE_ID,
    pumpOn: false,
    flowing: false,
    pumpState: PumpState.IDLE,
    motorManualMode: "AUTO",
    phManualMode: "AUTO",
    nutritionManualMode: "AUTO",
    phDosingOn: false,
    nutritionADosingOn: false,
    nutritionBDosingOn: false,
    ph: null,
    ec: null,
    waterLevel: "FULL",
    reservoirTempC: null,
    humidityPct: null,
    towerTempC: null,
    flowRateLpm: null,
    lastRunISO: null,
    fault: null,
    resetReason: null,
    lastBootFault: null,
    uptimeSec: null,
    nextCycleISO: null,
    nextCycleIn: 0,
    telemetryUpdatedAt: null,
    heartbeatUpdatedAt: null,
    isOnline: false,
  };
}

function syncScheduledState(deviceId?: string | null, now = new Date()) {
  const resolvedDeviceId = normalizeDeviceId(deviceId);
  if (!statuses[resolvedDeviceId]) {
    statuses[resolvedDeviceId] = createBaseStatus(now, resolvedDeviceId);
  }

  const currentStatus = statuses[resolvedDeviceId];
  if (currentStatus.isOnline) {
    return;
  }

  const sched = resolveSchedule(resolvedDeviceId);
  const nextStatus = { ...currentStatus };
  const currentMode = getModeForNow(now, resolvedDeviceId);
  const nightEnabled = isNightModeEnabled(resolvedDeviceId);
  const withinScheduledWindow = currentMode === "DAY" || nightEnabled;

  if (nextStatus.motorManualMode === "AUTO" && sched.enabled) {
    const withinActiveWindow = withinScheduledWindow;
    const cycleProfile = getCycleProfile(now, resolvedDeviceId);
    const onDurationMs = cycleProfile.onDurationSeconds * 1000;
    const offIntervalMs = cycleProfile.offIntervalMinutes * 60 * 1000;
    const lastRunMs = nextStatus.lastRunISO ? Date.parse(nextStatus.lastRunISO) : null;

    if (!withinActiveWindow) {
      if (nextStatus.pumpOn || nextStatus.pumpState !== PumpState.IDLE) {
        nextStatus.pumpOn = false;
        nextStatus.flowing = false;
        nextStatus.pumpState = PumpState.IDLE;
      }

      if (autoPumpLogId) {
        try {
          updatePumpLog(autoPumpLogId, {
            durationSeconds: autoPumpStartedAtMs ? Math.max(1, Math.round((now.getTime() - autoPumpStartedAtMs) / 1000)) : undefined,
            flowed: false,
            endedAtMs: now.getTime(),
          });
        } catch {
          // ignore automatic log closure failures
        }
        autoPumpLogId = null;
        autoPumpStartedAtMs = null;
      }

      statuses[resolvedDeviceId] = nextStatus;
      return;
    }

    const turnPumpOn = () => {
      const startedAtMs = now.getTime();
      nextStatus.pumpOn = true;
      nextStatus.flowing = false;
      nextStatus.pumpState = PumpState.VERIFYING_FLOW;
      nextStatus.motorManualMode = "AUTO";
      nextStatus.lastRunISO = new Date(startedAtMs).toISOString();

      if (!autoPumpLogId) {
        try {
          const created = startPumpLog({
            mode: cycleProfile.mode,
            onDurationSeconds: cycleProfile.onDurationSeconds,
            offIntervalMinutes: cycleProfile.offIntervalMinutes,
            startedAtMs,
          });
          autoPumpLogId = created.id;
          autoPumpStartedAtMs = startedAtMs;
        } catch {
          autoPumpLogId = null;
          autoPumpStartedAtMs = null;
        }
      }
    };

    const turnPumpOff = () => {
      nextStatus.pumpOn = false;
      nextStatus.flowing = false;
      nextStatus.pumpState = PumpState.IDLE;

      if (autoPumpLogId) {
        try {
          updatePumpLog(autoPumpLogId, {
            durationSeconds: autoPumpStartedAtMs ? Math.max(1, Math.round((now.getTime() - autoPumpStartedAtMs) / 1000)) : onDurationMs / 1000,
            flowed: true,
            endedAtMs: now.getTime(),
          });
        } catch {
          // ignore automatic log closure failures
        }
        autoPumpLogId = null;
        autoPumpStartedAtMs = null;
      }
    };

    if (lastRunMs == null) {
      turnPumpOn();
      statuses[resolvedDeviceId] = nextStatus;
      return;
    }

    const elapsedMs = now.getTime() - lastRunMs;

    if (nextStatus.pumpOn) {
      if (elapsedMs >= onDurationMs) {
        turnPumpOff();
      } else {
        nextStatus.pumpState = nextStatus.flowing ? PumpState.RUNNING : PumpState.VERIFYING_FLOW;
      }
    } else if (elapsedMs >= onDurationMs + offIntervalMs) {
      turnPumpOn();
    } else {
      nextStatus.pumpState = PumpState.IDLE;
    }
  }

  statuses[resolvedDeviceId] = nextStatus;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getSchedule(deviceId?: string | null) {
  const resolvedDeviceId = deviceId ? normalizeDeviceId(deviceId) : null;
  if (resolvedDeviceId && deviceSchedules[resolvedDeviceId]) {
    return { ...deviceSchedules[resolvedDeviceId] };
  }
  return { ...schedule };
}

export function updateSchedule(next: Schedule, deviceId?: string | null) {
  const resolvedDeviceId = deviceId ? normalizeDeviceId(deviceId) : null;
  if (resolvedDeviceId) {
    deviceSchedules[resolvedDeviceId] = { ...next };
    saveDeviceSchedulesToDisk(deviceSchedules);
    void appendEvent("schedule_updated", { deviceId: resolvedDeviceId, schedule: next });
    return getSchedule(resolvedDeviceId);
  } else {
    schedule = { ...next };
    saveScheduleToDisk(schedule);
    void appendEvent("schedule_updated", schedule);
    return getSchedule();
  }
}

export function getStatus(deviceId?: string | null) {
  syncScheduledState(deviceId);
  const currentStatus = getDeviceStatus(deviceId);
  if (!currentStatus) return null;
  
  // Calculate next cycle and update status
  const plannedNextCycle = calculatePlannedNextCycle(new Date(), currentStatus);
  const plannedNextCycle_2 = calculatePlannedNextCycle_2(new Date(), currentStatus);
  const retryCycle = calculateRetryCycle(currentStatus);
  const cycleProfile = getCycleProfile(undefined, deviceId);
  const heartbeatUpdatedAt = currentStatus.heartbeatUpdatedAt ?? null;
  const deviceSignalUpdatedAt = getLatestDeviceSignalAt(currentStatus);
  const isOnline = isFresh(deviceSignalUpdatedAt);
  
  // Compute pumpEndISO when pump is running
  let pumpEndISO: string | null = null;
  try {
    if (currentStatus.pumpOn && currentStatus.lastRunISO) {
      // Prefer to use a matching pumpLog's onDurationSeconds when available
      const matching = pumpLogs.find((p) => p.startedAt === currentStatus.lastRunISO && (p.deviceId ?? DEFAULT_DEVICE_ID) === (currentStatus.deviceId ?? DEFAULT_DEVICE_ID));
      const onDur = matching ? matching.onDurationSeconds : getCycleProfile(new Date(currentStatus.lastRunISO), deviceId).onDurationSeconds;
      const lastMs = new Date(currentStatus.lastRunISO).getTime();
      pumpEndISO = new Date(lastMs + onDur * 1000).toISOString();
    }
  } catch {
    pumpEndISO = null;
  }

  // Compute pumpEndISO_2 when pump 2 is running
  let pumpEndISO_2: string | null = null;
  try {
    if (currentStatus.pumpOn_2 && currentStatus.lastRunISO_2) {
      const sched = resolveSchedule(deviceId);
      const isDayMode = getModeForNow(new Date(), deviceId) === "DAY";
      const onDur2 = isDayMode
        ? (sched.dayDurationSeconds_2 ?? sched.durationSeconds_2 ?? sched.durationSeconds)
        : (sched.nightDurationSeconds_2 ?? sched.durationSeconds_2 ?? sched.durationSeconds);
      const lastMs_2 = new Date(currentStatus.lastRunISO_2).getTime();
      pumpEndISO_2 = new Date(lastMs_2 + onDur2 * 1000).toISOString();
    }
  } catch {
    pumpEndISO_2 = null;
  }

  return {
    ...currentStatus,
    nextCycleISO: plannedNextCycle.nextCycleISO,
    nextCycleIn: plannedNextCycle.nextCycleIn,
    plannedNextCycleISO: plannedNextCycle.nextCycleISO,
    plannedNextCycleIn: plannedNextCycle.nextCycleIn,
    plannedNextCycleISO_2: plannedNextCycle_2.nextCycleISO,
    plannedNextCycleIn_2: plannedNextCycle_2.nextCycleIn,
    retryNextCycleISO: retryCycle.retryNextCycleISO,
    retryNextCycleIn: retryCycle.retryNextCycleIn,
    cycleMode: cycleProfile.mode,
    cycleOnDurationSeconds: cycleProfile.onDurationSeconds,
    cycleOffIntervalMinutes: cycleProfile.offIntervalMinutes,
    nightEnabled: isNightModeEnabled(deviceId),
    isOnline,
    pumpEndISO,
    pumpEndISO_2,
    heartbeatUpdatedAt,
  };
}

export function normalizeLastRunISO(val: any): string | null {
  if (!val) return null;
  let numeric = Number(val);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric < 1e12) {
      numeric *= 1000;
    }
    return new Date(numeric).toISOString();
  }
  const parsed = Date.parse(String(val));
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return null;
}

export function updateStatus(
  patch: Partial<LiveStatus>,
  options: { source?: "esp32" | "server"; deviceId?: string | null } = {},
) {
  const deviceId = normalizeDeviceId(options.deviceId);
  const currentStatus = ensureDeviceStatus(deviceId);

  const source = options.source ?? "server";
  const telemetryUpdatedAt = source === "esp32" ? Date.now() : currentStatus.telemetryUpdatedAt ?? null;
  const heartbeatUpdatedAt = source === "esp32" ? Date.now() : currentStatus.heartbeatUpdatedAt ?? null;

  // Prefer an explicit run timestamp from the device/backend.
  // Only infer "now" when the pump turns on and no timestamp was supplied.
  const transitionToOn = patch.pumpOn === true && !currentStatus.pumpOn;
  const resolvedLastRunISO = patch.lastRunISO !== undefined
    ? normalizeLastRunISO(patch.lastRunISO)
    : transitionToOn
      ? currentStatus.lastRunISO ?? new Date().toISOString()
      : currentStatus.lastRunISO;

  const rawEc = patch.ec !== undefined ? patch.ec : currentStatus.ec;
  const rawTemp = patch.reservoirTempC !== undefined ? patch.reservoirTempC : currentStatus.reservoirTempC;
  const compEc = compensateEc(rawEc, rawTemp);

  const airTemp = patch.towerTempC !== undefined ? patch.towerTempC : currentStatus.towerTempC;
  const humidity = patch.humidityPct !== undefined ? patch.humidityPct : currentStatus.humidityPct;
  const calcVpd = calculateVpd(airTemp, humidity);

  const motorManualModeChanged = patch.motorManualMode !== undefined && patch.motorManualMode !== currentStatus.motorManualMode;
  const motorManualMode2Changed = patch.motorManualMode_2 !== undefined && patch.motorManualMode_2 !== currentStatus.motorManualMode_2;
  const pumpOnChanged = patch.pumpOn !== undefined && patch.pumpOn !== currentStatus.pumpOn;
  const pumpOn2Changed = patch.pumpOn_2 !== undefined && patch.pumpOn_2 !== currentStatus.pumpOn_2;

  const motorManualModeUpdatedAt = motorManualModeChanged ? Date.now() : currentStatus.motorManualModeUpdatedAt ?? null;
  const motorManualModeUpdatedAt_2 = motorManualMode2Changed ? Date.now() : currentStatus.motorManualModeUpdatedAt_2 ?? null;
  const pumpOnUpdatedAt = pumpOnChanged ? Date.now() : currentStatus.pumpOnUpdatedAt ?? null;
  const pumpOnUpdatedAt_2 = pumpOn2Changed ? Date.now() : currentStatus.pumpOnUpdatedAt_2 ?? null;

  const mergedStatus = {
    ...createBaseStatus(new Date(), deviceId),
    ...currentStatus,
    ...patch,
    ec: compEc,
    vpd: calcVpd,
    deviceId,
    telemetryUpdatedAt,
    heartbeatUpdatedAt,
    lastRunISO: resolvedLastRunISO,
    motorManualModeUpdatedAt,
    motorManualModeUpdatedAt_2,
    pumpOnUpdatedAt,
    pumpOnUpdatedAt_2,
  };
  const isOnline = isFresh(getLatestDeviceSignalAt(mergedStatus));

  statuses[deviceId] = {
    ...mergedStatus,
    isOnline,
  };

  pushSensorSnapshot(statuses[deviceId]);

  // Track fault history
  if (patch.fault && patch.fault !== "OK" && patch.fault !== currentStatus.fault) {
    faultHistory = [
      {
        timestamp: Date.now(),
        fault: patch.fault,
        deviceId,
      },
      ...faultHistory,
    ];
    void appendEvent("fault_recorded", faultHistory[0]);
  }

  saveStateToDisk();
  void appendEvent("status_updated", statuses[deviceId]);

  return getStatus(deviceId);
}

export function touchStatus(options: { source?: "esp32" | "server"; deviceId?: string | null } = {}) {
  const source = options.source ?? "server";
  const deviceId = normalizeDeviceId(options.deviceId);
  if (!statuses[deviceId]) {
    statuses[deviceId] = createBaseStatus(new Date(), deviceId);
    if (source === "esp32") {
      statuses[deviceId].telemetryUpdatedAt = Date.now();
      statuses[deviceId].heartbeatUpdatedAt = Date.now();
      statuses[deviceId].isOnline = true;
    }
    saveStateToDisk();
    void appendEvent("status_updated", statuses[deviceId]);
    return getStatus(deviceId);
  }

  const currentStatus = statuses[deviceId];
  const telemetryUpdatedAt = source === "esp32" ? Date.now() : currentStatus.telemetryUpdatedAt ?? null;
  const heartbeatUpdatedAt = source === "esp32" ? Date.now() : currentStatus.heartbeatUpdatedAt ?? null;
  const mergedStatus = {
    ...currentStatus,
    telemetryUpdatedAt,
    heartbeatUpdatedAt,
    deviceId,
  };
  const isOnline = isFresh(getLatestDeviceSignalAt(mergedStatus));

  statuses[deviceId] = {
    ...mergedStatus,
    isOnline,
  };

  saveStateToDisk();
  void appendEvent("status_updated", statuses[deviceId]);

  return getStatus(deviceId);
}

export function getSensorHistory(days = 7, deviceId?: string | null) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const resolvedDeviceId = deviceId ? normalizeDeviceId(deviceId) : null;
  return sensorHistory
    .filter((snapshot) => snapshot.timestamp >= cutoff)
    .filter((snapshot) => !resolvedDeviceId || snapshot.deviceId === resolvedDeviceId)
    .map((snapshot) => ({ ...snapshot }));
}

export function getReadings() {
  return readings.map((reading) => ({ ...reading }));
}

export function addReading(reading: Omit<ManualReading, "id" | "timestamp">) {
  const next = {
    ...reading,
    id: makeId(),
    timestamp: Date.now(),
  };
  readings = [next, ...readings];
  saveStateToDisk();
  void appendEvent("reading_added", next);
  return { ...next };
}

export function deleteReading(id: string) {
  const before = readings.length;
  readings = readings.filter((reading) => reading.id !== id);
  if (readings.length !== before) {
    saveStateToDisk();
    void appendEvent("reading_deleted", { id });
  }
  return readings.length !== before;
}

export function getPumpLogs(deviceId?: string | null) {
  const resolvedDeviceId = deviceId ? normalizeDeviceId(deviceId) : null;
  return pumpLogs.filter((log) => !resolvedDeviceId || log.deviceId === resolvedDeviceId).map((log) => ({ ...log }));
}

export function addPumpLog(log: PumpLogInput & { deviceId?: string | null }) {
  const deviceId = normalizeDeviceId(log.deviceId ?? null);
  const now = new Date(log.startedAtMs ?? Date.now());
  const endedAt = new Date(log.endedAtMs ?? (now.getTime() + Math.max(0, log.durationSeconds) * 1000));
  const cycleProfile = getCycleProfile(now);
  const next = {
    ...log,
    id: makeId(),
    deviceId,
    startedAt: now.toISOString(),
    endedAt: endedAt.toISOString(),
    mode: log.mode ?? cycleProfile.mode,
    onDurationSeconds: log.onDurationSeconds ?? log.durationSeconds,
    offIntervalMinutes: log.offIntervalMinutes ?? cycleProfile.offIntervalMinutes,
    volumeLiters: log.volumeLiters ?? null,
    flowRateLpm: log.flowRateLpm ?? null,
  };
  pumpLogs = [next, ...pumpLogs];

  if (statuses[deviceId]) {
    if (next.pumpIndex === 2) {
      statuses[deviceId] = {
        ...statuses[deviceId],
        lastRunISO_2: next.startedAt,
        fault: next.fault ?? statuses[deviceId].fault,
      };
    } else {
      statuses[deviceId] = {
        ...statuses[deviceId],
        lastRunISO: next.startedAt,
        fault: next.fault ?? statuses[deviceId].fault,
      };
    }
  }

  saveStateToDisk();
  void appendEvent("pump_log_added", next);

  return { ...next };
}

export function startPumpLog(input: { mode?: PumpLog["mode"]; onDurationSeconds?: number; offIntervalMinutes?: number; startedAtMs?: number; deviceId?: string | null; pumpIndex?: number }) {
  const next = addPumpLog({
    mode: input.mode ?? getCycleProfile(undefined, input.deviceId).mode,
    onDurationSeconds: input.onDurationSeconds ?? 0,
    offIntervalMinutes: input.offIntervalMinutes ?? getCycleProfile(undefined, input.deviceId).offIntervalMinutes,
    durationSeconds: 0,
    flowed: false,
    fault: null,
    startedAtMs: input.startedAtMs ?? Date.now(),
    endedAtMs: input.startedAtMs ?? Date.now(),
    deviceId: input.deviceId ?? undefined,
    pumpIndex: input.pumpIndex,
  });
  return next;
}

export function updatePumpLog(id: string, patch: Partial<PumpLogInput & { endedAtMs?: number; startedAtMs?: number }>) {
  const idx = pumpLogs.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const existing = pumpLogs[idx];
  const startedAtMs = patch.startedAtMs ? patch.startedAtMs : Date.parse(existing.startedAt);
  const endedAtMs = patch.endedAtMs ? patch.endedAtMs : Date.parse(existing.endedAt);

  const updated: PumpLog = {
    ...existing,
    mode: patch.mode ?? existing.mode,
    onDurationSeconds: patch.onDurationSeconds ?? existing.onDurationSeconds,
    offIntervalMinutes: patch.offIntervalMinutes ?? existing.offIntervalMinutes,
    durationSeconds: patch.durationSeconds ?? Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000)),
    flowed: patch.flowed ?? existing.flowed,
    fault: patch.fault ?? existing.fault,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    volumeLiters: (patch as any).volumeLiters ?? existing.volumeLiters ?? null,
    flowRateLpm: (patch as any).flowRateLpm ?? existing.flowRateLpm ?? null,
  };

  pumpLogs[idx] = updated;

  if (updated.deviceId && statuses[updated.deviceId]) {
    if (updated.pumpIndex === 2) {
      statuses[updated.deviceId] = {
        ...statuses[updated.deviceId],
        lastRunISO_2: updated.startedAt,
        fault: updated.fault ?? statuses[updated.deviceId].fault,
      };
    } else {
      statuses[updated.deviceId] = {
        ...statuses[updated.deviceId],
        lastRunISO: updated.startedAt,
        fault: updated.fault ?? statuses[updated.deviceId].fault,
      };
    }
  }

  saveStateToDisk();
  void appendEvent("pump_log_updated", updated);

  return { ...updated };
}

export function getFaultHistory(limit: number = 20, deviceId?: string | null) {
  const resolvedDeviceId = deviceId ? normalizeDeviceId(deviceId) : null;
  return faultHistory
    .filter((fault) => !resolvedDeviceId || (fault as any).deviceId === resolvedDeviceId)
    .slice(0, limit)
    .map((f) => ({ ...f }));
}

export function getAnalyticsSummary(days = 7, deviceId?: string | null) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const resolvedDeviceId = deviceId ? normalizeDeviceId(deviceId) : null;
  const recentSensors = sensorHistory
    .filter((snapshot) => snapshot.timestamp >= cutoff)
    .filter((snapshot) => !resolvedDeviceId || snapshot.deviceId === resolvedDeviceId);
  const recentLogs = pumpLogs
    .filter((log) => new Date(log.startedAt).getTime() >= cutoff)
    .filter((log) => !resolvedDeviceId || log.deviceId === resolvedDeviceId);
  const recentReadings = readings.filter((reading) => reading.timestamp >= cutoff);

  const dayBuckets = new Map<string, {
    date: string;
    cycles: number;
    success: number;
    reservoirTemps: number[];
    towerTemps: number[];
  }>();

  for (const snapshot of recentSensors) {
    const date = new Date(snapshot.timestamp).toISOString().slice(0, 10);
    if (!dayBuckets.has(date)) {
      dayBuckets.set(date, { date, cycles: 0, success: 0, reservoirTemps: [], towerTemps: [] });
    }
    const bucket = dayBuckets.get(date)!;
    if (snapshot.reservoirTempC != null) bucket.reservoirTemps.push(snapshot.reservoirTempC);
    if (snapshot.towerTempC != null) bucket.towerTemps.push(snapshot.towerTempC);
  }

  for (const log of recentLogs) {
    const date = new Date(log.startedAt).toISOString().slice(0, 10);
    if (!dayBuckets.has(date)) {
      dayBuckets.set(date, { date, cycles: 0, success: 0, reservoirTemps: [], towerTemps: [] });
    }
    const bucket = dayBuckets.get(date)!;
    bucket.cycles += 1;
    if (log.flowed && !log.fault) bucket.success += 1;
  }

  const daily = Array.from(dayBuckets.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((bucket) => {
      const avg = (values: number[]) =>
        values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      return {
        date: bucket.date,
        cycles: bucket.cycles,
        successRate: bucket.cycles > 0 ? (bucket.success / bucket.cycles) * 100 : 0,
        avgReservoirTempC: avg(bucket.reservoirTemps),
        avgTowerTempC: avg(bucket.towerTemps),
      };
    });

  const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const min = (values: number[]) => (values.length ? Math.min(...values) : null);
  const max = (values: number[]) => (values.length ? Math.max(...values) : null);
  const successCycles = recentLogs.filter((log) => log.flowed && !log.fault).length;
  const totalLitersEstimate = recentLogs.reduce((sum, log) => sum + (log.durationSeconds / 60) * 2, 0);

  return {
    days,
    sensorPoints: recentSensors.length,
    pumpCycles: recentLogs.length,
    manualReadings: recentReadings.length,
    successRate: recentLogs.length > 0 ? (successCycles / recentLogs.length) * 100 : 0,
    faultCount: recentLogs.filter((log) => log.fault).length,
    avgReservoirTempC: avg(recentSensors.map((s) => s.reservoirTempC ?? NaN).filter(Number.isFinite)),
    avgTowerTempC: avg(recentSensors.map((s) => s.towerTempC ?? NaN).filter(Number.isFinite)),
    minReservoirTempC: min(recentSensors.map((s) => s.reservoirTempC ?? NaN).filter(Number.isFinite)),
    maxReservoirTempC: max(recentSensors.map((s) => s.reservoirTempC ?? NaN).filter(Number.isFinite)),
    minTowerTempC: min(recentSensors.map((s) => s.towerTempC ?? NaN).filter(Number.isFinite)),
    maxTowerTempC: max(recentSensors.map((s) => s.towerTempC ?? NaN).filter(Number.isFinite)),
    estimatedWaterLiters: totalLitersEstimate,
    daily,
  };
}

export function getNftChannels(): NftChannel[] {
  return nftChannels;
}

export function saveNftChannels(channels: NftChannel[]): NftChannel[] {
  nftChannels = channels;
  saveNftChannelsToDisk(nftChannels);
  return nftChannels;
}

export function plantCrop(channelId: string, cropName: string, notes: string): NftChannel | null {
  const channel = nftChannels.find((c) => c.id === channelId);
  if (!channel) return null;
  channel.cropName = cropName;
  channel.notes = notes;
  channel.plantedAt = new Date().toISOString();
  channel.harvestedAt = null;
  channel.status = "growing";
  saveNftChannelsToDisk(nftChannels);
  return channel;
}

export function getHarvestHistory(): HarvestHistoryEntry[] {
  try {
    ensureDataDir();
    if (fs.existsSync(HARVEST_HISTORY_FILE)) {
      const raw = fs.readFileSync(HARVEST_HISTORY_FILE, "utf8");
      return JSON.parse(raw) as HarvestHistoryEntry[];
    }
  } catch (error) {
    console.error("Failed to load harvest history from disk:", error);
  }
  return [];
}

export function saveHarvestHistory(history: HarvestHistoryEntry[]) {
  try {
    ensureDataDir();
    fs.writeFileSync(HARVEST_HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save harvest history to disk:", error);
  }
}

export function harvestCrop(
  channelId: string,
  yieldQty: number,
  wasteQty: number,
  avgWeightGrams: number,
  notes: string,
  harvestCultivar?: string
): NftChannel | null {
  const channel = nftChannels.find((c) => c.id === channelId);
  if (!channel) return null;

  const totalHarvested = yieldQty + wasteQty;
  const currentTotal = channel.currentCount ?? 0;

  if (totalHarvested > currentTotal) {
    throw new Error(`Harvest quantity (${totalHarvested}) exceeds current plant count (${currentTotal}) in channel.`);
  }

  // Save crop details into historical log before resetting
  if (channel.cropName || (channel.crops && channel.crops.length > 0)) {
    const history = getHarvestHistory();
    const newEntry: HarvestHistoryEntry = {
      id: `harv-${Date.now()}`,
      channelId: channel.id,
      channelName: channel.name,
      cropName: harvestCultivar || channel.cropName || (channel.crops ? channel.crops.map((c) => `${c.cropName} (${c.count})`).join(", ") : ""),
      crops: channel.crops ? channel.crops.filter(c => c.cropName === harvestCultivar || !harvestCultivar) : undefined,
      plantedAt: channel.plantedAt,
      harvestedAt: new Date().toISOString(),
      notes: notes || channel.notes || "Harvested crops.",
      capacity: channel.capacity,
      currentCount: totalHarvested,
      yieldQty,
      wasteQty,
      avgWeightGrams,
      incidents: channel.incidents,
    };
    history.push(newEntry);
    saveHarvestHistory(history);
  }

  // Perform partial crop inventory update
  if (channel.crops && channel.crops.length > 0) {
    const targetCropName = harvestCultivar || channel.crops[0].cropName;
    const cropIndex = channel.crops.findIndex(c => c.cropName.toLowerCase() === targetCropName.toLowerCase());
    if (cropIndex > -1) {
      const crop = channel.crops[cropIndex];
      crop.count = Math.max(0, crop.count - totalHarvested);
    }
    // Drop crops with 0 count
    channel.crops = channel.crops.filter(c => c.count > 0);
  }

  // Update total counts
  const nextTotal = Math.max(0, currentTotal - totalHarvested);
  channel.currentCount = nextTotal;

  if (nextTotal === 0) {
    channel.cropName = "";
    channel.plantedAt = null;
    channel.harvestedAt = new Date().toISOString();
    channel.status = "empty";
    channel.crops = [];
    channel.incidents = []; // Clear incidents on harvest reset
  } else {
    // Re-combine remaining crop names
    if (channel.crops && channel.crops.length > 0) {
      channel.cropName = channel.crops.length > 1
        ? channel.crops.map(c => `${c.cropName} (${c.count})`).join(", ")
        : channel.crops[0].cropName;
    } else {
      channel.cropName = "";
      channel.status = "empty";
      channel.plantedAt = null;
    }
  }

  saveNftChannelsToDisk(nftChannels);
  return channel;
}

export function getGpioMappings(): GpioMapping[] {
  return gpioMappings;
}

export function saveGpioMappings(mappings: GpioMapping[]): GpioMapping[] {
  gpioMappings = mappings;
  saveGpioMappingsToDisk(gpioMappings);
  return gpioMappings;
}


