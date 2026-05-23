// ==================== PUMP STATE ENUM ====================
export enum PumpState {
  IDLE = "IDLE",
  WAITING = "WAITING",
  STARTING = "STARTING",
  VERIFYING_FLOW = "VERIFYING_FLOW",
  RUNNING = "RUNNING",
  FAULT_NO_FLOW = "FAULT_NO_FLOW",
  LOW_WATER_LOCK = "LOW_WATER_LOCK",
  TEMP_PAUSE = "TEMP_PAUSE",
  MANUAL_MODE = "MANUAL_MODE",
}

export const PUMP_STATE_LABELS: Record<PumpState, string> = {
  [PumpState.IDLE]: "Idle (waiting for next cycle)",
  [PumpState.WAITING]: "Waiting for scheduled time",
  [PumpState.STARTING]: "Relay activated",
  [PumpState.VERIFYING_FLOW]: "Verifying flow sensor (3 sec)",
  [PumpState.RUNNING]: "Pump running - water flowing",
  [PumpState.FAULT_NO_FLOW]: "ERROR: No flow detected",
  [PumpState.LOW_WATER_LOCK]: "Locked: Water level too low",
  [PumpState.TEMP_PAUSE]: "Paused: Reservoir too hot",
  [PumpState.MANUAL_MODE]: "Manual override active",
};

export const PUMP_STATE_COLORS: Record<PumpState, string> = {
  [PumpState.IDLE]: "bg-slate-200 text-slate-900",
  [PumpState.WAITING]: "bg-blue-200 text-blue-900",
  [PumpState.STARTING]: "bg-amber-200 text-amber-900",
  [PumpState.VERIFYING_FLOW]: "bg-orange-300 text-orange-900",
  [PumpState.RUNNING]: "bg-green-200 text-green-900",
  [PumpState.FAULT_NO_FLOW]: "bg-red-200 text-red-900",
  [PumpState.LOW_WATER_LOCK]: "bg-yellow-200 text-yellow-900",
  [PumpState.TEMP_PAUSE]: "bg-orange-200 text-orange-900",
  [PumpState.MANUAL_MODE]: "bg-purple-200 text-purple-900",
};

type Schedule = {
  planName?: string;
  intervalMinutes: number;
  durationSeconds: number;
  startHour: number;
  endHour: number;
  enabled: boolean;
  lightEnabled?: boolean;
  lightStartHour?: number;
  lightEndHour?: number;
  dayIntervalMinutes?: number;
  dayDurationSeconds?: number;
  nightIntervalMinutes?: number;
  nightDurationSeconds?: number;
  temperatureProtection?: boolean;
  rainPause?: boolean;
  heatBoost?: boolean;
  lowWaterAutoLock?: boolean;
};

export type LiveStatus = {
  pumpOn: boolean;
  flowing: boolean;
  pumpState: PumpState;
  motorManualMode?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
  lightManualMode?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
  batteryChargeOn?: boolean;
  batteryManualMode?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
  reservoirTempC: number | null;
  humidityPct?: number | null;
  lightLux?: number | null;
  towerTempC: number | null;
  flowRateLpm?: number | null;
  lightOn?: boolean;
  lastRunISO: string | null;
  // If device reports scheduleAppliedAt (epoch seconds)
  scheduleAppliedAt?: number | null;
  appliedPlanName?: string | null;
  // If device reports an explicit on-duration at start, server can expose pumpEndISO
  pumpEndISO?: string | null;
  fault: string | null;
  resetReason?: string | null;
  lastBootFault?: string | null;
  uptimeSec?: number | null;
  nextCycleISO: string | null;
  nextCycleIn: number; // seconds until next cycle
  telemetryUpdatedAt: number | null;
  isOnline: boolean;
};

export type SensorSnapshot = {
  id: string;
  timestamp: number;
  reservoirTempC: number | null;
  humidityPct?: number | null;
  lightLux?: number | null;
  towerTempC: number | null;
  pumpState: PumpState;
  fault: string | null;
};

type ManualReading = {
  id: string;
  timestamp: number;
  ph: number | null;
  tds: number | null;
  ec: number | null;
  notes: string;
};

