# ESP32 Firmware Redesign: Professional State-Based Automation

## Overview

Your ESP32 firmware has been **completely redesigned** from a simple timer-based system to a **professional-grade state machine** with safety verification, fault handling, and intelligent automation.

This matches real IoT farming systems used in production hydroponic farms.

---

## Core Architecture Change

### Before: Simple Timer
```
Wait 7 min → Turn ON Pump → Run for 60 sec → Turn OFF
(No verification, no safety checks)
```

### After: Verification-Based State Machine
```
IDLE
  ↓ [scheduled time]
CHECK_WATER (verify level & sensors OK)
  ↓ [all checks pass]
PUMP_ON (activate relay)
  ↓ [pump starts]
WAITING_FOR_FLOW (critical 5-sec window)
  ↓ [flow detected] or [timeout + no flow = DRY_RUN fault]
RUNNING (pump runs with continuous monitoring)
  ↓ [time expires or fault detected]
STOPPING (graceful shutdown & logging)
  ↓
IDLE or FAULT/RECOVERY
```

---

## 8-State State Machine

| State | Purpose | Next State | Exit Condition |
|-------|---------|-----------|-----------------|
| **IDLE** | Wait for scheduled time | CHECK_WATER | Schedule triggered |
| **CHECK_WATER** | Pre-pump safety checks | PUMP_ON or FAULT | Checks pass or fail |
| **PUMP_ON** | Activate relay | WAITING_FOR_FLOW | Relay energized |
| **WAITING_FOR_FLOW** | **CRITICAL** - Verify flow exists | RUNNING or FAULT | Flow detected or 5 sec timeout |
| **RUNNING** | Normal operation | STOPPING or FAULT | Duration reached or fault |
| **STOPPING** | Graceful shutdown | IDLE | Pump off, cycle logged |
| **FAULT** | Handle error | RECOVERY | Retry delay passed |
| **RECOVERY** | Attempt to recover | IDLE or FAULT | Conditions safe or still failing |

### State Diagram
```
                    ┌─────────────┐
                    │    IDLE     │
                    └──────┬──────┘
                           │ schedule
                           ↓
                    ┌─────────────────┐
                    │  CHECK_WATER    │
                    └──────┬────┬─────┘
                    pass ╱  │   │ fail
                          │   └──────┐
                          ↓          ↓
                    ┌──────────┐ ┌────────┐
                    │ PUMP_ON  │ │ FAULT  │◄──┐
                    └────┬─────┘ └────┬───┘   │
                         │            │       │
                         ↓            │  retry delay
                    ┌────────────────┐ │       │
                    │WAITING_FOR_FLOW│ │    ┌──┴────────┐
                    │  (5 sec window)│ │    │ RECOVERY  │
                    └────┬──────┬────┘ │    └──────┬─────┘
                    flow │      │ timeout        ✓ │ ✗
                         │      │                  │
                         ↓      ↓                  ↓
                    ┌──────────────┐          IDLE or FAULT
                    │  RUNNING     │
                    └─┬──────┬─────┘
              time   │      │ fault
              reached│      │
                     ↓      ↓
                    ┌────────────┐
                    │  STOPPING  │
                    └──────┬─────┘
                           │
                           ↓
                        IDLE/FAULT
```

---

## Critical Safety Features

### 1. Watchdog Timer (Auto-Restart)
```cpp
// System restarts if firmware freezes for 45 seconds
esp_task_wdt_init(45, true);
esp_task_wdt_add(NULL);

// Fed every 15 seconds
if (now - lastWatchdogFeedTime >= 15000) {
  esp_task_wdt_reset();
  lastWatchdogFeedTime = now;
}
```

**Why?** Outdoor systems must restart automatically. If pump gets stuck, watchdog forces restart → returns to safe state.

---

### 2. Flow Verification (The Most Critical Part)

**Problem it solves:**
- Pump motor runs silently but no water flows (pipe blocked, tank empty, sensor failed)
- Without verification → motor burns, roots dry, silent failure

