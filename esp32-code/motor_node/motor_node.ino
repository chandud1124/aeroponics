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

// Relay active state (LOW for active low relays)
#define RELAY_ACTIVE_HIGH false

// ─────────────────────────────────────────────────────────────────────
//  FORWARD DECLARATIONS & CONSTANTS
// ─────────────────────────────────────────────────────────────────────
void postStatus();
bool fetchHandshakeAndSync();
void logPumpCycle(float durationSec, bool flowed, String fault, int pumpIndex);

int findJsonKey(const String& json, const char* key);
String extractJsonValue(const String& json, const char* key);
int extractJsonInt(const String& json, const char* key);
String extractJsonString(const String& json, const char* key);
String extractJsonNumber(const String& json, const char* key);
bool extractJsonBool(const String& json, const char* key, bool defaultVal);
time_t getCurrentEpoch();

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
bool wifiConnected   = false;
bool ntpSynced       = false;
String deviceMacAddress = "";

unsigned long tsLastScheduleFetch  = 0;
unsigned long tsLastStatusPost     = 0;
unsigned long tsLastWifiCheck      = 0;
unsigned long tsLastWifiAttempt    = 0;
unsigned long tsLastWdtFeed        = 0;
unsigned long wifiBackoffMs        = 5000UL;

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
};

// Status & sensors
struct MotorStatus {
  bool pumpOn        = false;
  bool flowing       = false;
  String fault       = "OK";
  time_t lastRunEpoch = 0;
};

struct RemoteSensors {
  String waterLevel = "MEDIUM";
  bool levelValid   = true;
  bool valid        = true;
} sensors;

struct LogEntry {
  time_t timestamp;
  uint16_t durationSeconds;
  bool flowed;
  char fault[16];
};

// ─────────────────────────────────────────────────────────────────────
//  PUMP ENGINE CLASS (DUAL PUMP STATE MACHINES)
// ─────────────────────────────────────────────────────────────────────
struct PumpEngine {
  int pumpIndex;
  int pinPumpRelay;
  int pinMotorButton;
  
  PumpState curState = STATE_IDLE;
  PumpState prevState = STATE_IDLE;
  ManualMode motorManualMode = MANUAL_AUTO;
  
  PumpSchedule schedule;
  MotorStatus status;
  
  time_t lastAutoRunEpoch = 0;
  unsigned long pumpStartMs = 0;
  unsigned long pumpScheduledEndMs = 0;
  unsigned long faultStartMs = 0;
  String faultCode = "OK";
  bool lastPumpOnState = false;

  // Button Debouncing
  unsigned long btnLastDebounceMs = 0;
  bool btnLastReading = HIGH;
  bool btnState = HIGH;

  const char* nvsNs;

  void init(int pumpIdx, int defaultRelayPin, int defaultBtnPin, const char* ns) {
    pumpIndex = pumpIdx;
    pinPumpRelay = defaultRelayPin;
    pinMotorButton = defaultBtnPin;
    nvsNs = ns;
  }

  void setupPins() {
    if (pinPumpRelay > 0) {
      pinMode(pinPumpRelay, OUTPUT);
      stopPumpCycle();
    }
    if (pinMotorButton > 0) {
      pinMode(pinMotorButton, INPUT_PULLUP);
    }
  }

  void stopPumpCycle() {
    if (pinPumpRelay > 0) {
      bool level = RELAY_ACTIVE_HIGH ? false : true;
      digitalWrite(pinPumpRelay, level);
    }
    status.pumpOn = false;
    status.flowing = false;
  }

  void startPumpCycle() {
    if (pinPumpRelay > 0) {
      bool level = RELAY_ACTIVE_HIGH ? true : false;
      digitalWrite(pinPumpRelay, level);
    }
    status.pumpOn = true;
    status.flowing = true;
  }

