import {
  PumpState,
  PUMP_STATE_LABELS,
  PUMP_STATE_COLORS,
  defaultSchedule,
} from "./tower-shared";

import type {
  Schedule,
  ManualReading,
  LiveStatus,
  SensorSnapshot,
  PumpLogEntry,
  AnalyticsSummary,
  NftChannel,
  GpioMapping,
  HarvestHistoryEntry,
  NftCropEntry,
} from "./tower-shared";

export {
  PumpState,
  PUMP_STATE_LABELS,
  PUMP_STATE_COLORS,
  defaultSchedule,
};

export type {
  Schedule,
  ManualReading,
  LiveStatus,
  SensorSnapshot,
  PumpLogEntry,
  AnalyticsSummary,
  NftChannel,
  GpioMapping,
  HarvestHistoryEntry,
  NftCropEntry,
};

export type StatusEnvelope = {
  status: LiveStatus | null;
  schedule: Schedule;
  hasRegisteredDevice: boolean;
};

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export function withDeviceHeaders(init: RequestInit = {}, deviceId?: string | null): RequestInit {
  const headers = new Headers(init.headers ?? {});
  const trimmedDeviceId = deviceId?.trim();
  if (trimmedDeviceId) {
    headers.set("x-device-id", trimmedDeviceId);
  }

  return { ...init, headers };
}

async function requestJson<T>(path: string, init?: RequestInit, deviceId?: string | null): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...withDeviceHeaders(init, deviceId),
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(init?.headers ?? {}).entries()),
      ...(deviceId?.trim() ? { "x-device-id": deviceId.trim() } : {}),
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

export async function fetchStatus(deviceId?: string | null): Promise<LiveStatus | null> {
  try {
    const payload = await fetchStatusEnvelope(deviceId);
    return payload?.status ?? null;
  } catch {
    return null;
  }
}

export async function fetchStatusEnvelope(deviceId?: string | null): Promise<StatusEnvelope | null> {
  try {
    return await requestJson<StatusEnvelope>("/api/status", { method: "GET" }, deviceId);
  } catch {
    return null;
  }
}

export async function fetchFaultHistory(deviceId?: string | null) {
  try {
    const payload = await requestJson<{ faults: Array<{ timestamp: number; fault: string; resolved?: number }> }>(
      "/api/fault-history",
      { method: "GET" },
      deviceId,
    );
    return payload.faults ?? [];
  } catch {
    return [];
  }
}

export async function fetchSensorHistory(days = 7, deviceId?: string | null): Promise<SensorSnapshot[]> {
  try {
    const payload = await requestJson<{ snapshots: SensorSnapshot[] }>(`/api/sensor-history?days=${days}`, {
      method: "GET",
    }, deviceId);
    return payload.snapshots ?? [];
  } catch {
    return [];
  }
}

export async function fetchPumpLogs(days = 7, limit = 100, deviceId?: string | null): Promise<PumpLogEntry[]> {
  try {
    const payload = await requestJson<{ cycles: PumpLogEntry[] }>(
      `/api/pump-logs?days=${days}&limit=${limit}`,
      { method: "GET" },
      deviceId,
    );
    return payload.cycles ?? [];
  } catch {
    return [];
  }
}

export async function fetchAnalyticsSummary(days = 7, deviceId?: string | null): Promise<AnalyticsSummary | null> {
  try {
    return await requestJson<AnalyticsSummary>(`/api/analytics/summary?days=${days}`, { method: "GET" }, deviceId);
  } catch {
    return null;
  }
}

// Admin device management
export type DeviceListEntry = { id: string; name: string | null; deviceId: string; macAddress?: string | null; ipAddress?: string | null; createdAt: string; pins?: GpioMapping[]; online?: boolean; lastSeen?: string | number | null };
export type DeviceCreateSuccess = { deviceId: string; secret: string };
export type DeviceCreateDuplicate = { error: string; existingDevice: DeviceListEntry };
export type DeviceCreateResult = DeviceCreateSuccess | DeviceCreateDuplicate;

export async function fetchDevices(): Promise<DeviceListEntry[]> {
  try {
    return await requestJson<{ devices: DeviceListEntry[] }>("/api/devices", { method: "GET" }).then((r) => r.devices ?? []);
  } catch {
    return [];
  }
}

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

export async function fetchNftChannels(): Promise<NftChannel[]> {
  try {
    return await requestJson<NftChannel[]>("/api/nft-channels", { method: "GET" });
  } catch {
    return [];
  }
}

export async function saveNftChannels(channels: NftChannel[]): Promise<NftChannel[]> {
  return requestJson<NftChannel[]>("/api/nft-channels", {
    method: "PUT",
    body: JSON.stringify(channels),
  });
}

export async function plantCropRemote(channelId: string, cropName: string, notes: string): Promise<NftChannel> {
  return requestJson<NftChannel>(`/api/nft-channels/${encodeURIComponent(channelId)}/plant`, {
    method: "POST",
    body: JSON.stringify({ cropName, notes }),
  });
}

export async function harvestCropRemote(
  channelId: string,
  yieldQty: number,
  wasteQty: number,
  avgWeightGrams: number,
  notes: string,
): Promise<NftChannel> {
  return requestJson<NftChannel>(`/api/nft-channels/${encodeURIComponent(channelId)}/harvest`, {
    method: "POST",
    body: JSON.stringify({ yieldQty, wasteQty, avgWeightGrams, notes }),
  });
}

export async function fetchGpioMappings(): Promise<GpioMapping[]> {
  try {
    return await requestJson<GpioMapping[]>("/api/gpio-mappings", { method: "GET" });
  } catch {
    return [];
  }
}

export async function saveGpioMappings(mappings: GpioMapping[]): Promise<GpioMapping[]> {
  return requestJson<GpioMapping[]>("/api/gpio-mappings", {
    method: "PUT",
    body: JSON.stringify(mappings),
  });
}

export async function fetchHarvestHistory(): Promise<HarvestHistoryEntry[]> {
  try {
    return await requestJson<HarvestHistoryEntry[]>("/api/harvest-history", { method: "GET" });
  } catch {
    return [];
  }
}
