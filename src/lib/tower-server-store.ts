import fs from "fs";
import os from "os";
import path from "path";

import {
  PumpState,
  PUMP_STATE_LABELS,
  PUMP_STATE_COLORS,
  defaultSchedule,
  type AnalyticsSummary,
  type LiveStatus,
  type ManualReading,
  type PumpLogEntry,
  type Schedule,
  type SensorSnapshot,
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
const STATE_FILE = process.env.TOWER_STATE_FILE ?? path.join(DATA_DIR, "tower-state.json");
const EVENTS_TABLE = "tower_events";

const HAS_SUPABASE_EVENTS = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

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

type PersistedTowerState = {
  status?: LiveStatus | null;
  statuses?: Record<string, LiveStatus>;
  sensorHistory?: SensorSnapshot[];
  readings?: ManualReading[];
  pumpLogs?: PumpLog[];
  faultHistory?: Array<{ timestamp: number; fault: string; resolved?: number }>;
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
  } catch (error) {
    console.error("Failed to load tower state from disk:", error);
  }
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
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to save tower state to disk:", error);
  }
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
const DEFAULT_DEVICE_ID = "default";
let statuses: Record<string, LiveStatus> = {};
let sensorHistory: SensorSnapshot[] = [];
let readings: ManualReading[] = [];
let pumpLogs: PumpLog[] = [];
let faultHistory: Array<{ timestamp: number; fault: string; deviceId?: string; resolved?: number }> = [];
let autoPumpStartedAtMs: number | null = null;
let autoPumpLogId: string | null = null;

loadStateFromDisk();

const TELEMETRY_STALE_MS = 15000;
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

function getModeForNow(now = new Date()): "DAY" | "NIGHT" {
  const hour = getIstHour(now);
  return hour >= schedule.startHour && hour < schedule.endHour ? "DAY" : "NIGHT";
}

function isRetryableFlowFault(fault: string | null | undefined): boolean {
  if (!fault) return false;
  const upper = fault.toUpperCase();
  return upper.includes("FLOW") || upper.includes("DRY");
}

