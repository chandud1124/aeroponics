#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

// ─────────────────────────────────────────────────────────────────────
//  STATE MACHINE ENUM & NAMES
// ─────────────────────────────────────────────────────────────────────
enum PumpState : uint8_t {
  STATE_IDLE         = 0,
  STATE_CHECK_WATER  = 1,
  STATE_PUMP_ON      = 2,
  STATE_RUNNING      = 3,
  STATE_STOPPING     = 4,
  STATE_FAULT        = 5,
  STATE_RECOVERY     = 6,
  STATE_MANUAL_MODE  = 7
};

const char* const STATE_NAMES[] = {
  "IDLE", "CHECK_WATER", "PUMP_ON",
  "RUNNING", "STOPPING", "FAULT", "RECOVERY", "MANUAL_MODE"
};

enum ManualMode {
  MANUAL_AUTO = 0,
  MANUAL_FORCE_ON = 1,
  MANUAL_FORCE_OFF = 2
};

// ─────────────────────────────────────────────────────────────────────
//  PIN ASSIGNMENTS (BOOT DEFAULTS AND DYNAMIC OVERRIDES)
// ─────────────────────────────────────────────────────────────────────
int PIN_PUMP_RELAY   = 27;
int PIN_MOTOR_BUTTON = 19;

// Relay active state (LOW for active low relays)
#define RELAY_ACTIVE_HIGH false

// ─────────────────────────────────────────────────────────────────────
//  FORWARD DECLARATIONS & CONSTANTS
// ─────────────────────────────────────────────────────────────────────
void runStateMachine(unsigned long now);
void stateIdle(unsigned long now);
void stateCheckWater(unsigned long now);
void statePumpOn(unsigned long now);
void stateRunning(unsigned long now);
void stateStopping(unsigned long now);
void stateFault(unsigned long now);
void stateRecovery(unsigned long now);
void stateManual(unsigned long now);

void postStatus();
bool fetchHandshakeAndSync();
void setupPinModes();
void handleManualButtons(unsigned long now);
bool isTimeToWater();
void getActivePumpProfile(time_t epochNow, int& intervalMinutes, int& durationSeconds);
void enterFault(unsigned long now, const char* code);
void stopPumpCycle();
void logPumpCycle(float durationSec, bool flowed, String fault);

int findJsonKey(const String& json, const char* key);
String extractJsonValue(const String& json, const char* key);
int extractJsonInt(const String& json, const char* key);
String extractJsonString(const String& json, const char* key);
String extractJsonNumber(const String& json, const char* key);
bool extractJsonBool(const String& json, const char* key, bool defaultVal);
time_t getCurrentEpoch();
void loadScheduleFromNVS();
void saveScheduleToNVS();

// WiFi
const char* WIFI_SSID     = "I am Not A Witch I am Your Wifi";
const char* WIFI_PASS     = "Whoareu@0000";

// Backend API
const char* API_BASE_URL  = "https://hydroponics.chandugowda.site";
const char* DEVICE_ID      = "device-w7p329";
const char* DEVICE_SECRET  = "54364796ead0fe885adcea29c48267cf462e5c163fb1ac77";

// Timing Intervals
const unsigned long IV_SCHEDULE     = 60000UL;
const unsigned long IV_WDT_FEED     = 5000UL;
const unsigned long IV_WIFI_CHECK   = 10000UL;
const unsigned long WIFI_BACKOFF_MAX = 60000UL;
const unsigned long API_TIMEOUT_MS  = 8000UL;
const unsigned long FAULT_RETRY_MS  = 300000UL; // 5 min retry

// Globals
Preferences prefs;
const char* NVS_NS         = "motorNode";
const char* NVS_LAST_RUN   = "lastRun";
const char* NVS_SCHED_INT  = "schedInt";
const char* NVS_SCHED_DUR  = "schedDur";
const char* NVS_SCHED_SH   = "schedSH";
const char* NVS_SCHED_EH   = "schedEH";
const char* NVS_SCHED_EN   = "schedEn";
const char* NVS_NIGHT_EN   = "nightEnabled";
const char* NVS_SCHED_DAY_INT = "schedDayInt";
const char* NVS_SCHED_DAY_DUR = "schedDayDur";
const char* NVS_SCHED_NIGHT_INT = "schedNightInt";
const char* NVS_SCHED_NIGHT_DUR = "schedNightDur";