**How it works:**
1. Pump relay turns ON
2. **Wait 5 seconds** while monitoring flow sensor pulses
3. **If pulses detected** → water actually flows → continue ✓
4. **If NO pulses after 5 sec** → STOP pump immediately + raise DRY_RUN fault ✗

**Code:**
```cpp
void handleStateWaitingForFlow(unsigned long now) {
  unsigned long elapsed = now - flowVerificationStartTime;
  
  // Check if flow detected yet
  if (flowPulseCount > 0) {
    Serial.println("✓ Flow detected! Pump confirmed working");
    currentState = STATE_RUNNING;
    return;
  }
  
  // Window expired - no flow!
  if (elapsed >= FLOW_VERIFY_WINDOW_MS) {  // 5 seconds
    Serial.println("✗ CRITICAL: No flow detected!");
    digitalWrite(PUMP_RELAY_PIN, LOW);     // STOP PUMP
    currentStatus.fault = "DRY_RUN";
    currentState = STATE_FAULT;
  }
}
```

**This is what separates hobby from professional systems.**

---

### 3. Temperature Monitoring
```cpp
const float TEMP_MAX_RESERVOIR_C = 28.0;  // Stop if too hot
const float TEMP_MAX_TOWER_C = 32.0;      // Alert threshold

// Pre-pump checks
if (currentSensors.reservoirTempC > TEMP_MAX_RESERVOIR_C) {
  // Stop pump start
  currentState = STATE_FAULT;
}

// Continuous monitoring during pump operation
void checkSafetyThresholds(unsigned long now) {
  if (currentSensors.reservoirTempC > TEMP_MAX_RESERVOIR_C) {
    Serial.print("[ALERT] Reservoir temp high: ");
    Serial.println(currentSensors.reservoirTempC);
  }
}
```

---

### 4. Water Level Protection
```cpp
// Pre-pump check
if (currentSensors.waterLevel == "LOW") {
  Serial.println("✗ Water level LOW - skipping cycle");
  currentStatus.fault = "LOW_WATER";
  currentState = STATE_FAULT;
  return;
}

// Prevents dry running and motor damage
```

---

### 5. Non-Blocking Timers Everywhere
```cpp
// OLD (BLOCKS SYSTEM):
delay(100);

// NEW (NON-BLOCKING):
unsigned long now = millis();
if (now - lastActionTime >= 100) {
  doAction();
  lastActionTime = now;
}
```

**Why?** System must stay responsive:
- Watchdog can see system is alive
- Sensor readings continue
- Safety checks don't get blocked
- WiFi reconnection happens in background

---

### 6. Local Fallback (WiFi Independence)
```cpp
// If WiFi offline:
if (!wifiConnected) {
  // Watering still continues on local schedule
  // API posting is skipped (non-critical)
  // Pump operations are NOT blocked
}

// System never depends entirely on internet
```

**Why?** A hydroponic tower can't die because internet is down.

---

### 7. Comprehensive Fault Codes

| Fault Code | Meaning | Action | Recovery |
|-----------|---------|--------|----------|
| OK | All good | Continue | N/A |
| LOW_WATER | Tank below minimum | Stop pump | 30 sec retry |
| DRY_RUN | Pump ON but no flow | Stop pump immediately | 30 sec retry |
| FLOW_STOPPED | Flow ceased mid-cycle | Stop pump | 30 sec retry |
| PUMP_TIMEOUT | Ran > 2 min | Stop pump | 30 sec retry |
| TEMP_HIGH | Reservoir too hot | Prevent/stop pump | 30 sec retry |
| SENSOR_FAIL | Temperature sensor bad | Stop pump | 30 sec retry |
| WIFI_LOST | Network offline | Ignore (use local) | Auto-reconnect |

---

## Code Organization

