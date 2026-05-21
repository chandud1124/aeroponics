import { PumpState, PUMP_STATE_LABELS, PUMP_STATE_COLORS } from "./tower-server-store";

export type Schedule = {
  intervalMinutes: number;
  durationSeconds: number;
  startHour: number;
  endHour: number;
  enabled: boolean;
  dayIntervalMinutes?: number;
  dayDurationSeconds?: number;
  nightIntervalMinutes?: number;
  nightDurationSeconds?: number;
  temperatureProtection?: boolean;
  rainPause?: boolean;
  heatBoost?: boolean;
  lowWaterAutoLock?: boolean;
};

export type ManualReading = {
  id: string;
  timestamp: number;
  ph: number | null;
  tds: number | null;
  ec: number | null;
  notes: string;
};

export type LiveStatus = {
  pumpOn: boolean;
  flowing: boolean;
  pumpState: PumpState;
  reservoirTempC: number | null;
  humidityPct?: number | null;
  lightLux?: number | null;
  towerTempC: number | null;
  lightOn?: boolean;
  waterLevel: "LOW" | "MEDIUM" | "FULL";
  lastRunISO: string | null;
  fault: string | null;
  nextCycleISO: string | null;
  nextCycleIn: number;
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
  waterLevel: "LOW" | "MEDIUM" | "FULL";
  pumpState: PumpState;
  fault: string | null;
};

export type PumpLogEntry = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  flowed: boolean;
  fault: string | null;
  mode: "DAY" | "NIGHT" | "MANUAL";
  onDurationSeconds: number;
  offIntervalMinutes: number;
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

export { PumpState, PUMP_STATE_LABELS, PUMP_STATE_COLORS };

export const defaultSchedule: Schedule = {
  intervalMinutes: 30,
  durationSeconds: 60,
  startHour: 6,
  endHour: 19,
  enabled: true,
  dayIntervalMinutes: 7,
  dayDurationSeconds: 45,
  nightIntervalMinutes: 20,
  nightDurationSeconds: 30,
  temperatureProtection: true,
  rainPause: false,
  heatBoost: true,
  lowWaterAutoLock: true,
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchSchedule(): Promise<Schedule> {
  try {
    return await requestJson<Schedule>("/api/schedule", { method: "GET" });
  } catch {
    return defaultSchedule;
  }
}

export async function saveScheduleRemote(s: Schedule) {
  await requestJson("/api/schedule", {
    method: "PUT",
    body: JSON.stringify(s),
  });
}

export async function fetchReadings(): Promise<ManualReading[]> {
  try {
    return await requestJson<ManualReading[]>("/api/readings", { method: "GET" });
  } catch {
    return [];
  }
}

export async function fetchManualReadings(): Promise<ManualReading[]> {
  return fetchReadings();
}

export async function addReadingRemote(r: Omit<ManualReading, "id" | "timestamp">) {
  return requestJson("/api/readings", {
    method: "POST",
    body: JSON.stringify(r),
  });
}

export async function deleteReadingRemote(id: string) {
  await requestJson("/api/readings", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
}

export async function fetchStatus(): Promise<LiveStatus | null> {
  try {
    return await requestJson<LiveStatus>("/api/status", { method: "GET" });
  } catch {
    return null;
  }
}

export async function fetchFaultHistory() {
  try {
    const payload = await requestJson<{ faults: Array<{ timestamp: number; fault: string; resolved?: number }> }>(
      "/api/fault-history",
      { method: "GET" }
    );
    return payload.faults ?? [];
  } catch {
    return [];
  }
}

export async function fetchSensorHistory(days = 7): Promise<SensorSnapshot[]> {
  try {
    const payload = await requestJson<{ snapshots: SensorSnapshot[] }>(`/api/sensor-history?days=${days}`, {
      method: "GET",
    });
    return payload.snapshots ?? [];
  } catch {
    return [];
  }
}

export async function fetchPumpLogs(days = 7, limit = 100): Promise<PumpLogEntry[]> {
  try {
    const payload = await requestJson<{ cycles: PumpLogEntry[] }>(
      `/api/pump-logs?days=${days}&limit=${limit}`,
      { method: "GET" },
    );
    return payload.cycles ?? [];
  } catch {
    return [];
  }
}

export async function fetchAnalyticsSummary(days = 7): Promise<AnalyticsSummary | null> {
  try {
    return await requestJson<AnalyticsSummary>(`/api/analytics/summary?days=${days}`, { method: "GET" });
  } catch {
    return null;
  }
}

// Admin device management
export type DeviceListEntry = { id: string; name: string | null; deviceId: string; macAddress?: string | null; ipAddress?: string | null; createdAt: string };
export type DeviceCreateSuccess = { deviceId: string; secret: string };
export type DeviceCreateDuplicate = { error: string; existingDevice: DeviceListEntry };
export type DeviceCreateResult = DeviceCreateSuccess | DeviceCreateDuplicate;

export async function fetchAdminDevices(adminPasskey: string): Promise<DeviceListEntry[]> {
  return requestJson<{ devices: DeviceListEntry[] }>("/api/admin/devices", {
    method: "GET",
    headers: { "x-admin-passkey": adminPasskey },
  }).then((r) => r.devices ?? []);
}

export async function createAdminDevice(adminPasskey: string, name?: string, macAddress?: string, ipAddress?: string): Promise<DeviceCreateResult> {
  const response = await fetch(`${API_BASE_URL}/api/admin/devices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-passkey": adminPasskey,
    },
    body: JSON.stringify({ name, macAddress, ipAddress }),
  });

  const data = (await response.json().catch(() => null)) as DeviceCreateResult | null;

  if (!response.ok) {
    if (response.status === 409 && data && "existingDevice" in data) {
      return data;
    }

    throw new Error((data && "error" in data && data.error) || `Request failed with status ${response.status}`);
  }

  return data ?? { error: "Unexpected empty response", existingDevice: { id: "", name: null, deviceId: "", createdAt: "" } };
}

export async function deleteAdminDevice(adminPasskey: string, deviceId: string) {
  return requestJson(`/api/admin/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    headers: { "x-admin-passkey": adminPasskey },
  });
}

export async function rotateAdminDeviceSecret(adminPasskey: string, deviceId: string) {
  return requestJson<{ deviceId: string; secret: string }>(`/api/admin/devices/${encodeURIComponent(deviceId)}/secret`, {
    method: "POST",
    headers: { "x-admin-passkey": adminPasskey },
  });
}
