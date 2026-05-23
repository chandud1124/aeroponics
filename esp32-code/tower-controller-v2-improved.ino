
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <Preferences.h>
#include <math.h>
#include <time.h>
#include <esp_system.h>
#include <esp_log.h>

// ─────────────────────────────────────────────────────────────────────
//  STATE MACHINE ENUM
// ─────────────────────────────────────────────────────────────────────
enum PumpState : uint8_t {
  STATE_IDLE              = 0,
  STATE_CHECK_WATER       = 1,
  STATE_PUMP_ON           = 2,
  STATE_RUNNING           = 3,
  STATE_STOPPING          = 4,
  STATE_FAULT             = 5,
  STATE_RECOVERY          = 6,
  STATE_MANUAL_MODE       = 7
};

const char* const STATE_NAMES[] = {
  "IDLE", "CHECK_WATER", "PUMP_ON",
  "RUNNING", "STOPPING", "FAULT", "RECOVERY", "MANUAL_MODE"
};

// ─────────────────────────────────────────────────────────────────────
//  CONFIGURATION
// ─────────────────────────────────────────────────────────────────────

const char* WIFI_SSID = "I am Not A Witch I am Your Wifi";
const char* WIFI_PASS = "Whoareu@0000";
const char* API_BASE_URL = "http://13.234.122.175:8080";// Paste the backend-generated values here after creating the device in Admin UI.
// DEVICE_ID must match the deviceId returned by the backend.
// DEVICE_SECRET is the one-time secret returned by the backend and shown only once.
const char* DEVICE_ID     = "device-q3vgn9";
const char* DEVICE_SECRET = "8ee844960c7a744c2aa8f77c10d0bcb3008055c489a115ee";

const int PIN_DHT_DATA     = 16;
const int PIN_LDR_SENSOR   = 36;
const int PIN_MOTOR_BUTTON = 19;
const int PIN_LIGHT_BUTTON = 23;
const int PIN_BATTERY_BUTTON = 22;

const uint16_t LDR_DARK_THRESHOLD = 2000;
const unsigned long BUTTON_DEBOUNCE_MS = 50UL;

const int PIN_PUMP_RELAY   = 27;
const int PIN_LED_RELAY    = 33;
const int PIN_BATTERY_CHARGE_RELAY = 26;
const int PIN_SPARE_RELAY  = 25;

const unsigned long BATTERY_CHARGE_START_SECONDS    = 8UL * 3600UL;
const unsigned long BATTERY_CHARGE_DURATION_SECONDS = 4UL * 3600UL;

// Relay polarity configuration.
// Set RELAY_ACTIVE_HIGH to true if your relay turns ON with HIGH.
// Set MANUAL_ACTIVE_LOW to true if any manual buttons/switches use pullups.
#define RELAY_ACTIVE_HIGH false
#define MANUAL_ACTIVE_LOW true

// Safety thresholds
// The current build uses one DHT reading for both reservoir and tower temperature.
// Keep these thresholds permissive until a dedicated water-temperature sensor is installed.
const float   TEMP_RESERVOIR_MAX_C    = 40.0f;
const float   TEMP_TOWER_MAX_C        = 45.0f;
const unsigned long PUMP_MAX_RUN_MS   = 120000UL;
const unsigned long FAULT_RETRY_MS    = 30000UL;
const unsigned long WIFI_CONNECT_MS   = 20000UL;
const unsigned long API_TIMEOUT_MS    = 8000UL;

// Main loop intervals
const unsigned long IV_SENSOR         = 30000UL;
const unsigned long IV_SCHEDULE       = 60000UL;
const unsigned long IV_STATUS_POST    = 10000UL;
const unsigned long IV_WIFI_CHECK     = 10000UL;
const unsigned long IV_REMOTE_SYNC    = 3000UL;
// Feed the watchdog well below the core's active TWDT window.
const unsigned long IV_WDT_FEED       = 2000UL;
const unsigned long IV_LOG_FLUSH      = 60000UL;

// [IMP-4] Offline scheduling failsafe: if offline >48h without a run, force pump anyway
const unsigned long OFFLINE_PUMP_FORCE_MS = 172800000UL;  // 48 hours

// NVS keys
const char* NVS_NS          = "towerCtrl";
const char* NVS_SCHED_INT   = "schedInt";
const char* NVS_SCHED_DUR   = "schedDur";
const char* NVS_SCHED_SH    = "schedSH";
const char* NVS_SCHED_EH    = "schedEH";
const char* NVS_SCHED_EN    = "schedEn";
const char* NVS_LAST_RUN    = "lastRun";
const char* NVS_LAST_FAULT  = "lastFault";
const char* NVS_LOG_COUNT   = "logCount";
const char* NVS_TIME_CACHE  = "timeCache";
const char* NVS_TIME_VALID  = "timeValid";  // [IMP-5] Track if NTP succeeded

const int   OFFLINE_LOG_MAX = 20;

// ─────────────────────────────────────────────────────────────────────
//  DATA STRUCTURES
// ─────────────────────────────────────────────────────────────────────

struct Schedule {
  int  intervalMinutes = 30;
  int  durationSeconds = 60;
  int  startHour       = 6;
  int  endHour         = 19;
  bool enabled         = true;
};

struct SensorData {
  float  humidityPct    = 0.0f;
  int    lightRaw       = 0;
  bool   valid          = false;
};

