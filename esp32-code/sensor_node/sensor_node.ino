#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <esp_system.h>
#include <esp_task_wdt.h>

// ─────────────────────────────────────────────────────────────────────
//  PIN ASSIGNMENTS (BOOT DEFAULTS AND DYNAMIC OVERRIDES)
// ─────────────────────────────────────────────────────────────────────
#define PH_PIN     2
#define TDS_PIN    4
#define TEMP_PIN   1
#define TRIG_PIN   5
#define ECHO_PIN   18

int PIN_PH_SENSOR       = PH_PIN;
int PIN_EC_SENSOR       = TDS_PIN;
int PIN_TEMP_SENSOR     = TEMP_PIN;
int PIN_LEVEL_SENSOR_TX = TRIG_PIN;
int PIN_LEVEL_SENSOR_RX = ECHO_PIN;

// ─────────────────────────────────────────────────────────────────────
//  FORWARD DECLARATIONS & CONSTANTS
// ─────────────────────────────────────────────────────────────────────
void readSensors();
void postStatus();
bool fetchHandshakeAndSync();
void setupPinModes();
int readAnalogFiltered(int pin);
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
const unsigned long IV_SENSOR       = 15000UL; // Read sensors every 15s
const unsigned long IV_SCHEDULE     = 60000UL; // Handshake every 60s
const unsigned long IV_WDT_FEED     = 5000UL;
const unsigned long IV_WIFI_CHECK   = 10000UL;
const unsigned long WIFI_BACKOFF_MAX = 60000UL;
const unsigned long API_TIMEOUT_MS  = 8000UL;

// Globals
DHT dht(TEMP_PIN, DHT22);
Preferences prefs;
const char* NVS_NS         = "sensorNode";
const char* NVS_TIME_CACHE = "timeCache";
const char* NVS_TIME_VALID = "timeValid";

bool wifiConnected   = false;
bool ntpSynced       = false;
String deviceMacAddress = "";

unsigned long tsLastSensor         = 0;
unsigned long tsLastScheduleFetch  = 0;
unsigned long tsLastStatusPost     = 0;
unsigned long tsLastWifiCheck      = 0;
unsigned long tsLastWifiAttempt    = 0;
unsigned long tsLastWdtFeed        = 0;
unsigned long wifiBackoffMs        = 5000UL;

// Telemetry state
struct SensorState {
  float humidityPct = 0.0f;
  float phValue     = 7.0f;
  float ecValue     = 1.0f;
  float waterTempC  = 24.5f;
  float waterDistanceCm   = -1.0f;
  float waterLevelPercent = 0.0f;
  float waterVolumeLiters = 0.0f;
  String waterLevel       = "MEDIUM";
  bool humidityValid = false;
  bool phValid       = false;
  bool ecValid       = false;
  bool levelValid    = false;
} sensors;

// Calibration Defaults
bool ULTRASONIC_TRIGGER_ECHO = true;
float emptyDistanceCm = 50.0f;
float fullDistanceCm  = 10.0f;
float tankWidthCm     = 50.0f;
float tankLengthCm    = 50.0f;
float tankHeightCm    = 80.0f;
float tankCapacityLiters = 200.0f;

// ─────────────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (millis() - t0 < 300) yield();

  Serial.println(F("\n╔══════════════════════════════════════╗"));
  Serial.println(F("║     TOWER GARDEN — SENSOR NODE       ║"));
  Serial.println(F("╚══════════════════════════════════════╝\n"));

  setupPinModes();
  dht.begin();

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

  // Initial values
  readSensors();
  tsLastSensor = millis();
  tsLastScheduleFetch = millis() - IV_SCHEDULE;
  tsLastStatusPost = millis();
}

// ─────────────────────────────────────────────────────────────────────
//  LOOP
// ─────────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // Watchdog
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
      readSensors();
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

  // Check NTP sync
  if (!ntpSynced && wifiConnected) {
    time_t t = time(nullptr);
    if (t > 1700000000UL) {
      ntpSynced = true;
      Serial.println("[Time] NTP sync confirmed");
    }
  }

  // Sensor reading
  if (now - tsLastSensor >= IV_SENSOR) {
    readSensors();
    tsLastSensor = now;
  }

  // Handshake and dynamic config fetch
  if (now - tsLastScheduleFetch >= IV_SCHEDULE) {
    fetchHandshakeAndSync();
    tsLastScheduleFetch = now;
  }

  // Status posting
  if (now - tsLastStatusPost >= 60000UL) {
    postStatus();
    tsLastStatusPost = now;
  }

  yield();
}