  void handleManualButtons(unsigned long now) {
    if (pinMotorButton <= 0) return;
    bool readVal = digitalRead(pinMotorButton);
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
            Serial.printf("[Button P%d] Forced Pump OFF\n", pumpIndex);
          } else if (motorManualMode == MANUAL_FORCE_OFF) {
            motorManualMode = MANUAL_AUTO;
            Serial.printf("[Button P%d] Resumed Auto Schedule\n", pumpIndex);
          } else {
            motorManualMode = MANUAL_FORCE_ON;
            Serial.printf("[Button P%d] Forced Pump ON\n", pumpIndex);
          }
        }
      }
    }
  }

  void loadScheduleFromNVS() {
    Preferences p;
    p.begin(nvsNs, true);
    schedule.intervalMinutes = p.getInt("schedInt", 10);
    schedule.durationSeconds = p.getInt("schedDur", 180);
    schedule.startHour       = p.getInt("schedSH", 0);
    schedule.endHour         = p.getInt("schedEH", 24);
    schedule.enabled         = p.getBool("schedEn", true);
    schedule.nightEnabled    = p.getBool("nightEnabled", true);
    schedule.dayIntervalMinutes = p.getInt("schedDayInt", 10);
    schedule.dayDurationSeconds = p.getInt("schedDayDur", 180);
    schedule.nightIntervalMinutes = p.getInt("schedNightInt", 15);
    schedule.nightDurationSeconds = p.getInt("schedNightDur", 120);
    lastAutoRunEpoch         = p.getUInt("lastRun", 0);
    p.end();
  }

  void saveScheduleToNVS() {
    Preferences p;
    p.begin(nvsNs, false);
    p.putInt("schedInt", schedule.intervalMinutes);
    p.putInt("schedDur", schedule.durationSeconds);
    p.putInt("schedSH",  schedule.startHour);
    p.putInt("schedEH",  schedule.endHour);
    p.putBool("schedEn", schedule.enabled);
    p.putBool("nightEnabled", schedule.nightEnabled);
    p.putInt("schedDayInt", schedule.dayIntervalMinutes);
    p.putInt("schedDayDur", schedule.dayDurationSeconds);
    p.putInt("schedNightInt", schedule.nightIntervalMinutes);
    p.putInt("schedNightDur", schedule.nightDurationSeconds);
    p.end();
  }

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

  void enterFault(unsigned long now, const char* code) {
    Serial.printf("[FAULT P%d] Entered fault state: %s\n", pumpIndex, code);
    faultCode    = String(code);
    status.fault = faultCode;
    faultStartMs = now;
    curState     = STATE_FAULT;
  }

  void runStateMachine(unsigned long now) {
    if (pinPumpRelay <= 0) return;

    if (motorManualMode != MANUAL_AUTO) {
      if (curState != STATE_MANUAL_MODE) {
        Serial.printf("[SM P%d] → MANUAL_MODE\n", pumpIndex);
        curState = STATE_MANUAL_MODE;
      }
      stateManual(now);
      return;
    }

    if (curState == STATE_MANUAL_MODE) {
      Serial.printf("[SM P%d] MANUAL_MODE → IDLE\n", pumpIndex);
      stopPumpCycle();
      curState = STATE_IDLE;
    }

    if (curState != prevState) {
      Serial.printf("[SM P%d] %s → %s\n", pumpIndex, STATE_NAMES[prevState], STATE_NAMES[curState]);
      prevState = curState;
    }

    switch (curState) {
      case STATE_IDLE: {
        if (!schedule.enabled) return;
        if (isTimeToWater()) {
          Serial.printf("[SCHED P%d] Time to water — starting cycle\n", pumpIndex);
          curState = STATE_CHECK_WATER;
        }
        break;
      }
      case STATE_CHECK_WATER: {
        if (!sensors.levelValid || sensors.waterLevel == "LOW") {
          Serial.printf("[CHECK P%d] Reservoir level unsafe — blocking pump\n", pumpIndex);
          enterFault(now, sensors.levelValid ? "LOW_WATER" : "LEVEL_SENSOR_FAIL");
          return;
        }
        pumpStartMs = now;
        curState    = STATE_PUMP_ON;
        break;
      }
      case STATE_PUMP_ON: {
        time_t epochNow = getCurrentEpoch();
        int intervalMinutes = schedule.intervalMinutes;
        int durationSeconds = schedule.durationSeconds;
        getActivePumpProfile(epochNow, intervalMinutes, durationSeconds);
        Serial.printf("[PUMP P%d] Starting Relay Pin %d — duration %ds\n", pumpIndex, pinPumpRelay, durationSeconds);
        startPumpCycle();
        pumpScheduledEndMs = pumpStartMs + (unsigned long)(durationSeconds * 1000UL);

        if (epochNow > 0) {
          status.lastRunEpoch = epochNow;
          lastAutoRunEpoch = epochNow;
          Preferences p;
          p.begin(nvsNs, false);
          p.putUInt("lastRun", (uint32_t)epochNow);
          p.end();
        }

        curState = STATE_RUNNING;
        break;
      }
      case STATE_RUNNING: {
        if (now >= pumpScheduledEndMs) {
          Serial.printf("[PUMP P%d] Scheduled duration complete\n", pumpIndex);
          curState = STATE_STOPPING;
        }
        
        if (!sensors.levelValid || sensors.waterLevel == "LOW") {
          Serial.printf("[SAFETY P%d] Reservoir went low during run! Force shutdown.\n", pumpIndex);
          enterFault(now, "DRY_RUN_TRIPPED");
        }
        break;
      }
      case STATE_STOPPING: {
        unsigned long durMs = now - pumpStartMs;
        stopPumpCycle();
        pumpStartMs = 0;
        pumpScheduledEndMs = 0;
        Serial.printf("[PUMP P%d] Stopped — runtime %.1fs\n", pumpIndex, durMs / 1000.0f);

        bool flowed = status.fault == "OK" || status.fault.length() == 0;
        logPumpCycle(durMs / 1000.0f, flowed, status.fault, pumpIndex);

        if (status.fault == "OK" || status.fault.length() == 0) {
          status.fault = "OK";
        }
        curState = STATE_IDLE;
        break;
      }
      case STATE_FAULT: {
        if (status.pumpOn) {
          stopPumpCycle();
          Serial.printf("[FAULT P%d] Forced pump OFF\n", pumpIndex);
        }
        if (now - faultStartMs >= FAULT_RETRY_MS) {
          Serial.printf("[FAULT P%d] Retry delay passed → RECOVERY\n", pumpIndex);
          curState = STATE_RECOVERY;
        }
        break;
      }
      case STATE_RECOVERY: {
        Serial.printf("[RECOVERY P%d] Fault cleared → IDLE\n", pumpIndex);
        status.fault = "OK";
        faultCode    = "OK";
        curState     = STATE_IDLE;
        break;
      }
      case STATE_MANUAL_MODE: {
        stateManual(now);
        break;
      }
      default: break;
    }
  }

  void stateManual(unsigned long now) {
    (void)now;
    if (motorManualMode == MANUAL_FORCE_ON) {
      startPumpCycle();
    } else if (motorManualMode == MANUAL_FORCE_OFF) {
      stopPumpCycle();
    }
  }
};