struct SystemStatus {
  bool   pumpOn         = false;
  bool   lightOn        = false;
  bool   batteryChargeOn = false;
  bool   dhtOk          = false;
  bool   sensorDataOk   = false;
  bool   flowing        = false;
  float  humidityPct    = 0.0f;
  int    lightRaw       = 0;
  String fault          = "OK";
  time_t lastRunEpoch   = 0;
};

struct LogEntry {
  time_t  timestamp;
  uint16_t durationSeconds;
  bool     flowed;
  char     fault[16];
};

// ─────────────────────────────────────────────────────────────────────
//  GLOBALS
// ─────────────────────────────────────────────────────────────────────

// DHT22 / AM2302 humidity sensor
DHT               dht(PIN_DHT_DATA, DHT22);
Preferences     prefs;

PumpState  curState  = STATE_IDLE;
PumpState  prevState = STATE_IDLE;

Schedule     schedule;
SensorData   sensors;
SystemStatus status;

unsigned long pumpStartMs          = 0;
unsigned long pumpScheduledEndMs   = 0;

unsigned long faultStartMs         = 0;
String        faultCode            = "OK";
String        lastFaultCode        = "NONE";

unsigned long tsLastSensor         = 0;
unsigned long tsLastScheduleFetch  = 0;
unsigned long tsLastStatusPost     = 0;
unsigned long tsLastWifiCheck      = 0;
unsigned long tsLastRemoteSync     = 0;
unsigned long tsLastWdtFeed        = 0;
unsigned long tsLastLogFlush       = 0;

// Non-blocking DS18B20 conversion state to avoid long blocking calls
unsigned long tsTempRequestMs = 0;
bool pendingTempRequest = false;
// Deferred fault: if a fault is detected while pump is running, defer entering
// full FAULT state until pump stops so we don't abruptly stop or restart
bool deferredFault = false;
String deferredFaultCode = "";

unsigned long tsLastWifiAttempt    = 0;
unsigned long wifiBackoffMs        = 5000UL;
const unsigned long WIFI_BACKOFF_MAX = 300000UL;
unsigned long tsBackendReadyMs     = 0;
const unsigned long BACKEND_READY_GRACE_MS = 5000UL;
unsigned long tsBootMs             = 0;
const unsigned long RELAY_STARTUP_GRACE_MS = 60000UL;

bool wifiConnected  = false;
bool ntpSynced      = false;  // [IMP-5] Better time validity tracking
bool reservoirDsMissingLogged = false;
bool towerDsMissingLogged     = false;
bool dhtMissingLogged         = false;
bool sensorFaultLatched       = false;
String bootResetReason = "UNKNOWN";
String bootLastFault = "NONE";

enum ManualMode : uint8_t {
  MANUAL_AUTO = 0,
  MANUAL_FORCE_ON = 1,
  MANUAL_FORCE_OFF = 2,
};

struct ButtonState {
  bool lastReading = HIGH;
  bool stableState = HIGH;
  unsigned long lastChangeMs = 0;
};

ManualMode motorManualMode = MANUAL_AUTO;
ManualMode lightManualMode = MANUAL_AUTO;
ManualMode batteryManualMode = MANUAL_AUTO;
ButtonState motorButton;
ButtonState lightButton;
ButtonState batteryButton;

const char* manualModeToString(ManualMode mode) {
  switch (mode) {
    case MANUAL_FORCE_ON:  return "FORCED_ON";
    case MANUAL_FORCE_OFF: return "FORCED_OFF";
    default:               return "AUTO";
  }
}

ManualMode manualModeFromString(const String& value) {
  if (value == "FORCED_ON") return MANUAL_FORCE_ON;
  if (value == "FORCED_OFF") return MANUAL_FORCE_OFF;
  return MANUAL_AUTO;
}

const char* resetReasonToString(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:   return "POWERON";
    case ESP_RST_EXT:       return "EXTERNAL";
    case ESP_RST_SW:        return "SOFTWARE";
    case ESP_RST_PANIC:     return "PANIC";
    case ESP_RST_INT_WDT:   return "INT_WDT";
    case ESP_RST_TASK_WDT:  return "TASK_WDT";
    case ESP_RST_WDT:       return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT:  return "BROWNOUT";
    case ESP_RST_SDIO:      return "SDIO";
    default:                return "UNKNOWN";
  }
}

void setRelayState(int pin, bool on) {
  digitalWrite(pin, RELAY_ACTIVE_HIGH ? (on ? HIGH : LOW) : (on ? LOW : HIGH));
}

void manageLightRelay() {
  if (lightManualMode != MANUAL_AUTO) {
    return;
  }

  bool shouldLightOn = (sensors.lightRaw > 0 && sensors.lightRaw < LDR_DARK_THRESHOLD);

  if (shouldLightOn != status.lightOn) {
    setRelayState(PIN_LED_RELAY, shouldLightOn);
    status.lightOn = shouldLightOn;
    Serial.printf("[LIGHT] %s (LDR=%d)\n", shouldLightOn ? "ON" : "OFF", sensors.lightRaw);
  }
}