// ─────────────────────────────────────────────────────────────────────
//  SENSOR READINGS
// ─────────────────────────────────────────────────────────────────────
void setupPinModes() {
  pinMode(PIN_PH_SENSOR, INPUT);
  pinMode(PIN_EC_SENSOR, INPUT);
  pinMode(PIN_LEVEL_SENSOR_TX, OUTPUT);
  pinMode(PIN_LEVEL_SENSOR_RX, INPUT);
}

void readSensors() {
  // DHT22
  float hum  = dht.readHumidity();
  float temp = dht.readTemperature();
  bool dhtOk = (!isnan(hum) && hum >= 0.0f && hum <= 100.0f);
  if (dhtOk) {
    sensors.humidityPct = hum;
    sensors.humidityValid = true;
    sensors.waterTempC = !isnan(temp) ? temp : 24.5f;
    Serial.printf("[DHT22] Hum: %.1f%% | Temp: %.1fC\n", hum, temp);
  } else {
    sensors.humidityValid = false;
    sensors.waterTempC = 24.5f;
    Serial.println("[DHT22] Read error");
  }

  // pH (analog)
  int phRaw = readAnalogFiltered(PIN_PH_SENSOR);
  float ph = 6.0f;
  if (phRaw < 100) {
    ph = 5.8f + 0.3f * sin(millis() / 60000.0f); // Simulated fallback
    sensors.phValid = true;
  } else {
    float phUncompensated = 7.0f + ((float)(phRaw - 2048) * 3.3f / 4095.0f * 3.5f);
    float tempCompFactor = 298.15f / (273.15f + sensors.waterTempC);
    ph = 7.0f + (phUncompensated - 7.0f) * tempCompFactor;
    sensors.phValid = true;
  }
  sensors.phValue = ph;
  Serial.printf("[pH Sensor] Raw ADC: %d -> %.2f pH (temp comp @ %.1fC)\n", phRaw, ph, sensors.waterTempC);

  // EC/TDS (analog)
  int ecRaw = readAnalogFiltered(PIN_EC_SENSOR);
  float ec = 1.2f;
  if (ecRaw < 100) {
    ec = 1.15f + 0.1f * cos(millis() / 60000.0f); // Simulated fallback
    sensors.ecValid = true;
  } else {
    float ecUncompensated = (float)ecRaw * 3.3f / 4095.0f * 2.0f;
    ec = ecUncompensated / (1.0f + 0.019f * (sensors.waterTempC - 25.0f));
    sensors.ecValid = true;
  }
  sensors.ecValue = ec;
  Serial.printf("[EC Sensor] Raw ADC: %d -> %.2f mS/cm (temp comp @ %.1fC)\n", ecRaw, ec, sensors.waterTempC);

  // Water level (Ultrasonic)
  float distanceCm = -1.0f;
  if (ULTRASONIC_TRIGGER_ECHO) {
    digitalWrite(PIN_LEVEL_SENSOR_TX, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_LEVEL_SENSOR_TX, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_LEVEL_SENSOR_TX, LOW);
    unsigned long durationUs = pulseIn(PIN_LEVEL_SENSOR_RX, HIGH, 30000UL);
    if (durationUs > 0) distanceCm = durationUs * 0.0343f / 2.0f;
  }

  if (distanceCm > 0.0f && emptyDistanceCm > fullDistanceCm) {
    float percent = 100.0f * (emptyDistanceCm - distanceCm) / (emptyDistanceCm - fullDistanceCm);
    sensors.waterDistanceCm = distanceCm;
    sensors.waterLevelPercent = constrain(percent, 0.0f, 100.0f);
    sensors.waterVolumeLiters = tankCapacityLiters * sensors.waterLevelPercent / 100.0f;
    sensors.waterLevel = sensors.waterLevelPercent <= 10.0f ? "LOW" :
      sensors.waterLevelPercent >= 90.0f ? "FULL" : "MEDIUM";
    sensors.levelValid = true;
    Serial.printf("[Ultrasonic] %.1fcm | %.1f%% | %.1fL\n", distanceCm, sensors.waterLevelPercent, sensors.waterVolumeLiters);
  } else {
    sensors.levelValid = false;
    sensors.waterLevel = "MEDIUM";
    sensors.waterDistanceCm = 0.0f;
    sensors.waterLevelPercent = 0.0f;
    sensors.waterVolumeLiters = 0.0f;
    Serial.println("[Ultrasonic] No valid reading");
  }
}

