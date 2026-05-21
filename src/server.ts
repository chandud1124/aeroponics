import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  addPumpLog,
  addReading,
  deleteReading,
  getPumpLogs,
  getReadings,
  getSchedule,
  getStatus,
  getFaultHistory,
  getSensorHistory,
  getAnalyticsSummary,
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
} from "./lib/device-registry.server";
import { analyzeSensorDataWithGemini } from "./lib/gemini-service";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

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

async function handleLocalApi(request: Request): Promise<Response | null> {
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

  if (url.pathname === "/api/status") {
    if (request.method === "GET") {
      const status = getStatus();
      return jsonResponse(status ?? null);
    }

    if (request.method === "PATCH") {
      // Require device authentication for status updates
      const deviceIdHeader = request.headers.get("x-device-id");
      const deviceKeyHeader = request.headers.get("x-api-key");
      if (!deviceIdHeader || !deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
        return jsonResponse({ error: "Unauthorized (device)" }, 401);
      }
      const payload = (await request.json()) as {
        pumpOn?: boolean;
        flowing?: boolean;
        humidityPct?: number | null;
        reservoirTempC?: number;
        lightLux?: number | null;
        towerTempC?: number;
        lightOn?: boolean;
        waterLevel?: string;
        fault?: string | null;
        lastRunAt?: string;
      };

      // Validate water level
      if (payload.waterLevel && !["LOW", "MEDIUM", "FULL"].includes(payload.waterLevel)) {
        return jsonResponse({ error: "Invalid water level" }, 400);
      }

      // Validate temperature ranges (reasonable bounds for hydroponics: -10°C to 60°C)
      if (payload.reservoirTempC !== undefined && (payload.reservoirTempC < -10 || payload.reservoirTempC > 60)) {
        return jsonResponse({ error: "Reservoir temperature out of valid range (-10°C to 60°C)" }, 400);
      }

      if (payload.towerTempC !== undefined && (payload.towerTempC < -10 || payload.towerTempC > 60)) {
        return jsonResponse({ error: "Tower temperature out of valid range (-10°C to 60°C)" }, 400);
      }

      // Validate humidity (0-100%)
      if (payload.humidityPct !== undefined && payload.humidityPct !== null) {
        if (payload.humidityPct < 0 || payload.humidityPct > 100) {
          return jsonResponse({ error: "Humidity must be between 0 and 100%" }, 400);
        }
      }

      return jsonResponse(
        updateStatus({
          pumpOn: payload.pumpOn,
          flowing: payload.flowing,
          pumpState: payload.pumpOn ? PumpState.RUNNING : PumpState.IDLE,
          humidityPct: payload.humidityPct ?? undefined,
          lightLux: payload.lightLux ?? undefined,
          reservoirTempC: payload.reservoirTempC,
          towerTempC: payload.towerTempC,
          lightOn: payload.lightOn ?? undefined,
          waterLevel: payload.waterLevel as "LOW" | "MEDIUM" | "FULL" | undefined,
          fault: payload.fault ?? undefined,
          lastRunISO: payload.lastRunAt ?? undefined,
        }, { source: "esp32" }) ?? { success: true },
      );
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/schedule") {
    if (request.method === "GET" || request.method === "POST") {
      return jsonResponse(getSchedule());
    }

    if (request.method === "PUT") {
      const payload = (await request.json()) as {
        intervalMinutes: number;
        durationSeconds: number;
        startHour: number;
        endHour: number;
        enabled: boolean;
      };

      if (payload.startHour >= payload.endHour) {
        return jsonResponse({ error: "Start hour must be earlier than end hour" }, 400);
      }

      return jsonResponse(updateSchedule(payload));
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/pump-log") {
    if (request.method === "GET") {
      const cycles = getPumpLogs().map((log) => ({
        id: log.id,
        startedAt: log.startedAt,
        durationSeconds: log.durationSeconds,
        flowed: log.flowed,
        fault: log.fault,
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
      const deviceIdHeader = request.headers.get("x-device-id");
      const deviceKeyHeader = request.headers.get("x-api-key");
      if (!deviceIdHeader || !deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
        return jsonResponse({ error: "Unauthorized (device)" }, 401);
      }

      const payload = (await request.json()) as {
        durationSeconds?: number;
        flowed?: boolean;
        fault?: string;
        mode?: "DAY" | "NIGHT" | "MANUAL";
        onDurationSeconds?: number;
        offIntervalMinutes?: number;
      };

      if (typeof payload.durationSeconds !== "number" || typeof payload.flowed !== "boolean") {
        return jsonResponse({ error: "Missing or invalid fields" }, 400);
      }

      const created = addPumpLog({
        durationSeconds: payload.durationSeconds,
        flowed: payload.flowed,
        fault: payload.fault || null,
        mode: payload.mode,
        onDurationSeconds: payload.onDurationSeconds,
        offIntervalMinutes: payload.offIntervalMinutes,
      });

      return jsonResponse(created, 201);
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
      const history = getFaultHistory(20);
      return jsonResponse({ faults: history });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/sensor-history") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const days = Number(url.searchParams.get("days") ?? "7");
    return jsonResponse({ snapshots: getSensorHistory(Number.isFinite(days) ? days : 7) });
  }

  if (url.pathname === "/api/pump-logs") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const days = Number(url.searchParams.get("days") ?? "7");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const cutoff = Date.now() - (Number.isFinite(days) ? days : 7) * 24 * 60 * 60 * 1000;
    const cycles = getPumpLogs()
      .filter((log) => new Date(log.startedAt).getTime() >= cutoff)
      .slice(0, Number.isFinite(limit) ? limit : 100);
    return jsonResponse({ cycles });
  }

  if (url.pathname === "/api/analytics/summary") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const days = Number(url.searchParams.get("days") ?? "7");
    return jsonResponse(getAnalyticsSummary(Number.isFinite(days) ? days : 7));
  }

  if (url.pathname === "/api/manual-pump") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const payload = (await request.json()) as { action?: "start" | "stop" };
    if (!payload.action) {
      return jsonResponse({ error: "Missing action" }, 400);
    }

    if (payload.action === "start") {
      updateStatus({ pumpOn: true, flowing: false, pumpState: PumpState.MANUAL_MODE, fault: null });
      addPumpLog({ durationSeconds: 0, flowed: false, fault: null });
      return jsonResponse({ success: true, state: "MANUAL_MODE" }, 201);
    }

    updateStatus({ pumpOn: false, flowing: false, pumpState: PumpState.IDLE });
    addPumpLog({ durationSeconds: 0, flowed: false, fault: null });
    return jsonResponse({ success: true, state: "IDLE" }, 201);
  }

  if (url.pathname === "/api/manual-light") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const payload = (await request.json()) as { action?: "on" | "off" };
    if (!payload.action) {
      return jsonResponse({ error: "Missing action" }, 400);
    }

    if (payload.action === "on") {
      updateStatus({ lightOn: true });
      return jsonResponse({ success: true, lightOn: true }, 201);
    }

    updateStatus({ lightOn: false });
    return jsonResponse({ success: true, lightOn: false }, 201);
  }

  if (url.pathname === "/api/ai-insights") {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const days = Number(url.searchParams.get("days") ?? "7");
    const status = getStatus();
    const sensorHistory = getSensorHistory(Number.isFinite(days) ? days : 7);

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