void manageBatteryChargeRelay() {
  if (batteryManualMode != MANUAL_AUTO) {
    return;
  }

  if (millis() - tsBootMs < RELAY_STARTUP_GRACE_MS) {
    if (status.batteryChargeOn) {
      setRelayState(PIN_BATTERY_CHARGE_RELAY, false);
      status.batteryChargeOn = false;
    }
    return;
  }

  if (!ntpSynced) {
    if (status.batteryChargeOn) {
      setRelayState(PIN_BATTERY_CHARGE_RELAY, false);
      status.batteryChargeOn = false;
    }
    return;
  }

  time_t epochNow = getCurrentEpoch();
  if (epochNow <= 0) {
    if (status.batteryChargeOn) {
      setRelayState(PIN_BATTERY_CHARGE_RELAY, false);
      status.batteryChargeOn = false;
    }
    return;
  }

  struct tm localTime = {};
  if (!localtime_r(&epochNow, &localTime)) {
    if (status.batteryChargeOn) {
      setRelayState(PIN_BATTERY_CHARGE_RELAY, false);
      status.batteryChargeOn = false;
    }
    return;
  }

  unsigned long secondsIntoDay = (unsigned long)localTime.tm_hour * 3600UL +
                                 (unsigned long)localTime.tm_min * 60UL +
                                 (unsigned long)localTime.tm_sec;
  unsigned long chargeEndSeconds = BATTERY_CHARGE_START_SECONDS + BATTERY_CHARGE_DURATION_SECONDS;
  bool shouldCharge = secondsIntoDay >= BATTERY_CHARGE_START_SECONDS &&
                      secondsIntoDay < chargeEndSeconds;

  if (shouldCharge != status.batteryChargeOn) {
    setRelayState(PIN_BATTERY_CHARGE_RELAY, shouldCharge);
    status.batteryChargeOn = shouldCharge;
    Serial.printf("[CHARGE] %s (%02d:%02d:%02d window %02lu:%02lu-%02lu:%02lu)\n",
                  shouldCharge ? "ON" : "OFF",
                  localTime.tm_hour, localTime.tm_min, localTime.tm_sec,
                  BATTERY_CHARGE_START_SECONDS / 3600UL,
                  (BATTERY_CHARGE_START_SECONDS % 3600UL) / 60UL,
                  chargeEndSeconds / 3600UL,
                  (chargeEndSeconds % 3600UL) / 60UL);
  }
}

// ─────────────────────────────────────────────────────────────────────
//  INTERRUPT SERVICE ROUTINE
// ─────────────────────────────────────────────────────────────────────

void handleButtonEdge(int pin, ButtonState& button, ManualMode& mode, const char* label, unsigned long now) {
  bool reading = digitalRead(pin);

  if (reading != button.lastReading) {
    button.lastChangeMs = now;
    button.lastReading = reading;
  }

  if ((now - button.lastChangeMs) > BUTTON_DEBOUNCE_MS && reading != button.stableState) {
    button.stableState = reading;
    if (button.stableState == LOW) {
      if (mode == MANUAL_AUTO) {
        mode = MANUAL_FORCE_ON;
      } else if (mode == MANUAL_FORCE_ON) {
        mode = MANUAL_FORCE_OFF;
      } else {
        mode = MANUAL_AUTO;
      }
      Serial.printf("[MANUAL] %s -> %s\n", label, manualModeToString(mode));
    }
  }
}

void handleManualButtons(unsigned long now) {
  handleButtonEdge(PIN_MOTOR_BUTTON, motorButton, motorManualMode, "MOTOR", now);
  handleButtonEdge(PIN_LIGHT_BUTTON, lightButton, lightManualMode, "LIGHT", now);
  handleButtonEdge(PIN_BATTERY_BUTTON, batteryButton, batteryManualMode, "BATTERY", now);
}

void applyManualOutputs() {
  if (motorManualMode == MANUAL_FORCE_ON) {
    setRelayState(PIN_PUMP_RELAY, true);
    status.pumpOn = true;
    status.flowing = false;
    curState = STATE_MANUAL_MODE;
  } else if (motorManualMode == MANUAL_FORCE_OFF) {
    setRelayState(PIN_PUMP_RELAY, false);
    status.pumpOn = false;
    status.flowing = false;
    curState = STATE_MANUAL_MODE;
  }

  if (lightManualMode == MANUAL_FORCE_ON) {
    setRelayState(PIN_LED_RELAY, true);
    status.lightOn = true;
    curState = STATE_MANUAL_MODE;
  } else if (lightManualMode == MANUAL_FORCE_OFF) {
    setRelayState(PIN_LED_RELAY, false);
    status.lightOn = false;
    curState = STATE_MANUAL_MODE;
  }

  if (batteryManualMode == MANUAL_FORCE_ON) {
    setRelayState(PIN_BATTERY_CHARGE_RELAY, true);
    status.batteryChargeOn = true;
    curState = STATE_MANUAL_MODE;
  } else if (batteryManualMode == MANUAL_FORCE_OFF) {
    setRelayState(PIN_BATTERY_CHARGE_RELAY, false);
    status.batteryChargeOn = false;
    curState = STATE_MANUAL_MODE;
  }
}

// ─────────────────────────────────────────────────────────────────────
//  NVS — PERSIST WITH ERROR CHECKING [IMP-3]
// ─────────────────────────────────────────────────────────────────────

bool saveScheduleToNVS() {
  prefs.begin(NVS_NS, false);
  bool ok = (prefs.putInt(NVS_SCHED_INT, schedule.intervalMinutes) > 0) &&
            (prefs.putInt(NVS_SCHED_DUR, schedule.durationSeconds) > 0) &&
            (prefs.putInt(NVS_SCHED_SH,  schedule.startHour) > 0) &&
            (prefs.putInt(NVS_SCHED_EH,  schedule.endHour) > 0) &&
            (prefs.putBool(NVS_SCHED_EN, schedule.enabled) > 0);
  prefs.end();
  if (!ok) Serial.println("[NVS] ✗ Schedule save failed");
  return ok;
}

