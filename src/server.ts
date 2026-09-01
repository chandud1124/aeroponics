import * as fs from "fs";
import * as path from "path";
import { createHmac, randomBytes } from "crypto";

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
  getNftChannels,
  saveNftChannels,
  plantCrop,
  harvestCrop,
  getGpioMappings,
  saveGpioMappings,
  getHarvestHistory,
  saveHarvestHistory,
  getGrowBags,
  saveGrowBags,
  getNurseryStore,
  saveNurseryStore,
  getCropLifecycleEvents,
  saveCropLifecycleEvents,
  getGeminiApiKey,
  saveGeminiApiKey,
  getCameraSettings,
  saveCameraSettings,
  getCameraSnapshots,
  addCameraSnapshot,
  getUsers,
  addUser,
  deleteUser,
  hashUserPassword,
  verifyUserPassword,
  getRecentPlanHistory,
} from "./lib/tower-server-store";

import { sendPtzCommand } from "./lib/onvif-ptz";

import {
  createDevice,
  DuplicateDeviceError,
  listDevices,
  deleteDevice,
  validateDeviceSecret,
  rotateDeviceSecret,
  resolveDeviceId,
  updateDevicePins,
  getDevicePins,
  updateDeviceName,
} from "./lib/device-registry.server";
import { analyzeSensorDataWithGemini, analyzeCropImageWithGemini } from "./lib/gemini-service";
import type { CameraSnapshot, CameraSettings, GpioMapping } from "./lib/tower-shared";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

type ManualPumpSession = {
  startedAtMs: number;
  logId: string | null;
};

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET ?? (IS_PRODUCTION ? "" : "farmnexus-local-development-session-secret");
const SESSION_COOKIE_ATTRIBUTES = `HttpOnly; SameSite=Lax; Path=/${IS_PRODUCTION ? "; Secure" : ""}`;
if (IS_PRODUCTION && (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET)) {
  throw new Error("Production requires ADMIN_USERNAME, ADMIN_PASSWORD, and SESSION_SECRET");
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function createSessionToken(username: string, role: "admin" | "operator"): string {
  const payload = base64Url(JSON.stringify({ username, role, exp: Date.now() + 8 * 60 * 60 * 1000 }));
  const signature = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function getSessionCookie(request: Request): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  const session = cookies.find((cookie) => cookie.trim().startsWith("farmnexus_session="));
  return session ? decodeURIComponent(session.trim().slice("farmnexus_session=".length)) : null;
}

function getCookieUser(request: Request): { username: string; role: "admin" | "operator" } | null {
  const token = getSessionCookie(request);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (signature !== expected) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { username?: string; role?: "admin" | "operator"; exp?: number };
    if (!claims.username || !claims.role || !claims.exp || claims.exp < Date.now()) return null;
    return { username: claims.username, role: claims.role };
  } catch {
    return null;
  }
}

const manualPumpSessions = new Map<string, ManualPumpSession>();
const pendingMotorCommands = new Map<string, { motor?: string; motor_2?: string }>();

function setPendingMotorCommand(deviceId: string, pumpIndex: 1 | 2, mode: "AUTO" | "FORCED_ON" | "FORCED_OFF") {
  const pending = pendingMotorCommands.get(deviceId) ?? {};
  if (pumpIndex === 1) pending.motor = mode;
  else pending.motor_2 = mode;
  pendingMotorCommands.set(deviceId, pending);
}

