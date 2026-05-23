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

    if (parsed.status && typeof parsed.status === "object") {
      status = parsed.status;
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
      status,
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
  switch (eventType) {
    case "schedule_updated":
      schedule = { ...DEFAULT_SCHEDULE, ...payload };
      break;
    case "status_updated":
      status = payload ?? null;
      break;
    case "sensor_snapshot_added":
      if (payload) sensorHistory = [payload, ...sensorHistory].slice(0, 1000);
      break;
    case "reading_added":
      if (payload) readings = [payload, ...readings];
      break;
    case "reading_deleted":
      if (payload?.id) readings = readings.filter((reading) => reading.id !== payload.id);
      break;
    case "pump_log_added":
      if (payload) pumpLogs = [payload, ...pumpLogs];
      break;
    case "pump_log_updated":
      if (payload?.id) {
        const index = pumpLogs.findIndex((log) => log.id === payload.id);
        if (index >= 0) {
          pumpLogs[index] = payload;
        }
      }
      break;
    case "fault_recorded":
      if (payload) faultHistory = [payload, ...faultHistory];
      break;
  }
}

async function appendEvent(eventType: TowerEventType, payload: unknown) {
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
    status = null;
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
let status: LiveStatus | null = null;
let sensorHistory: SensorSnapshot[] = [];
let readings: ManualReading[] = [];
let pumpLogs: PumpLog[] = [];
let faultHistory: Array<{ timestamp: number; fault: string; resolved?: number }> = [];
let autoPumpStartedAtMs: number | null = null;
let autoPumpLogId: string | null = null;

loadStateFromDisk();

const TELEMETRY_STALE_MS = 15000;

function isFresh(timestamp: number | null | undefined, staleMs = TELEMETRY_STALE_MS): boolean {
  return timestamp != null && Date.now() - timestamp <= staleMs;
}

function getLatestDeviceSignalAt(status: LiveStatus | null | undefined): number | null {
  const timestamps = [status?.heartbeatUpdatedAt, status?.telemetryUpdatedAt]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function getModeForNow(now = new Date()): "DAY" | "NIGHT" {
  const hour = now.getHours();
  return hour >= schedule.startHour && hour < schedule.endHour ? "DAY" : "NIGHT";
}

function isRetryableFlowFault(fault: string | null | undefined): boolean {
  if (!fault) return false;
  const upper = fault.toUpperCase();
  return upper.includes("FLOW") || upper.includes("DRY");
}

/**
 * Determines if grow light should be on based on schedule
 * Light is on during active hours (startHour to endHour) if enabled
 */
function shouldLightBeOnBySchedule(now = new Date()): boolean {
  if (!schedule.lightEnabled) return false;
  if (!schedule.enabled) return false;
  const hour = now.getHours();
  const lightStartHour = schedule.lightStartHour ?? schedule.startHour;
  const lightEndHour = schedule.lightEndHour ?? schedule.endHour;
  const inWindow = hour >= lightStartHour && hour < lightEndHour;
  if (!inWindow) return false;

  // If an ambient light sensor is present, prefer auto-on when ambient lux is low (indoor use)
  try {
    const latest = sensorHistory[0];
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
  const safeDayIntervalMinutes = Math.min(schedule.dayIntervalMinutes ?? schedule.intervalMinutes, 7);

  return {
    mode,
    onDurationSeconds: isDay
      ? schedule.dayDurationSeconds ?? schedule.durationSeconds
      : schedule.nightDurationSeconds ?? Math.max(15, Math.round(schedule.durationSeconds * 0.75)),
    offIntervalMinutes: isDay
      ? safeDayIntervalMinutes
      : schedule.nightIntervalMinutes ?? Math.max(schedule.intervalMinutes, 15),
  };
}

function pushSensorSnapshot(nextStatus: LiveStatus) {
  const nextSnapshot = {
    id: makeId(),
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

// ==================== HELPER: CALCULATE NEXT CYCLE ====================
function calculatePlannedNextCycle(now = new Date()): { nextCycleISO: string | null; nextCycleIn: number } {
  if (!schedule.enabled) {
    return { nextCycleISO: null, nextCycleIn: -1 };
  }

  const currentHour = now.getHours();
  const { offIntervalMinutes } = getCycleProfile(now);
  const intervalMs = offIntervalMinutes * 60 * 1000;
  const windowStart = new Date(now);
  windowStart.setHours(schedule.startHour, 0, 0, 0);

  // Outside active hours?
  if (currentHour < schedule.startHour || currentHour >= schedule.endHour) {
    // Next cycle is at start of tomorrow's window
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(schedule.startHour, 0, 0, 0);
    const secondsUntil = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
    return { nextCycleISO: tomorrow.toISOString(), nextCycleIn: secondsUntil };
  }

  const elapsedMs = now.getTime() - windowStart.getTime();
  const slotsElapsed = Math.max(0, Math.ceil(elapsedMs / intervalMs));
  const nextCycleTime = new Date(windowStart.getTime() + slotsElapsed * intervalMs);

  if (nextCycleTime.getHours() >= schedule.endHour || nextCycleTime.getTime() < now.getTime()) {
    const nextDay = new Date(now);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(schedule.startHour, 0, 0, 0);
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

  const withinActiveWindow = now.getHours() >= schedule.startHour && now.getHours() < schedule.endHour;
  if (!withinActiveWindow) {
    return { retryNextCycleISO: null, retryNextCycleIn: null };
  }

  const retryableFault = isRetryableFlowFault(nextStatus.fault);
  if (!retryableFault) {
    return { retryNextCycleISO: null, retryNextCycleIn: null };
  }

  return { retryNextCycleISO: new Date(now.getTime() + 1000).toISOString(), retryNextCycleIn: 1 };
}

function createBaseStatus(now = new Date()): LiveStatus {
  return {
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
    lightOn: shouldLightBeOnBySchedule(now),
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

function syncScheduledState(now = new Date()) {
  if (!status) {
    status = createBaseStatus(now);
  }

  if (status.isOnline) {
    return;
  }

  const nextStatus = { ...status };

  if (nextStatus.lightManualMode === "AUTO") {
    nextStatus.lightOn = shouldLightBeOnBySchedule(now);
  }

  if (nextStatus.motorManualMode === "AUTO" && schedule.enabled) {
    const withinActiveWindow = now.getHours() >= schedule.startHour && now.getHours() < schedule.endHour;
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

      status = nextStatus;
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
      status = nextStatus;
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

  status = nextStatus;
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

export function getStatus() {
  syncScheduledState();
  const currentStatus = status;
  if (!currentStatus) return null;
  
  // Calculate next cycle and update status
  const plannedNextCycle = calculatePlannedNextCycle();
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
      const matching = pumpLogs.find((p) => p.startedAt === currentStatus.lastRunISO);
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

export function updateStatus(
  patch: Partial<LiveStatus>,
  options: { source?: "esp32" | "server" } = {},
) {
  if (!status) {
    status = createBaseStatus();
  }

  // Apply scheduled light logic if lightOn wasn't explicitly set in patch
  const shouldApplySchedule = patch.lightOn === undefined;
  const scheduledLightOn = shouldApplySchedule ? shouldLightBeOnBySchedule() : patch.lightOn;
  const source = options.source ?? "server";
  const telemetryUpdatedAt = source === "esp32" ? Date.now() : status?.telemetryUpdatedAt ?? null;
  const heartbeatUpdatedAt = status?.heartbeatUpdatedAt ?? null;
  const isOnline = isFresh(getLatestDeviceSignalAt(status));

  status = {
    ...createBaseStatus(),
    ...status,
    ...patch,
    telemetryUpdatedAt,
    heartbeatUpdatedAt,
    isOnline,
    lightOn: scheduledLightOn,
  };

  pushSensorSnapshot(status);

  // Track fault history
  if (patch.fault && patch.fault !== "OK" && patch.fault !== status.fault) {
    faultHistory = [
      {
        timestamp: Date.now(),
        fault: patch.fault,
      },
      ...faultHistory,
    ];
    void appendEvent("fault_recorded", faultHistory[0]);
  }

  saveStateToDisk();
  void appendEvent("status_updated", status);

  return getStatus();
}

export function touchStatus(options: { source?: "esp32" | "server" } = {}) {
  const source = options.source ?? "server";
  if (!status) {
    status = createBaseStatus();
    if (source === "esp32") {
      status.telemetryUpdatedAt = Date.now();
      status.heartbeatUpdatedAt = Date.now();
      status.isOnline = true;
    }
    saveStateToDisk();
    void appendEvent("status_updated", status);
    return getStatus();
  }

  const telemetryUpdatedAt = source === "esp32" ? Date.now() : status.telemetryUpdatedAt ?? null;
  const heartbeatUpdatedAt = source === "esp32" ? Date.now() : status.heartbeatUpdatedAt ?? null;
  const isOnline = isFresh(getLatestDeviceSignalAt({ ...status, telemetryUpdatedAt, heartbeatUpdatedAt }));

  status = {
    ...status,
    telemetryUpdatedAt,
    heartbeatUpdatedAt,
    isOnline,
  };

  saveStateToDisk();
  void appendEvent("status_updated", status);

  return getStatus();
}

export function getSensorHistory(days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return sensorHistory.filter((snapshot) => snapshot.timestamp >= cutoff).map((snapshot) => ({ ...snapshot }));
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

export function getPumpLogs() {
  return pumpLogs.map((log) => ({ ...log }));
}

export function addPumpLog(log: PumpLogInput) {
  const now = new Date(log.startedAtMs ?? Date.now());
  const endedAt = new Date(log.endedAtMs ?? (now.getTime() + Math.max(0, log.durationSeconds) * 1000));
  const cycleProfile = getCycleProfile(now);
  const next = {
    ...log,
    id: makeId(),
    startedAt: now.toISOString(),
    endedAt: endedAt.toISOString(),
    mode: log.mode ?? cycleProfile.mode,
    onDurationSeconds: log.onDurationSeconds ?? log.durationSeconds,
    offIntervalMinutes: log.offIntervalMinutes ?? cycleProfile.offIntervalMinutes,
    volumeLiters: log.volumeLiters ?? null,
    flowRateLpm: log.flowRateLpm ?? null,
  };
  pumpLogs = [next, ...pumpLogs];

  if (status) {
    status = {
      ...status,
      lastRunISO: next.startedAt,
      fault: next.fault ?? status.fault,
    };
  }

  saveStateToDisk();
  void appendEvent("pump_log_added", next);

  return { ...next };
}

export function startPumpLog(input: { mode?: PumpLog["mode"]; onDurationSeconds?: number; offIntervalMinutes?: number; startedAtMs?: number }) {
  const next = addPumpLog({
    mode: input.mode ?? getCycleProfile().mode,
    onDurationSeconds: input.onDurationSeconds ?? 0,
    offIntervalMinutes: input.offIntervalMinutes ?? getCycleProfile().offIntervalMinutes,
    durationSeconds: 0,
    flowed: false,
    fault: null,
    startedAtMs: input.startedAtMs ?? Date.now(),
    endedAtMs: input.startedAtMs ?? Date.now(),
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

  if (status) {
    status = {
      ...status,
      lastRunISO: updated.startedAt,
      fault: updated.fault ?? status.fault,
    };
  }

  saveStateToDisk();
  void appendEvent("pump_log_updated", updated);

  return { ...updated };
}

export function getFaultHistory(limit: number = 20) {
  return faultHistory.slice(0, limit).map((f) => ({ ...f }));
}

export function getAnalyticsSummary(days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recentSensors = sensorHistory.filter((snapshot) => snapshot.timestamp >= cutoff);
  const recentLogs = pumpLogs.filter((log) => new Date(log.startedAt).getTime() >= cutoff);
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