PumpEngine pump1;
PumpEngine pump2;

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

  pump1.init(1, 27, 19, "pump1");
  pump2.init(2, -1, -1, "pump2");

  pump1.loadScheduleFromNVS();
  pump2.loadScheduleFromNVS();

  pump1.setupPins();
  pump2.setupPins();

  // Watchdog
  esp_task_wdt_config_t wdtCfg = {
    .timeout_ms     = 45000,
    .idle_core_mask = 0,
    .trigger_panic  = true
  };
  esp_task_wdt_reconfigure(&wdtCfg);
  esp_task_wdt_add(NULL);
  Serial.println("[WDT] Watchdog enabled (45s)");

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
  pump1.handleManualButtons(now);
  pump2.handleManualButtons(now);

  // State Machine run
  pump1.runStateMachine(now);
  pump2.runStateMachine(now);

  // Status Posting
  bool stateChanged = (pump1.status.pumpOn != pump1.lastPumpOnState || pump2.status.pumpOn != pump2.lastPumpOnState);
  unsigned long statusPostInterval = (pump1.status.pumpOn || pump2.status.pumpOn) ? 5000UL : 60000UL;
  if (stateChanged || (now - tsLastStatusPost >= statusPostInterval)) {
    postStatus();
    tsLastStatusPost = now;
    pump1.lastPumpOnState = pump1.status.pumpOn;
    pump2.lastPumpOnState = pump2.status.pumpOn;
  }

  yield();
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

  // Sync Pump 1 schedule details
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
    bool changed = (ni != pump1.schedule.intervalMinutes || nd != pump1.schedule.durationSeconds ||
                    ns != pump1.schedule.startHour || ne != pump1.schedule.endHour ||
                    enabled != pump1.schedule.enabled || nightEnabled != pump1.schedule.nightEnabled);

    pump1.schedule.intervalMinutes = ni;
    pump1.schedule.durationSeconds = nd;
    pump1.schedule.startHour = ns;
    pump1.schedule.endHour = ne;
    pump1.schedule.enabled = enabled;
    pump1.schedule.nightEnabled = nightEnabled;

    if (dDayInt > 0) pump1.schedule.dayIntervalMinutes = dDayInt;
    if (dDayDur > 0) pump1.schedule.dayDurationSeconds = dDayDur;
    if (dNightInt > 0) pump1.schedule.nightIntervalMinutes = dNightInt;
    if (dNightDur > 0) pump1.schedule.nightDurationSeconds = dNightDur;

    if (changed) {
      pump1.saveScheduleToNVS();
      Serial.println("[API] Pump 1 Schedule synced from backend");
    }
  }

  // Sync Pump 2 schedule details
  int ni2 = extractJsonInt(resp, "intervalMinutes_2");
  int nd2 = extractJsonInt(resp, "durationSeconds_2");
  int dDayInt2 = extractJsonInt(resp, "dayIntervalMinutes_2");
  int dDayDur2 = extractJsonInt(resp, "dayDurationSeconds_2");
  int dNightInt2 = extractJsonInt(resp, "nightIntervalMinutes_2");
  int dNightDur2 = extractJsonInt(resp, "nightDurationSeconds_2");
  bool enabled2 = extractJsonBool(resp, "enabled_2", true);

  if (ni2 > 0 && ni2 <= 1440 && nd2 > 0 && nd2 <= 600) {
    bool changed = (ni2 != pump2.schedule.intervalMinutes || nd2 != pump2.schedule.durationSeconds ||
                    ns != pump2.schedule.startHour || ne != pump2.schedule.endHour ||
                    enabled2 != pump2.schedule.enabled || nightEnabled != pump2.schedule.nightEnabled);

    pump2.schedule.intervalMinutes = ni2;
    pump2.schedule.durationSeconds = nd2;
    pump2.schedule.startHour = ns;
    pump2.schedule.endHour = ne;
    pump2.schedule.enabled = enabled2;
    pump2.schedule.nightEnabled = nightEnabled;

    if (dDayInt2 > 0) pump2.schedule.dayIntervalMinutes = dDayInt2;
    if (dDayDur2 > 0) pump2.schedule.dayDurationSeconds = dDayDur2;
    if (dNightInt2 > 0) pump2.schedule.nightIntervalMinutes = dNightInt2;
    if (dNightDur2 > 0) pump2.schedule.nightDurationSeconds = dNightDur2;

    if (changed) {
      pump2.saveScheduleToNVS();
      Serial.println("[API] Pump 2 Schedule synced from backend");
    }
  }

  // Extract motor mode
  String pm = extractJsonString(resp, "motorManualMode");
  if (pm.length() > 0) {
    ManualMode newMode = MANUAL_AUTO;
    if (pm == "FORCED_ON") newMode = MANUAL_FORCE_ON;
    if (pm == "FORCED_OFF") newMode = MANUAL_FORCE_OFF;
    if (newMode != pump1.motorManualMode) {
      pump1.motorManualMode = newMode;
      Serial.printf("[API] Remote pump 1 mode: %s\n", pm.c_str());
    }
  }

  String pm2 = extractJsonString(resp, "motorManualMode_2");
  if (pm2.length() > 0) {
    ManualMode newMode = MANUAL_AUTO;
    if (pm2 == "FORCED_ON") newMode = MANUAL_FORCE_ON;
    if (pm2 == "FORCED_OFF") newMode = MANUAL_FORCE_OFF;
    if (newMode != pump2.motorManualMode) {
      pump2.motorManualMode = newMode;
      Serial.printf("[API] Remote pump 2 mode: %s\n", pm2.c_str());
    }
  }

  // Extract dynamic pin assignments
  int p_pump  = extractJsonInt(resp, "pin_pump_relay");
  int p_pump2 = extractJsonInt(resp, "pin_pump_relay_2");
  int p_motor = extractJsonInt(resp, "pin_motor_button");
  int p_motor2 = extractJsonInt(resp, "pin_motor_button_2");
  
  bool pinChanged = false;
  if (p_pump > 0 && p_pump != pump1.pinPumpRelay) { pump1.pinPumpRelay = p_pump; pinChanged = true; }
  if (p_pump2 >= 0 && p_pump2 != pump2.pinPumpRelay) { pump2.pinPumpRelay = p_pump2; pinChanged = true; }
  if (p_motor > 0 && p_motor != pump1.pinMotorButton) { pump1.pinMotorButton = p_motor; pinChanged = true; }
  if (p_motor2 >= 0 && p_motor2 != pump2.pinMotorButton) { pump2.pinMotorButton = p_motor2; pinChanged = true; }
  
  if (pinChanged) {
    Serial.println("[GPIO] Re-configuring ESP32 pins from backend handshake...");
    pump1.setupPins();
    pump2.setupPins();
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
  body += "\"pumpOn\":"           + String(pump1.status.pumpOn ? "true" : "false") + ",";
  body += "\"flowing\":"          + String(pump1.status.flowing ? "true" : "false") + ",";
  body += "\"state\":\""          + String(STATE_NAMES[pump1.curState]) + "\",";
  body += "\"fault\":\""          + pump1.status.fault + "\",";
  body += "\"motorManualMode\":\"" + String(pump1.motorManualMode == MANUAL_FORCE_ON ? "FORCED_ON" :
                                            (pump1.motorManualMode == MANUAL_FORCE_OFF ? "FORCED_OFF" : "AUTO")) + "\",";
  
  body += "\"pumpOn_2\":"         + String(pump2.status.pumpOn ? "true" : "false") + ",";
  body += "\"flowing_2\":"        + String(pump2.status.flowing ? "true" : "false") + ",";
  body += "\"state_2\":\""        + String(STATE_NAMES[pump2.curState]) + "\",";
  body += "\"motorManualMode_2\":\"" + String(pump2.motorManualMode == MANUAL_FORCE_ON ? "FORCED_ON" :
                                              (pump2.motorManualMode == MANUAL_FORCE_OFF ? "FORCED_OFF" : "AUTO")) + "\"";
  body += "}";

  httpRequest("PUT", "/api/status", body);
}

void logPumpCycle(float durationSec, bool flowed, String fault, int pumpIndex) {
  if (!wifiConnected) return;
  String body = "{";
  body += "\"timestamp\":"       + String((uint32_t)getCurrentEpoch()) + ",";
  body += "\"durationSeconds\":" + String((uint32_t)durationSec) + ",";
  body += "\"flowed\":"          + String(flowed ? "true" : "false") + ",";
  body += "\"fault\":\""         + fault + "\",";
  body += "\"pumpIndex\":"       + String(pumpIndex);
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
