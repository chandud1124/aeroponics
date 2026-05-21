# API Reference — Smart Tower Garden

## Base URL

```
https://your-domain.com
```

All requests should include `Content-Type: application/json` header.

---

## Endpoints

### 1. GET /api/schedule — Fetch Pump Schedule

**Purpose**: ESP32 polls this to get the current pump schedule.

**Request**:

```bash
POST /api/schedule
```

**Response** (200 OK):

```json
{
  "intervalMinutes": 30,
  "durationSeconds": 60,
  "startHour": 6,
  "endHour": 19,
  "enabled": true
}
```

**Response fields**:

- `intervalMinutes` (int): Minutes between pump cycles
- `durationSeconds` (int): Seconds pump runs each cycle
- `startHour` (int): Hour when daily cycles start (0-23)
- `endHour` (int): Hour when daily cycles stop (0-23)
- `enabled` (bool): Master switch for pump automation

**Example usage** (Arduino):

```cpp
void fetchScheduleFromAPI() {
  HTTPClient http;
  http.setTimeout(10000);
  http.begin("https://your-domain.com/api/schedule");
  int httpCode = http.POST("");
  if (httpCode == 200) {
    String payload = http.getString();
    // Parse JSON and update currentSchedule
  }
  http.end();
}
```

---

### 2. GET /api/status — Fetch Current Status

**Purpose**: Dashboard or external systems poll this for live tower status.

**Request**:

```bash
GET /api/status
```

**Response** (200 OK):

```json
{
  "pumpOn": false,
  "flowing": false,
  "reservoirTempC": 22.5,
  "towerTempC": 23.1,
  "waterLevel": "MEDIUM",
  "lastRunISO": "2026-05-15T14:30:00Z",
  "fault": "OK",
  "updatedAt": "2026-05-15T14:35:00Z"
}
```

**Response fields**:

- `pumpOn` (bool): Is pump currently running?
- `flowing` (bool): Is water actually flowing? (flow sensor verified)
- `reservoirTempC` (float|null): Reservoir temperature in Celsius
- `towerTempC` (float|null): Tower/root zone temperature
- `waterLevel` (string): "LOW" | "MEDIUM" | "FULL"
- `lastRunISO` (string|null): ISO 8601 timestamp of last pump cycle
- `fault` (string): Fault code ("OK", "DRY_RUN", "FLOW_TIMEOUT", "LOW_WATER", "SENSOR_FAIL", "WIFI_LOST")
- `updatedAt` (string): When status was last updated

**Example usage** (React):

```typescript
async function getStatus() {
  const res = await fetch("/api/status");
  const data = await res.json();
  console.log(`Pump: ${data.pumpOn ? "ON" : "OFF"}`);
  console.log(`Water Level: ${data.waterLevel}`);
  if (data.fault !== "OK") {
    console.warn(`Fault: ${data.fault}`);
  }
}
```

---

### 3. PATCH /api/status — Update Status

**Purpose**: ESP32 sends live sensor data to update the backend status record.

**Request**:

```bash
PATCH /api/status
Content-Type: application/json

{
  "pumpOn": false,
  "flowing": true,
  "reservoirTempC": 22.3,
  "towerTempC": 23.8,
  "waterLevel": "MEDIUM",
  "fault": "OK",
  "lastRunAt": "2026-05-15T14:30:00Z"
}
```

**Request fields** (all optional, only send what changed):

- `pumpOn` (bool): Current pump state
- `flowing` (bool): Flow sensor status
- `reservoirTempC` (float): Reservoir temperature
- `towerTempC` (float): Tower temperature
- `waterLevel` (string): "LOW" | "MEDIUM" | "FULL"
- `fault` (string): Current fault code
- `lastRunAt` (string): ISO 8601 timestamp of last run

**Response** (200 OK):

```json
{
  "success": true
}
```

**Error responses**:

- `400`: Invalid water level value
- `500`: Database update failed

**Example usage** (Arduino):

