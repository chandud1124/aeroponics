import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const gpio = [
  [
    "GPIO 4",
    "DS18B20 #1 — Reservoir temp",
    "Separate OneWire bus. Use 4.7 kΩ pull-up from data → 3.3 V.",
  ],
  ["GPIO 17", "DS18B20 #2 — Tower / root zone", "Separate OneWire bus, different ROM address."],
  [
    "GPIO 18",
    "YF-S201 flow sensor (signal)",
    "Pulse input. Power sensor from 5 V. Add 10 kΩ pull-up.",
  ],
  ["GPIO 19", "Motor override button", "INPUT_PULLUP switch to GND; debounced in firmware."],
  ["GPIO 23", "Light override button", "INPUT_PULLUP switch to GND; debounced in firmware."],
  ["GPIO 22", "Battery charge override button", "INPUT_PULLUP switch to GND; manual override for the battery relay."],
  [
    "GPIO 32",
    "Water level probe — LOW",
    "Through 100 kΩ to probe; second 100 kΩ to GND (divider).",
  ],
  ["GPIO 33", "Water level probe — MEDIUM", "Same divider pattern."],
  ["GPIO 34", "Water level probe — FULL", "Input-only pin, divider required."],
  ["GPIO 25", "Relay IN — spare / expansion", "Active LOW on most modules. Keep OFF at boot unless assigned."],
  ["GPIO 26", "Relay IN — battery charging", "Active LOW on most modules. Daily 4-hour window in firmware."],
  ["GPIO 27", "Relay IN — pump", "Active LOW on most modules. Drive HIGH to OFF at boot."],
  ["GPIO 35", "Reserved / input-only", "Optional analog or digital input only; not used by current build."],
  ["GND rod", "Common probe in tank", "Connected to ESP32 GND (through 1 kΩ for safety)."],
];

const components = [
  ["ESP32 DevKit V1", "₹350–500", "Main controller, has WiFi + plenty of GPIO"],
  ["YF-S201 flow sensor", "₹180–250", '1/2" hall-effect, 1–30 L/min'],
  ["DS18B20 waterproof × 2", "₹150 each", "Stainless steel, 1 m cable"],
  ["1-channel 5 V relay (opto-isolated)", "₹70", "For 230 V pump — use rated module if pump >5 A"],
  ["12 V 2 A SMPS", "₹200", "Powers ESP32 via buck converter; pump uses mains direct"],
  ["LM2596 buck (12 V → 5 V)", "₹50", "Feeds ESP32 VIN"],
  ["IP65 plastic enclosure", "₹250–400", "ABS, with cable glands"],
  ["316 stainless rods × 4", "₹100", "Level probes — 316 resists corrosion better than 304"],
  ["Cable glands PG7/PG9", "₹15 each", "Waterproof cable entry"],
  ["Heat-shrink + silicone sealant", "₹100", "Splice waterproofing"],
  ["Submersible pump 12 V or 230 V", "₹400–900", "Match to tower height (≥1.5× tower height)"],
];

