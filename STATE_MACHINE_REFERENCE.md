# State Machine Quick Reference

## The 8 States Explained (Simple Version)

### 🟢 STATE_IDLE
**What it does**: Waits for watering time  
**Exit by**: Schedule triggers → goes to CHECK_WATER  
**Serial output**: Nothing (quiet waiting)  

---

### 🟡 STATE_CHECK_WATER
**What it does**: Runs safety checks before pump starts  
**Checks**:
- ✓ Water level not LOW
- ✓ Sensors working properly
- ✓ Temperature not too high

**Exit by**: 
- All checks pass → PUMP_ON
- Any check fails → FAULT

**Serial output**:
```
[SAFETY] Running pre-pump checks...
✓ All pre-pump checks passed
```

---

### 🔴 STATE_PUMP_ON
**What it does**: Turns relay ON to start pump  
**Hardware**: GPIO 27 HIGH (relay energized)  
**Duration**: Instantaneous → immediately goes to WAITING_FOR_FLOW  

**Serial output**:
```
[PUMP] Starting pump...
[PUMP] Scheduled duration: 60 seconds
[PUMP] Entering flow verification window: 5 seconds
```

---

### 🚨 STATE_WAITING_FOR_FLOW (CRITICAL)
**What it does**: **Verifies water actually flows**  
**Duration**: 5 seconds maximum  
**Monitoring**: YF-S201 flow sensor pulses  

**Two Outcomes**:

**Option A - Flow Detected ✓**
```
[FLOW] ✓ Flow detected! Pump confirmed working
[STATE CHANGE] WAITING_FOR_FLOW → RUNNING
```
→ Continues to RUNNING state

**Option B - No Flow After 5 Seconds ✗** (DRY_RUN)
```
[FLOW] ✗✗✗ CRITICAL: No flow detected after 5 seconds!
[PUMP] ✗✗✗ Stopping pump immediately - DRY_RUN condition
[STATE CHANGE] WAITING_FOR_FLOW → FAULT
```
→ Pump stops immediately, goes to FAULT

---

### 🟦 STATE_RUNNING
**What it does**: Normal pump operation with monitoring  
**Duration**: Scheduled time (e.g., 60 seconds)  
**Monitoring**:
- ✓ Flow still present (every 3 seconds)
- ✓ Temperature still OK
- ✓ Haven't exceeded 2-minute safety timeout

**Exit by**:
- Time expires → STOPPING
- Flow stops mid-cycle → STOPPING
- Temperature too high → STOPPING
- 2-minute timeout → STOPPING

**Serial output**:
```
[STATE CHANGE] WAITING_FOR_FLOW → RUNNING
(silent during normal operation)
[PUMP] Scheduled duration reached, stopping
```

---

### 🟧 STATE_STOPPING
**What it does**: Gracefully stop pump and log cycle  
**Hardware**: GPIO 27 LOW (relay de-energized)  
**Actions**:
1. Turn off pump
2. Calculate runtime
3. Log to API (with flow status)

**Serial output**:
```
[PUMP] Stopping pump...
[PUMP] Total runtime: 60.0 seconds, Flow detected: YES
[LOG] Pump cycle logged ✓
```

**Exit by**: Immediately after logging → IDLE

---

### 🔴 STATE_FAULT
**What it does**: Error state - pump OFF, waiting to recover  
**Possible Faults**:
- `LOW_WATER` - Tank empty/low
- `DRY_RUN` - No flow after start
- `FLOW_STOPPED` - Flow lost mid-cycle
- `PUMP_TIMEOUT` - Ran > 2 min
- `TEMP_HIGH` - Too hot
- `SENSOR_FAIL` - Sensor broken

**Duration**: Waits 30 seconds  
**Hardware**: Pump OFF (GPIO 27 LOW)

**Serial output**:
```
[FAULT] LOW_WATER detected at 45230
(waits 30 seconds)
```

**Exit by**: 
- 30 seconds passed → RECOVERY
- (or stays in FAULT if fault persists)

---

### 🟠 STATE_RECOVERY
**What it does**: Check if fault is resolved  
**Actions**:
1. Read sensors fresh
2. Check if water level is OK now
3. Check if sensors are working

**Two Outcomes**:

**A - Fault Resolved ✓**
```
[RECOVERY] ✓ Conditions safe, returning to IDLE
[STATE CHANGE] RECOVERY → IDLE
```

**B - Fault Still Present ✗**
```
[RECOVERY] ✗ Fault conditions still present, staying in FAULT
[STATE CHANGE] RECOVERY → FAULT
```
→ Waits another 30 seconds, tries again

---

## State Transitions at a Glance