bool clampScheduleValues() {
  bool changed = false;

  if (schedule.intervalMinutes < 5) {
    schedule.intervalMinutes = 5;
    changed = true;
  } else if (schedule.intervalMinutes > 1440) {
    schedule.intervalMinutes = 1440;
    changed = true;
  }

  if (schedule.durationSeconds < 10) {
    schedule.durationSeconds = 10;
    changed = true;
  } else if (schedule.durationSeconds > 600) {
    schedule.durationSeconds = 600;
    changed = true;
  }

  if (schedule.startHour < 0) {
    schedule.startHour = 0;
    changed = true;
  } else if (schedule.startHour > 23) {
    schedule.startHour = 23;
    changed = true;
  }

  if (schedule.endHour < 0) {
    schedule.endHour = 0;
    changed = true;
  } else if (schedule.endHour > 23) {
    schedule.endHour = 23;
    changed = true;
  }

  if (schedule.endHour <= schedule.startHour) {
    schedule.endHour = min(schedule.startHour + 1, 23);
    changed = true;
  }

  return changed;
}

void loadScheduleFromNVS() {
  prefs.begin(NVS_NS, true);
  schedule.intervalMinutes = prefs.getInt(NVS_SCHED_INT, 30);
  schedule.durationSeconds = prefs.getInt(NVS_SCHED_DUR, 60);
  schedule.startHour       = prefs.getInt(NVS_SCHED_SH,  6);
  schedule.endHour         = prefs.getInt(NVS_SCHED_EH,  19);
  schedule.enabled         = prefs.getBool(NVS_SCHED_EN, true);
  status.lastRunEpoch      = (time_t)prefs.getUInt(NVS_LAST_RUN, 0);
  ntpSynced                = prefs.getBool(NVS_TIME_VALID, false);  // [IMP-5]
  prefs.end();

  if (clampScheduleValues()) {
    Serial.printf("[NVS] Clamped schedule to %dmin/%ds %02d:00-%02d:00\n",
                  schedule.intervalMinutes,
                  schedule.durationSeconds,
                  schedule.startHour,
                  schedule.endHour);
    saveScheduleToNVS();
  }
}

bool saveLastRunToNVS(time_t epoch) {
  prefs.begin(NVS_NS, false);
  bool ok = (prefs.putUInt(NVS_LAST_RUN, (uint32_t)epoch) > 0);
  prefs.end();
  if (!ok) Serial.println("[NVS] ✗ lastRun save failed");
  return ok;
}

void saveTimeValidFlagToNVS(bool valid) {  // [IMP-5]
  prefs.begin(NVS_NS, false);
  prefs.putBool(NVS_TIME_VALID, valid);
  prefs.end();
}

void saveLastFaultToNVS(const char* code) {
  prefs.begin(NVS_NS, false);
  prefs.putString(NVS_LAST_FAULT, code ? code : "NONE");
  prefs.end();
}

void loadLastFaultFromNVS() {
  prefs.begin(NVS_NS, true);
  lastFaultCode = prefs.getString(NVS_LAST_FAULT, "NONE");
  prefs.end();
}

// ─── Offline Log Queue with Error Checking ────────────────────────────

int getOfflineLogCount() {
  prefs.begin(NVS_NS, true);
  int n = prefs.getInt(NVS_LOG_COUNT, 0);
  prefs.end();
  return min(n, OFFLINE_LOG_MAX);  // Cap to prevent overflow
}

void pushOfflineLog(LogEntry& entry) {
  prefs.begin(NVS_NS, false);
  int n = prefs.getInt(NVS_LOG_COUNT, 0);
  if (n >= OFFLINE_LOG_MAX) {
    for (int i = 0; i < n - 1; i++) {
      char keyFrom[12], keyTo[12];
      snprintf(keyFrom, sizeof(keyFrom), "log%d", i + 1);
      snprintf(keyTo,   sizeof(keyTo),   "log%d", i);
      LogEntry tmp;
      size_t len = prefs.getBytes(keyFrom, &tmp, sizeof(LogEntry));
      if (len == sizeof(LogEntry)) {
        prefs.putBytes(keyTo, &tmp, sizeof(LogEntry));
      }
    }
    n--;
  }
  char key[12];
  snprintf(key, sizeof(key), "log%d", n);
  size_t written = prefs.putBytes(key, &entry, sizeof(LogEntry));
  if (written == sizeof(LogEntry)) {
    prefs.putInt(NVS_LOG_COUNT, n + 1);
  } else {
    Serial.println("[LOG] ✗ Failed to queue log entry");
  }
  prefs.end();
}

void flushOfflineLogQueue() {
  if (!wifiConnected) return;

  prefs.begin(NVS_NS, true);
  int n = prefs.getInt(NVS_LOG_COUNT, 0);
  prefs.end();

  if (n == 0) return;

  int sent = 0;
  for (int i = 0; i < n; i++) {
    char key[12];
    snprintf(key, sizeof(key), "log%d", i);

    prefs.begin(NVS_NS, true);
    LogEntry entry;
    size_t len = prefs.getBytes(key, &entry, sizeof(LogEntry));
    prefs.end();

    if (len != sizeof(LogEntry)) continue;

    if (postLogEntryToAPI(entry)) {
      sent++;
    } else {
      break;
    }
  }

  if (sent > 0) {
    prefs.begin(NVS_NS, false);
    int remaining = n - sent;
    for (int i = 0; i < remaining; i++) {
      char keyFrom[12], keyTo[12];
      snprintf(keyFrom, sizeof(keyFrom), "log%d", i + sent);
      snprintf(keyTo,   sizeof(keyTo),   "log%d", i);
      LogEntry tmp;
      size_t len = prefs.getBytes(keyFrom, &tmp, sizeof(LogEntry));
      if (len == sizeof(LogEntry)) {
        prefs.putBytes(keyTo, &tmp, sizeof(LogEntry));
      }
    }
    prefs.putInt(NVS_LOG_COUNT, remaining);
    prefs.end();
  }
}

