import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  addPumpLog,
  startPumpLog,
  updatePumpLog,
  addReading,
  deleteReading,
  getPumpLogs,
  getReadings,
  getSchedule,
  getStatus,
  getFaultHistory,
  getSensorHistory,
  getAnalyticsSummary,
  getCycleProfile,
  initializeTowerStore,
  touchStatus,
  updateSchedule,
  updateStatus,
  PumpState,
} from "./lib/tower-server-store";

import {
  createDevice,
  DuplicateDeviceError,
  listDevices,
  deleteDevice,
  validateDeviceSecret,
  rotateDeviceSecret,
  resolveDeviceId,
} from "./lib/device-registry.server";
import { analyzeSensorDataWithGemini } from "./lib/gemini-service";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

type ManualPumpSession = {
  startedAtMs: number;
  logId: string | null;
};

const manualPumpSessions = new Map<string, ManualPumpSession>();

function getManualPumpSession(deviceId: string): ManualPumpSession | null {
  return manualPumpSessions.get(deviceId) ?? null;
}

function beginManualPumpSession(deviceId: string): ManualPumpSession {
  const existing = manualPumpSessions.get(deviceId);
  if (existing) {
    return existing;
  }

  const session: ManualPumpSession = {
    startedAtMs: Date.now(),
    logId: null,
  };
  manualPumpSessions.set(deviceId, session);
  return session;
}

function clearManualPumpSession(deviceId: string) {
  manualPumpSessions.delete(deviceId);
}

function startManualPump(deviceId: string) {
  const session = beginManualPumpSession(deviceId);

  updateStatus(
    {
      pumpOn: true,
      flowing: false,
      pumpState: PumpState.MANUAL_MODE,
      motorManualMode: "FORCED_ON",
      fault: null,
    },
    { deviceId },
  );

  if (!session.logId) {
    try {
      const created = startPumpLog({ mode: "MANUAL", startedAtMs: session.startedAtMs, deviceId });
      session.logId = created.id;
    } catch {
      session.logId = null;
    }
  }

  return session;
}

function stopManualPump(deviceId: string) {
  const session = getManualPumpSession(deviceId);
  const startedAtMs = session?.startedAtMs ?? Date.now();
  const endedAtMs = Date.now();
  const durationSeconds = Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000));

  updateStatus(
    {
      pumpOn: false,
      flowing: false,
      pumpState: PumpState.MANUAL_MODE,
      motorManualMode: "FORCED_OFF",
    },
    { deviceId },
  );

  if (session) {
    if (session.logId) {
      updatePumpLog(session.logId, {
        durationSeconds: Math.max(1, durationSeconds),
        flowed: durationSeconds > 0,
        endedAtMs,
        deviceId,
      });
    } else {
      addPumpLog({
        durationSeconds: Math.max(1, durationSeconds),
        flowed: durationSeconds > 0,
        fault: null,
        mode: "MANUAL",
        onDurationSeconds: Math.max(1, durationSeconds),
        offIntervalMinutes: getCycleProfile().offIntervalMinutes,
        startedAtMs,
        endedAtMs,
        deviceId,
      });
    }
  }

  clearManualPumpSession(deviceId);
  return { startedAtMs, endedAtMs, durationSeconds };
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requireRegisteredDeviceForControl() {
  if (listDevices().length > 0) {
    return null;
  }

  return jsonResponse(
    {
      error: "No registered device",
      message: "Add the ESP32 from Admin Devices before using manual controls.",
    },
    409,
  );
}

function getTargetDeviceId(request: Request): string | null {
  const rawId = request.headers.get("x-device-id")?.trim() ?? null;
  return rawId ? resolveDeviceId(rawId) : null;
}

function requireRegisteredTargetDevice(request: Request): Response | null {
  const deviceId = getTargetDeviceId(request);
  if (!deviceId) {
    return jsonResponse(
      {
        error: "Missing device",
        message: "Select a registered device before using manual controls.",
      },
      400,
    );
  }

  const registered = listDevices().some((device) => device.deviceId === deviceId);
  if (!registered) {
    return jsonResponse(
      {
        error: "Unknown device",
        message: "The selected device is not registered.",
      },
      404,
    );
  }

  return null;
}