bool wifiConnected   = false;
bool ntpSynced       = false;
String deviceMacAddress = "";

unsigned long tsLastScheduleFetch  = 0;
unsigned long tsLastStatusPost     = 0;
unsigned long tsLastWifiCheck      = 0;
unsigned long tsLastWifiAttempt    = 0;
unsigned long tsLastWdtFeed        = 0;
unsigned long wifiBackoffMs        = 5000UL;

// State tracking
PumpState curState  = STATE_IDLE;
PumpState prevState = STATE_IDLE;
ManualMode motorManualMode = MANUAL_AUTO;

// Schedule struct
struct PumpSchedule {
  int intervalMinutes      = 10;
  int durationSeconds      = 180;
  int startHour            = 0;
  int endHour              = 24;
  bool enabled             = true;
  bool nightEnabled        = true;
  int dayIntervalMinutes   = 10;
  int dayDurationSeconds   = 180;
  int nightIntervalMinutes = 15;
  int nightDurationSeconds = 120;
} schedule;

// Status & sensors
struct MotorStatus {
  bool pumpOn        = false;
  bool flowing       = false;
  String fault       = "OK";
  time_t lastRunEpoch = 0;
} status;

struct RemoteSensors {
  String waterLevel = "MEDIUM";
  bool levelValid   = true;
  bool valid        = true;
} sensors;

time_t lastAutoRunEpoch      = 0;
unsigned long pumpStartMs    = 0;
unsigned long pumpScheduledEndMs = 0;
unsigned long faultStartMs   = 0;
String faultCode             = "OK";

bool lastPumpOnState         = false;

// Button Debouncing
unsigned long btnLastDebounceMs = 0;
bool btnLastReading = HIGH;
bool btnState = HIGH;

// LogEntry for offline queues
struct LogEntry {
  time_t timestamp;
  uint16_t durationSeconds;
  bool flowed;
  char fault[16];
};

// ─────────────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (millis() - t0 < 300) yield();

  Serial.println(F("\n╔══════════════════════════════════════╗"));
  Serial.println(F("║      TOWER GARDEN — MOTOR NODE       ║"));
  Serial.println(F("╚══════════════════════════════════════╝\n"));

  setupPinModes();
  stopPumpCycle();

  // Watchdog
  esp_task_wdt_config_t wdtCfg = {
    .timeout_ms     = 45000,
    .idle_core_mask = 0,
    .trigger_panic  = true
  };
  esp_task_wdt_reconfigure(&wdtCfg);
  esp_task_wdt_add(NULL);
  Serial.println("[WDT] Watchdog enabled (45s)");

  // NVS Load
  loadScheduleFromNVS();

  // WiFi setup
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  tsLastWifiAttempt = millis();
  deviceMacAddress = WiFi.macAddress();
  Serial.printf("[BOOT] MAC Address: %s\n", deviceMacAddress.c_str());

  tsLastScheduleFetch = millis() - IV_SCHEDULE;
  tsLastStatusPost = millis();
}

// ─────────────────────────────────────────────────────────────────────
//  LOOP
// ─────────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // Watchdog feed
  if (now - tsLastWdtFeed >= IV_WDT_FEED) {
    esp_task_wdt_reset();
    tsLastWdtFeed = now;
  }

  // WiFi maintenance
  if (now - tsLastWifiCheck >= IV_WIFI_CHECK) {
    tsLastWifiCheck = now;
    bool connected = (WiFi.status() == WL_CONNECTED);
    if (connected && !wifiConnected) {
      wifiConnected = true;
      wifiBackoffMs = 5000UL;
      Serial.print("[WiFi] Connected IP: ");
      Serial.println(WiFi.localIP());
      configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
      fetchHandshakeAndSync();
      postStatus();
      tsLastStatusPost = now;
    } else if (!connected && wifiConnected) {
      wifiConnected = false;
      Serial.println("[WiFi] Disconnected");
    }
    if (!connected && (now - tsLastWifiAttempt >= wifiBackoffMs)) {
      Serial.printf("[WiFi] Reconnecting (backoff %lus)...\n", wifiBackoffMs / 1000);
      WiFi.disconnect(false, false);
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      tsLastWifiAttempt = now;
      wifiBackoffMs = min(wifiBackoffMs * 2, WIFI_BACKOFF_MAX);
    }
  }

  // NTP sync
  if (!ntpSynced && wifiConnected) {
    time_t t = time(nullptr);
    if (t > 1700000000UL) {
      ntpSynced = true;
      Serial.println("[Time] NTP sync confirmed");
    }
  }

  // Handshake schedule fetch
  if (now - tsLastScheduleFetch >= IV_SCHEDULE) {
    fetchHandshakeAndSync();
    tsLastScheduleFetch = now;
  }

  // Button override checking
  handleManualButtons(now);

  // State Machine run
  runStateMachine(now);

  // Status Posting
  bool stateChanged = (status.pumpOn != lastPumpOnState);
  unsigned long statusPostInterval = status.pumpOn ? 5000UL : 60000UL;
  if (stateChanged || (now - tsLastStatusPost >= statusPostInterval)) {
    postStatus();
    tsLastStatusPost = now;
    lastPumpOnState = status.pumpOn;
  }

  yield();
}