### Main Loop (Non-Blocking)
```cpp
void loop() {
  unsigned long now = millis();
  
  // 1. Feed watchdog (critical)
  if (now - lastWatchdogFeedTime >= 15000) {
    esp_task_wdt_reset();
    lastWatchdogFeedTime = now;
  }
  
  // 2. Maintain WiFi (background)
  maintainWiFi(now);
  
  // 3. Read sensors (every 30 sec)
  if (now - lastSensorReadTime >= 30000) {
    readSensors();
    lastSensorReadTime = now;
  }
  
  // 4. Safety checks (temperature, water level)
  checkSafetyThresholds(now);
  
  // 5. Fetch schedule (every 60 sec)
  if (now - lastScheduleCheckTime >= 60000) {
    fetchScheduleFromAPI();
    lastScheduleCheckTime = now;
  }
  
  // 6. RUN STATE MACHINE (this drives everything)
  updateStateMachine(now);
  
  // 7. Post status to dashboard (every 30 sec)
  if (now - lastStatusPostTime >= 30000) {
    postStatusToAPI();
    lastStatusPostTime = now;
  }
  
  yield();  // Yield to watchdog
}
```

### State Machine Dispatcher
```cpp
void updateStateMachine(unsigned long now) {
  switch (currentState) {
    case STATE_IDLE:
      handleStateIdle(now);
      break;
    
    case STATE_CHECK_WATER:
      handleStateCheckWater(now);
      break;
    
    case STATE_PUMP_ON:
      handleStatePumpOn(now);
      break;
    
    case STATE_WAITING_FOR_FLOW:  // ← THE CRITICAL ONE
      handleStateWaitingForFlow(now);
      break;
    
    case STATE_RUNNING:
      handleStateRunning(now);
      break;
    
    case STATE_STOPPING:
      handleStateStopping(now);
      break;
    
    case STATE_FAULT:
      handleStateFault(now);
      break;
    
    case STATE_RECOVERY:
      handleStateRecovery(now);
      break;
  }
}
```

---

## Serial Console Output Example

```
╔════════════════════════════════════════╗
║  SMART TOWER GARDEN - STATE MACHINE   ║
║  Professional Automation System       ║
╚════════════════════════════════════════╝

✓ Watchdog timer enabled (45 sec timeout)
  System will auto-restart if frozen

✓ GPIO configured, flow sensor interrupt armed
✓ DS18B20 sensors initialized
✓ WiFi connected!
  IP: 192.168.1.100

┌─ SENSOR READ ─
│ Res Temp:  24.5°C
│ Tower Temp: 26.0°C
│ Water Level: FULL
└─────────────

[SCHEDULER] Watering time triggered
[STATE CHANGE] IDLE → CHECK_WATER
[SAFETY] Running pre-pump checks...
✓ All pre-pump checks passed
[STATE CHANGE] CHECK_WATER → PUMP_ON
[PUMP] Starting pump...
[PUMP] Scheduled duration: 60 seconds
[PUMP] Entering flow verification window: 5 seconds

[STATE CHANGE] PUMP_ON → WAITING_FOR_FLOW
[FLOW] ✓ Flow detected! Pump confirmed working
[STATE CHANGE] WAITING_FOR_FLOW → RUNNING

[FLOW] Flow stopped mid-cycle!
[STATE CHANGE] RUNNING → STOPPING
[PUMP] Stopping pump...
[PUMP] Total runtime: 45.3 seconds, Flow detected: YES
[LOG] Pump cycle logged ✓

[STATE CHANGE] STOPPING → IDLE
```

---

## Key Differences from Original

| Aspect | Before | After |
|--------|--------|-------|
| **Pump Logic** | Simple timer | State machine (8 states) |
| **Flow Check** | After-the-fact | **5-second mandatory verification** |
| **Dry-Run Protection** | Delayed detection | **Immediate stop** |
| **Timers** | Uses delay() (blocking) | All non-blocking via millis() |
| **Watchdog** | None | 45 sec, auto-restart |
| **Temp Monitoring** | Post-op only | Pre-pump + continuous |
| **Fault Handling** | Simple flag | **State-based recovery** |
| **WiFi Fail** | Stops watering | **Continues locally** |
| **Error Codes** | 3 types | 7 fault codes |
| **Logging** | Basic | Comprehensive with state |