```cpp
void postStatusToAPI() {
  HTTPClient http;
  http.begin("https://your-domain.com/api/status");
  http.addHeader("Content-Type", "application/json");

  String payload = "{";
  payload += "\"pumpOn\":" + String(currentStatus.pumpOn ? "true" : "false") + ",";
  payload += "\"flowing\":" + String(currentStatus.flowing ? "true" : "false") + ",";
  payload += "\"reservoirTempC\":" + String(currentStatus.reservoirTempC) + ",";
  payload += "\"towerTempC\":" + String(currentStatus.towerTempC) + ",";
  payload += "\"waterLevel\":\"" + currentStatus.waterLevel + "\",";
  payload += "\"fault\":\"" + currentStatus.fault + "\"";
  payload += "}";

  int httpCode = http.PATCH(payload);
  if (httpCode == 200) Serial.println("✓ Status updated");
  http.end();
}
```

---

### 4. GET /api/pump-log — Fetch Pump Log & Stats

**Purpose**: Dashboard fetches pump cycle history and aggregated statistics.

**Request**:

```bash
GET /api/pump-log
```

**Response** (200 OK):

```json
{
  "cycles": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "startedAt": "2026-05-15T14:30:00Z",
      "durationSeconds": 61,
      "flowed": true,
      "fault": null
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "startedAt": "2026-05-15T14:00:00Z",
      "durationSeconds": 60,
      "flowed": true,
      "fault": null
    }
  ],
  "stats": {
    "totalCycles": 2,
    "successfulCycles": 2,
    "failedCycles": 0,
    "successRate": 100,
    "averageDurationSeconds": 60,
    "totalFlowTime": 121,
    "faultCounts": {}
  }
}
```

**Response fields**:

**cycles** array:

- `id` (uuid): Unique cycle ID
- `startedAt` (string): ISO 8601 timestamp when cycle started
- `durationSeconds` (int): How long pump ran (seconds)
- `flowed` (bool): Did flow sensor detect water?
- `fault` (string|null): Fault code if any, otherwise null

**stats** object:

- `totalCycles` (int): Total number of pump cycles
- `successfulCycles` (int): Cycles with flow and no fault
- `failedCycles` (int): Cycles without flow or with fault
- `successRate` (int): Percentage (0-100) of successful cycles
- `averageDurationSeconds` (int): Average cycle duration
- `totalFlowTime` (int): Sum of all flow durations
- `faultCounts` (object): Count by fault code
  ```json
  {
    "DRY_RUN": 2,
    "FLOW_TIMEOUT": 1,
    "LOW_WATER": 3
  }
  ```

**Example usage** (React):

```typescript
async function getPumpStats() {
  const res = await fetch("/api/pump-log");
  const { stats } = await res.json();
  console.log(`Success rate: ${stats.successRate}%`);
  console.log(`Average cycle: ${stats.averageDurationSeconds}s`);
  console.log(`Faults: ${JSON.stringify(stats.faultCounts)}`);
}
```

---

### 5. POST /api/pump-log — Log Pump Cycle

**Purpose**: ESP32 sends pump cycle data after each cycle completes.

**Request**:

```bash
POST /api/pump-log
Content-Type: application/json

{
  "durationSeconds": 61,
  "flowed": true,
  "fault": null
}
```

**Request fields**:

- `durationSeconds` (int, required): How long pump ran
- `flowed` (bool, required): Did flow sensor detect water?
- `fault` (string, optional): Fault code if any