export function Documentation() {
  return (
    <div className="space-y-4">
      <Accordion type="multiple" defaultValue={["arch"]} className="w-full">
        <AccordionItem value="arch">
          <AccordionTrigger>System architecture</AccordionTrigger>
          <AccordionContent>
            <Card className="p-4">
              <pre className="overflow-x-auto whitespace-pre text-xs leading-relaxed text-muted-foreground">
                {`        ┌─────────────────────────────┐
        │   Vertical Aeroponic Tower  │
        │   (gravity drip from top)   │
        │   ◯ DS18B20 (root zone)     │
        └──────────────┬──────────────┘
                       │ water trickles down
                       ▼
        ┌─────────────────────────────┐
        │   Reservoir Tank (50–80 L)  │
        │   ◯ DS18B20 (water temp)    │
        │   ◯ FULL probe ─┐           │
        │   ◯ MED  probe ─┼─ to ESP32 │
        │   ◯ LOW  probe ─┘  ADC      │
        │   ◯ GND rod ─── to ESP32 GND│
        │   ▣ Submersible pump        │
        └──────────────┬──────────────┘
                       │
                  YF-S201 flow sensor
                       │
                       ▼  (lifts water back to top)
              ┌──────────────────┐
              │  ESP32 + Relay   │── 12V SMPS
              │  IP65 enclosure  │── WiFi → Phone dashboard
              └──────────────────┘`}
              </pre>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="gpio">
          <AccordionTrigger>ESP32 GPIO mapping</AccordionTrigger>
          <AccordionContent>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">GPIO</th>
                    <th className="px-3 py-2 text-left">Connected to</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {gpio.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 font-mono">{row[0]}</td>
                      <td className="px-3 py-2">{row[1]}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="level">
          <AccordionTrigger>DIY conductivity water-level probe</AccordionTrigger>
          <AccordionContent>
            <Card className="space-y-3 p-4 text-sm">
              <p>
                Four <strong>316-grade stainless steel</strong> rods hang inside the tank: one
                common GND rod (long, reaches the bottom) and three sense rods cut to LOW, MEDIUM
                and FULL heights. When water touches a sense rod and the GND rod, it completes a
                very weak circuit — the ESP32 detects it.
              </p>
              <p>
                Each sense rod connects to its ESP32 GPIO through a <strong>100 kΩ resistor</strong>
                , with a second 100 kΩ resistor from that GPIO to GND. This forms a voltage divider
                that holds the input LOW in air and pulls it HIGH only when water bridges the rods.
              </p>
              <p>
                <strong>Corrosion prevention:</strong>
              </p>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  Use 316 stainless (not iron, copper or aluminium — they rust/leach into nutrient).
                </li>
                <li>
                  Drive the probes with very short pulses, not continuous DC. Power them via a GPIO
                  that you set HIGH only for ~5 ms during a reading, then back to INPUT. This stops
                  electrolysis.
                </li>
                <li>
                  Even better: alternate polarity between two reads. The firmware sample below does
                  pulsed reading every 30 s.
                </li>
                <li>Lift probes out monthly, wipe with vinegar to remove mineral scale.</li>
              </ul>
              <p>
                <strong>Waterproofing:</strong> seal the rod-to-wire joint with heat-shrink filled
                with marine silicone. Bring wires out the top of the tank lid through a cable gland.
              </p>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="logic">
          <AccordionTrigger>Automation logic & fault codes</AccordionTrigger>
          <AccordionContent>
            <Card className="p-4 space-y-3">
              <pre className="overflow-x-auto whitespace-pre text-xs leading-relaxed text-muted-foreground">
                {`every loop():
  poll cloud schedule (every 60 s)
  push status to cloud (every 30 s)

  if time-since-last-run >= interval AND inside active hours:
    if water level == LOW       → fault = LOW_WATER, skip
    relay ON, reset flow counter, wait 5 s
    if pulses < 30              → fault = DRY_RUN, log, stop
    while cycle running:
      if pulses frozen 4 s+     → fault = FLOW_TIMEOUT, log, stop
    relay OFF, fault = OK, log cycle

  if temp sensors return NaN    → fault = SENSOR_FAIL
  if WiFi dropped               → fault = WIFI_LOST (logged on reconnect)`}
              </pre>
              <div className="rounded-md border border-border p-3 text-xs">
                <strong>
                  Fault codes (written to{" "}
                  <code className="rounded bg-muted px-1">tower_status.fault</code>):
                </strong>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                  <li>
                    <code>DRY_RUN</code> — pump on, no flow within 5 s
                  </li>
                  <li>
                    <code>FLOW_TIMEOUT</code> — flow stopped mid-cycle
                  </li>
                  <li>
                    <code>LOW_WATER</code> — tank empty, cycle skipped
                  </li>
                  <li>
                    <code>SENSOR_FAIL</code> — DS18B20 / probe invalid reading
                  </li>
                  <li>
                    <code>WIFI_LOST</code> — ESP32 was offline (info only)
                  </li>
                </ul>
              </div>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="firmware">
          <AccordionTrigger>Full ESP32 sketch (cloud-connected, with retries)</AccordionTrigger>
          <AccordionContent>
            <Card className="p-4 space-y-2">
              <p className="text-xs text-muted-foreground">
                Drop this into Arduino IDE. It polls the watering plan every 60 s, PATCHes status
                every 30 s, POSTs a pump log row after each cycle, and writes a clean fault code
                (DRY_RUN / FLOW_TIMEOUT / LOW_WATER / SENSOR_FAIL) the dashboard understands.
              </p>
              <pre className="overflow-x-auto whitespace-pre text-xs leading-relaxed">
                {`#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>      // install "ArduinoJson" by Benoit Blanchon
#include <OneWire.h>
#include <DallasTemperature.h>

// ====== EDIT THESE ======
const char* WIFI_SSID = "YourWiFi";
const char* WIFI_PASS = "YourPass";
const char* SUPA_URL  = "https://YOUR-PROJECT.supabase.co";
const char* SUPA_KEY  = "YOUR_PUBLISHABLE_ANON_KEY";
// ========================

#define PIN_ONEWIRE     4
#define PIN_FLOW       18
#define PIN_LEVEL_LOW  32
#define PIN_LEVEL_MED  33
#define PIN_LEVEL_FULL 34
#define PIN_RELAY      26

#define HTTP_TIMEOUT_MS  10000   // 10 s per request
#define HTTP_RETRIES     1       // retry once on failure
#define POLL_PLAN_MS     60000   // pull schedule every 60 s
#define PUSH_STATUS_MS   30000   // push status every 30 s
#define FLOW_VERIFY_MS   5000    // wait 5 s after pump on, then check flow
#define FLOW_MIN_PULSES  30      // YF-S201 ~30 pulses in 5 s == flowing

OneWire ow(PIN_ONEWIRE);
DallasTemperature ds(&ow);
volatile uint32_t flowPulses = 0;
void IRAM_ATTR onFlow() { flowPulses++; }

// runtime state synced FROM the cloud
uint32_t intervalMs = 30UL*60*1000;
uint32_t durationMs = 60UL*1000;
uint8_t  startHour = 6, endHour = 19;
bool     planEnabled = true;

uint32_t lastRun = 0, lastPlanPoll = 0, lastStatusPush = 0;
bool pumpOn = false;
String fault = "";   // one of: "" DRY_RUN FLOW_TIMEOUT LOW_WATER SENSOR_FAIL WIFI_LOST

// ---------- HTTP helper with timeout + retry ----------
int httpSend(const char* method, const String& path, const String& body, String* out=nullptr) {
  for (int attempt = 0; attempt <= HTTP_RETRIES; attempt++) {
    WiFiClientSecure client; client.setInsecure();   // beginner mode
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    if (!http.begin(client, String(SUPA_URL) + path)) { delay(500); continue; }
    http.addHeader("apikey", SUPA_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPA_KEY);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Prefer", "return=minimal");
    int code = (String(method) == "PATCH") ? http.PATCH(body)
             : (String(method) == "POST")  ? http.POST(body)
             :                                http.GET();
    if (out) *out = http.getString();
    http.end();
    if (code > 0 && code < 500) return code;
    delay(800);  // small backoff before retry
  }
  return -1;
}

// ---------- read sensors ----------
String readLevel() {
  if (digitalRead(PIN_LEVEL_FULL)) return "FULL";
  if (digitalRead(PIN_LEVEL_MED))  return "MEDIUM";
  if (digitalRead(PIN_LEVEL_LOW))  return "LOW";
  return "LOW";
}
float readTemp(uint8_t idx) {
  ds.requestTemperatures();
  float t = ds.getTempCByIndex(idx);
  return (t < -50 || t > 100) ? NAN : t;
}

// ---------- cloud sync ----------
void pollPlan() {
  String body;
  int code = httpSend("GET", "/rest/v1/tower_schedule?id=eq.1&select=*", "", &body);
  if (code != 200) return;
  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, body)) return;
  JsonObject row = doc[0];
  intervalMs  = (uint32_t)row["interval_minutes"] * 60UL * 1000UL;
  durationMs  = (uint32_t)row["duration_seconds"] * 1000UL;
  startHour   = row["start_hour"];
  endHour     = row["end_hour"];
  planEnabled = row["enabled"];
}

void pushStatus(const String& level, float tRes, float tTow) {
  StaticJsonDocument<384> doc;
  doc["pump_on"]          = pumpOn;
  doc["flowing"]          = (flowPulses > 5);
  doc["water_level"]      = level;
  if (!isnan(tRes)) doc["reservoir_temp_c"] = tRes;
  if (!isnan(tTow)) doc["tower_temp_c"]     = tTow;
  doc["fault"]            = fault.length() ? fault : (const char*)nullptr;
  doc["updated_at"]       = "now()";
  String body; serializeJson(doc, body);
  httpSend("PATCH", "/rest/v1/tower_status?id=eq.1", body);
}

void logCycle(uint32_t durSec, bool flowed, const String& f) {
  StaticJsonDocument<256> doc;
  doc["duration_seconds"] = durSec;
  doc["flowed"]           = flowed;
  doc["fault"]            = f.length() ? f : (const char*)nullptr;
  String body; serializeJson(doc, body);
  httpSend("POST", "/rest/v1/tower_pump_log", body);
}

// ---------- pump cycle with fault detection ----------
void runCycle() {
  String level = readLevel();
  if (level == "LOW") { fault = "LOW_WATER"; return; }

  digitalWrite(PIN_RELAY, LOW); pumpOn = true;
  flowPulses = 0; uint32_t cycleStart = millis();
  delay(FLOW_VERIFY_MS);

  // Rule 1 — DRY RUN: pump on but no flow within verify window
  if (flowPulses < FLOW_MIN_PULSES) {
    digitalWrite(PIN_RELAY, HIGH); pumpOn = false;
    fault = "DRY_RUN";
    logCycle((millis()-cycleStart)/1000, false, fault);
    return;
  }

  // Rule 2 — FLOW TIMEOUT: pulses freeze mid-cycle
  uint32_t lastPulses = flowPulses;
  uint32_t lastCheck  = millis();
  while (millis() - cycleStart < durationMs) {
    delay(2000);
    if (flowPulses == lastPulses && millis()-lastCheck > 4000) {
      digitalWrite(PIN_RELAY, HIGH); pumpOn = false;
      fault = "FLOW_TIMEOUT";
      logCycle((millis()-cycleStart)/1000, false, fault);
      return;
    }
    lastPulses = flowPulses; lastCheck = millis();
  }

  digitalWrite(PIN_RELAY, HIGH); pumpOn = false;
  fault = ""; lastRun = millis();
  logCycle(durationMs/1000, true, "");
}

// ---------- setup / loop ----------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY, OUTPUT); digitalWrite(PIN_RELAY, HIGH);
  pinMode(PIN_FLOW, INPUT_PULLUP);
  pinMode(PIN_LEVEL_LOW, INPUT); pinMode(PIN_LEVEL_MED, INPUT); pinMode(PIN_LEVEL_FULL, INPUT);
  attachInterrupt(PIN_FLOW, onFlow, RISING);
  ds.begin();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis()-t0 < 20000) { delay(500); }
  pollPlan();
}

void loop() {
  uint32_t now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    fault = "WIFI_LOST";
    WiFi.reconnect();
  }

  if (now - lastPlanPoll > POLL_PLAN_MS) { pollPlan(); lastPlanPoll = now; }

  if (planEnabled && !pumpOn && now - lastRun >= intervalMs) {
    runCycle();
  }

  if (now - lastStatusPush > PUSH_STATUS_MS) {
    String level = readLevel();
    float tRes = readTemp(0), tTow = readTemp(1);
    if (isnan(tRes) && isnan(tTow)) fault = "SENSOR_FAIL";
    pushStatus(level, tRes, tTow);
    lastStatusPush = now;
  }

  delay(200);
}`}
              </pre>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="parts">
          <AccordionTrigger>Recommended low-cost parts (India pricing)</AccordionTrigger>
          <AccordionContent>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Part</th>
                    <th className="px-3 py-2 text-left">Approx ₹</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2">{row[0]}</td>
                      <td className="px-3 py-2 font-mono">{row[1]}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="outdoor">
          <AccordionTrigger>Outdoor safety checklist</AccordionTrigger>
          <AccordionContent>
            <Card className="space-y-2 p-4 text-sm">
              <ul className="list-disc space-y-2 pl-5">
                <li>
                  Mount the IP65 enclosure under a small rain shield, cable entries pointing DOWN.
                </li>
                <li>All cables enter the box through PG cable glands — never raw holes.</li>
                <li>Sensor cables routed in PVC conduit, away from the 230 V mains line.</li>
                <li>
                  Use a 30 mA RCBO (ELCB) on the pump mains line — non-negotiable for water +
                  electricity.
                </li>
                <li>Earth the metal pump body and any metal frame to household ground.</li>
                <li>
                  Apply silicone sealant on every probe-to-wire junction; cover with heat-shrink.
                </li>
                <li>
                  Keep the relay rated ≥2× the pump's running current (10 A relay for a 5 A pump).
                </li>
                <li>
                  For Karnataka monsoon: add a small 5 W solar dryer pack inside the enclosure to
                  keep humidity low.
                </li>
              </ul>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="manual">
          <AccordionTrigger>Why pH / TDS / EC stay manual</AccordionTrigger>
          <AccordionContent>
            <Card className="space-y-2 p-4 text-sm text-muted-foreground">
              <p>
                Probes for pH and EC are <strong>consumables</strong> — they drift, need calibration
                buffers (pH 4.0 / 7.0), and last only 6–12 months. For a single home tower it is
                cheaper, more accurate, and far less stressful to use a ₹400 handheld pH pen and a
                ₹500 TDS pen, then log the reading here.
              </p>
              <p>
                <strong>How often:</strong> check pH + TDS every 2–3 days, and any time you top up
                water or add nutrients. Adjust pH with a few drops of pH-Down (phosphoric acid) or
                pH-Up (potassium hydroxide).
              </p>
              <p>
                <strong>Targets (leafy greens, lettuce, basil):</strong> pH 5.5–6.5, TDS 560–1400
                ppm, EC 1.2–2.4 mS/cm. Fruiting plants (tomato, chilli) want EC 2.0–3.5.
              </p>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="trouble">
          <AccordionTrigger>Troubleshooting</AccordionTrigger>
          <AccordionContent>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Symptom</th>
                    <th className="px-3 py-2 text-left">Likely cause</th>
                    <th className="px-3 py-2 text-left">Fix</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      "Pump runs but dashboard says NO FLOW",
                      "Flow sensor wired wrong / blocked impeller",
                      "Check 5 V on red, GND on black, signal on yellow → GPIO 18. Tap sensor; flush with water.",
                    ],
                    [
                      "Level always shows FULL",
                      "Probes shorted by mineral scale",
                      "Lift probes, soak in vinegar 15 min, rinse.",
                    ],
                    [
                      "Level always shows LOW even when full",
                      "GND rod not in water OR broken wire",
                      "Confirm GND rod reaches bottom; meter-test continuity.",
                    ],
                    [
                      "DS18B20 reads -127 °C",
                      "OneWire pull-up missing",
                      "Add 4.7 kΩ from data line to 3.3 V.",
                    ],
                    [
                      "ESP32 reboots when pump turns on",
                      "Mains spikes through shared ground / weak 5 V supply",
                      "Use opto-isolated relay; separate SMPS for ESP32.",
                    ],
                    [
                      "WiFi keeps disconnecting outdoors",
                      "Metal enclosure or distance",
                      "Use plastic IP65 box; add external antenna ESP32 variant.",
                    ],
                  ].map((row, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="px-3 py-2">{row[0]}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row[1]}</td>
                      <td className="px-3 py-2">{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="cloud">
          <AccordionTrigger>ESP32 ↔ Cloud (backend) — REST endpoints</AccordionTrigger>
          <AccordionContent>
            <Card className="p-4 space-y-3 text-sm">
              <p className="text-muted-foreground">
                The dashboard and ESP32 share four tables in Lovable Cloud. The ESP32 talks to them
                using plain HTTPS (Supabase REST). Use the project URL and the public anon key
                already baked into your <code className="rounded bg-muted px-1">.env</code>.
              </p>
              <div>
                <strong>Base URL:</strong>{" "}
                <code className="rounded bg-muted px-1">{`<VITE_SUPABASE_URL>/rest/v1`}</code>
              </div>
              <div>
                <strong>Headers (every request):</strong>
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                  {`apikey: <VITE_SUPABASE_PUBLISHABLE_KEY>
Authorization: Bearer <VITE_SUPABASE_PUBLISHABLE_KEY>
Content-Type: application/json`}
                </pre>
              </div>

              <div>
                <strong>1. Read the watering plan</strong>
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                  {`GET /rest/v1/tower_schedule?id=eq.1&select=*

→ [{ "interval_minutes": 30, "duration_seconds": 60,
     "start_hour": 6, "end_hour": 19, "enabled": true }]`}
                </pre>
                <p className="text-muted-foreground text-xs">
                  Poll once a minute so the ESP32 picks up plan changes from the dashboard.
                </p>
              </div>

              <div>
                <strong>2. Push live status</strong>
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                  {`PATCH /rest/v1/tower_status?id=eq.1
{
  "pump_on": true,
  "flowing": true,
  "reservoir_temp_c": 27.4,
  "tower_temp_c": 24.8,
  "water_level": "MEDIUM",
  "fault": null,
  "last_run_at": "2026-05-14T12:30:00Z",
  "updated_at": "2026-05-14T12:30:05Z"
}`}
                </pre>
                <p className="text-muted-foreground text-xs">
                  Send right after each pump cycle and every 30 s. Dashboard updates in real time.
                </p>
              </div>

              <div>
                <strong>3. Log a pump cycle (optional history)</strong>
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                  {`POST /rest/v1/tower_pump_log
{ "duration_seconds": 60, "flowed": true, "fault": null }`}
                </pre>
              </div>

              <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
                Arduino tip: use <code className="rounded bg-background px-1">HTTPClient</code> +
                <code className="rounded bg-background px-1">WiFiClientSecure</code> with{" "}
                <code className="rounded bg-background px-1">setInsecure()</code> (beginner mode) or
                pin the Supabase root cert. Wrap calls in a 10 s timeout and retry once on failure —
                never block the pump scheduler waiting for the network.
              </div>
            </Card>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