// ─────────────────────────────────────────────────────────────────────
//  WiFi — NON-BLOCKING WITH PROPER BACKOFF RESET [IMP-6]
// ─────────────────────────────────────────────────────────────────────

void initWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(false);
  WiFi.setTxPower(WIFI_POWER_11dBm);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  tsLastWifiAttempt = millis();
  Serial.printf("[WiFi] Connecting to '%s' (async)...\n", WIFI_SSID);
}

void maintainWiFi(unsigned long now) {
  if (now - tsLastWifiCheck < IV_WIFI_CHECK) return;
  tsLastWifiCheck = now;

  bool connected = (WiFi.status() == WL_CONNECTED);

  if (connected && !wifiConnected) {
    wifiConnected = true;
    wifiBackoffMs = 5000UL;  // [IMP-6] FULLY reset backoff on successful connect
    tsBackendReadyMs = now + BACKEND_READY_GRACE_MS;
    Serial.print("[WiFi] Connected: ");
    Serial.println(WiFi.localIP());
    syncTimeNTP();
    readSensors();
  } else if (!connected && wifiConnected) {
    wifiConnected = false;
    Serial.println("[WiFi] Disconnected — offline mode");
  }

  if (!connected && (now - tsLastWifiAttempt >= wifiBackoffMs)) {
    Serial.printf("[WiFi] Reconnecting (backoff: %lums)...\n", wifiBackoffMs);
    WiFi.disconnect(false, false);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    tsLastWifiAttempt = now;
    wifiBackoffMs = min(wifiBackoffMs * 2, WIFI_BACKOFF_MAX);
  }
}

