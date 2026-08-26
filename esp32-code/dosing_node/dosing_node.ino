#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

enum ManualMode {
  MANUAL_AUTO = 0,
  MANUAL_FORCE_ON = 1,
  MANUAL_FORCE_OFF = 2
};

// ─────────────────────────────────────────────────────────────────────
//  PIN ASSIGNMENTS (BOOT DEFAULTS AND DYNAMIC OVERRIDES)
// ─────────────────────────────────────────────────────────────────────
int PIN_PH_DOWN_RELAY     = 25;
int PIN_NUTRITION_A_RELAY = 33;
int PIN_NUTRITION_B_RELAY = 26;

// Relay active state (LOW for active low relays)
#define RELAY_ACTIVE_HIGH false

// ─────────────────────────────────────────────────────────────────────
//  FORWARD DECLARATIONS & CONSTANTS
// ─────────────────────────────────────────────────────────────────────
void manageNutritionAndPhDosing();
void postStatus();
bool fetchHandshakeAndSync();
void setupPinModes();
void setRelayState(int pin, bool on);

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

// Globals
Preferences prefs;
const char* NVS_NS         = "dosingNode";
const char* NVS_NUTRI_EN   = "nutriEn";
const char* NVS_TARGET_PH  = "targetPh";
const char* NVS_TARGET_EC  = "targetEc";
const char* NVS_PH_DOSE_SEC = "phDoseSec";
const char* NVS_PH_COOLDOWN = "phCool";
const char* NVS_EC_DOSE_SEC = "ecDoseSec";
const char* NVS_EC_COOLDOWN = "ecCool";

bool wifiConnected   = false;
bool ntpSynced       = false;
String deviceMacAddress = "";

unsigned long tsLastScheduleFetch  = 0;
unsigned long tsLastStatusPost     = 0;
unsigned long tsLastWifiCheck      = 0;
unsigned long tsLastWifiAttempt    = 0;
unsigned long tsLastWdtFeed        = 0;
unsigned long wifiBackoffMs        = 5000UL;

// Manual Modes
ManualMode phManualMode        = MANUAL_AUTO;
ManualMode nutritionManualMode = MANUAL_AUTO;

// Schedule targets
struct DosingSchedule {
  bool nutritionEnabled      = true;
  float targetPh             = 6.0f;
  float targetEc             = 1.2f;
  int phDoseSeconds          = 5;
  int phDoseIntervalMinutes  = 30;
  int ecDoseSeconds          = 10;
  int ecDoseIntervalMinutes  = 30;
} schedule;

// Status & sensors
struct DosingStatus {
  bool phDosingOn          = false;
  bool nutritionADosingOn  = false;
  bool nutritionBDosingOn  = false;
  float phValue            = 7.0f;
  float ecValue            = 1.0f;
  String waterLevel        = "MEDIUM";
  bool levelValid          = true;
} status;

// Timestamps for cooldowns
unsigned long tsLastPhDosingMs = 0;
unsigned long tsLastEcDosingMs = 0;
unsigned long phDoseStopMs     = 0;
unsigned long ecDoseStopMs     = 0;

bool lastPhDosingOnState         = false;
bool lastNutritionADosingOnState = false;

// ─────────────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (millis() - t0 < 300) yield();

  Serial.println(F("\n╔══════════════════════════════════════╗"));
  Serial.println(F("║      TOWER GARDEN — DOSING NODE      ║"));
  Serial.println(F("╚══════════════════════════════════════╝\n"));

  setupPinModes();
  // Ensure all pumps are OFF initially
  setRelayState(PIN_PH_DOWN_RELAY, false);
  setRelayState(PIN_NUTRITION_A_RELAY, false);
  setRelayState(PIN_NUTRITION_B_RELAY, false);

  // Watchdog
  esp_task_wdt_config_t wdtCfg = {
    .timeout_ms     = 45000,
    .idle_core_mask = 0,
    .trigger_panic  = true
  };
  esp_task_wdt_reconfigure(&wdtCfg);
  esp_task_wdt_add(NULL);
  Serial.println("[WDT] Watchdog enabled (45s)");

  // Load target config
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

  // Handshake fetch (runs every 60s)
  if (now - tsLastScheduleFetch >= IV_SCHEDULE) {
    fetchHandshakeAndSync();
    tsLastScheduleFetch = now;
  }

  // Automated/manual dosing control loops
  manageNutritionAndPhDosing();

  // Status Posting
  bool stateChanged = (status.phDosingOn != lastPhDosingOnState) ||
                      (status.nutritionADosingOn != lastNutritionADosingOnState);
  unsigned long statusPostInterval = (status.phDosingOn || status.nutritionADosingOn) ? 3000UL : 60000UL;
  if (stateChanged || (now - tsLastStatusPost >= statusPostInterval)) {
    postStatus();
    tsLastStatusPost = now;
    lastPhDosingOnState = status.phDosingOn;
    lastNutritionADosingOnState = status.nutritionADosingOn;
  }

  yield();
}