type PumpLog = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  flowed: boolean;
  fault: string | null;
  mode: "DAY" | "NIGHT" | "MANUAL";
  onDurationSeconds: number;
  offIntervalMinutes: number;
  volumeLiters?: number | null;
  flowRateLpm?: number | null;
};

type PumpLogInput = Omit<PumpLog, "id" | "startedAt" | "endedAt"> & {
  mode?: PumpLog["mode"];
  onDurationSeconds?: number;
  offIntervalMinutes?: number;
  startedAtMs?: number;
  endedAtMs?: number;
  volumeLiters?: number | null;
  flowRateLpm?: number | null;
};

const DEFAULT_SCHEDULE: Schedule = {
  intervalMinutes: 30,
  durationSeconds: 60,
  // Adjusted to indoor guide: lights on 5:00, off 21:00 (16h)
  startHour: 5,
  endHour: 21,
  enabled: true,
  lightEnabled: true,
  lightStartHour: 5,
  lightEndHour: 21,
  dayIntervalMinutes: 7,
  dayDurationSeconds: 45,
  nightIntervalMinutes: 20,
  nightDurationSeconds: 30,
  temperatureProtection: true,
  rainPause: false,
  heatBoost: true,
  lowWaterAutoLock: true,
};

let schedule: Schedule = { ...DEFAULT_SCHEDULE };
let status: LiveStatus | null = null;
let sensorHistory: SensorSnapshot[] = [];
let readings: ManualReading[] = [];
let pumpLogs: PumpLog[] = [];
let faultHistory: Array<{ timestamp: number; fault: string; resolved?: number }> = [];

const TELEMETRY_STALE_MS = 15000;