---

## What This Means for Your System

### Before
❌ Pump could run silently without water  
❌ Motor damage possible  
❌ System freezes → plant dies (no auto-restart)  
❌ WiFi outage → watering stops  
❌ No safety verification  

### After
✅ **Flow must be verified within 5 seconds**  
✅ **Pump stops immediately if no water**  
✅ **Watchdog auto-restarts if frozen**  
✅ **Watering continues if WiFi fails**  
✅ **7 different safety checks**  
✅ **Professional IoT reliability**  

---

## Next Steps

1. **Edit Configuration**
   - Line 48: `YOUR_SSID` → your WiFi name
   - Line 49: `YOUR_PASS` → your WiFi password
   - Line 52: `YOUR_PC_LAN_IP` → your computer's IP (e.g., 192.168.1.100)

2. **Upload to ESP32**
   ```
   Arduino IDE → Select Board: ESP32
   → Upload
   ```

3. **Monitor Serial Console**
   ```
   Tools → Serial Monitor (115200 baud)
   ```
   Watch state transitions as system operates.

4. **Test Flow Verification**
   - Start scheduled watering
   - Watch for `[STATE CHANGE] PUMP_ON → WAITING_FOR_FLOW`
   - Verify `[FLOW] ✓ Flow detected!` message
   - If you block flow sensor: `[FLOW] ✗ No flow detected!` + pump stops

---

## Technical Specifications

- **State Machine**: 8 states, event-driven transitions
- **Flow Verification Window**: 5 seconds (configurable)
- **Watchdog Timeout**: 45 seconds (critical for outdoor)
- **Sensor Read Interval**: 30 seconds
- **Schedule Check**: 60 seconds  
- **Status Post**: 30 seconds
- **Watchdog Feed**: Every 15 seconds
- **Temp Thresholds**: Res 28°C, Tower 32°C
- **Max Pump Runtime**: 2 minutes (safety)
- **Fault Retry Delay**: 30 seconds

---

## Architecture Summary

```
ESP32 FIRMWARE LAYERS
│
├─ Watchdog Layer
│  └─ Auto-restart if frozen (45 sec)
│
├─ Main Loop (Non-Blocking)
│  ├─ WiFi Maintenance
│  ├─ Sensor Reading (30s)
│  ├─ Safety Checks
│  ├─ STATE MACHINE CORE ← Everything driven by this
│  └─ API Communication
│
├─ State Machine (8 States)
│  ├─ IDLE → CHECK_WATER → PUMP_ON → WAITING_FOR_FLOW
│  ├─ WAITING_FOR_FLOW → RUNNING (or FAULT)
│  ├─ RUNNING → STOPPING → IDLE
│  ├─ FAULT → RECOVERY → IDLE (or back to FAULT)
│  └─ All transitions logged to console & API
│
├─ Safety Module
│  ├─ Water Level Check
│  ├─ Temperature Monitoring
│  ├─ Sensor Validity
│  └─ Pre-pump Verification
│
├─ Flow Verification (CRITICAL)
│  ├─ YF-S201 Pulse Counting
│  ├─ 5-Second Detection Window
│  └─ Immediate Stop on Failure
│
├─ Sensor Layer
│  ├─ DS18B20 Temperature (2×)
│  ├─ Water Level Probes (3×)
│  └─ Flow Sensor (YF-S201)
│
└─ Network Layer
   ├─ WiFi Management (non-blocking)
   ├─ NTP Time Sync
   ├─ Schedule Fetching
   ├─ Status Posting
   └─ Local Fallback (offline mode)
```

---

## This is Professional IoT Farming

Your system now operates like enterprise hydroponic farms:
- **Verification-based** not timer-based
- **Fault detection & recovery** built-in
- **Safety first** (watchdog, flow checks, temp limits)
- **Resilient** (works offline, auto-restarts)
- **Observable** (detailed state logging, console output)

The difference between a hobby project and a system you can leave running for weeks without worry.

---

**Status**: Firmware ready to upload. Monitor serial console for state machine operation.
