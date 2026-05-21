// Standardised fault codes written by the ESP32 into tower_status.fault
// (and tower_pump_log.fault). Keeping them as short uppercase tokens means
// the dashboard can colour-code them without parsing free text.

export type FaultCode =
  | "DRY_RUN" // pump ran but no flow detected within the verification window
  | "FLOW_TIMEOUT" // flow stopped mid-cycle
  | "LOW_WATER" // tank level == LOW, cycle skipped
  | "SENSOR_FAIL" // DS18B20 / level probe returned invalid reading
  | "WIFI_LOST" // ESP32 lost network for >5 min (logged when it reconnects)
  | "OK";

export type FaultSeverity = "info" | "warn" | "bad";

export const FAULT_INFO: Record<
  FaultCode,
  { label: string; hint: string; severity: FaultSeverity }
> = {
  DRY_RUN: {
    label: "Dry run",
    hint: "Pump turned on but no flow within 5 s. Check pump primer or blockage.",
    severity: "bad",
  },
  FLOW_TIMEOUT: {
    label: "Flow stopped mid-cycle",
    hint: "Flow pulses dropped to zero before cycle end. Possible pipe clog or pump stall.",
    severity: "bad",
  },
  LOW_WATER: {
    label: "Low water — refill",
    hint: "Reservoir is at LOW probe. Pump skipped to avoid dry running.",
    severity: "warn",
  },
  SENSOR_FAIL: {
    label: "Sensor failure",
    hint: "Temperature or level sensor returned an invalid reading. Check wiring.",
    severity: "warn",
  },
  WIFI_LOST: {
    label: "Network was offline",
    hint: "ESP32 lost WiFi briefly. Pump kept running on local schedule.",
    severity: "info",
  },
  OK: { label: "All good", hint: "No active faults.", severity: "info" },
};

export function parseFault(raw: string | null | undefined): FaultCode | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (upper in FAULT_INFO) return upper as FaultCode;
  // Backwards compatibility with older free-text faults
  if (upper.includes("DRY")) return "DRY_RUN";
  if (upper.includes("FLOW")) return "FLOW_TIMEOUT";
  if (upper.includes("LOW") || upper.includes("EMPTY") || upper.includes("REFILL"))
    return "LOW_WATER";
  if (upper.includes("SENSOR")) return "SENSOR_FAIL";
  return "SENSOR_FAIL";
}
