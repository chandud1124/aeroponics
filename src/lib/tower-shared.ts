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
  [PumpState.VERIFYING_FLOW]: "Verifying pump start",
  [PumpState.RUNNING]: "Pump running",
  [PumpState.FAULT_NO_FLOW]: "ERROR: Pump verification failed",
  [PumpState.LOW_WATER_LOCK]: "Locked: Safety input active",
  [PumpState.TEMP_PAUSE]: "Paused: Safety condition active",
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

export type Schedule = {
  planName?: string;
  intervalMinutes: number;
  durationSeconds: number;
  startHour: number;
  endHour: number;
  enabled: boolean;
  nightEnabled?: boolean;
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
  deviceId?: string;
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
  scheduleAppliedAt?: number | null;
  appliedPlanName?: string | null;
  pumpEndISO?: string | null;
  fault: string | null;
  plannedNextCycleISO?: string | null;
  plannedNextCycleIn?: number | null;
  retryNextCycleISO?: string | null;
  retryNextCycleIn?: number | null;
  sensorDataOk?: boolean;
  dhtOk?: boolean;
  reservoirDsOk?: boolean;
  towerDsOk?: boolean;
  cycleMode?: "DAY" | "NIGHT";
  cycleOnDurationSeconds?: number;
  cycleOffIntervalMinutes?: number;
  nightEnabled?: boolean;
  resetReason?: string | null;
  lastBootFault?: string | null;
  uptimeSec?: number | null;
  nextCycleISO: string | null;
  nextCycleIn: number;
  telemetryUpdatedAt: number | null;
  heartbeatUpdatedAt?: number | null;
  isOnline: boolean;
};

export type SensorSnapshot = {
  id: string;
  deviceId?: string;
  timestamp: number;
  reservoirTempC: number | null;
  humidityPct?: number | null;
  lightLux?: number | null;
  towerTempC: number | null;
  pumpState: PumpState;
  fault: string | null;
};

export type ManualReading = {
  id: string;
  timestamp: number;
  ph: number | null;
  tds: number | null;
  ec: number | null;
  notes: string;
};

export type PumpLogEntry = {
  id: string;
  deviceId?: string;
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

export type AnalyticsSummary = {
  days: number;
  sensorPoints: number;
  pumpCycles: number;
  manualReadings: number;
  successRate: number;
  faultCount: number;
  avgReservoirTempC: number | null;
  avgTowerTempC: number | null;
  minReservoirTempC: number | null;
  maxReservoirTempC: number | null;
  minTowerTempC: number | null;
  maxTowerTempC: number | null;
  estimatedWaterLiters: number;
  daily: Array<{
    date: string;
    cycles: number;
    successRate: number;
    avgReservoirTempC: number | null;
    avgTowerTempC: number | null;
  }>;
};

export const defaultSchedule: Schedule = {
  planName: "3 on / 7 off (safe day cycle)",
  intervalMinutes: 10,
  durationSeconds: 180, // 3 minutes
  startHour: 0,
  endHour: 24,
  enabled: true,
  nightEnabled: true,
  lightEnabled: true,
  lightStartHour: 5,
  lightEndHour: 21,
  dayIntervalMinutes: 7,
  dayDurationSeconds: 180,
  nightIntervalMinutes: 10,
  nightDurationSeconds: 180,
  temperatureProtection: true,
  rainPause: false,
  heatBoost: true,
  lowWaterAutoLock: true,
};