function normalizeDeviceId(deviceId?: string | null): string {
  return deviceId?.trim() || DEFAULT_DEVICE_ID;
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

/**
 * Determines if grow light should be on based on schedule
 * Light is on during active hours (startHour to endHour) if enabled
 */
function shouldLightBeOnBySchedule(now = new Date(), deviceId?: string | null): boolean {
  if (!schedule.lightEnabled) return false;
  if (!schedule.enabled) return false;
  const hour = getIstHour(now);
  const lightStartHour = schedule.lightStartHour ?? schedule.startHour;
  const lightEndHour = schedule.lightEndHour ?? schedule.endHour;
  const inWindow = hour >= lightStartHour && hour < lightEndHour;
  if (!inWindow) return false;

  // If an ambient light sensor is present, prefer auto-on when ambient lux is low (indoor use)
  try {
    const latest = getLatestSensorSnapshot(deviceId);
    // From the indoor lettuce guide: use a higher threshold for indoor rooms
    // Typical room ambient lux varies; use 2000 lux as a conservative threshold
    // to decide when supplemental LED grow lights should be enabled.
    const AMBIENT_LUX_THRESHOLD = 2000; // lux threshold for indoor grow LEDs
    if (latest && typeof latest.lightLux === "number") {
      return latest.lightLux < AMBIENT_LUX_THRESHOLD;
    }
  } catch {
    // fall through to schedule-based behavior
  }

  return true;
}

export function getCycleProfile(now = new Date()) {
  const mode = getModeForNow(now);
  const isDay = mode === "DAY";
  const configuredDayIntervalMinutes = schedule.dayIntervalMinutes ?? schedule.intervalMinutes;

  return {
    mode,
    onDurationSeconds: isDay
      ? schedule.dayDurationSeconds ?? schedule.durationSeconds
      : schedule.nightDurationSeconds ?? Math.max(15, Math.round(schedule.durationSeconds * 0.75)),
    offIntervalMinutes: isDay
      ? configuredDayIntervalMinutes
      : schedule.nightIntervalMinutes ?? Math.max(schedule.intervalMinutes, 15),
  };
}

function pushSensorSnapshot(nextStatus: LiveStatus) {
  const nextSnapshot = {
    id: makeId(),
    deviceId: nextStatus.deviceId ?? DEFAULT_DEVICE_ID,
    timestamp: Date.now(),
    reservoirTempC: nextStatus.reservoirTempC,
    humidityPct: nextStatus.humidityPct ?? null,
    lightLux: nextStatus.lightLux ?? null,
    towerTempC: nextStatus.towerTempC,
    pumpState: nextStatus.pumpState,
    fault: nextStatus.fault,
    lightOn: nextStatus.lightOn ?? false,
  };

  sensorHistory = [
    nextSnapshot,
    ...sensorHistory,
  ].slice(0, 1000);

  void appendEvent("sensor_snapshot_added", nextSnapshot);
}

function calculatePlannedNextCycle(now = new Date(), status?: LiveStatus | null): { nextCycleISO: string | null; nextCycleIn: number } {
  if (!schedule.enabled) {
    return { nextCycleISO: null, nextCycleIn: -1 };
  }

  const currentHour = getIstHour(now);
  const { offIntervalMinutes, onDurationSeconds } = getCycleProfile(now);
  const intervalMs = (offIntervalMinutes * 60 + onDurationSeconds) * 1000;

  let nextCycleTime: Date | null = null;

  // Try using actual last run time if present and valid
  const lastRunMs = status?.lastRunISO ? Date.parse(status.lastRunISO) : null;
  if (lastRunMs && Number.isFinite(lastRunMs)) {
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
    const windowStart = makeIstDateAtHour(now, schedule.startHour);

    // Outside active hours?
    if (currentHour < schedule.startHour || currentHour >= schedule.endHour) {
      // Next cycle is at start of tomorrow's window
      const tomorrow = makeIstDateAtHour(now, schedule.startHour, 1);
      const secondsUntil = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
      return { nextCycleISO: tomorrow.toISOString(), nextCycleIn: secondsUntil };
    }

    const elapsedMs = now.getTime() - windowStart.getTime();
    const slotsElapsed = Math.max(0, Math.ceil(elapsedMs / intervalMs));
    nextCycleTime = new Date(windowStart.getTime() + slotsElapsed * intervalMs);
  }

  const nextHour = getIstHour(nextCycleTime);
  if (nextHour < schedule.startHour || nextHour >= schedule.endHour || nextCycleTime.getTime() < now.getTime()) {
    const nextDay = makeIstDateAtHour(now, schedule.startHour, 1);
    const secondsUntil = Math.floor((nextDay.getTime() - now.getTime()) / 1000);
    return { nextCycleISO: nextDay.toISOString(), nextCycleIn: secondsUntil };
  }

  const secondsUntil = Math.floor((nextCycleTime.getTime() - now.getTime()) / 1000);
  return { nextCycleISO: nextCycleTime.toISOString(), nextCycleIn: Math.max(0, secondsUntil) };
}

function calculateRetryCycle(nextStatus: LiveStatus, now = new Date()): { retryNextCycleISO: string | null; retryNextCycleIn: number | null } {
  if (!schedule.enabled) {
    return { retryNextCycleISO: null, retryNextCycleIn: null };
  }

  const withinActiveWindow = getIstHour(now) >= schedule.startHour && getIstHour(now) < schedule.endHour;
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
    lightManualMode: "AUTO",
    batteryManualMode: "AUTO",
    reservoirTempC: null,
    humidityPct: null,
    lightLux: null,
    towerTempC: null,
    flowRateLpm: null,
    lightOn: shouldLightBeOnBySchedule(now, deviceId),
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

  const nextStatus = { ...currentStatus };
  const currentHour = getIstHour(now);

  if (nextStatus.lightManualMode === "AUTO") {
    nextStatus.lightOn = shouldLightBeOnBySchedule(now, resolvedDeviceId);
  }

  if (nextStatus.motorManualMode === "AUTO" && schedule.enabled) {
    const withinActiveWindow = currentHour >= schedule.startHour && currentHour < schedule.endHour;
    const cycleProfile = getCycleProfile(now);
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

export function getSchedule() {
  return { ...schedule };
}

export function updateSchedule(next: Schedule) {
  schedule = { ...next };
  saveScheduleToDisk(schedule);
  void appendEvent("schedule_updated", schedule);
  return getSchedule();
}

export function getStatus(deviceId?: string | null) {
  syncScheduledState(deviceId);
  const currentStatus = getDeviceStatus(deviceId);
  if (!currentStatus) return null;
  
  // Calculate next cycle and update status
  const plannedNextCycle = calculatePlannedNextCycle(new Date(), currentStatus);
  const retryCycle = calculateRetryCycle(currentStatus);
  const cycleProfile = getCycleProfile();
  const heartbeatUpdatedAt = currentStatus.heartbeatUpdatedAt ?? null;
  const deviceSignalUpdatedAt = getLatestDeviceSignalAt(currentStatus);
  const isOnline = isFresh(deviceSignalUpdatedAt);
  
  // Compute pumpEndISO when pump is running
  let pumpEndISO: string | null = null;
  try {
    if (currentStatus.pumpOn && currentStatus.lastRunISO) {
      // Prefer to use a matching pumpLog's onDurationSeconds when available
      const matching = pumpLogs.find((p) => p.startedAt === currentStatus.lastRunISO && (p.deviceId ?? DEFAULT_DEVICE_ID) === (currentStatus.deviceId ?? DEFAULT_DEVICE_ID));
      const onDur = matching ? matching.onDurationSeconds : getCycleProfile(new Date(currentStatus.lastRunISO)).onDurationSeconds;
      const lastMs = new Date(currentStatus.lastRunISO).getTime();
      pumpEndISO = new Date(lastMs + onDur * 1000).toISOString();
    }
  } catch {
    pumpEndISO = null;
  }

  return {
    ...currentStatus,
    nextCycleISO: plannedNextCycle.nextCycleISO,
    nextCycleIn: plannedNextCycle.nextCycleIn,
    plannedNextCycleISO: plannedNextCycle.nextCycleISO,
    plannedNextCycleIn: plannedNextCycle.nextCycleIn,
    retryNextCycleISO: retryCycle.retryNextCycleISO,
    retryNextCycleIn: retryCycle.retryNextCycleIn,
    cycleMode: cycleProfile.mode,
    cycleOnDurationSeconds: cycleProfile.onDurationSeconds,
    cycleOffIntervalMinutes: cycleProfile.offIntervalMinutes,
    isOnline,
    pumpEndISO,
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

  // Apply scheduled light logic if lightOn wasn't explicitly set in patch
  const shouldApplySchedule = patch.lightOn === undefined;
  const scheduledLightOn = shouldApplySchedule ? shouldLightBeOnBySchedule(new Date(), deviceId) : patch.lightOn;
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

  const mergedStatus = {
    ...createBaseStatus(new Date(), deviceId),
    ...currentStatus,
    ...patch,
    deviceId,
    telemetryUpdatedAt,
    heartbeatUpdatedAt,
    lightOn: scheduledLightOn,
    lastRunISO: resolvedLastRunISO,
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
    statuses[deviceId] = {
      ...statuses[deviceId],
      lastRunISO: next.startedAt,
      fault: next.fault ?? statuses[deviceId].fault,
    };
  }

  saveStateToDisk();
  void appendEvent("pump_log_added", next);

  return { ...next };
}

export function startPumpLog(input: { mode?: PumpLog["mode"]; onDurationSeconds?: number; offIntervalMinutes?: number; startedAtMs?: number; deviceId?: string | null }) {
  const next = addPumpLog({
    mode: input.mode ?? getCycleProfile().mode,
    onDurationSeconds: input.onDurationSeconds ?? 0,
    offIntervalMinutes: input.offIntervalMinutes ?? getCycleProfile().offIntervalMinutes,
    durationSeconds: 0,
    flowed: false,
    fault: null,
    startedAtMs: input.startedAtMs ?? Date.now(),
    endedAtMs: input.startedAtMs ?? Date.now(),
    deviceId: input.deviceId ?? undefined,
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
    statuses[updated.deviceId] = {
      ...statuses[updated.deviceId],
      lastRunISO: updated.startedAt,
      fault: updated.fault ?? statuses[updated.deviceId].fault,
    };
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


