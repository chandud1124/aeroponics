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
  lightEnabled?: boolean;
  lightStartHour?: number;
  lightEndHour?: number;
  nightEnabled?: boolean;
  dayIntervalMinutes?: number;
  dayDurationSeconds?: number;
  nightIntervalMinutes?: number;
  nightDurationSeconds?: number;
  temperatureProtection?: boolean;
  rainPause?: boolean;
  heatBoost?: boolean;
  lowWaterAutoLock?: boolean;
  nutritionEnabled?: boolean;
  targetPh?: number;
  targetEc?: number;
  phDoseSeconds?: number;
  phDoseIntervalMinutes?: number;
  ecDoseSeconds?: number;
  ecDoseIntervalMinutes?: number;
};

export type LiveStatus = {
  deviceId?: string;
  pumpOn: boolean;
  flowing: boolean;
  pumpState: PumpState;
  motorManualMode?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
  phManualMode?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
  nutritionManualMode?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
  phDosingOn: boolean;
  nutritionADosingOn: boolean;
  nutritionBDosingOn: boolean;
  ph: number | null;
  ec: number | null;
  waterLevel: "LOW" | "MEDIUM" | "FULL" | null;
  waterDistanceCm?: number | null;
  waterLevelPercent?: number | null;
  waterVolumeLiters?: number | null;
  reservoirTempC: number | null;
  humidityPct?: number | null;
  towerTempC: number | null;
  flowRateLpm?: number | null;
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
  vpd?: number | null;
  lightOn?: boolean | null;
  lightLux?: number | null;
};

export type SensorSnapshot = {
  id: string;
  deviceId?: string;
  timestamp: number;
  reservoirTempC: number | null;
  ph: number | null;
  ec: number | null;
  waterLevel: "LOW" | "MEDIUM" | "FULL" | null;
  humidityPct?: number | null;
  towerTempC: number | null;
  pumpState: PumpState;
  fault: string | null;
  vpd?: number | null;
  lightLux?: number | null;
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
  lightEnabled: true,
  lightStartHour: 5,
  lightEndHour: 21,
  nightEnabled: true,
  dayIntervalMinutes: 7,
  dayDurationSeconds: 180,
  nightIntervalMinutes: 10,
  nightDurationSeconds: 180,
  temperatureProtection: true,
  rainPause: false,
  heatBoost: true,
  lowWaterAutoLock: true,
  nutritionEnabled: true,
  targetPh: 6.0,
  targetEc: 1.2,
  phDoseSeconds: 5,
  phDoseIntervalMinutes: 30,
  ecDoseSeconds: 10,
  ecDoseIntervalMinutes: 30,
};

export type NftCropEntry = {
  cropName: string;
  count: number;
};

export type NftIncidentLog = {
  timestamp: string;
  type: "incident" | "removal";
  description: string;
  qtyRemoved?: number;
  cultivar?: string;
};

export type NftChannel = {
  id: string;
  name: string;
  qrCode: string;
  cropName: string;
  crops?: NftCropEntry[];
  plantedAt: string | null;
  harvestedAt: string | null;
  notes: string;
  status: "empty" | "growing" | "harvested";
  capacity?: number;
  currentCount?: number;
  expectedHarvestISO?: string | null;
  stand?: string;
  level?: string;
  channelIndex?: number;
  incidents?: NftIncidentLog[];
};

export type GpioMapping = {
  id: string;
  name: string;
  type:
    | "pH Sensor"
    | "EC Sensor"
    | "Water Level Sensor"
    | "Water Level - Float Switch"
    | "Water Level - Ultrasonic"
    | "Water Level - Analog Sensor"
    | "Humidity Sensor"
    | "Water Temperature Sensor"
    | "Relay - Water Pump"
    | "Relay - Nutrition A"
    | "Relay - Nutrition B"
    | "Relay - Nutrition C"
    | "Relay - pH Down"
    | "Other Sensor"
    | "Other Actuator";
  direction: "INPUT" | "OUTPUT";
  pin: number;
  txPin?: number;
  emptyDistanceCm?: number;
  fullDistanceCm?: number;
  tankWidthCm?: number;
  tankLengthCm?: number;
  tankHeightCm?: number;
  tankCapacityLiters?: number;
};

export const defaultGpioMappings: GpioMapping[] = [
  { id: "map-1", name: "Water Pump", type: "Relay - Water Pump", direction: "OUTPUT", pin: 27 },
  { id: "map-2", name: "Nutrient Pump A", type: "Relay - Nutrition A", direction: "OUTPUT", pin: 33 },
  { id: "map-3", name: "Nutrient Pump B", type: "Relay - Nutrition B", direction: "OUTPUT", pin: 26 },
  { id: "map-4", name: "pH Down Pump", type: "Relay - pH Down", direction: "OUTPUT", pin: 25 },
  { id: "map-5", name: "pH Probe", type: "pH Sensor", direction: "INPUT", pin: 35 },
  { id: "map-6", name: "EC Probe", type: "EC Sensor", direction: "INPUT", pin: 34 },
  { id: "map-7", name: "Water Level Switch", type: "Water Level Sensor", direction: "INPUT", pin: 32 },
  { id: "map-8", name: "DHT22 Temp/Hum Sensor", type: "Humidity Sensor", direction: "INPUT", pin: 16 }
];

export type HarvestHistoryEntry = {
  id: string;
  channelId: string;
  channelName: string;
  cropName: string;
  crops?: NftCropEntry[];
  plantedAt: string | null;
  harvestedAt: string;
  notes: string;
  capacity?: number;
  currentCount?: number;
  yieldQty?: number;
  wasteQty?: number;
  avgWeightGrams?: number;
  incidents?: NftIncidentLog[];
};

export function calculateVpd(tempC: number | null | undefined, humidityPct: number | null | undefined): number | null {
  if (tempC == null || humidityPct == null) return null;
  const vpsat = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const vpd = vpsat * (1 - humidityPct / 100);
  return Number(vpd.toFixed(2));
}

export function compensateEc(ec: number | null | undefined, tempC: number | null | undefined): number | null {
  if (ec == null || tempC == null) return ec ?? null;
  const compensated = ec / (1 + 0.0191 * (tempC - 25));
  return Number(compensated.toFixed(2));
}

export type CameraSettings = {
  rtspUrl: string;
  ezvizAppKey: string;
  ezvizAppSecret: string;
  autoCapture: boolean;
};

export type CameraSnapshot = {
  id: string;
  timestamp: number;
  imageUrl: string;
  analysis: string;
  healthStatus: "healthy" | "warning" | "alert";
};