function reconcileMotorCommand(deviceId: string, reportedMode: string | undefined, pumpIndex: 1 | 2) {
  const pending = pendingMotorCommands.get(deviceId);
  if (!pending) return reportedMode;

  const key = pumpIndex === 1 ? "motor" : "motor_2";
  const requestedMode = pending[key];
  if (!requestedMode) return reportedMode;
  if (reportedMode === requestedMode) {
    delete pending[key];
    if (!pending.motor && !pending.motor_2) pendingMotorCommands.delete(deviceId);
    else pendingMotorCommands.set(deviceId, pending);
    return reportedMode;
  }
  return requestedMode;
}

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
  setPendingMotorCommand(deviceId, 1, "FORCED_ON");

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
  setPendingMotorCommand(deviceId, 1, "FORCED_OFF");

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

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
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

  // Admin credentials read from the env
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? (IS_PRODUCTION ? "" : "admin123");
  const DEVICE_SECRET_PIN = process.env.DEVICE_SECRET_PIN ?? "";

  function getUserFromRequest(request: Request) {
    const cookieUser = getCookieUser(request);
    if (cookieUser) {
      if (cookieUser.username.toLowerCase() === ADMIN_USERNAME.toLowerCase() && cookieUser.role === "admin") {
        return cookieUser;
      }
      const found = getUsers().find((u) => u.username.toLowerCase() === cookieUser.username.toLowerCase());
      if (found && found.role === cookieUser.role) return { username: found.username, role: found.role };
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.substring(7).trim();
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
    if (signature !== expected) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { username?: string; role?: "admin" | "operator"; exp?: number };
      if (!claims.username || !claims.role || !claims.exp || claims.exp < Date.now()) return null;
      if (claims.username.toLowerCase() === ADMIN_USERNAME.toLowerCase() && claims.role === "admin") return { username: ADMIN_USERNAME, role: "admin" };
      const found = getUsers().find((u) => u.username.toLowerCase() === claims.username?.toLowerCase() && u.role === claims.role);
      if (found) return { username: found.username, role: found.role };
    } catch {
      return null;
    }
    return null;
  }

  function requireUserAuth(request: Request): Response | null {
    const user = getUserFromRequest(request);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    return null;
  }

  function requireAdminAuth(request: Request): Response | null {
    const user = getUserFromRequest(request);
    if (!user || user.role !== "admin") {
      return jsonResponse({ error: "Unauthorized (admin role required)" }, 403);
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

  // 1. Auth & user endpoints
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const payload = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
      const username = payload?.username ?? "";
      const password = payload?.password ?? "";
      if (username.toLowerCase() === ADMIN_USERNAME.toLowerCase() && password === ADMIN_PASSWORD) {
        return jsonResponse({
          success: true,
          user: { username: ADMIN_USERNAME, role: "admin" }
        }, 200, { "Set-Cookie": `farmnexus_session=${encodeURIComponent(createSessionToken(ADMIN_USERNAME, "admin"))}; ${SESSION_COOKIE_ATTRIBUTES}` });
      }
      const found = getUsers().find((u) => u.username.toLowerCase() === username.toLowerCase());
      const passwordCheck = found ? verifyUserPassword(password, found.passwordHash) : { valid: false, needsMigration: false };
      if (found && passwordCheck.valid) {
        if (passwordCheck.needsMigration) {
          found.passwordHash = hashUserPassword(password);
          saveStateToDiskForAuth();
        }
        return jsonResponse({
          success: true,
          user: { username: found.username, role: found.role }
        }, 200, { "Set-Cookie": `farmnexus_session=${encodeURIComponent(createSessionToken(found.username, found.role))}; ${SESSION_COOKIE_ATTRIBUTES}` });
      }
      return jsonResponse({ error: "Invalid username or password" }, 401);
    } catch (e: any) {
      return jsonResponse({ error: e.message || "Login failed" }, 500);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const user = getUserFromRequest(request);
    if (!user) {
      return jsonResponse({ authenticated: false }, 401);
    }
    return jsonResponse({ authenticated: true, user });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    return jsonResponse({ success: true }, 200, { "Set-Cookie": `farmnexus_session=; Max-Age=0; ${SESSION_COOKIE_ATTRIBUTES}` });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/users") {
    const adminCheck = requireAdminAuth(request);
    if (adminCheck instanceof Response) return adminCheck;
    try {
      const payload = (await request.json()) as { username?: string; password?: string; role?: "admin" | "operator" };
      const username = payload?.username?.trim() ?? "";
      const password = payload?.password ?? "";
      const role = payload?.role ?? "operator";
      if (!username || !password) {
        return jsonResponse({ error: "Username and password are required" }, 400);
      }
      if (username.toLowerCase() === ADMIN_USERNAME.toLowerCase()) {
        return jsonResponse({ error: "Cannot create user with admin username" }, 400);
      }
      addUser({ username, passwordHash: hashUserPassword(password), role });
      return jsonResponse({ success: true });
    } catch (e: any) {
      return jsonResponse({ error: e.message || "Failed to add user" }, 400);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/admin/users") {
    const adminCheck = requireAdminAuth(request);
    if (adminCheck instanceof Response) return adminCheck;
    return jsonResponse({ users: getUsers().map(u => ({ username: u.username, role: u.role })) });
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/users/")) {
    const adminCheck = requireAdminAuth(request);
    if (adminCheck instanceof Response) return adminCheck;
    const username = decodeURIComponent(url.pathname.substring("/api/admin/users/".length));
    deleteUser(username);
    return jsonResponse({ success: true });
  }

  // 2. Telemetry and public endpoint checks
  const isTelemetry = url.pathname === "/api/telemetry";
  const isSchedulePublic = url.pathname === "/api/schedule" && request.method === "GET";
  const isWaterEvent = url.pathname === "/api/water-event";
  const isDeviceAuthRoute =
    (url.pathname === "/api/status" && (request.method === "PUT" || request.method === "PATCH")) ||
    (url.pathname === "/api/device/handshake" && request.method === "GET") ||
    (url.pathname === "/api/heartbeat" && (request.method === "POST" || request.method === "PUT")) ||
    (url.pathname === "/api/pump-log" && request.method === "POST") ||
    (url.pathname === "/api/pump-log/start" && request.method === "POST");

  if (!isTelemetry && !isSchedulePublic && !isWaterEvent && !isDeviceAuthRoute) {
    const authCheck = requireUserAuth(request);
    if (authCheck instanceof Response) return authCheck;
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

    // Save/update device pins — PUT /api/admin/devices/:deviceId/pins
    if (request.method === "PUT" && url.pathname.match(/^\/api\/admin\/devices\/[^\/]+\/pins$/)) {
      const parts = url.pathname.split("/").filter(Boolean);
      const deviceId = parts[parts.length - 2];
      if (!deviceId) return jsonResponse({ error: "Missing device id" }, 400);
      
      const payload = (await request.json()) as { pins: GpioMapping[] };
      const success = updateDevicePins(deviceId, payload?.pins ?? []);
      if (!success) return jsonResponse({ error: "Device not found" }, 404);
      return jsonResponse({ success: true }, 200);
    }

    // Rename device name — PUT /api/admin/devices/:deviceId/name
    if (request.method === "PUT" && url.pathname.match(/^\/api\/admin\/devices\/[^\/]+\/name$/)) {
      const parts = url.pathname.split("/").filter(Boolean);
      const deviceId = parts[parts.length - 2];
      if (!deviceId) return jsonResponse({ error: "Missing device id" }, 400);

      const payload = (await request.json()) as { name: string };
      if (!payload?.name?.trim()) return jsonResponse({ error: "Name is required" }, 400);

      const success = updateDeviceName(deviceId, payload.name.trim());
      if (!success) return jsonResponse({ error: "Device not found" }, 404);
      return jsonResponse({ success: true }, 200);
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
      const enrichedDevices = listDevices().map((d) => {
        const s = getStatus(d.deviceId);
        return {
          ...d,
          online: s ? s.isOnline : false,
          lastSeen: s ? (s.telemetryUpdatedAt ?? s.heartbeatUpdatedAt ?? null) : null,
        };
      });
      return jsonResponse({ devices: enrichedDevices });
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

      const enrichedDevices = listDevices().map((d) => {
        const s = getStatus(d.deviceId);
        return {
          ...d,
          online: s ? s.isOnline : false,
          lastSeen: s ? (s.telemetryUpdatedAt ?? s.heartbeatUpdatedAt ?? null) : null,
        };
      });
      return jsonResponse({ devices: enrichedDevices });
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
        pumpOn_2?: boolean;
        flowing_2?: boolean;
        pumpState_2?: string;
        state_2?: string;
        motorManualMode?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
        motorManualMode_2?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
        humidityPct?: number | null;
        ph?: number | null;
        ec?: number | null;
        waterLevel?: "LOW" | "MEDIUM" | "FULL" | null;
        waterDistanceCm?: number | null;
        waterLevelPercent?: number | null;
        waterVolumeLiters?: number | null;
        phDosingOn?: boolean;
        nutritionADosingOn?: boolean;
        nutritionBDosingOn?: boolean;
        phManualMode?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
        nutritionManualMode?: "AUTO" | "FORCED_ON" | "FORCED_OFF";
        fault?: string | null;
        fault_2?: string | null;
        resetReason?: string | null;
        lastBootFault?: string | null;
        uptimeSec?: number | null;
        lastRunAt?: string;
        lastRunAt_2?: string;
        sensorDataOk?: boolean;
        dhtOk?: boolean;
        levelSensorOk?: boolean;
        reservoirTempC?: number | null;
        nftTempC?: number | null;
      };

      if (payload.motorManualMode !== undefined) {
        payload.motorManualMode = reconcileMotorCommand(resolvedDeviceId, payload.motorManualMode, 1) as typeof payload.motorManualMode;
      }
      if (payload.motorManualMode_2 !== undefined) {
        payload.motorManualMode_2 = reconcileMotorCommand(resolvedDeviceId, payload.motorManualMode_2, 2) as typeof payload.motorManualMode_2;
      }

      // Force unmapped sensor values to null if device registry has custom pins configured
      const devicePins = getDevicePins(resolvedDeviceId);
      const hasCustomPins = devicePins && devicePins.length > 0;
      if (hasCustomPins) {
        const hasPh = devicePins.some((p) => p.type === "pH Sensor");
        const hasEc = devicePins.some((p) => p.type === "EC Sensor");
        const hasTemp = devicePins.some((p) => p.type === "Water Temperature Sensor" || p.type === "Humidity Sensor");
        const hasLevel = devicePins.some((p) => p.type === "Water Level - Ultrasonic" || p.type === "Water Level Sensor" || p.type === "Water Level - Analog Sensor");

        if (!hasPh) {
          payload.ph = null;
        }
        if (!hasEc) {
          payload.ec = null;
        }
        if (!hasTemp) {
          payload.humidityPct = null;
          payload.reservoirTempC = null;
          payload.nftTempC = null;
        }
        if (!hasLevel) {
          payload.waterLevel = null;
          payload.waterLevelPercent = null;
          payload.waterVolumeLiters = null;
          payload.waterDistanceCm = null;
        }
      }

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
        pumpOn_2: payload.pumpOn_2,
        flowing_2: payload.flowing_2,
        pumpState_2: (() => {
          const rawState = payload.pumpState_2 ?? payload.state_2;
          if (typeof rawState === "string" && Object.values(PumpState).includes(rawState as PumpState)) {
            return rawState as PumpState;
          }
          return payload.pumpOn_2 ? PumpState.RUNNING : PumpState.IDLE;
        })(),
        motorManualMode: payload.motorManualMode,
        motorManualMode_2: payload.motorManualMode_2,
        humidityPct: payload.humidityPct === null ? null : (payload.humidityPct ?? undefined),
        ph: payload.ph === null ? null : (payload.ph ?? undefined),
        ec: payload.ec === null ? null : (payload.ec ?? undefined),
        waterLevel: payload.waterLevel === null ? null : (payload.waterLevel ?? undefined),
        waterDistanceCm: payload.waterDistanceCm === null ? null : (payload.waterDistanceCm ?? undefined),
        waterLevelPercent: payload.waterLevelPercent === null ? null : (payload.waterLevelPercent ?? undefined),
        waterVolumeLiters: payload.waterVolumeLiters === null ? null : (payload.waterVolumeLiters ?? undefined),
        reservoirTempC: payload.reservoirTempC === null ? null : (payload.reservoirTempC ?? undefined),
        nftTempC: payload.nftTempC === null ? null : (payload.nftTempC ?? undefined),
        phDosingOn: payload.phDosingOn ?? undefined,
        nutritionADosingOn: payload.nutritionADosingOn ?? undefined,
        nutritionBDosingOn: payload.nutritionBDosingOn ?? undefined,
        phManualMode: payload.phManualMode ?? undefined,
        nutritionManualMode: payload.nutritionManualMode ?? undefined,
        fault: payload.fault ?? undefined,
        fault_2: payload.fault_2 ?? undefined,
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
        lastRunISO_2: (() => {
          if (!payload.lastRunAt_2) return undefined;
          let val = Number(payload.lastRunAt_2);
          if (Number.isFinite(val) && val > 0) {
            if (val < 1e12) val *= 1000;
            return new Date(val).toISOString();
          }
          const parsed = Date.parse(String(payload.lastRunAt_2));
          if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
          return undefined;
        })(),
        sensorDataOk: payload.sensorDataOk ?? undefined,
        dhtOk: payload.dhtOk ?? undefined,
        levelSensorOk: payload.levelSensorOk ?? undefined,
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
        if (payload.lastRunAt && payload.pumpOn && !previousStatus?.pumpOn) {
          // Parse epoch seconds or ISO and compute ms
          let startedAtMs = Number(payload.lastRunAt);
          if (!Number.isFinite(startedAtMs) || startedAtMs === 0) {
            const parsed = Date.parse(String(payload.lastRunAt));
            startedAtMs = Number.isFinite(parsed) ? parsed : Date.now();
          } else {
            // if likely epoch seconds (<= 1e12), convert to ms
            if (startedAtMs < 1e12) startedAtMs = startedAtMs * 1000;
          }

          const onDur = (payload as any).onDurationSeconds ?? getCycleProfile(new Date(startedAtMs), resolvedDeviceId).onDurationSeconds;
          createdPumpLog = startPumpLog({
            mode: undefined,
            onDurationSeconds: onDur,
            offIntervalMinutes: (payload as any).offIntervalMinutes ?? getCycleProfile(new Date(startedAtMs), resolvedDeviceId).offIntervalMinutes,
            startedAtMs: startedAtMs,
            deviceId: resolvedDeviceId,
            pumpIndex: 1,
          });
        }
      } catch (e) {
        // ignore start log failures
        console.error("Failed to create start pump log:", e);
      }

      // If device reported a lastRunAt_2 and indicates pump_2 is ON, create a start pump-log entry for Pump 2
      try {
        if (payload.lastRunAt_2 && payload.pumpOn_2 && !previousStatus?.pumpOn_2) {
          let startedAtMs = Number(payload.lastRunAt_2);
          if (!Number.isFinite(startedAtMs) || startedAtMs === 0) {
            const parsed = Date.parse(String(payload.lastRunAt_2));
            startedAtMs = Number.isFinite(parsed) ? parsed : Date.now();
          } else {
            if (startedAtMs < 1e12) startedAtMs = startedAtMs * 1000;
          }

          const deviceSchedule = getSchedule(resolvedDeviceId);
          const onDur = deviceSchedule.dayDurationSeconds_2 ?? deviceSchedule.durationSeconds_2 ?? 180;
          const offInterval = deviceSchedule.dayIntervalMinutes_2 ?? deviceSchedule.intervalMinutes_2 ?? 10;
          
          startPumpLog({
            mode: undefined,
            onDurationSeconds: onDur,
            offIntervalMinutes: offInterval,
            startedAtMs: startedAtMs,
            deviceId: resolvedDeviceId,
            pumpIndex: 2,
          });
        }
      } catch (e) {
        console.error("Failed to create start pump log for Pump 2:", e);
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
    const deviceSchedule = getSchedule(resolvedDeviceId);
    const recentPlans = getRecentPlanHistory(resolvedDeviceId);
    const activePlan = recentPlans[0] ?? null;
    const cycleProfile = getCycleProfile(undefined, resolvedDeviceId);
    const devicePins = getDevicePins(resolvedDeviceId);
    const mappings = (devicePins && devicePins.length > 0) ? devicePins : getGpioMappings();
    const findPin = (type: string, defaultPin: number) => {
      const found = mappings.find((m) => m.type === type);
      if (found) return found.pin;
      if (devicePins && devicePins.length > 0) return -1;
      return defaultPin;
    };
    const ultrasonic = mappings.find((m) => m.type === "Water Level - Ultrasonic");
    const waterCalibration = ultrasonic ?? mappings.find((m) =>
      m.type === "Water Level - Analog Sensor" || m.type === "Water Level Sensor"
    );
    const humidityMapping = mappings.find((m) => m.type === "Humidity Sensor") ??
      mappings.find((m) => m.type === "Water Temperature Sensor");

    // Dynamic Cycle Profile calculation for Pump 2
    const getCycleProfile2 = () => {
      const mode = cycleProfile.mode;
      const isDay = mode === "DAY";
      const nightEnabled = deviceSchedule.nightEnabled !== false;
      const configuredDayIntervalMinutes_2 = deviceSchedule.dayIntervalMinutes_2 ?? deviceSchedule.intervalMinutes_2 ?? 10;
      
      const onDurationSeconds_2 = isDay
        ? deviceSchedule.dayDurationSeconds_2 ?? deviceSchedule.durationSeconds_2 ?? 180
        : nightEnabled
          ? deviceSchedule.nightDurationSeconds_2 ?? Math.max(15, Math.round((deviceSchedule.durationSeconds_2 ?? 180) * 0.75))
          : deviceSchedule.dayDurationSeconds_2 ?? deviceSchedule.durationSeconds_2 ?? 180;

      const offIntervalMinutes_2 = isDay
        ? configuredDayIntervalMinutes_2
        : nightEnabled
          ? deviceSchedule.nightIntervalMinutes_2 ?? Math.max(deviceSchedule.intervalMinutes_2 ?? 10, 15)
          : configuredDayIntervalMinutes_2;

      return {
        onDurationSeconds: onDurationSeconds_2,
        offIntervalMinutes: offIntervalMinutes_2,
      };
    };

    const cycleProfile2 = getCycleProfile2();
 
    return jsonResponse(
      {
        ok: true,
        authenticated: true,
        deviceId: resolvedDeviceId,
        serverTime: Date.now(),
        hasRegisteredDevice: true,
        ...deviceSchedule,
        recentPlanHistory: recentPlans,
        activePlanName: activePlan?.planName ?? deviceSchedule.planName ?? status?.activePlanName ?? null,
        activePlanSignature: activePlan?.signature ?? status?.activePlanSignature ?? null,
        activePlanSavedAt: activePlan?.savedAt ?? status?.activePlanSavedAt ?? null,
        intervalMinutes: cycleProfile.offIntervalMinutes + Math.round(cycleProfile.onDurationSeconds / 60),
        durationSeconds: cycleProfile.onDurationSeconds,
        intervalMinutes_2: cycleProfile2.offIntervalMinutes + Math.round(cycleProfile2.onDurationSeconds / 60),
        durationSeconds_2: cycleProfile2.onDurationSeconds,
        ...(status ?? {}),
        pin_pump_relay: findPin("Relay - Water Pump", 27),
        pin_pump_relay_2: findPin("Relay - Water Pump 2", 32),
        pin_nutrition_a: findPin("Relay - Nutrition A", 33),
        pin_nutrition_b: findPin("Relay - Nutrition B", 26),
        pin_nutrition_c: findPin("Relay - Nutrition C", 0),
        pin_ph_down: findPin("Relay - pH Down", 25),
        pin_ph_sensor: findPin("pH Sensor", 2),
        pin_ec_sensor: findPin("EC Sensor", 4),
        pin_level_sensor: findPin("Water Level Sensor", 18),
        pin_level_sensor_rx: ultrasonic?.pin ?? findPin("Water Level Sensor", 18),
        pin_level_sensor_tx: ultrasonic?.txPin ?? (devicePins && devicePins.length > 0 ? -1 : 5),
        pin_motor_button: findPin("Motor Override Button", 19),
        pin_motor_button_2: findPin("Motor Override Button 2", 26),
        emptyDistanceCm: waterCalibration?.emptyDistanceCm ?? 50,
        fullDistanceCm: waterCalibration?.fullDistanceCm ?? 10,
        tankWidthCm: waterCalibration?.tankWidthCm ?? 50,
        tankLengthCm: waterCalibration?.tankLengthCm ?? 50,
        tankHeightCm: waterCalibration?.tankHeightCm ?? 80,
        tankCapacityLiters: waterCalibration?.tankCapacityLiters ?? 200,
        ultrasonicTriggerEcho: waterCalibration?.type === "Water Level - Ultrasonic",
        pin_dht_data: findPin("Humidity Sensor", 16),
        pin_water_temp: findPin("Water Temperature Sensor", 15),
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
      pumpIndex?: number;
    };

    const created = startPumpLog({
      mode: payload.mode ?? "MANUAL",
      onDurationSeconds: payload.onDurationSeconds ?? 0,
      offIntervalMinutes: payload.offIntervalMinutes ?? getCycleProfile(undefined, resolvedDeviceId).offIntervalMinutes,
      startedAtMs: payload.startedAtMs,
      deviceId: resolvedDeviceId,
      pumpIndex: payload.pumpIndex,
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

  if (url.pathname === "/api/nft-channels") {
    if (request.method === "GET") {
      return jsonResponse(getNftChannels());
    }
    if (request.method === "PUT") {
      const payload = (await request.json()) as any[];
      return jsonResponse(saveNftChannels(payload));
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname.startsWith("/api/nft-channels/") && url.pathname.endsWith("/plant")) {
    if (request.method === "POST") {
      const parts = url.pathname.split("/");
      const id = parts[3];
      const payload = (await request.json()) as { cropName: string; notes: string };
      const updated = plantCrop(id, payload.cropName || "", payload.notes || "");
      if (!updated) {
        return jsonResponse({ error: "Channel not found" }, 404);
      }
      return jsonResponse(updated);
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname.startsWith("/api/nft-channels/") && url.pathname.endsWith("/harvest")) {
    if (request.method === "POST") {
      const parts = url.pathname.split("/");
      const id = parts[3];
      const payload = (await request.json()) as { notes: string; yieldQty?: number; wasteQty?: number; avgWeightGrams?: number; harvestCultivar?: string; sourceNurseryTrayId?: string | null };
      const measurements = [payload.yieldQty ?? 0, payload.wasteQty ?? 0, payload.avgWeightGrams ?? 0];
      if (measurements.some((value) => !Number.isFinite(value) || value < 0)) {
        return jsonResponse({ error: "Harvest yield, waste, and average weight must be non-negative numbers" }, 400);
      }
      try {
        const updated = harvestCrop(
          id,
          payload.yieldQty ?? 0,
          payload.wasteQty ?? 0,
          payload.avgWeightGrams ?? 0,
          payload.notes || "",
          payload.harvestCultivar,
          payload.sourceNurseryTrayId
        );
        if (!updated) {
          return jsonResponse({ error: "Channel not found" }, 404);
        }
        return jsonResponse(updated);
      } catch (err: any) {
        return jsonResponse({ error: err.message || "Failed to harvest" }, 400);
      }
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/harvest-history") {
    if (request.method === "GET") {
      return jsonResponse(getHarvestHistory());
    }
    if (request.method === "PUT") {
      try {
        const payload = (await request.json()) as any[];
        saveHarvestHistory(payload);
        return jsonResponse({ success: true });
      } catch (err: any) {
        return jsonResponse({ error: err.message || "Failed to save harvest history" }, 400);
      }
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/grow-bags") {
    if (request.method === "GET") return jsonResponse(getGrowBags());
    if (request.method === "PUT") {
      const payload = (await request.json()) as unknown;
      if (!Array.isArray(payload)) return jsonResponse({ error: "Grow bags must be an array" }, 400);
      return jsonResponse(saveGrowBags(payload));
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/nursery") {
    if (request.method === "GET") return jsonResponse(getNurseryStore());
    if (request.method === "PUT") {
      const payload = (await request.json()) as { trays?: unknown; history?: unknown; configs?: unknown };
      if (!Array.isArray(payload.trays) || !Array.isArray(payload.history) || !Array.isArray(payload.configs)) {
        return jsonResponse({ error: "Nursery payload must contain trays, history, and configs arrays" }, 400);
      }
      return jsonResponse(saveNurseryStore(payload as never));
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/crop-lifecycle-events") {
    if (request.method === "GET") return jsonResponse(getCropLifecycleEvents());
    if (request.method === "PUT") {
      const payload = (await request.json()) as unknown;
      if (!Array.isArray(payload)) return jsonResponse({ error: "Lifecycle events must be an array" }, 400);
      return jsonResponse(saveCropLifecycleEvents(payload));
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/gpio-mappings") {
    if (request.method === "GET") {
      return jsonResponse(getGpioMappings());
    }
    if (request.method === "PUT") {
      const payload = (await request.json()) as any[];
      return jsonResponse(saveGpioMappings(payload));
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/schedule") {
    const qDeviceId = url.searchParams.get("deviceId") ?? request.headers.get("x-device-id") ?? null;
    
    if (request.method === "GET" || request.method === "POST") {
      // If a device is calling (provides device headers), require device auth.
      const deviceIdHeader = request.headers.get("x-device-id");
      const deviceKeyHeader = request.headers.get("x-api-key");
      if (deviceIdHeader || deviceKeyHeader) {
        if (!deviceIdHeader || !deviceKeyHeader || !validateDeviceSecret(deviceIdHeader, deviceKeyHeader)) {
          return jsonResponse({ error: "Unauthorized (device)" }, 401);
        }
      }
      return jsonResponse(getSchedule(qDeviceId));
    }

    if (request.method === "PUT") {
      // Accept the full Schedule object from the UI (including day/night overrides) without restriction
      const payload = (await request.json()) as any;
      return jsonResponse(updateSchedule(payload, qDeviceId));
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/force-sync-plan") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Require user authentication from web UI
    const targetDeviceGate = requireRegisteredTargetDevice(request);
    if (targetDeviceGate) return targetDeviceGate;

    const targetDevice = getTargetDeviceId(request);
    const recentPlans = getRecentPlanHistory(targetDevice);
    const activePlan = recentPlans[0];

    if (!activePlan) {
      return jsonResponse(
        {
          error: "No active plan",
          message: "Cannot force sync: no active plan found for this device.",
        },
        404,
      );
    }

    // Mark the plan as needing immediate sync by recording the current time
    // On next handshake, device will receive this plan in recentPlanHistory
    // and update its local storage since the signature is known
    const syncMarked = {
      ...activePlan,
      syncRequestedAt: Date.now(),
    };

    return jsonResponse(
      {
        success: true,
        planName: activePlan.planName,
        signature: activePlan.signature,
        message: "Plan sync queued. ESP32 will apply changes on next check-in (usually within 30 seconds).",
        syncRequestedAt: syncMarked.syncRequestedAt,
      },
      200,
    );
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
        pumpIndex?: number;
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
        pumpIndex: payload.pumpIndex === 2 ? 2 : 1,
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
      setPendingMotorCommand(targetDevice!, 1, "AUTO");
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

  if (url.pathname === "/api/manual-pump-2") {
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
      setPendingMotorCommand(targetDevice!, 2, "AUTO");
      updateStatus({
        pumpOn_2: false,
        flowing_2: false,
        pumpState_2: PumpState.IDLE,
        motorManualMode_2: "AUTO",
        lastRunISO_2: null,
      }, { deviceId: targetDevice });
      return jsonResponse({ success: true, state: "AUTO" }, 201);
    }

    if (payload.action === "manual") {
      const desiredOn = Boolean(payload.desiredOn);
      setPendingMotorCommand(targetDevice!, 2, desiredOn ? "FORCED_ON" : "FORCED_OFF");
      updateStatus({
        pumpOn_2: desiredOn,
        flowing_2: desiredOn,
        pumpState_2: desiredOn ? PumpState.RUNNING : PumpState.IDLE,
        motorManualMode_2: desiredOn ? "FORCED_ON" : "FORCED_OFF",
        lastRunISO_2: desiredOn ? new Date().toISOString() : null,
      }, { deviceId: targetDevice });
      return jsonResponse({ success: true, state: "MANUAL_MODE", pumpOn_2: desiredOn }, 201);
    }

    if (payload.action === "start") {
      setPendingMotorCommand(targetDevice!, 2, "FORCED_ON");
      updateStatus({
        pumpOn_2: true,
        flowing_2: true,
        pumpState_2: PumpState.RUNNING,
        motorManualMode_2: "FORCED_ON",
        lastRunISO_2: new Date().toISOString(),
      }, { deviceId: targetDevice });
      return jsonResponse({ success: true, state: "MANUAL_MODE", pumpOn_2: true }, 201);
    }

    updateStatus({
      pumpOn_2: false,
      flowing_2: false,
      pumpState_2: PumpState.IDLE,
      motorManualMode_2: "FORCED_OFF",
    }, { deviceId: targetDevice });
    setPendingMotorCommand(targetDevice!, 2, "FORCED_OFF");
    return jsonResponse({ success: true, state: "IDLE", pumpOn_2: false }, 201);
  }

  if (url.pathname === "/api/manual-ph-down") {
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
      updateStatus({ phManualMode: "AUTO" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, phDosingOn: getStatus(targetDevice)?.phDosingOn ?? false, mode: "AUTO" }, 201);
    }

    if (payload.action === "manual") {
      const desiredOn = Boolean(payload.desiredOn);
      updateStatus({ phDosingOn: desiredOn, phManualMode: desiredOn ? "FORCED_ON" : "FORCED_OFF" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, phDosingOn: desiredOn, mode: "MANUAL" }, 201);
    }

    if (payload.action === "on") {
      updateStatus({ phDosingOn: true, phManualMode: "FORCED_ON" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, phDosingOn: true }, 201);
    }
    updateStatus({ phDosingOn: false, phManualMode: "FORCED_OFF" }, { deviceId: targetDevice });
    return jsonResponse({ success: true, phDosingOn: false }, 201);
  }

  if (url.pathname === "/api/manual-nutrition") {
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
      updateStatus({ nutritionADosingOn: false, nutritionBDosingOn: false, nutritionManualMode: "AUTO" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, nutritionDosingOn: getStatus(targetDevice)?.nutritionADosingOn ?? false, mode: "AUTO" }, 201);
    }

    if (payload.action === "manual") {
      const desiredOn = Boolean(payload.desiredOn);
      updateStatus({ nutritionADosingOn: desiredOn, nutritionBDosingOn: desiredOn, nutritionManualMode: desiredOn ? "FORCED_ON" : "FORCED_OFF" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, nutritionDosingOn: desiredOn, mode: "MANUAL" }, 201);
    }

    if (payload.action === "on") {
      updateStatus({ nutritionADosingOn: true, nutritionBDosingOn: true, nutritionManualMode: "FORCED_ON" }, { deviceId: targetDevice });
      return jsonResponse({ success: true, nutritionDosingOn: true }, 201);
    }

    updateStatus({ nutritionADosingOn: false, nutritionBDosingOn: false, nutritionManualMode: "FORCED_OFF" }, { deviceId: targetDevice });
    return jsonResponse({ success: true, nutritionDosingOn: false }, 201);
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

  if (url.pathname === "/api/settings") {
    if (request.method === "GET") {
      return jsonResponse({ geminiApiKey: getGeminiApiKey() });
    }

    if (request.method === "POST" || request.method === "PATCH") {
      const payload = (await request.json()) as { geminiApiKey?: string };
      saveGeminiApiKey(payload.geminiApiKey || "");
      return jsonResponse({ success: true, geminiApiKey: getGeminiApiKey() });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/camera/settings") {
    if (request.method === "GET") {
      return jsonResponse({ settings: getCameraSettings() });
    }

    if (request.method === "POST" || request.method === "PATCH") {
      const payload = (await request.json()) as Partial<CameraSettings>;
      saveCameraSettings(payload);
      return jsonResponse({ success: true, settings: getCameraSettings() });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/camera/snapshots") {
    if (request.method === "GET") {
      return jsonResponse({ snapshots: getCameraSnapshots() });
    }
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (url.pathname === "/api/camera/inspect") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const payload = (await request.json().catch(() => ({}))) as { image?: string; timeOfDay?: "morning" | "evening" };
    if (!payload.image) {
      return jsonResponse({ error: "Missing parameter: image (base64 data URL)" }, 400);
    }
    const timeOfDay = payload.timeOfDay || "morning";

    const targetDevice = getTargetDeviceId(request);
    const status = getStatus(targetDevice) || {
      pumpOn: false,
      flowing: false,
      pumpState: "Idle",
      ph: 6.0,
      ec: 1.2,
      reservoirTempC: 20.0,
      tempC: 22.0,
      humidityPct: 65,
      waterLevel: "FULL"
    };

    // Save image to public/uploads/
    let imageUrl = "/placeholder-crop.jpg";
    try {
      const publicDir = path.join(process.cwd(), "public");
      const uploadsDir = path.join(publicDir, "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      let mimeType = "image/jpeg";
      let base64Data = payload.image;
      const match = payload.image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }

      const extension = mimeType.split("/")[1] || "jpg";
      const filename = `snap-${Date.now()}.${extension}`;
      const filepath = path.join(uploadsDir, filename);

      fs.writeFileSync(filepath, Buffer.from(base64Data, "base64"));
      imageUrl = `/uploads/${filename}`;
    } catch (fsErr) {
      console.error("Failed to save uploaded image locally:", fsErr);
    }

    // Call Gemini vision analysis
    let analysisText = "";
    let healthStatus: "healthy" | "warning" | "alert" = "healthy";

    try {
      const visionRes = await analyzeCropImageWithGemini(payload.image, status as any, timeOfDay);
      analysisText = `${visionRes.analysis}\n\nRecommendations:\n${visionRes.recommendations.map(r => "- " + r).join("\n")}`;
      healthStatus = visionRes.healthStatus;
    } catch (aiErr: any) {
      console.error("AI Vision analysis failed:", aiErr);
      analysisText = `Canopy scan complete (${timeOfDay}). Visual analysis failed. Fallback sensor diagnostics: pH: ${status.ph}, EC: ${status.ec}. Check Gemini API key configurations.`;
    }

    const newSnapshot: CameraSnapshot = {
      id: "snap-" + Date.now(),
      timestamp: Date.now(),
      imageUrl,
      analysis: analysisText,
      healthStatus,
      timeOfDay
    };

    addCameraSnapshot(newSnapshot);
    return jsonResponse(newSnapshot, 201);
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