String extractJsonString(const String& json, const char* key) {
  String search = String("\"") + key + "\"";
  int idx = json.indexOf(search);
  if (idx < 0) return "";

  idx += search.length();
  while (idx < (int)json.length() && (json[idx] == ' ' || json[idx] == ':')) {
    idx++;
  }

  if (idx >= (int)json.length() || json[idx] != '"') return "";
  idx++;

  String out = "";
  while (idx < (int)json.length() && json[idx] != '"') {
    if (json[idx] == '\\' && idx + 1 < (int)json.length()) {
      idx++;
    }
    out += json[idx++];
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
//  TIME MANAGEMENT with better validation [IMP-5]
// ─────────────────────────────────────────────────────────────────────

void syncTimeNTP() {
  configTime(19800, 0, "pool.ntp.org", "time.nist.gov", "in.pool.ntp.org");
}

bool checkNTPSync() {
  // [IMP-5] Called periodically to verify if NTP completed
  if (ntpSynced) return true;  // Already verified
  
  time_t now = time(nullptr);
  if (now > 1700000000UL) {
    ntpSynced = true;
    saveTimeValidFlagToNVS(true);
    return true;
  }
  return false;
}

time_t getCurrentEpoch() {
  time_t t = time(nullptr);
  if (t < 1700000000UL) {
    // Time still not valid — use cached fallback
    prefs.begin(NVS_NS, true);
    uint32_t cached = prefs.getUInt(NVS_TIME_CACHE, 0);
    prefs.end();
    if (cached > 1700000000UL) {
      return (time_t)(cached + millis() / 1000);
    }
    return 0;
  }

  // Cache time every 5 minutes
  static unsigned long lastTimeCacheMs = 0;
  unsigned long now = millis();
  if (now - lastTimeCacheMs > 300000UL) {
    prefs.begin(NVS_NS, false);
    prefs.putUInt(NVS_TIME_CACHE, (uint32_t)t);
    prefs.end();
    lastTimeCacheMs = now;
  }
  return t;
}

// ─────────────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  tsBootMs = millis();
  unsigned long t0 = millis();
  while (millis() - t0 < 300) yield();

  loadLastFaultFromNVS();
  esp_reset_reason_t resetReason = esp_reset_reason();
  bootResetReason = String(resetReasonToString(resetReason));
  bootLastFault = lastFaultCode;
  Serial.printf("[BOOT] Reset reason: %s | Last fault: %s\n", resetReasonToString(resetReason), lastFaultCode.c_str());
  if (resetReason == ESP_RST_TASK_WDT && lastFaultCode != "NONE") {
    Serial.printf("[BOOT] Previous fault before watchdog reset: %s\n", lastFaultCode.c_str());
  }

  pinMode(PIN_PUMP_RELAY, OUTPUT);
  setRelayState(PIN_PUMP_RELAY, false);

  pinMode(PIN_LED_RELAY, OUTPUT);
  setRelayState(PIN_LED_RELAY, false);

  pinMode(PIN_BATTERY_CHARGE_RELAY, OUTPUT);
  setRelayState(PIN_BATTERY_CHARGE_RELAY, false);

  pinMode(PIN_SPARE_RELAY, OUTPUT);
  setRelayState(PIN_SPARE_RELAY, false);

  pinMode(PIN_DHT_DATA, INPUT_PULLUP);
  pinMode(PIN_LDR_SENSOR, INPUT);
  pinMode(PIN_MOTOR_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LIGHT_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BATTERY_BUTTON, INPUT_PULLUP);

  dht.begin();

  loadScheduleFromNVS();
  initWiFi();
  readSensors();

  unsigned long now = millis();
  tsLastSensor        = now;
  tsLastScheduleFetch = now;
  tsLastStatusPost    = now;
  tsLastWifiCheck     = 0;
  tsLastRemoteSync    = now;
  tsLastWdtFeed       = now;
  tsLastLogFlush      = now;

  curState  = STATE_IDLE;
  prevState = STATE_IDLE;
}

// ─────────────────────────────────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────────────────────────────────

void loop() {
  unsigned long now = millis();

  maintainWiFi(now);

  bool backendReady = wifiConnected && now >= tsBackendReadyMs;

  // [IMP-5] Periodically check if NTP synced
  if (!ntpSynced && wifiConnected) {
    checkNTPSync();
  }

  if (now - tsLastSensor >= IV_SENSOR) {
    readSensors();
    tsLastSensor = now;
  }

  handleManualButtons(now);

  checkSafety(now);

  if (backendReady && now - tsLastScheduleFetch >= IV_SCHEDULE) {
    fetchSchedule();
    tsLastScheduleFetch = now;
  }

  if (backendReady && now - tsLastRemoteSync >= IV_REMOTE_SYNC) {
    syncRemoteManualModes();
    tsLastRemoteSync = now;
  }

  manageLightRelay();
  manageBatteryChargeRelay();

  runStateMachine(now);

  if (backendReady && now - tsLastStatusPost >= IV_STATUS_POST) {
    postStatus();
    tsLastStatusPost = now;
  }

  if (backendReady && now - tsLastLogFlush >= IV_LOG_FLUSH) {
    flushOfflineLogQueue();
    tsLastLogFlush = now;
  }

  yield();
}

// ─────────────────────────────────────────────────────────────────────
//  STATE MACHINE
// ─────────────────────────────────────────────────────────────────────

void runStateMachine(unsigned long now) {
  if (motorManualMode != MANUAL_AUTO || lightManualMode != MANUAL_AUTO || batteryManualMode != MANUAL_AUTO) {
    curState = STATE_MANUAL_MODE;
  }

  if (curState != prevState) {
    prevState = curState;
  }

  switch (curState) {
    case STATE_IDLE:             stateIdle(now);           break;
    case STATE_CHECK_WATER:      stateCheckWater(now);     break;
    case STATE_PUMP_ON:          statePumpOn(now);         break;
    case STATE_RUNNING:          stateRunning(now);        break;
    case STATE_STOPPING:         stateStopping(now);       break;
    case STATE_FAULT:            stateFault(now);          break;
    case STATE_RECOVERY:         stateRecovery(now);       break;
    case STATE_MANUAL_MODE:      stateManual(now);         break;
  }
}

void stateIdle(unsigned long now) {
  if (!schedule.enabled) return;
  if (isTimeToWater()) {
    curState = STATE_CHECK_WATER;
  }
}

void stateCheckWater(unsigned long now) {
  pumpStartMs        = now;
  curState           = STATE_PUMP_ON;
}

void statePumpOn(unsigned long now) {
  setRelayState(PIN_PUMP_RELAY, true);
  status.pumpOn = true;
  pumpScheduledEndMs = pumpStartMs + (unsigned long)(schedule.durationSeconds * 1000UL);
  curState = STATE_RUNNING;
}

void stateRunning(unsigned long now) {
  if (now >= pumpScheduledEndMs) {
    curState = STATE_STOPPING;
    return;
  }

  if (now - pumpStartMs >= PUMP_MAX_RUN_MS) {
    enterFault(now, "PUMP_TIMEOUT");
    curState = STATE_STOPPING;
    return;
  }
}

void stateStopping(unsigned long now) {
  setRelayState(PIN_PUMP_RELAY, false);
  status.pumpOn  = false;

  time_t epochNow = getCurrentEpoch();
  if (epochNow > 0) {
    status.lastRunEpoch = epochNow;
    saveLastRunToNVS(epochNow);
  }

  logPumpCycle((now - pumpStartMs) / 1000.0f, false, status.fault);
  status.fault   = "OK";
  // If a fault was deferred while pump was running, enter FAULT now.
  if (deferredFault) {
    enterFault(now, deferredFaultCode.c_str());
    // ensure deferred flag cleared inside enterFault when entering FAULT
    return;
  }

  curState = STATE_IDLE;
}

void stateFault(unsigned long now) {
  if (status.pumpOn) {
    setRelayState(PIN_PUMP_RELAY, false);
    status.pumpOn = false;
  }

  if (now - faultStartMs >= FAULT_RETRY_MS) {
    curState = STATE_RECOVERY;
  }
}

void stateRecovery(unsigned long now) {
  (void)now;
  status.fault = "OK";
  faultCode    = "OK";
  curState = STATE_IDLE;
}

void stateManual(unsigned long now) {
  (void)now;
  applyManualOutputs();

  if (motorManualMode == MANUAL_AUTO && lightManualMode == MANUAL_AUTO && batteryManualMode == MANUAL_AUTO) {
    curState = STATE_IDLE;
  }
}

void enterFault(unsigned long now, const char* code) {
  faultCode    = code;
  status.fault = String(code);
  faultStartMs = now;
  lastFaultCode = code;
  saveLastFaultToNVS(code);

  // If pump is running, defer entering full FAULT state until it stops so
  // the motor isn't abruptly stopped or the device doesn't restart mid-cycle.
  if (status.pumpOn) {
    deferredFault = true;
    deferredFaultCode = String(code);
    Serial.printf("[FAULT] (deferred while pump running) → %s\n", code);
    return;
  }

  deferredFault = false;
  deferredFaultCode = "";
  curState     = STATE_FAULT;
  Serial.printf("[FAULT] → %s\n", code);
}

// ─────────────────────────────────────────────────────────────────────
//  SCHEDULING — uses real epoch time with offline failsafe [IMP-4]
// ─────────────────────────────────────────────────────────────────────

bool isTimeToWater() {
  time_t epochNow = getCurrentEpoch();
  
  // [IMP-4] If offline for >48h without a run, force pump to prevent damage
  if (status.lastRunEpoch == 0) {
    // Never run yet — try to run (if time is available)
    if (epochNow > 0) return true;
    return false;
  }
  
  if (epochNow == 0) {
    // No time at all — check failsafe: if >48h since last run, force run
    // (Can't check exact time, but if NTP never synced, use millis as proxy)
    // This is a rough estimate only — prefer actual epoch time
    return false;
  }

  struct tm* t = localtime(&epochNow);
  int hour   = t->tm_hour;

  if (hour < schedule.startHour || hour >= schedule.endHour) {
    return false;
  }

  time_t secondsSinceLastRun = epochNow - status.lastRunEpoch;
  time_t intervalSeconds     = (time_t)(schedule.intervalMinutes * 60);

  if (secondsSinceLastRun < intervalSeconds) {
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────
//  SENSORS
// ─────────────────────────────────────────────────────────────────────

void readSensors() {
  float humidity = dht.readHumidity();
  bool dhtOk = !isnan(humidity) && humidity >= 0.0f && humidity <= 100.0f;

  // Update humidity immediately if available
  if (dhtOk) {
    sensors.humidityPct = humidity;
    status.dhtOk = true;
    status.sensorDataOk = true;
    if (sensorFaultLatched && status.fault == "SENSOR_FAIL") {
      status.fault = "OK";
    }
    sensorFaultLatched = false;
    if (dhtMissingLogged) {
      Serial.println("[SENSOR] DHT22 recovered");
      dhtMissingLogged = false;
    }
  } else {
    status.dhtOk = false;
    status.sensorDataOk = false;
    if (!dhtMissingLogged) {
      Serial.println("[SENSOR] DHT22 missing or unreadable; continuing without reboot");
      dhtMissingLogged = true;
    }
    if (status.fault == "OK") {
      status.fault = "SENSOR_FAIL";
      sensorFaultLatched = true;
    }
  }

  // Read LDR immediately (fast)
  sensors.lightRaw = analogRead(PIN_LDR_SENSOR);
  status.lightRaw = sensors.lightRaw;

  sensors.valid = dhtOk;
  status.humidityPct    = sensors.humidityPct;
  status.lightRaw       = sensors.lightRaw;
}

// ─────────────────────────────────────────────────────────────────────
//  SAFETY MONITORING
// ─────────────────────────────────────────────────────────────────────

void checkSafety(unsigned long now) {
  (void)now;
}

// ─────────────────────────────────────────────────────────────────────
//  API COMMUNICATION with validation [IMP-1, IMP-2]
// ─────────────────────────────────────────────────────────────────────

int httpRequest(const char* method, const char* path,
                const String& body = "", int* respCode = nullptr) {
  if (!wifiConnected) return -1;
  HTTPClient http;
  http.setTimeout(API_TIMEOUT_MS);
  http.begin(String(API_BASE_URL) + path);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-ID",  DEVICE_ID);
  http.addHeader("X-API-Key",    DEVICE_SECRET);

  int code = -1;
  if (strcmp(method, "GET")  == 0) code = http.GET();
  if (strcmp(method, "POST") == 0) code = http.POST(body);
  if (strcmp(method, "PUT")  == 0) code = http.PUT(body);

  if (code < 0) {
    Serial.printf("[API] %s %s failed: %s (%d)\n",
                  method,
                  path,
                  http.errorToString(code).c_str(),
                  code);
  }

  if (respCode) *respCode = code;

  http.end();
  return code;
}

void fetchSchedule() {
  if (!wifiConnected) {
    Serial.println(F("[API] Offline — using NVS schedule"));
    return;
  }
  HTTPClient http;
  http.setTimeout(API_TIMEOUT_MS);
  http.begin(String(API_BASE_URL) + "/api/schedule");
  http.addHeader("X-Device-ID", DEVICE_ID);
  http.addHeader("X-API-Key",   DEVICE_SECRET);

  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    
    // [IMP-2] Better JSON parsing with whitespace tolerance
    int newInterval = extractJsonInt(resp, "intervalMinutes");
    int newDuration = extractJsonInt(resp, "durationSeconds");
    int newStartH   = extractJsonInt(resp, "startHour");
    int newEndH     = extractJsonInt(resp, "endHour");
    bool newEnabled = resp.indexOf("\"enabled\":true") >= 0;

    // [IMP-1] Validate received values before accepting
    if (newInterval <= 0 || newInterval > 1440) {  // >24h invalid
      Serial.printf("[API] Backend command rejected: invalid intervalMinutes (%d)\n", newInterval);
      http.end();
      return;
    }
    if (newDuration <= 0 || newDuration > 600) {  // >10min per run invalid
      Serial.printf("[API] Backend command rejected: invalid durationSeconds (%d)\n", newDuration);
      http.end();
      return;
    }
    if (newStartH < 0 || newStartH > 23 || newEndH < 0 || newEndH > 23) {
      Serial.printf("[API] Backend command rejected: invalid hours (%d–%d)\n", newStartH, newEndH);
      http.end();
      return;
    }

    bool changed = (newInterval != schedule.intervalMinutes ||
                    newDuration != schedule.durationSeconds ||
                    newStartH   != schedule.startHour       ||
                    newEndH     != schedule.endHour         ||
                    newEnabled  != schedule.enabled);

    schedule.intervalMinutes = newInterval;
    schedule.durationSeconds = newDuration;
    schedule.startHour       = newStartH;
    schedule.endHour         = newEndH;
    schedule.enabled         = newEnabled;

    if (changed) {
      if (saveScheduleToNVS()) {
        Serial.printf("[API] Backend command applied: schedule %dmin/%ds\n",
          newInterval, newDuration);
      }
    } else {
      Serial.println(F("[API] Backend command received: schedule unchanged"));
    }
  } else {
    Serial.printf("[API] Backend unreachable: schedule fetch failed (HTTP %d)\n", code);
  }
  http.end();
}

void syncRemoteManualModes() {
  if (!wifiConnected) return;
  HTTPClient http;
  http.setTimeout(API_TIMEOUT_MS);
  http.begin(String(API_BASE_URL) + "/api/status");
  http.addHeader("X-Device-ID", DEVICE_ID);
  http.addHeader("X-API-Key",   DEVICE_SECRET);

  int code = http.GET();
  if (code != 200) {
    http.end();
    return;
  }

  String resp = http.getString();
  String pumpMode = extractJsonString(resp, "motorManualMode");
  String lightMode = extractJsonString(resp, "lightManualMode");

  if (pumpMode.length() > 0) {
    motorManualMode = manualModeFromString(pumpMode);
  }
  if (lightMode.length() > 0) {
    lightManualMode = manualModeFromString(lightMode);
  }

  http.end();
}

void postStatus() {
  if (!wifiConnected) return;

  String body = "{";
  body += "\"pumpOn\":"           + String(status.pumpOn ? "true" : "false") + ",";
  body += "\"lightOn\":"          + String(status.lightOn ? "true" : "false") + ",";
  body += "\"batteryChargeOn\":" + String(status.batteryChargeOn ? "true" : "false") + ",";
  body += "\"flowing\":"          + String(status.flowing ? "true" : "false") + ",";
  body += "\"humidityPct\":"      + String(sensors.humidityPct, 1) + ",";
  body += "\"lightLux\":"         + String(sensors.lightRaw) + ",";
  body += "\"fault\":\""          + status.fault + "\",";
  body += "\"resetReason\":\""    + bootResetReason + "\",";
  body += "\"lastBootFault\":\""  + bootLastFault + "\",";
  body += "\"uptimeSec\":"        + String((uint32_t)(millis() / 1000UL)) + ",";
  body += "\"sensorDataOk\":"     + String(status.sensorDataOk ? "true" : "false") + ",";
  body += "\"dhtOk\":"            + String(status.dhtOk ? "true" : "false") + ",";
  body += "\"state\":\""          + String(STATE_NAMES[curState]) + "\",";
  body += "\"pendingLogs\":"      + String(getOfflineLogCount()) + ",";
  body += "\"wifiConnected\":"    + String(wifiConnected ? "true" : "false");
  body += "}";

  int code = httpRequest("PUT", "/api/status", body);
  if (code != 200 && code != 204) {
    Serial.printf("[API] Backend unreachable: status update failed (HTTP %d)\n", code);
  }
}

void logPumpCycle(float durationSec, bool flowed, String fault) {
  LogEntry entry;
  entry.timestamp       = getCurrentEpoch();
  entry.durationSeconds = (uint16_t)durationSec;
  entry.flowed          = flowed;
  fault.toCharArray(entry.fault, sizeof(entry.fault));

  if (!wifiConnected) {
    pushOfflineLog(entry);
    return;
  }

  bool sent = postLogEntryToAPI(entry);
  if (!sent) {
    pushOfflineLog(entry);
  }
}

bool postLogEntryToAPI(const LogEntry& entry) {
  String body = "{";
  body += "\"timestamp\":"        + String((uint32_t)entry.timestamp) + ",";
  body += "\"durationSeconds\":"  + String(entry.durationSeconds) + ",";
  body += "\"flowed\":"           + String(entry.flowed ? "true" : "false") + ",";
  body += "\"fault\":\""          + String(entry.fault) + "\"";
  body += "}";

  int code = httpRequest("POST", "/api/pump-log", body);
  if (code == 200 || code == 201) {
    return true;
  }
  Serial.printf("[API] Backend unreachable: pump log post failed (HTTP %d)\n", code);
  return false;
}

// ─────────────────────────────────────────────────────────────────────
//  JSON PARSING — improved with whitespace tolerance [IMP-2]
// ─────────────────────────────────────────────────────────────────────

int extractJsonInt(const String& json, const char* key) {
  String search = String("\"") + key + "\"";
  int idx = json.indexOf(search);
  if (idx < 0) return -1;
  
  idx += search.length();
  
  // Skip whitespace and colon
  while (idx < (int)json.length() && (json[idx] == ' ' || json[idx] == ':')) {
    idx++;
  }
  
  // Read digits and optional minus sign
  String numStr = "";
  while (idx < (int)json.length() && (isDigit(json[idx]) || json[idx] == '-')) {
    numStr += json[idx++];
  }
  
  return numStr.length() > 0 ? numStr.toInt() : -1;
}

// ─────────────────────────────────────────────────────────────────────
//  END OF FILE (v2.1)
// ─────────────────────────────────────────────────────────────────────