// ─────────────────────────────────────────────────────────────────────
//  RELAY & BUTTON CONFIG
// ─────────────────────────────────────────────────────────────────────
void setupPinModes() {
  pinMode(PIN_PUMP_RELAY, OUTPUT);
  pinMode(PIN_MOTOR_BUTTON, INPUT_PULLUP);
}

void setRelayState(int pin, bool on) {
  bool level = RELAY_ACTIVE_HIGH ? on : !on;
  digitalWrite(pin, level);
}

void stopPumpCycle() {
  setRelayState(PIN_PUMP_RELAY, false);
  status.pumpOn = false;
  status.flowing = false;
}

void handleManualButtons(unsigned long now) {
  bool readVal = digitalRead(PIN_MOTOR_BUTTON);
  if (readVal != btnLastReading) {
    btnLastDebounceMs = now;
    btnLastReading = readVal;
  }
  if ((now - btnLastDebounceMs) >= 50UL) {
    if (readVal != btnState) {
      btnState = readVal;
      if (btnState == LOW) { // Button Pressed
        if (motorManualMode == MANUAL_FORCE_ON) {
          motorManualMode = MANUAL_FORCE_OFF;
          Serial.println("[Button] Forced Pump OFF");
        } else if (motorManualMode == MANUAL_FORCE_OFF) {
          motorManualMode = MANUAL_AUTO;
          Serial.println("[Button] Resumed Auto Schedule");
        } else {
          motorManualMode = MANUAL_FORCE_ON;
          Serial.println("[Button] Forced Pump ON");
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
//  STATE MACHINE
// ─────────────────────────────────────────────────────────────────────
void runStateMachine(unsigned long now) {
  if (motorManualMode != MANUAL_AUTO) {
    if (curState != STATE_MANUAL_MODE) {
      Serial.println("[SM] → MANUAL_MODE");
      curState = STATE_MANUAL_MODE;
    }
    stateManual(now);
    return;
  }

  if (curState == STATE_MANUAL_MODE) {
    Serial.println("[SM] MANUAL_MODE → IDLE");
    stopPumpCycle();
    curState = STATE_IDLE;
  }

  if (curState != prevState) {
    Serial.printf("[SM] %s → %s\n", STATE_NAMES[prevState], STATE_NAMES[curState]);
    prevState = curState;
  }

  switch (curState) {
    case STATE_IDLE:        stateIdle(now);        break;
    case STATE_CHECK_WATER: stateCheckWater(now);  break;
    case STATE_PUMP_ON:     statePumpOn(now);       break;
    case STATE_RUNNING:     stateRunning(now);      break;
    case STATE_STOPPING:    stateStopping(now);     break;
    case STATE_FAULT:       stateFault(now);        break;
    case STATE_RECOVERY:    stateRecovery(now);     break;
    default: break;
  }
}

void stateIdle(unsigned long now) {
  (void)now;
  if (!schedule.enabled) return;
  if (isTimeToWater()) {
    Serial.println("[SCHED] Time to water — starting cycle");
    curState = STATE_CHECK_WATER;
  }
}

void stateCheckWater(unsigned long now) {
  // If remote water level says low or level sensor failed, block pump
  if (!sensors.levelValid || sensors.waterLevel == "LOW") {
    Serial.println("[CHECK] Reservoir level unsafe — blocking pump");
    enterFault(now, sensors.levelValid ? "LOW_WATER" : "LEVEL_SENSOR_FAIL");
    return;
  }
  // All checks passed
  pumpStartMs = now;
  curState    = STATE_PUMP_ON;
}

void statePumpOn(unsigned long now) {
  (void)now;
  time_t epochNow = getCurrentEpoch();
  int intervalMinutes = schedule.intervalMinutes;
  int durationSeconds = schedule.durationSeconds;
  getActivePumpProfile(epochNow, intervalMinutes, durationSeconds);
  Serial.printf("[PUMP] Starting Relay Pin %d — duration %ds\n", PIN_PUMP_RELAY, durationSeconds);
  setRelayState(PIN_PUMP_RELAY, true);
  status.pumpOn  = true;
  status.flowing = true;
  pumpScheduledEndMs = pumpStartMs + (unsigned long)(durationSeconds * 1000UL);

  if (epochNow > 0) {
    status.lastRunEpoch = epochNow;
    lastAutoRunEpoch = epochNow;
    prefs.begin(NVS_NS, false);
    prefs.putUInt(NVS_LAST_RUN, (uint32_t)epochNow);
    prefs.end();
  }

  curState = STATE_RUNNING;
}

void stateRunning(unsigned long now) {
  if (now >= pumpScheduledEndMs) {
    Serial.println("[PUMP] Scheduled duration complete");
    curState = STATE_STOPPING;
  }
  
  // Dynamic safety: If mid-run the level sensor signals low, force stop
  if (!sensors.levelValid || sensors.waterLevel == "LOW") {
    Serial.println("[SAFETY] Reservoir went low during run! Force shutdown.");
    enterFault(now, "DRY_RUN_TRIPPED");
  }
}

void stateStopping(unsigned long now) {
  unsigned long durMs = now - pumpStartMs;
  stopPumpCycle();
  pumpStartMs = 0;
  pumpScheduledEndMs = 0;
  Serial.printf("[PUMP] Stopped — runtime %.1fs\n", durMs / 1000.0f);

  bool flowed = status.fault == "OK" || status.fault.length() == 0;
  logPumpCycle(durMs / 1000.0f, flowed, status.fault);

  if (status.fault == "OK" || status.fault.length() == 0) {
    status.fault = "OK";
  }
  curState = STATE_IDLE;
}

void stateFault(unsigned long now) {
  if (status.pumpOn) {
    stopPumpCycle();
    Serial.println("[FAULT] Forced pump OFF");
  }
  if (now - faultStartMs >= FAULT_RETRY_MS) {
    Serial.println("[FAULT] Retry delay passed → RECOVERY");
    curState = STATE_RECOVERY;
  }
}

void stateRecovery(unsigned long now) {
  (void)now;
  Serial.println("[RECOVERY] Fault cleared → IDLE");
  status.fault = "OK";
  faultCode    = "OK";
  curState     = STATE_IDLE;
}

void stateManual(unsigned long now) {
  (void)now;
  if (motorManualMode == MANUAL_FORCE_ON) {
    setRelayState(PIN_PUMP_RELAY, true);
    status.pumpOn = true;
    status.flowing = true;
  } else if (motorManualMode == MANUAL_FORCE_OFF) {
    stopPumpCycle();
  }
}

void enterFault(unsigned long now, const char* code) {
  Serial.printf("[FAULT] Entered fault state: %s\n", code);
  faultCode    = String(code);
  status.fault = faultCode;
  faultStartMs = now;
  curState     = STATE_FAULT;
}

// ─────────────────────────────────────────────────────────────────────
//  SCHEDULING CALCULATIONS
// ─────────────────────────────────────────────────────────────────────
bool isTimeToWater() {
  if (!schedule.enabled) return false;
  time_t epochNow = getCurrentEpoch();
  if (epochNow < 1700000000UL) return false;

  struct tm t;
  localtime_r(&epochNow, &t);

  bool isDay = t.tm_hour >= schedule.startHour && t.tm_hour < schedule.endHour;
  if (!isDay && !schedule.nightEnabled) return false;

  time_t secondsSinceLastRun = epochNow - lastAutoRunEpoch;
  int intervalMinutes = schedule.intervalMinutes;
  int durationSeconds = schedule.durationSeconds;
  getActivePumpProfile(epochNow, intervalMinutes, durationSeconds);
  time_t intervalSeconds = (time_t)(intervalMinutes * 60 + durationSeconds);

  return (secondsSinceLastRun >= intervalSeconds);
}

void getActivePumpProfile(time_t epochNow, int& intervalMinutes, int& durationSeconds) {
  struct tm localTime = {};
  if (epochNow > 0 && localtime_r(&epochNow, &localTime)) {
    bool isDay = localTime.tm_hour >= schedule.startHour && localTime.tm_hour < schedule.endHour;
    if (isDay || !schedule.nightEnabled) {
      intervalMinutes = schedule.dayIntervalMinutes;
      durationSeconds = schedule.dayDurationSeconds;
      return;
    }
    intervalMinutes = schedule.nightIntervalMinutes;
    durationSeconds = schedule.nightDurationSeconds;
    return;
  }
  intervalMinutes = schedule.intervalMinutes;
  durationSeconds = schedule.durationSeconds;
}

// ─────────────────────────────────────────────────────────────────────
//  NVS READ/WRITE
// ─────────────────────────────────────────────────────────────────────
void loadScheduleFromNVS() {
  prefs.begin(NVS_NS, true);
  schedule.intervalMinutes = prefs.getInt(NVS_SCHED_INT, 10);
  schedule.durationSeconds = prefs.getInt(NVS_SCHED_DUR, 180);
  schedule.startHour       = prefs.getInt(NVS_SCHED_SH, 0);
  schedule.endHour         = prefs.getInt(NVS_SCHED_EH, 24);
  schedule.enabled         = prefs.getBool(NVS_SCHED_EN, true);
  schedule.nightEnabled    = prefs.getBool(NVS_NIGHT_EN, true);
  schedule.dayIntervalMinutes = prefs.getInt(NVS_SCHED_DAY_INT, 10);
  schedule.dayDurationSeconds = prefs.getInt(NVS_SCHED_DAY_DUR, 180);
  schedule.nightIntervalMinutes = prefs.getInt(NVS_SCHED_NIGHT_INT, 15);
  schedule.nightDurationSeconds = prefs.getInt(NVS_SCHED_NIGHT_DUR, 120);
  lastAutoRunEpoch         = prefs.getUInt(NVS_LAST_RUN, 0);
  prefs.end();
}

void saveScheduleToNVS() {
  prefs.begin(NVS_NS, false);
  prefs.putInt(NVS_SCHED_INT, schedule.intervalMinutes);
  prefs.putInt(NVS_SCHED_DUR, schedule.durationSeconds);
  prefs.putInt(NVS_SCHED_SH,  schedule.startHour);
  prefs.putInt(NVS_SCHED_EH,  schedule.endHour);
  prefs.putBool(NVS_SCHED_EN, schedule.enabled);
  prefs.putBool(NVS_NIGHT_EN, schedule.nightEnabled);
  prefs.putInt(NVS_SCHED_DAY_INT, schedule.dayIntervalMinutes);
  prefs.putInt(NVS_SCHED_DAY_DUR, schedule.dayDurationSeconds);
  prefs.putInt(NVS_SCHED_NIGHT_INT, schedule.nightIntervalMinutes);
  prefs.putInt(NVS_SCHED_NIGHT_DUR, schedule.nightDurationSeconds);
  prefs.end();
}

// ─────────────────────────────────────────────────────────────────────
//  API COMMUNICATION
// ─────────────────────────────────────────────────────────────────────
int httpRequest(const char* method, const char* path, const String& body = "") {
  if (!wifiConnected) return -1;
  HTTPClient http;
  http.setTimeout(API_TIMEOUT_MS);
  http.begin(String(API_BASE_URL) + path);
  http.addHeader("Content-Type", "application/json");
  String finalDeviceID = (deviceMacAddress.length() > 0) ? deviceMacAddress : String(DEVICE_ID);
  http.addHeader("X-Device-ID",  finalDeviceID);
  http.addHeader("X-API-Key",    DEVICE_SECRET);
  http.addHeader("Connection",   "close");
  int code = -1;
  if (strcmp(method, "POST") == 0) code = http.POST(body);
  if (strcmp(method, "PUT")  == 0) code = http.PUT(body);
  http.end();
  Serial.printf("[API] %s %s -> HTTP %d\n", method, path, code);
  return code;
}

bool fetchHandshakeAndSync() {
  if (!wifiConnected) return false;
  HTTPClient http;
  http.setTimeout(API_TIMEOUT_MS);
  http.begin(String(API_BASE_URL) + "/api/device/handshake");
  String finalDeviceID = (deviceMacAddress.length() > 0) ? deviceMacAddress : String(DEVICE_ID);
  http.addHeader("X-Device-ID", finalDeviceID);
  http.addHeader("X-API-Key",   DEVICE_SECRET);
  http.addHeader("Connection",  "close");

  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;
  }

  String resp = http.getString();
  http.end();

  // Extract schedule details
  int ni = extractJsonInt(resp, "intervalMinutes");
  int nd = extractJsonInt(resp, "durationSeconds");
  int ns = extractJsonInt(resp, "startHour");
  int ne = extractJsonInt(resp, "endHour");
  int dDayInt = extractJsonInt(resp, "dayIntervalMinutes");
  int dDayDur = extractJsonInt(resp, "dayDurationSeconds");
  int dNightInt = extractJsonInt(resp, "nightIntervalMinutes");
  int dNightDur = extractJsonInt(resp, "nightDurationSeconds");
  bool nightEnabled = extractJsonBool(resp, "nightEnabled", true);
  bool enabled = extractJsonBool(resp, "enabled", true);

  if (ni > 0 && ni <= 1440 && nd > 0 && nd <= 600) {
    bool changed = (ni != schedule.intervalMinutes || nd != schedule.durationSeconds ||
                    ns != schedule.startHour || ne != schedule.endHour ||
                    enabled != schedule.enabled || nightEnabled != schedule.nightEnabled);

    schedule.intervalMinutes = ni;
    schedule.durationSeconds = nd;
    schedule.startHour = ns;
    schedule.endHour = ne;
    schedule.enabled = enabled;
    schedule.nightEnabled = nightEnabled;

    if (dDayInt > 0) schedule.dayIntervalMinutes = dDayInt;
    if (dDayDur > 0) schedule.dayDurationSeconds = dDayDur;
    if (dNightInt > 0) schedule.nightIntervalMinutes = dNightInt;
    if (dNightDur > 0) schedule.nightDurationSeconds = dNightDur;

    if (changed) {
      saveScheduleToNVS();
      Serial.println("[API] Schedule synced from backend");
    }
  }

  // Extract motor mode
  String pm = extractJsonString(resp, "motorManualMode");
  if (pm.length() > 0) {
    ManualMode newMode = MANUAL_AUTO;
    if (pm == "FORCED_ON") newMode = MANUAL_FORCE_ON;
    if (pm == "FORCED_OFF") newMode = MANUAL_FORCE_OFF;
    if (newMode != motorManualMode) {
      motorManualMode = newMode;
      Serial.printf("[API] Remote motor mode: %s\n", pm.c_str());
    }
  }

  // Extract dynamic pin assignments
  int p_pump  = extractJsonInt(resp, "pin_pump_relay");
  int p_motor = extractJsonInt(resp, "pin_motor_button");
  bool pinChanged = false;
  if (p_pump > 0 && p_pump != PIN_PUMP_RELAY) { PIN_PUMP_RELAY = p_pump; pinChanged = true; }
  if (p_motor > 0 && p_motor != PIN_MOTOR_BUTTON) { PIN_MOTOR_BUTTON = p_motor; pinChanged = true; }
  if (pinChanged) {
    Serial.println("[GPIO] Re-configuring ESP32 pins from backend handshake...");
    setupPinModes();
  }

  // Extract status of remote sensors (pH, level, etc.) for safety check
  sensors.waterLevel = extractJsonString(resp, "waterLevel");
  sensors.levelValid = extractJsonBool(resp, "levelSensorOk", true);

  // Sync serverTime
  String stStr = extractJsonNumber(resp, "serverTime");
  if (stStr.length() > 0) {
    long long serverTimeMs = atoll(stStr.c_str());
    time_t serverTimeSec = (time_t)(serverTimeMs / 1000LL);
    if (serverTimeSec > 1700000000UL) {
      struct timeval tv;
      tv.tv_sec = serverTimeSec;
      tv.tv_usec = 0;
      settimeofday(&tv, NULL);
    }
  }

  return true;
}

void postStatus() {
  if (!wifiConnected) return;

  String body = "{";
  body += "\"pumpOn\":"           + String(status.pumpOn ? "true" : "false") + ",";
  body += "\"flowing\":"          + String(status.flowing ? "true" : "false") + ",";
  body += "\"state\":\""          + String(STATE_NAMES[curState]) + "\",";
  body += "\"fault\":\""          + status.fault + "\",";
  body += "\"motorManualMode\":\"" + String(motorManualMode == MANUAL_FORCE_ON ? "FORCED_ON" :
                                            (motorManualMode == MANUAL_FORCE_OFF ? "FORCED_OFF" : "AUTO")) + "\"";
  body += "}";

  httpRequest("PUT", "/api/status", body);
}

void logPumpCycle(float durationSec, bool flowed, String fault) {
  if (!wifiConnected) return;
  String body = "{";
  body += "\"timestamp\":"       + String((uint32_t)getCurrentEpoch()) + ",";
  body += "\"durationSeconds\":" + String((uint32_t)durationSec) + ",";
  body += "\"flowed\":"          + String(flowed ? "true" : "false") + ",";
  body += "\"fault\":\""         + fault + "\"";
  body += "}";

  httpRequest("POST", "/api/pump-log", body);
}

// ─────────────────────────────────────────────────────────────────────
//  JSON HELPERS
// ─────────────────────────────────────────────────────────────────────
int findJsonKey(const String& json, const char* key) {
  int keyLen = strlen(key);
  int idx = 0;
  while (true) {
    idx = json.indexOf(key, idx);
    if (idx < 0) return -1;
    bool validStart = false;
    if (idx > 0) {
      char prev = json[idx - 1];
      if (prev == '"' || prev == '\'' || (!isalnum(prev) && prev != '_')) validStart = true;
    } else {
      validStart = true;
    }
    bool validEnd = false;
    int endIdx = idx + keyLen;
    if (endIdx < (int)json.length()) {
      char next = json[endIdx];
      if (next == '"' || next == '\'' || (!isalnum(next) && next != '_')) validEnd = true;
    } else {
      validEnd = true;
    }
    if (validStart && validEnd) {
      int colonIdx = endIdx;
      if (idx > 0 && json[idx - 1] == '"' && json[endIdx] == '"') colonIdx++;
      else if (idx > 0 && json[idx - 1] == '\'' && json[endIdx] == '\'') colonIdx++;
      while (colonIdx < (int)json.length() && isspace((unsigned char)colonIdx)) colonIdx++;
      if (colonIdx < (int)json.length() && json[colonIdx] == ':') return colonIdx + 1;
    }
    idx += keyLen;
  }
}

String extractJsonValue(const String& json, const char* key) {
  int idx = findJsonKey(json, key);
  if (idx < 0) return "";
  while (idx < (int)json.length() && isspace((unsigned char)json[idx])) idx++;
  if (idx >= (int)json.length()) return "";
  char quote = 0;
  if (json[idx] == '"' || json[idx] == '\'') {
    quote = json[idx];
    idx++;
  }
  String val = "";
  if (quote != 0) {
    while (idx < (int)json.length()) {
      if (json[idx] == '\\' && idx + 1 < (int)json.length()) {
        val += json[idx + 1];
        idx += 2;
      } else if (json[idx] == quote) {
        break;
      } else {
        val += json[idx++];
      }
    }
  } else {
    while (idx < (int)json.length()) {
      char c = json[idx];
      if (c == ',' || c == '}' || c == ']' || isspace((unsigned char)c)) break;
      val += c;
      idx++;
    }
  }
  return val;
}

int extractJsonInt(const String& json, const char* key) {
  String val = extractJsonValue(json, key);
  if (val.length() == 0) return -1;
  if (val == "true") return 1;
  if (val == "false") return 0;
  return val.toInt();
}

String extractJsonString(const String& json, const char* key) {
  return extractJsonValue(json, key);
}

String extractJsonNumber(const String& json, const char* key) {
  return extractJsonValue(json, key);
}

bool extractJsonBool(const String& json, const char* key, bool defaultVal) {
  String val = extractJsonValue(json, key);
  if (val == "true") return true;
  if (val == "false") return false;
  return defaultVal;
}

time_t getCurrentEpoch() {
  return time(nullptr);
}