```
IDLE
 ↓ [schedule time]
CHECK_WATER
 ├→ [PASS] → PUMP_ON
 └→ [FAIL] → FAULT

PUMP_ON (instant)
 ↓
WAITING_FOR_FLOW (5 sec)
 ├→ [FLOW DETECTED] → RUNNING
 └→ [NO FLOW] → FAULT

RUNNING
 ├→ [TIME EXPIRED] → STOPPING
 ├→ [FLOW STOPPED] → STOPPING
 ├→ [FAULT] → STOPPING
 └→ [TIMEOUT] → STOPPING

STOPPING (logs cycle)
 ↓
IDLE or FAULT (depending on what happened)

FAULT (30 sec wait)
 ↓
RECOVERY (check sensors)
 ├→ [RESOLVED] → IDLE
 └→ [NOT RESOLVED] → FAULT (repeat)
```

---

## What You'll See on Serial Console

### Normal Watering Cycle
```
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
[PUMP] Scheduled duration reached, stopping
[STATE CHANGE] RUNNING → STOPPING
[PUMP] Total runtime: 60.0 seconds, Flow detected: YES
[LOG] Pump cycle logged ✓
[STATE CHANGE] STOPPING → IDLE
```

### DRY_RUN Fault (No Water Flowing)
```
[STATE CHANGE] IDLE → CHECK_WATER
[SAFETY] Running pre-pump checks...
✓ All pre-pump checks passed
[STATE CHANGE] CHECK_WATER → PUMP_ON
[PUMP] Starting pump...
[PUMP] Entering flow verification window: 5 seconds
[STATE CHANGE] PUMP_ON → WAITING_FOR_FLOW
[FLOW] ✗✗✗ CRITICAL: No flow detected after 5 seconds!
[PUMP] ✗✗✗ Stopping pump immediately - DRY_RUN condition
[STATE CHANGE] WAITING_FOR_FLOW → FAULT
(waits 30 seconds)
[STATE CHANGE] FAULT → RECOVERY
[RECOVERY] Checking if conditions are safe to retry...
[RECOVERY] ✗ Fault conditions still present, staying in FAULT
```

### LOW_WATER Fault
```
[STATE CHANGE] IDLE → CHECK_WATER
[SAFETY] Running pre-pump checks...
✗ SAFETY HALT: Water level is LOW
[STATE CHANGE] CHECK_WATER → FAULT
(waits 30 seconds for tank to refill)
```

---

## Key Points to Remember

1. **STATE_WAITING_FOR_FLOW is CRITICAL**
   - This is where flow verification happens
   - 5-second window only
   - NO FLOW = immediate pump stop

2. **Non-Blocking Throughout**
   - No delay() anywhere
   - System always responsive
   - Watchdog always sees activity

3. **Safety First**
   - Pre-pump checks (water level, temps)
   - Flow verification (prevents dry-run)
   - Continuous monitoring (flow, temp, time)

4. **Fault Recovery**
   - Faults don't crash system
   - 30-second recovery delay
   - Automatic retry when conditions OK

5. **Local Fallback**
   - WiFi offline? No problem.
   - Watering continues on local schedule
   - API posts fail silently, not fatally

---

## Testing the State Machine

### Test 1: Normal Flow
1. Block flow sensor
2. Watch for: `PUMP_ON → WAITING_FOR_FLOW`
3. Unblock sensor
4. Watch for: `[FLOW] ✓ Flow detected!`
5. Confirm pump continues to RUNNING

### Test 2: Dry-Run Detection
1. Block flow sensor
2. Start watering
3. Watch for: `[FLOW] ✗✗✗ CRITICAL: No flow`
4. Confirm pump stops within 5 seconds
5. Check for: `DRY_RUN` fault message

### Test 3: Low Water
1. Lower water level to LOW
2. Trigger watering schedule
3. Watch for: `✗ SAFETY HALT: Water level is LOW`
4. Confirm pump never starts
5. Add water, watch recovery

### Test 4: Watchdog (Optional)
1. Upload test code that deliberately freezes
2. System should restart in 45 seconds
3. Check serial console for watchdog restart message

---

## Architecture in One Picture

```
┌──────────────────────────────────────────┐
│          MAIN LOOP                       │
│  (runs every 100ms non-blocking)         │
└──┬───────────────────────────────────────┘
   │
   ├─→ Feed Watchdog (every 15 sec)
   ├─→ Check WiFi (every 5 sec)
   ├─→ Read Sensors (every 30 sec)
   ├─→ Check Safety Thresholds
   ├─→ Fetch Schedule (every 60 sec)
   │
   └─→ ┌─────────────────────────────────┐
       │  STATE MACHINE DISPATCHER       │
       │  (THE CORE OF EVERYTHING)       │
       └─┬───────────────────────────────┘
         │
         ├─→ [IDLE]
         ├─→ [CHECK_WATER]
         ├─→ [PUMP_ON]
         ├─→ [WAITING_FOR_FLOW] ← CRITICAL
         ├─→ [RUNNING]
         ├─→ [STOPPING]
         ├─→ [FAULT]
         └─→ [RECOVERY]
   
   └─→ Post Status to API (every 30 sec)
```

---

**Key Takeaway**: Your system now operates using STATES, not just timers. Each state has a clear purpose, and transitions are deterministic and logged.