// ─────────────────────────────────────────────────────────────────────
//  RELAY OPERATIONS
// ─────────────────────────────────────────────────────────────────────
void setupPinModes() {
  pinMode(PIN_PH_DOWN_RELAY, OUTPUT);
  pinMode(PIN_NUTRITION_A_RELAY, OUTPUT);
  pinMode(PIN_NUTRITION_B_RELAY, OUTPUT);
}

void setRelayState(int pin, bool on) {
  bool level = RELAY_ACTIVE_HIGH ? on : !on;
  digitalWrite(pin, level);
}

// ─────────────────────────────────────────────────────────────────────
//  DOSING CONTROL LOOP
// ─────────────────────────────────────────────────────────────────────
void manageNutritionAndPhDosing() {
  // Safety lockout: never dose with low or unavailable level telemetry.
  if (!status.levelValid || status.waterLevel == "LOW") {
    setRelayState(PIN_NUTRITION_A_RELAY, false);
    setRelayState(PIN_NUTRITION_B_RELAY, false);
    setRelayState(PIN_PH_DOWN_RELAY, false);
    status.nutritionADosingOn = false;
    status.nutritionBDosingOn = false;
    status.phDosingOn = false;
    phDoseStopMs = 0;
    ecDoseStopMs = 0;
    return;
  }

  // ── pH Down Control ────────────────────────────────────────────────
  if (phManualMode == MANUAL_FORCE_ON) {
    setRelayState(PIN_PH_DOWN_RELAY, true);
    status.phDosingOn = true;
  } else if (phManualMode == MANUAL_FORCE_OFF) {
    setRelayState(PIN_PH_DOWN_RELAY, false);
    status.phDosingOn = false;
    phDoseStopMs = 0;
  } else {
    // AUTO pH Dosing Mode
    if (phDoseStopMs > 0) {
      if (millis() >= phDoseStopMs) {
        setRelayState(PIN_PH_DOWN_RELAY, false);
        status.phDosingOn = false;
        phDoseStopMs = 0;
        tsLastPhDosingMs = millis();
        Serial.println("[DOSING] Auto pH Dosing Pulse Complete.");
      } else {
        setRelayState(PIN_PH_DOWN_RELAY, true);
        status.phDosingOn = true;
      }
    } else if (schedule.nutritionEnabled) {
      // Auto trigger pH Down if pH goes above threshold (target + 0.3)
      if (status.phValue > schedule.targetPh + 0.3f) {
        unsigned long cooldown = (unsigned long)schedule.phDoseIntervalMinutes * 60 * 1000;
        if (tsLastPhDosingMs == 0 || (millis() - tsLastPhDosingMs >= cooldown)) {
          phDoseStopMs = millis() + ((unsigned long)schedule.phDoseSeconds * 1000);
          setRelayState(PIN_PH_DOWN_RELAY, true);
          status.phDosingOn = true;
          Serial.printf("[DOSING] Auto pH Dosing Triggered for %ds\n", schedule.phDoseSeconds);
        }
      }
    }
  }

  // ── Nutrition Pumps Control ────────────────────────────────────────
  if (nutritionManualMode == MANUAL_FORCE_ON) {
    setRelayState(PIN_NUTRITION_A_RELAY, true);
    setRelayState(PIN_NUTRITION_B_RELAY, true);
    status.nutritionADosingOn = true;
    status.nutritionBDosingOn = true;
  } else if (nutritionManualMode == MANUAL_FORCE_OFF) {
    setRelayState(PIN_NUTRITION_A_RELAY, false);
    setRelayState(PIN_NUTRITION_B_RELAY, false);
    status.nutritionADosingOn = false;
    status.nutritionBDosingOn = false;
    ecDoseStopMs = 0;
  } else {
    // AUTO Nutrition Dosing Mode
    if (ecDoseStopMs > 0) {
      if (millis() >= ecDoseStopMs) {
        setRelayState(PIN_NUTRITION_A_RELAY, false);
        setRelayState(PIN_NUTRITION_B_RELAY, false);
        status.nutritionADosingOn = false;
        status.nutritionBDosingOn = false;
        ecDoseStopMs = 0;
        tsLastEcDosingMs = millis();
        Serial.println("[DOSING] Auto Nutrient Dosing Pulse Complete.");
      } else {
        setRelayState(PIN_NUTRITION_A_RELAY, true);
        setRelayState(PIN_NUTRITION_B_RELAY, true);
        status.nutritionADosingOn = true;
        status.nutritionBDosingOn = true;
      }
    } else if (schedule.nutritionEnabled) {
      // Auto trigger Nutrient dosing if EC goes below threshold (target - 0.2)
      if (status.ecValue < schedule.targetEc - 0.2f) {
        unsigned long cooldown = (unsigned long)schedule.ecDoseIntervalMinutes * 60 * 1000;
        if (tsLastEcDosingMs == 0 || (millis() - tsLastEcDosingMs >= cooldown)) {
          ecDoseStopMs = millis() + ((unsigned long)schedule.ecDoseSeconds * 1000);
          setRelayState(PIN_NUTRITION_A_RELAY, true);
          setRelayState(PIN_NUTRITION_B_RELAY, true);
          status.nutritionADosingOn = true;
          status.nutritionBDosingOn = true;
          Serial.printf("[DOSING] Auto Nutrient Dosing Triggered for %ds\n", schedule.ecDoseSeconds);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
//  NVS CONFIG
// ─────────────────────────────────────────────────────────────────────
void loadScheduleFromNVS() {
  prefs.begin(NVS_NS, true);
  schedule.nutritionEnabled = prefs.getBool(NVS_NUTRI_EN, true);
  schedule.targetPh        = prefs.getFloat(NVS_TARGET_PH, 6.0f);
  schedule.targetEc        = prefs.getFloat(NVS_TARGET_EC, 1.2f);
  schedule.phDoseSeconds    = prefs.getInt(NVS_PH_DOSE_SEC, 5);
  schedule.phDoseIntervalMinutes = prefs.getInt(NVS_PH_COOLDOWN, 30);
  schedule.ecDoseSeconds    = prefs.getInt(NVS_EC_DOSE_SEC, 10);
  schedule.ecDoseIntervalMinutes = prefs.getInt(NVS_EC_COOLDOWN, 30);
  prefs.end();
}

void saveScheduleToNVS() {
  prefs.begin(NVS_NS, false);
  prefs.putBool(NVS_NUTRI_EN, schedule.nutritionEnabled);
  prefs.putFloat(NVS_TARGET_PH, schedule.targetPh);
  prefs.putFloat(NVS_TARGET_EC, schedule.targetEc);
  prefs.putInt(NVS_PH_DOSE_SEC, schedule.phDoseSeconds);
  prefs.putInt(NVS_PH_COOLDOWN, schedule.phDoseIntervalMinutes);
  prefs.putInt(NVS_EC_DOSE_SEC, schedule.ecDoseSeconds);
  prefs.putInt(NVS_EC_COOLDOWN, schedule.ecDoseIntervalMinutes);
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

  // Extract latest targets and config
  bool nutriEn = extractJsonBool(resp, "nutritionEnabled", true);
  String targetPhStr = extractJsonNumber(resp, "targetPh");
  String targetEcStr = extractJsonNumber(resp, "targetEc");
  int phDoseSec = extractJsonInt(resp, "phDoseSeconds");
  int phDoseCool = extractJsonInt(resp, "phDoseIntervalMinutes");
  int ecDoseSec = extractJsonInt(resp, "ecDoseSeconds");
  int ecDoseCool = extractJsonInt(resp, "ecDoseIntervalMinutes");

  bool changed = false;
  if (nutriEn != schedule.nutritionEnabled) { schedule.nutritionEnabled = nutriEn; changed = true; }
  if (targetPhStr.length() > 0 && atof(targetPhStr.c_str()) != schedule.targetPh) { schedule.targetPh = atof(targetPhStr.c_str()); changed = true; }
  if (targetEcStr.length() > 0 && atof(targetEcStr.c_str()) != schedule.targetEc) { schedule.targetEc = atof(targetEcStr.c_str()); changed = true; }
  if (phDoseSec > 0 && phDoseSec != schedule.phDoseSeconds) { schedule.phDoseSeconds = phDoseSec; changed = true; }
  if (phDoseCool > 0 && phDoseCool != schedule.phDoseIntervalMinutes) { schedule.phDoseIntervalMinutes = phDoseCool; changed = true; }
  if (ecDoseSec > 0 && ecDoseSec != schedule.ecDoseSeconds) { schedule.ecDoseSeconds = ecDoseSec; changed = true; }
  if (ecDoseCool > 0 && ecDoseCool != schedule.ecDoseIntervalMinutes) { schedule.ecDoseIntervalMinutes = ecDoseCool; changed = true; }

  if (changed) {
    saveScheduleToNVS();
    Serial.println("[API] Targets updated from backend");
  }

  // Extract dosing manual modes
  String phm = extractJsonString(resp, "phManualMode");
  String nm = extractJsonString(resp, "nutritionManualMode");

  if (phm.length() > 0) {
    ManualMode newMode = MANUAL_AUTO;
    if (phm == "FORCED_ON") newMode = MANUAL_FORCE_ON;
    if (phm == "FORCED_OFF") newMode = MANUAL_FORCE_OFF;
    if (newMode != phManualMode) {
      phManualMode = newMode;
      Serial.printf("[API] Remote pH manual mode: %s\n", phm.c_str());
    }
  }

  if (nm.length() > 0) {
    ManualMode newMode = MANUAL_AUTO;
    if (nm == "FORCED_ON") newMode = MANUAL_FORCE_ON;
    if (nm == "FORCED_OFF") newMode = MANUAL_FORCE_OFF;
    if (newMode != nutritionManualMode) {
      nutritionManualMode = newMode;
      Serial.printf("[API] Remote nutrition manual mode: %s\n", nm.c_str());
    }
  }

  // Extract dynamic pin assignments
  int p_phD   = extractJsonInt(resp, "pin_ph_down");
  int p_nutA  = extractJsonInt(resp, "pin_nutrition_a");
  int p_nutB  = extractJsonInt(resp, "pin_nutrition_b");
  bool pinChanged = false;
  if (p_phD > 0 && p_phD != PIN_PH_DOWN_RELAY) { PIN_PH_DOWN_RELAY = p_phD; pinChanged = true; }
  if (p_nutA > 0 && p_nutA != PIN_NUTRITION_A_RELAY) { PIN_NUTRITION_A_RELAY = p_nutA; pinChanged = true; }
  if (p_nutB > 0 && p_nutB != PIN_NUTRITION_B_RELAY) { PIN_NUTRITION_B_RELAY = p_nutB; pinChanged = true; }
  if (pinChanged) {
    Serial.println("[GPIO] Re-configuring ESP32 pins from backend handshake...");
    setupPinModes();
  }

  // Extract latest status variables (sensor values and level) from backend
  String phValStr = extractJsonNumber(resp, "ph");
  String ecValStr = extractJsonNumber(resp, "ec");
  if (phValStr.length() > 0) status.phValue = phValStr.toFloat();
  if (ecValStr.length() > 0) status.ecValue = ecValStr.toFloat();
  status.waterLevel = extractJsonString(resp, "waterLevel");
  status.levelValid = extractJsonBool(resp, "levelSensorOk", true);

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
  body += "\"phDosingOn\":"        + String(status.phDosingOn ? "true" : "false") + ",";
  body += "\"nutritionADosingOn\":" + String(status.nutritionADosingOn ? "true" : "false") + ",";
  body += "\"nutritionBDosingOn\":" + String(status.nutritionBDosingOn ? "true" : "false") + "";
  body += "}";

  httpRequest("PUT", "/api/status", body);
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
      while (colonIdx < (int)json.length() && isspace((unsigned char)json[colonIdx])) colonIdx++;
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