**Response** (201 Created):

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "startedAt": "2026-05-15T14:30:00Z",
  "durationSeconds": 61,
  "flowed": true,
  "fault": null
}
```

**Error responses**:

- `400`: Missing `durationSeconds` or `flowed` field
- `500`: Database insert failed

**Example usage** (Arduino):

```cpp
void logPumpCycle(float durationSeconds, bool flowed) {
  HTTPClient http;
  http.begin("https://your-domain.com/api/pump-log");
  http.addHeader("Content-Type", "application/json");

  String fault = (currentStatus.fault == "OK") ? "" : currentStatus.fault;

  String payload = "{";
  payload += "\"durationSeconds\":" + String((int)durationSeconds) + ",";
  payload += "\"flowed\":" + String(flowed ? "true" : "false") + ",";
  payload += "\"fault\":\"" + fault + "\"";
  payload += "}";

  int httpCode = http.POST(payload);
  if (httpCode == 201) Serial.println("✓ Cycle logged");
  http.end();
}
```

---

## Fault Codes

| Code             | Severity | Meaning                                              | Action                                                |
| ---------------- | -------- | ---------------------------------------------------- | ----------------------------------------------------- |
| **OK**           | info     | No faults                                            | Normal operation                                      |
| **DRY_RUN**      | bad      | Pump ran but no flow detected within 5s              | Check pump prime, blockage, suction line              |
| **FLOW_TIMEOUT** | bad      | Flow stopped mid-cycle                               | Check for clog in discharge line, verify pump running |
| **LOW_WATER**    | warn     | Tank water level at LOW probe                        | Refill tank soon                                      |
| **SENSOR_FAIL**  | warn     | Temperature or level sensor returned invalid reading | Check OneWire wiring, probe connections               |
| **WIFI_LOST**    | info     | ESP32 lost network for >5 minutes                    | Check WiFi password, signal strength, restart ESP32   |

---

## Retry Logic & Timeouts

ESP32 implements automatic retry logic:

```
MAX_RETRIES = 3
RETRY_DELAY = 500ms
API_TIMEOUT = 10000ms (10 seconds)

If POST fails:
  1. Wait 500ms
  2. Retry (up to 3 times)
  3. If all fail, log locally and continue (no blocking)
```

---

## Rate Limiting

- **Schedule polling**: Every 60 seconds
- **Status posting**: Every 30 seconds
- **Pump log**: Once per cycle completion (irregular)
- **No rate limits** enforced (beginner-friendly, single tower per deployment)

---

## Database Tables

### tower_status (singleton, id=1)

```sql
CREATE TABLE tower_status (
  id INTEGER PRIMARY KEY DEFAULT 1,
  pump_on BOOLEAN NOT NULL DEFAULT FALSE,
  flowing BOOLEAN NOT NULL DEFAULT FALSE,
  reservoir_temp_c NUMERIC,
  tower_temp_c NUMERIC,
  water_level TEXT NOT NULL DEFAULT 'MEDIUM',
  fault TEXT,
  last_run_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### tower_schedule (singleton, id=1)

```sql
CREATE TABLE tower_schedule (
  id INTEGER PRIMARY KEY DEFAULT 1,
  interval_minutes INTEGER NOT NULL DEFAULT 30,
  duration_seconds INTEGER NOT NULL DEFAULT 60,
  start_hour INTEGER NOT NULL DEFAULT 6,
  end_hour INTEGER NOT NULL DEFAULT 19,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### tower_pump_log (append-only)

```sql
CREATE TABLE tower_pump_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER,
  flowed BOOLEAN,
  fault TEXT
);
```

### tower_readings (manual readings)

```sql
CREATE TABLE tower_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ph NUMERIC,
  tds NUMERIC,
  ec NUMERIC,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## CORS & Authentication

- **CORS**: Enabled for all origins (beginner-friendly, single deployment)
- **Auth**: None required (permissive RLS policies, single tower per deployment)
- **Rate limiting**: Not enforced
- **Production note**: Add authentication for multi-user deployments

---

## Response Status Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 200  | OK — Request succeeded                  |
| 201  | Created — Resource created (POST)       |
| 400  | Bad Request — Invalid parameters        |
| 404  | Not Found — Resource doesn't exist      |
| 500  | Server Error — Database or server issue |

---

## Testing with cURL

### Fetch schedule

```bash
curl -X POST https://your-domain.com/api/schedule
```

### Fetch status

```bash
curl -X GET https://your-domain.com/api/status
```

### Update status

```bash
curl -X PATCH https://your-domain.com/api/status \
  -H "Content-Type: application/json" \
  -d '{
    "pumpOn": true,
    "flowing": true,
    "reservoirTempC": 22.3,
    "waterLevel": "MEDIUM",
    "fault": "OK"
  }'
```

### Fetch pump log

```bash
curl -X GET https://your-domain.com/api/pump-log
```

### Log a pump cycle

```bash
curl -X POST https://your-domain.com/api/pump-log \
  -H "Content-Type: application/json" \
  -d '{
    "durationSeconds": 60,
    "flowed": true,
    "fault": null
  }'
```

---

**Last updated: 15-May-2026**  
**Version: 1.0**