async function handleLocalApi(request: Request): Promise<Response | null> {
  await initializeTowerStore();
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/")) {
    return null;
  }

  // Admin simple passkey (can be set in environment)
  const ADMIN_PASSKEY = process.env.ADMIN_PASSKEY ?? "0990";
  const DEVICE_SECRET_PIN = process.env.DEVICE_SECRET_PIN ?? "";

  function requireAdminAuth(request: Request): Response | null {
    const pass = request.headers.get("x-admin-passkey");
    if (pass !== ADMIN_PASSKEY) {
      return jsonResponse({ error: "Unauthorized (admin)" }, 401);
    }
    return null;
  }

  function requireSecretPin(request: Request, url: URL): Response | null {
    if (!DEVICE_SECRET_PIN) return null;
    const providedPin = request.headers.get("x-device-secret-pin") ?? url.searchParams.get("secretPin") ?? "";
    if (providedPin !== DEVICE_SECRET_PIN) {
      return jsonResponse({ error: "Invalid device secret PIN" }, 403);
    }
    return null;
  }

  // Admin endpoints: device management
  if (url.pathname.startsWith("/api/admin/devices")) {
    const adminAuth = requireAdminAuth(request);
    if (adminAuth) return adminAuth;

    if (request.method === "POST" && url.pathname === "/api/admin/devices") {
      const payload = (await request.json()) as { name?: string; deviceId?: string; macAddress?: string; ipAddress?: string };
      try {
        const created = createDevice({
          name: payload?.name ?? null,
          deviceId: payload?.deviceId ?? null,
          macAddress: payload?.macAddress ?? null,
          ipAddress: payload?.ipAddress ?? null,
        });
        return jsonResponse(created, 201);
      } catch (error) {
        if (error instanceof DuplicateDeviceError) {
          return jsonResponse(
            {
              error: "Device already exists",
              existingDevice: {
                id: error.existingDevice.id,
                name: error.existingDevice.name,
                deviceId: error.existingDevice.deviceId,
                macAddress: error.existingDevice.macAddress ?? null,
                ipAddress: error.existingDevice.ipAddress ?? null,
                createdAt: error.existingDevice.createdAt,
              },
            },
            409,
          );
        }

        throw error;
      }
    }

    // Rotate device secret (regenerate) — POST /api/admin/devices/:deviceId/secret
    if (request.method === "POST" && url.pathname.match(/^\/api\/admin\/devices\/[^\/]+\/secret$/)) {
      const pinCheck = requireSecretPin(request, url);
      if (pinCheck) return pinCheck;

      const parts = url.pathname.split("/").filter(Boolean);
      const deviceId = parts[parts.length - 2];
      if (!deviceId) return jsonResponse({ error: "Missing device id" }, 400);
      const newSecret = rotateDeviceSecret(deviceId);
      if (!newSecret) return jsonResponse({ error: "Device not found" }, 404);
      console.info(`[ADMIN] Rotated device secret`, { deviceId, by: "admin" });
      return jsonResponse({ deviceId, secret: newSecret }, 200);
    }

    if (request.method === "GET" && url.pathname === "/api/admin/devices") {
      return jsonResponse({ devices: listDevices() });
    }

    if (request.method === "DELETE") {
      const parts = url.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (!last) return jsonResponse({ error: "Missing device id" }, 400);
      const removed = deleteDevice(last);
      return removed ? jsonResponse({ success: true }) : jsonResponse({ error: "Device not found" }, 404);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

    if (url.pathname === "/api/devices") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return jsonResponse({ devices: listDevices() });
    }

  if (url.pathname === "/api/status") {
    if (request.method === "GET") {
      const targetDevice = getTargetDeviceId(request);
      const status = getStatus(targetDevice);
      const hasRegisteredDevice = listDevices().length > 0;
      // Include the current schedule so devices can pull it with a single call
      const schedule = getSchedule();
      if (!status) return jsonResponse({ status: null, schedule, hasRegisteredDevice });
      // Nest status field and attach schedule under `schedule` key to match StatusEnvelope
      return jsonResponse({ status, schedule, hasRegisteredDevice });
    }

    if (request.method === "PATCH" || request.method === "PUT") {
      // Require device authentication for status updates
      const deviceIdHeader = request.headers.get("x-device-id");
      const deviceKeyHeader = request.headers.get("x-api-key");
      if (!deviceIdHeader || !deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
        return jsonResponse({ error: "Unauthorized (device)" }, 401);
      }
      const resolvedDeviceId = resolveDeviceId(deviceIdHeader);
      const previousStatus = getStatus(resolvedDeviceId);
      const payload = (await request.json()) as {
        pumpOn?: boolean;
        flowing?: boolean;
        pumpState?: string;
        state?: string;
        humidityPct?: number | null;
        lightLux?: number | null;
        lightOn?: boolean;
        batteryChargeOn?: boolean;
        fault?: string | null;
        resetReason?: string | null;
        lastBootFault?: string | null;
        uptimeSec?: number | null;
        lastRunAt?: string;
          sensorDataOk?: boolean;
          dhtOk?: boolean;
      };

      // Validate humidity (0-100%)
      if (payload.humidityPct !== undefined && payload.humidityPct !== null) {
        if (payload.humidityPct < 0 || payload.humidityPct > 100) {
          return jsonResponse({ error: "Humidity must be between 0 and 100%" }, 400);
        }
      }

      const updated = updateStatus({
        pumpOn: payload.pumpOn,
        flowing: payload.flowing,
        pumpState: (() => {
          const rawState = payload.pumpState ?? payload.state;
          if (typeof rawState === "string" && Object.values(PumpState).includes(rawState as PumpState)) {
            return rawState as PumpState;
          }
          return payload.pumpOn ? PumpState.RUNNING : PumpState.IDLE;
        })(),
        humidityPct: payload.humidityPct ?? undefined,
        lightLux: payload.lightLux ?? undefined,
        lightOn: payload.lightOn ?? undefined,
        batteryChargeOn: payload.batteryChargeOn ?? undefined,
        fault: payload.fault ?? undefined,
        resetReason: payload.resetReason ?? undefined,
        lastBootFault: payload.lastBootFault ?? undefined,
        uptimeSec: payload.uptimeSec ?? undefined,
        lastRunISO: (() => {
          if (!payload.lastRunAt) return undefined;
          let val = Number(payload.lastRunAt);
          if (Number.isFinite(val) && val > 0) {
            if (val < 1e12) val *= 1000;
            return new Date(val).toISOString();
          }
          const parsed = Date.parse(String(payload.lastRunAt));
          if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
          return undefined;
        })(),
        sensorDataOk: payload.sensorDataOk ?? undefined,
        dhtOk: payload.dhtOk ?? undefined,
        // accept optional device-sent fields
        scheduleAppliedAt: (payload as any).scheduleAppliedAt ?? undefined,
        appliedPlanName: (payload as any).planName ?? undefined,
      }, { source: "esp32", deviceId: resolvedDeviceId });

      if (!previousStatus || previousStatus.isOnline !== updated?.isOnline) {
        console.info("[api/status] device connectivity changed", {
          deviceId: resolvedDeviceId,
          online: updated?.isOnline ?? false,
        });
      }

      // If device reported a lastRunAt and indicates pump is ON, create a start pump-log entry
      let createdPumpLog: any = null;
      try {
        if (payload.lastRunAt && payload.pumpOn) {
          // Parse epoch seconds or ISO and compute ms
          let startedAtMs = Number(payload.lastRunAt);
          if (!Number.isFinite(startedAtMs) || startedAtMs === 0) {
            const parsed = Date.parse(String(payload.lastRunAt));
            startedAtMs = Number.isFinite(parsed) ? parsed : Date.now();
          } else {
            // if likely epoch seconds (<= 1e12), convert to ms
            if (startedAtMs < 1e12) startedAtMs = startedAtMs * 1000;
          }

          const onDur = (payload as any).onDurationSeconds ?? getCycleProfile(new Date(startedAtMs)).onDurationSeconds;
          createdPumpLog = startPumpLog({
            mode: undefined,
            onDurationSeconds: onDur,
            offIntervalMinutes: (payload as any).offIntervalMinutes ?? getCycleProfile(new Date(startedAtMs)).offIntervalMinutes,
            startedAtMs: startedAtMs,
            deviceId: resolvedDeviceId,
          });
        }
      } catch (e) {
        // ignore start log failures
        console.error("Failed to create start pump log:", e);
      }

      const respBody: any = updated ?? { success: true };
      if (createdPumpLog && createdPumpLog.id) respBody.pumpLogId = createdPumpLog.id;
      return jsonResponse(respBody);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/device/handshake") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const deviceIdHeader = request.headers.get("x-device-id")?.trim() ?? "";
    const deviceKeyHeader = request.headers.get("x-api-key")?.trim() ?? "";
    if (!deviceIdHeader) {
      return jsonResponse({ error: "Missing device id" }, 400);
    }

    const resolvedDeviceId = resolveDeviceId(deviceIdHeader);
    const deviceExists = listDevices().some((device) => device.deviceId === resolvedDeviceId);
    if (!deviceExists) {
      return jsonResponse({ error: "Device not registered" }, 404);
    }

    if (!deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
      return jsonResponse({ error: "Unauthorized (device)" }, 401);
    }

    touchStatus({ source: "esp32", deviceId: resolvedDeviceId });
    const status = getStatus(resolvedDeviceId);
    const schedule = getSchedule();
    const cycleProfile = getCycleProfile();

    return jsonResponse(
      {
        ok: true,
        authenticated: true,
        deviceId: resolvedDeviceId,
        serverTime: Date.now(),
        hasRegisteredDevice: true,
        ...schedule,
        intervalMinutes: cycleProfile.offIntervalMinutes + Math.round(cycleProfile.onDurationSeconds / 60),
        durationSeconds: cycleProfile.onDurationSeconds,
        ...(status ?? {}),
      },
      200,
    );
  }

  if (url.pathname === "/api/pump-log/start") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const deviceIdHeader = request.headers.get("x-device-id") ?? "";
    const deviceKeyHeader = request.headers.get("x-api-key") ?? "";
    if (!deviceIdHeader || !deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
      return jsonResponse({ error: "Unauthorized (device)" }, 401);
    }

    const resolvedDeviceId = resolveDeviceId(deviceIdHeader);
    const payload = (await request.json()) as {
      mode?: "DAY" | "NIGHT" | "MANUAL";
      onDurationSeconds?: number;
      offIntervalMinutes?: number;
      startedAtMs?: number;
    };

    const created = startPumpLog({
      mode: payload.mode ?? "MANUAL",
      onDurationSeconds: payload.onDurationSeconds ?? 0,
      offIntervalMinutes: payload.offIntervalMinutes ?? getCycleProfile().offIntervalMinutes,
      startedAtMs: payload.startedAtMs,
      deviceId: resolvedDeviceId,
    });

    return jsonResponse(created, 201);
  }

  // Test endpoint: simulate a device status update without any sensor fields
  if (url.pathname === "/api/test/no-sensor") {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    // Create a minimal status update (pump off) with no sensor fields
    const targetDeviceGate = requireRegisteredTargetDevice(request);
    if (targetDeviceGate) return targetDeviceGate;

    const targetDevice = getTargetDeviceId(request);
    const updated = updateStatus({ pumpOn: false, flowing: false }, { source: "server", deviceId: targetDevice });
    return jsonResponse({ success: true, status: updated }, 200);
  }

  if (url.pathname === "/api/heartbeat") {
    if (request.method !== "POST" && request.method !== "PUT") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const deviceIdHeader = request.headers.get("x-device-id") ?? "";
    const deviceKeyHeader = request.headers.get("x-api-key") ?? "";
    if (!deviceIdHeader || !deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
      return jsonResponse({ error: "Unauthorized (device)" }, 401);
    }

    const resolvedDeviceId = resolveDeviceId(deviceIdHeader);
    const status = touchStatus({ source: "esp32", deviceId: resolvedDeviceId });
    return jsonResponse(
      {
        success: true,
        telemetryUpdatedAt: status?.telemetryUpdatedAt ?? Date.now(),
        isOnline: status?.isOnline ?? true,
      },
      200,
    );
  }

  if (url.pathname === "/api/schedule") {
    if (request.method === "GET" || request.method === "POST") {
      // If a device is calling (provides device headers), require device auth.
      const deviceIdHeader = request.headers.get("x-device-id");
      const deviceKeyHeader = request.headers.get("x-api-key");
      if (deviceIdHeader || deviceKeyHeader) {
        if (!deviceIdHeader || !deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
          return jsonResponse({ error: "Unauthorized (device)" }, 401);
        }
      }
      return jsonResponse(getSchedule());
    }

    if (request.method === "PUT") {
      // Accept the full Schedule object from the UI (including day/night overrides)
      const payload = (await request.json()) as any;

      if (typeof payload.startHour === "number" && typeof payload.endHour === "number") {
        if (payload.startHour >= payload.endHour) {
          return jsonResponse({ error: "Start hour must be earlier than end hour" }, 400);
        }
      }

      return jsonResponse(updateSchedule(payload));
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/pump-log") {
    if (request.method === "GET") {
      const deviceId = request.headers.get("x-device-id") ?? null;
      const resolvedDeviceId = deviceId ? resolveDeviceId(deviceId) : null;
      const cycles = getPumpLogs(resolvedDeviceId).map((log) => ({
        id: log.id,
        startedAt: log.startedAt,
        durationSeconds: log.durationSeconds,
        flowed: log.flowed,
        fault: log.fault,
        volumeLiters: (log as any).volumeLiters ?? null,
      }));

      const successfulCycles = cycles.filter((cycle) => cycle.flowed && !cycle.fault).length;
      const totalDuration = cycles.reduce((sum, cycle) => sum + (cycle.durationSeconds || 0), 0);
      const totalFlow = cycles
        .filter((cycle) => cycle.flowed)
        .reduce((sum, cycle) => sum + (cycle.durationSeconds || 0), 0);
      const faultCounts: Record<string, number> = {};
      cycles.forEach((cycle) => {
        if (cycle.fault) faultCounts[cycle.fault] = (faultCounts[cycle.fault] || 0) + 1;
      });

      return jsonResponse({
        cycles,
        stats: {
          totalCycles: cycles.length,
          successfulCycles,
          failedCycles: cycles.filter((cycle) => !cycle.flowed || cycle.fault).length,
          successRate: cycles.length > 0 ? Math.round((successfulCycles / cycles.length) * 100) : 0,
          averageDurationSeconds: cycles.length > 0 ? Math.round(totalDuration / cycles.length) : 0,
          totalFlowTime: totalFlow,
          faultCounts,
        },
      });
    }

    if (request.method === "POST") {
      // If device is reporting pump log, require device authentication
      const deviceIdHeader = request.headers.get("x-device-id") ?? "";
      const deviceKeyHeader = request.headers.get("x-api-key") ?? "";
      if (!deviceIdHeader || !deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
        return jsonResponse({ error: "Unauthorized (device)" }, 401);
      }
      const resolvedDeviceId = resolveDeviceId(deviceIdHeader);

      const payload = (await request.json()) as {
        durationSeconds?: number;
        flowed?: boolean;
        fault?: string;
        mode?: "DAY" | "NIGHT" | "MANUAL";
        onDurationSeconds?: number;
        offIntervalMinutes?: number;
        volumeLiters?: number;
      };

      if (typeof payload.durationSeconds !== "number" || typeof payload.flowed !== "boolean") {
        return jsonResponse({ error: "Missing or invalid fields" }, 400);
      }

      const created = addPumpLog({
        durationSeconds: payload.durationSeconds,
        flowed: payload.flowed,
        fault: payload.fault || null,
        mode: payload.mode ?? "MANUAL",
        onDurationSeconds: payload.onDurationSeconds ?? payload.durationSeconds,
        offIntervalMinutes: payload.offIntervalMinutes ?? getCycleProfile().offIntervalMinutes,
        volumeLiters: payload.volumeLiters ?? null,
        deviceId: resolvedDeviceId,
      });

      return jsonResponse(created, 201);
    }

    // Update an existing pump-log entry by id
    if (request.method === "PATCH" && url.pathname.match(/^\/api\/pump-log\/[\w\-]+$/)) {
      const deviceIdHeader = request.headers.get("x-device-id") ?? "";
      const deviceKeyHeader = request.headers.get("x-api-key") ?? "";
      if (!deviceIdHeader || !deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
        return jsonResponse({ error: "Unauthorized (device)" }, 401);
      }
      const resolvedDeviceId = resolveDeviceId(deviceIdHeader);

      const parts = url.pathname.split("/").filter(Boolean);
      const id = parts[parts.length - 1];
      const payload = (await request.json()) as {
        durationSeconds?: number;
        flowed?: boolean;
        fault?: string | null;
        endedAtMs?: number;
        volumeLiters?: number | null;
      };

      const updated = updatePumpLog(id, {
        durationSeconds: payload.durationSeconds,
        flowed: payload.flowed,
        fault: payload.fault ?? null,
        endedAtMs: payload.endedAtMs,
        volumeLiters: payload.volumeLiters ?? null,
        // keep device scoping consistent — ensure pump log remains attributed to device
        deviceId: resolvedDeviceId,
      });

      if (!updated) return jsonResponse({ error: "Pump log not found" }, 404);
      return jsonResponse(updated, 200);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/readings") {
    if (request.method === "GET") {
      return jsonResponse(getReadings());
    }

    if (request.method === "POST") {
      const payload = (await request.json()) as {
        ph?: number | null;
        tds?: number | null;
        ec?: number | null;
        notes?: string;
      };

      const created = addReading({
        ph: payload.ph ?? null,
        tds: payload.tds ?? null,
        ec: payload.ec ?? null,
        notes: payload.notes ?? "",
      });

      return jsonResponse(created, 201);
    }

    if (request.method === "DELETE") {
      const payload = (await request.json()) as { id?: string };

      if (!payload.id) {
        return jsonResponse({ error: "Missing reading id" }, 400);
      }

      const removed = deleteReading(payload.id);
      return removed ? jsonResponse({ success: true }) : jsonResponse({ error: "Reading not found" }, 404);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/fault-history") {
    if (request.method === "GET") {
      const deviceId = request.headers.get("x-device-id") ?? null;
      const resolvedDeviceId = deviceId ? resolveDeviceId(deviceId) : null;
      const history = getFaultHistory(20, resolvedDeviceId);
      return jsonResponse({ faults: history });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/sensor-history") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const days = Number(url.searchParams.get("days") ?? "7");
    const deviceId = request.headers.get("x-device-id") ?? null;
    const resolvedDeviceId = deviceId ? resolveDeviceId(deviceId) : null;
    return jsonResponse({ snapshots: getSensorHistory(Number.isFinite(days) ? days : 7, resolvedDeviceId) });
  }

  if (url.pathname === "/api/pump-logs") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const days = Number(url.searchParams.get("days") ?? "7");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const deviceId = request.headers.get("x-device-id") ?? null;
    const resolvedDeviceId = deviceId ? resolveDeviceId(deviceId) : null;
    const cutoff = Date.now() - (Number.isFinite(days) ? days : 7) * 24 * 60 * 60 * 1000;
    const cycles = getPumpLogs(resolvedDeviceId)
      .filter((log) => new Date(log.startedAt).getTime() >= cutoff)
      .slice(0, Number.isFinite(limit) ? limit : 100);
    return jsonResponse({ cycles });
  }

  if (url.pathname === "/api/analytics/summary") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const days = Number(url.searchParams.get("days") ?? "7");
    const deviceId = request.headers.get("x-device-id") ?? null;
    const resolvedDeviceId = deviceId ? resolveDeviceId(deviceId) : null;
    return jsonResponse(getAnalyticsSummary(Number.isFinite(days) ? days : 7, resolvedDeviceId));
  }

  if (url.pathname === "/api/manual-pump") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const deviceGate = requireRegisteredDeviceForControl();
    if (deviceGate) return deviceGate;

    const payload = (await request.json()) as { action?: "start" | "stop" | "auto" | "manual"; desiredOn?: boolean };
    if (!payload.action) {
      return jsonResponse({ error: "Missing action" }, 400);
    }

    const targetDeviceGate = requireRegisteredTargetDevice(request);
    if (targetDeviceGate) return targetDeviceGate;

    const targetDevice = getTargetDeviceId(request);

    if (payload.action === "auto") {
      clearManualPumpSession(targetDevice!);
      updateStatus({
        pumpOn: false,
        flowing: false,
        pumpState: PumpState.IDLE,
        motorManualMode: "AUTO",
        lastRunISO: null,
      }, { deviceId: targetDevice });
      return jsonResponse({ success: true, state: "AUTO" }, 201);
    }

    if (payload.action === "manual") {
      const desiredOn = Boolean(payload.desiredOn);
      if (desiredOn) {
        startManualPump(targetDevice!);
      } else {
        stopManualPump(targetDevice!);
      }
      return jsonResponse({ success: true, state: "MANUAL_MODE", pumpOn: desiredOn }, 201);
    }

    if (payload.action === "start") {
      const session = startManualPump(targetDevice!);
      return jsonResponse({ success: true, state: "MANUAL_MODE", startedAt: session.startedAtMs, pumpLogId: session.logId }, 201);
    }

    const stopped = stopManualPump(targetDevice!);
    return jsonResponse({ success: true, state: "IDLE", durationSeconds: stopped.durationSeconds }, 201);
  }

  if (url.pathname === "/api/manual-light") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const deviceGate = requireRegisteredDeviceForControl();
    if (deviceGate) return deviceGate;

    const payload = (await request.json()) as { action?: "on" | "off" | "auto" | "manual"; desiredOn?: boolean };
    if (!payload.action) {
      return jsonResponse({ error: "Missing action" }, 400);
    }

    const targetDeviceGate = requireRegisteredTargetDevice(request);
    if (targetDeviceGate) return targetDeviceGate;

    const targetDevice = getTargetDeviceId(request);

    if (payload.action === "auto") {
      updateStatus({ lightManualMode: "AUTO" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, lightOn: getStatus(targetDevice)?.lightOn ?? false, mode: "AUTO" }, 201);
    }

    if (payload.action === "manual") {
      const desiredOn = Boolean(payload.desiredOn);
      updateStatus({ lightOn: desiredOn, lightManualMode: desiredOn ? "FORCED_ON" : "FORCED_OFF" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, lightOn: desiredOn, mode: "MANUAL" }, 201);
    }

    if (payload.action === "on") {
      updateStatus({ lightOn: true, lightManualMode: "FORCED_ON" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, lightOn: true }, 201);
    }
    updateStatus({ lightOn: false, lightManualMode: "FORCED_OFF" }, { deviceId: targetDevice });
    return jsonResponse({ success: true, lightOn: false }, 201);
  }

  if (url.pathname === "/api/manual-battery") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const deviceGate = requireRegisteredDeviceForControl();
    if (deviceGate) return deviceGate;

    const payload = (await request.json()) as { action?: "on" | "off" | "auto" | "manual"; desiredOn?: boolean };
    if (!payload.action) {
      return jsonResponse({ error: "Missing action" }, 400);
    }

    const targetDeviceGate = requireRegisteredTargetDevice(request);
    if (targetDeviceGate) return targetDeviceGate;

    const targetDevice = getTargetDeviceId(request);

    if (payload.action === "auto") {
      updateStatus({ batteryChargeOn: false, batteryManualMode: "AUTO" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, batteryChargeOn: getStatus(targetDevice)?.batteryChargeOn ?? false, mode: "AUTO" }, 201);
    }

    if (payload.action === "manual") {
      const desiredOn = Boolean(payload.desiredOn);
      updateStatus({ batteryChargeOn: desiredOn, batteryManualMode: desiredOn ? "FORCED_ON" : "FORCED_OFF" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, batteryChargeOn: desiredOn, mode: "MANUAL" }, 201);
    }

    if (payload.action === "on") {
      updateStatus({ batteryChargeOn: true, batteryManualMode: "FORCED_ON" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, batteryChargeOn: true }, 201);
    }

    updateStatus({ batteryChargeOn: false, batteryManualMode: "FORCED_OFF" }, { deviceId: targetDevice });
    return jsonResponse({ success: true, batteryChargeOn: false }, 201);
  }

  if (url.pathname === "/api/ai-insights") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const days = Number(url.searchParams.get("days") ?? "7");
    const targetDevice = getTargetDeviceId(request);
    const status = getStatus(targetDevice);
    const sensorHistory = getSensorHistory(Number.isFinite(days) ? days : 7, targetDevice);

    if (!status) {
      return jsonResponse(
        {
          available: false,
          error: "No status available",
          message: "AI insights need current sensor telemetry from the ESP32",
        },
        200,
      );
    }

    const analysis = await analyzeSensorDataWithGemini(
      status,
      sensorHistory,
      Number.isFinite(days) ? days : 7,
    );

    if (!analysis) {
      return jsonResponse(
        {
          available: false,
          error: "AI analysis unavailable",
          message: "Gemini API is not configured or temporarily unavailable",
        },
        200,
      );
    }

    return jsonResponse({ available: true, ...analysis });
  }

  return null;
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const apiResponse = await handleLocalApi(request);
      if (apiResponse) {
        return apiResponse;
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