function getModeForNow(now = new Date()): "DAY" | "NIGHT" {
  const hour = now.getHours();
  return hour >= schedule.startHour && hour < schedule.endHour ? "DAY" : "NIGHT";
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

function getCycleProfile(now = new Date()) {
  const mode = getModeForNow(now);
  const isDay = mode === "DAY";

  return {
    mode,
    onDurationSeconds: isDay
      ? schedule.dayDurationSeconds ?? schedule.durationSeconds
      : schedule.nightDurationSeconds ?? Math.max(15, Math.round(schedule.durationSeconds * 0.75)),
    offIntervalMinutes: isDay
      ? schedule.dayIntervalMinutes ?? schedule.intervalMinutes
      : schedule.nightIntervalMinutes ?? Math.max(schedule.intervalMinutes, 15),
  };
}

function pushSensorSnapshot(nextStatus: LiveStatus) {
  sensorHistory = [
    {
      id: makeId(),
      timestamp: Date.now(),
      reservoirTempC: nextStatus.reservoirTempC,
      humidityPct: nextStatus.humidityPct ?? null,
      lightLux: nextStatus.lightLux ?? null,
      towerTempC: nextStatus.towerTempC,
      pumpState: nextStatus.pumpState,
      fault: nextStatus.fault,
      lightOn: nextStatus.lightOn ?? false,
    },
    ...sensorHistory,
  ].slice(0, 1000);
}

// ==================== HELPER: CALCULATE NEXT CYCLE ====================
function calculateNextCycle(): { nextCycleISO: string | null; nextCycleIn: number } {
  if (!schedule.enabled) {
    return { nextCycleISO: null, nextCycleIn: -1 };
  }

  const now = new Date();
  const currentHour = now.getHours();
  const { offIntervalMinutes } = getCycleProfile(now);

  // Outside active hours?
  if (currentHour < schedule.startHour || currentHour >= schedule.endHour) {
    // Next cycle is at start of tomorrow's window
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(schedule.startHour, 0, 0, 0);
    const secondsUntil = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
    return { nextCycleISO: tomorrow.toISOString(), nextCycleIn: secondsUntil };
  }

  // Within active hours - calculate based on last run
  const lastRunTime = status?.lastRunISO ? new Date(status.lastRunISO).getTime() : null;
  const intervalMs = offIntervalMinutes * 60 * 1000;

  if (!lastRunTime) {
    // Never run yet - let the UI show an explicit waiting state instead of 00:00
    return { nextCycleISO: null, nextCycleIn: -1 };
  }

  const nextCycleTime = new Date(lastRunTime + intervalMs);

  // If next cycle is after end hour, push to next day's start
  if (nextCycleTime.getHours() >= schedule.endHour) {
    const nextDay = new Date(now);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(schedule.startHour, 0, 0, 0);
    const secondsUntil = Math.floor((nextDay.getTime() - now.getTime()) / 1000);
    return { nextCycleISO: nextDay.toISOString(), nextCycleIn: secondsUntil };
  }

  const secondsUntil = Math.floor((nextCycleTime.getTime() - now.getTime()) / 1000);
  return { nextCycleISO: nextCycleTime.toISOString(), nextCycleIn: Math.max(0, secondsUntil) };
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getSchedule() {
  return { ...schedule };
}

export function updateSchedule(next: Schedule) {
  schedule = { ...next };
  return getSchedule();
}

export function getStatus() {
  if (!status) return null;
  
  // Calculate next cycle and update status
  const nextCycle = calculateNextCycle();
  const telemetryUpdatedAt = status.telemetryUpdatedAt;
  const isOnline = telemetryUpdatedAt != null && Date.now() - telemetryUpdatedAt <= TELEMETRY_STALE_MS;
  
  // Compute pumpEndISO when pump is running
  let pumpEndISO: string | null = null;
  try {
    if (status.pumpOn && status.lastRunISO) {
      // Prefer to use a matching pumpLog's onDurationSeconds when available
      const matching = pumpLogs.find((p) => p.startedAt === status.lastRunISO);
      const onDur = matching ? matching.onDurationSeconds : getCycleProfile(new Date(status.lastRunISO)).onDurationSeconds;
      const lastMs = new Date(status.lastRunISO).getTime();
      pumpEndISO = new Date(lastMs + onDur * 1000).toISOString();
    }
  } catch {
    pumpEndISO = null;
  }

  return {
    ...status,
    nextCycleISO: nextCycle.nextCycleISO,
    nextCycleIn: nextCycle.nextCycleIn,
    isOnline,
    pumpEndISO,
  };
}

export function updateStatus(
  patch: Partial<LiveStatus>,
  options: { source?: "esp32" | "server" } = {},
) {
  // Apply scheduled light logic if lightOn wasn't explicitly set in patch
  const shouldApplySchedule = patch.lightOn === undefined;
  const scheduledLightOn = shouldApplySchedule ? shouldLightBeOnBySchedule() : patch.lightOn;
  const source = options.source ?? "server";
  const telemetryUpdatedAt = source === "esp32" ? Date.now() : status?.telemetryUpdatedAt ?? null;
  const isOnline = telemetryUpdatedAt != null && Date.now() - telemetryUpdatedAt <= TELEMETRY_STALE_MS;

  status = {
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
    lastRunISO: null,
    fault: null,
    nextCycleISO: null,
    nextCycleIn: 0,
    ...status,
    ...patch,
    telemetryUpdatedAt,
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
  }

  return getStatus();
}

export function touchStatus(options: { source?: "esp32" | "server" } = {}) {
  const source = options.source ?? "server";
  if (!status) {
    status = {
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
      lastRunISO: null,
      fault: null,
      nextCycleISO: null,
      nextCycleIn: 0,
      telemetryUpdatedAt: source === "esp32" ? Date.now() : null,
      isOnline: source === "esp32",
    };
    return getStatus();
  }

  const telemetryUpdatedAt = source === "esp32" ? Date.now() : status.telemetryUpdatedAt ?? null;
  const isOnline = telemetryUpdatedAt != null && Date.now() - telemetryUpdatedAt <= TELEMETRY_STALE_MS;

  status = {
    ...status,
    telemetryUpdatedAt,
    isOnline,
  };

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
  return { ...next };
}

export function deleteReading(id: string) {
  const before = readings.length;
  readings = readings.filter((reading) => reading.id !== id);
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

  return { ...next };
}

export function startPumpLog(input: { mode?: PumpLog["mode"]; onDurationSeconds?: number; offIntervalMinutes?: number; startedAtMs?: number }) {
  const next = addPumpLog({
    mode: input.mode,
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


