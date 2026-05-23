import { randomBytes, createHash } from "crypto";
import os from "os";
import fs from "fs";
import path from "path";

export type DeviceEntry = {
  id: string;
  name: string | null;
  deviceId: string;
  secretHash: string;
  macAddress?: string | null;
  ipAddress?: string | null;
  createdAt: string;
};

let devices: DeviceEntry[] = [];

export class DuplicateDeviceError extends Error {
  existingDevice: DeviceEntry;

  constructor(message: string, existingDevice: DeviceEntry) {
    super(message);
    this.name = "DuplicateDeviceError";
    this.existingDevice = existingDevice;
  }
}

const LEGACY_DEVICES_FILE = path.join(process.cwd(), "data", "devices.json");
const DATA_DIR = process.env.TOWER_DATA_DIR ?? path.join(os.homedir(), ".smart-tower-garden");
const DEVICES_FILE = process.env.TOWER_DEVICES_FILE ?? path.join(DATA_DIR, "devices.json");

function migrateLegacyDevicesFileIfNeeded() {
  try {
    if (fs.existsSync(DEVICES_FILE)) return;
    if (!fs.existsSync(LEGACY_DEVICES_FILE)) return;

    ensureDataDir();
    fs.copyFileSync(LEGACY_DEVICES_FILE, DEVICES_FILE);
    console.info(`[devices] Migrated legacy registry from ${LEGACY_DEVICES_FILE} to ${DEVICES_FILE}`);
  } catch (e) {
    console.error("Failed to migrate legacy devices file:", e);
  }
}

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (e) {
    console.error("Failed to ensure data directory:", e);
  }
}

function loadDevicesFromDisk() {
  try {
    migrateLegacyDevicesFileIfNeeded();
    if (!fs.existsSync(DEVICES_FILE)) return;
    const raw = fs.readFileSync(DEVICES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const deduped = sortAndDedupeDevices(parsed as DeviceEntry[]);
      devices = deduped;
      if (deduped.length !== parsed.length) {
        saveDevicesToDisk();
      }
    }
  } catch (e) {
    console.error("Failed to load devices from disk:", e);
  }
}

function saveDevicesToDisk() {
  try {
    ensureDataDir();
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save devices to disk:", e);
  }
}

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function normalizeValue(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function findDuplicateDevice(opts: { deviceId?: string | null; macAddress?: string | null }) {
  const normalizedDeviceId = normalizeValue(opts.deviceId);
  const normalizedMacAddress = normalizeValue(opts.macAddress);

  return (
    devices.find((device) => {
      if (normalizedDeviceId && normalizeValue(device.deviceId) === normalizedDeviceId) {
        return true;
      }

      if (normalizedMacAddress && normalizeValue(device.macAddress) === normalizedMacAddress) {
        return true;
      }

      return false;
    }) ?? null
  );
}

function sortAndDedupeDevices(entries: DeviceEntry[]) {
  const seenDeviceIds = new Set<string>();
  const seenMacAddresses = new Set<string>();

  return entries.filter((entry) => {
    const deviceIdKey = normalizeValue(entry.deviceId);
    const macKey = normalizeValue(entry.macAddress);

    if (deviceIdKey && seenDeviceIds.has(deviceIdKey)) {
      return false;
    }

    if (macKey && seenMacAddresses.has(macKey)) {
      return false;
    }

    if (deviceIdKey) seenDeviceIds.add(deviceIdKey);
    if (macKey) seenMacAddresses.add(macKey);
    return true;
  });
}

export function createDevice(opts: { name?: string | null; deviceId?: string | null; macAddress?: string | null; ipAddress?: string | null } = {}) {
  const duplicate = findDuplicateDevice({ deviceId: opts.deviceId ?? null, macAddress: opts.macAddress ?? null });
  if (duplicate) {
    throw new DuplicateDeviceError("Device already exists", duplicate);
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const deviceId = opts.deviceId ?? `device-${Math.random().toString(36).slice(2, 8)}`;
  const secret = randomBytes(24).toString("hex");
  const secretHash = hashSecret(secret);

  const entry: DeviceEntry = {
    id,
    name: opts.name ?? null,
    deviceId,
    secretHash,
    macAddress: opts.macAddress ?? null,
    ipAddress: opts.ipAddress ?? null,
    createdAt: new Date().toISOString(),
  };

  devices.push(entry);
  saveDevicesToDisk();
  return { deviceId: entry.deviceId, secret };
}

export function listDevices() {
  return devices.map((d) => ({ id: d.id, name: d.name, deviceId: d.deviceId, macAddress: d.macAddress ?? null, ipAddress: d.ipAddress ?? null, createdAt: d.createdAt }));
}

export function deleteDevice(deviceId: string) {
  const before = devices.length;
  devices = devices.filter((d) => d.deviceId !== deviceId);
  const changed = devices.length !== before;
  if (changed) saveDevicesToDisk();
  return changed;
}

export function validateDeviceSecret(deviceId: string, secret: string) {
  const found = devices.find((d) => d.deviceId === deviceId);
  if (!found) return false;
  return found.secretHash === hashSecret(secret);
}

export function rotateDeviceSecret(deviceId: string) {
  const found = devices.find((d) => d.deviceId === deviceId);
  if (!found) return null;
  const secret = randomBytes(24).toString("hex");
  found.secretHash = hashSecret(secret);
  saveDevicesToDisk();
  return secret;
}

// Load at startup
loadDevicesFromDisk();