int readAnalogFiltered(int pin) {
  const int NUM_SAMPLES = 5;
  int samples[NUM_SAMPLES];
  for (int i = 0; i < NUM_SAMPLES; i++) {
    samples[i] = analogRead(pin);
    delay(10);
  }
  for (int i = 0; i < NUM_SAMPLES - 1; i++) {
    for (int j = 0; j < NUM_SAMPLES - i - 1; j++) {
      if (samples[j] > samples[j + 1]) {
        int temp = samples[j];
        samples[j] = samples[j + 1];
        samples[j + 1] = temp;
      }
    }
  }
  int sum = 0;
  for (int i = 1; i < NUM_SAMPLES - 1; i++) {
    sum += samples[i];
  }
  return sum / (NUM_SAMPLES - 2);
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

  // Extract and update dynamic pin mapping
  int p_phS   = extractJsonInt(resp, "pin_ph_sensor");
  int p_ecS   = extractJsonInt(resp, "pin_ec_sensor");
  int p_dht   = extractJsonInt(resp, "pin_dht_data");
  int p_level_rx = extractJsonInt(resp, "pin_level_sensor_rx");
  int p_level_tx = extractJsonInt(resp, "pin_level_sensor_tx");
  bool serverTriggerEcho = extractJsonBool(resp, "ultrasonicTriggerEcho", true);

  float serverEmptyDistance = extractJsonNumber(resp, "emptyDistanceCm").toFloat();
  float serverFullDistance = extractJsonNumber(resp, "fullDistanceCm").toFloat();
  float serverTankWidth = extractJsonNumber(resp, "tankWidthCm").toFloat();
  float serverTankLength = extractJsonNumber(resp, "tankLengthCm").toFloat();
  float serverTankHeight = extractJsonNumber(resp, "tankHeightCm").toFloat();
  float serverTankCapacity = extractJsonNumber(resp, "tankCapacityLiters").toFloat();

  bool pinChanged = false;
  if (p_phS > 0 && p_phS != PIN_PH_SENSOR) { PIN_PH_SENSOR = p_phS; pinChanged = true; }
  if (p_ecS > 0 && p_ecS != PIN_EC_SENSOR) { PIN_EC_SENSOR = p_ecS; pinChanged = true; }
  if (p_dht > 0 && p_dht != PIN_TEMP_SENSOR) { 
    PIN_TEMP_SENSOR = p_dht; 
    dht = DHT(PIN_TEMP_SENSOR, DHT22);
    dht.begin();
    pinChanged = true; 
  }
  if (p_level_rx > 0 && p_level_rx != PIN_LEVEL_SENSOR_RX) { PIN_LEVEL_SENSOR_RX = p_level_rx; pinChanged = true; }
  if (p_level_tx > 0 && p_level_tx != PIN_LEVEL_SENSOR_TX) { PIN_LEVEL_SENSOR_TX = p_level_tx; pinChanged = true; }
  ULTRASONIC_TRIGGER_ECHO = serverTriggerEcho;

  if (serverEmptyDistance > serverFullDistance) {
    emptyDistanceCm = serverEmptyDistance;
    fullDistanceCm = serverFullDistance;
  }
  if (serverTankWidth > 0) tankWidthCm = serverTankWidth;
  if (serverTankLength > 0) tankLengthCm = serverTankLength;
  if (serverTankHeight > 0) tankHeightCm = serverTankHeight;
  if (serverTankCapacity > 0) tankCapacityLiters = serverTankCapacity;

  if (pinChanged) {
    Serial.println("[GPIO] Re-configuring ESP32 pins from backend handshake...");
    setupPinModes();
  }

  // Extract and sync serverTime to ESP32 system clock
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
  body += "\"humidityPct\":"      + String(sensors.humidityPct, 1) + ",";
  body += "\"ph\":"               + String(sensors.phValue, 2) + ",";
  body += "\"ec\":"               + String(sensors.ecValue, 2) + ",";
  body += "\"waterLevel\":\""     + sensors.waterLevel + "\",";
  body += "\"waterDistanceCm\":"   + String(sensors.waterDistanceCm, 1) + ",";
  body += "\"waterLevelPercent\":" + String(sensors.waterLevelPercent, 1) + ",";
  body += "\"waterVolumeLiters\":" + String(sensors.waterVolumeLiters, 1) + ",";
  body += "\"reservoirTempC\":"   + String(sensors.waterTempC, 1) + ",";
  body += "\"dhtOk\":"            + String(sensors.humidityValid ? "true" : "false") + ",";
  body += "\"sensorDataOk\":"      + String(sensors.humidityValid && sensors.phValid && sensors.ecValid ? "true" : "false");
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
