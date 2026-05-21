# Fault Codes Reference — Smart Tower Garden

Complete guide to understanding and fixing fault codes displayed on your ESP32 hydroponic controller.

---

## Quick Fault Reference

| Code             | Severity    | Icon | Meaning                  | Action                     |
| ---------------- | ----------- | ---- | ------------------------ | -------------------------- |
| **OK**           | ✅ Good     | 🟢   | All systems healthy      | Monitor normally           |
| **DRY_RUN**      | 🔴 Critical | 🚨   | Pump on but no flow      | Prime pump, check blockage |
| **FLOW_TIMEOUT** | 🔴 Critical | 🚨   | Flow stopped mid-cycle   | Check discharge line       |
| **LOW_WATER**    | 🟡 Warning  | ⚠️   | Tank nearly empty        | Refill tank ASAP           |
| **SENSOR_FAIL**  | 🟡 Warning  | ⚠️   | Sensor connection broken | Check wiring               |
| **WIFI_LOST**    | ℹ️ Info     | ℹ️   | Network unavailable      | Check WiFi, restart ESP32  |

---

## 🔴 CRITICAL FAULTS

### DRY_RUN — Pump Running But No Flow

**What it means**:

- Pump relay activated and started running
- BUT flow sensor detected **zero pulses within 5 seconds**
- Pump is either blocked, not primed, or flow sensor failed

**Why it happens**:

- Pump not properly primed (air in suction line)
- Discharge line is clogged (mineral buildup, debris)
- Pump impeller stuck or jammed
- Flow sensor wiring disconnected
- Water tank empty or outlet submerged

**What happens**:

- Pump stops automatically (prevents damage)
- Status shows "DRY_RUN" fault code
- Dashboard shows red alert
- No pump cycles until fixed

**How to fix**:

1. **Check pump operation**:

   ```
   Listen: Should hear motor humming
   Feel: Check discharge tube for water pressure
   Visual: Look for leaks around pump seal
   ```

2. **Prime the pump** (most common fix):

   ```
   1. Turn off pump (via dashboard)
   2. Fill discharge tubing with water manually
   3. Tap reservoir to remove air bubbles
   4. Turn pump back on
   5. Listen for water flowing
   ```

3. **Check for blockage**:

   ```
   1. Turn off pump
   2. Disconnect discharge tube from tank outlet
   3. Hold tube over bucket, turn pump on
   4. If water flows → blockage is downstream (in tower)
   5. If no water → blockage is in pump suction line
   ```

4. **Test flow sensor**:

   ```
   Arduino Serial Monitor → Watch for flow pulses
   Manually spin sensor wheel with finger
   Should see rapid pulse count increases
   If not → Yellow wire may be disconnected
   ```

5. **Last resort**:
   ```
   Try manually pumping 1-2 liters
   Then turn on pump again
   Sometimes pump needs more priming
   ```

**Prevention**:

- Always prime pump before first run
- Check discharge line monthly for mineral buildup
- Rinse suction strainer weekly
- Add inline filter to prevent debris

---

### FLOW_TIMEOUT — Flow Stopped Mid-Cycle

**What it means**:

- Pump started and flow was detected (good)
- BUT water flow **stopped before cycle completed**
- Flow sensor pulse count dropped to zero mid-operation

**Why it happens**:

- Discharge line became clogged (mineral crystals forming)
- Air bubble entered system
- Tank level dropped below outlet (siphon broke)
- Pump cavitation (suction line blocked)
- Flow sensor connection intermittent

**What happens**:

- Pump stops automatically after 3 seconds of no flow
- Cycle marked as fault
- Logged to database for trend analysis
- Dashboard shows red alert

**How to fix**:

1. **Immediate check**:

   ```
   1. Check tank water level (should be above pump outlet)
   2. Listen to pump (humming or silent?)
   3. Feel discharge tube (should be warm = water flowing)
   4. Check tower base (is water backing up?)
   ```

2. **Check for clogs**:

   ```
   1. Turn off pump
   2. Inspect discharge line for white mineral deposits
   3. Disconnect tower distribution lines
   4. Manually pump 2-3 liters through system
   5. If water flows → clog is in tower
   6. If blocked → clog is in pump outlet
   ```

3. **Mineral dissolution** (for calcium buildup):

   ```
   1. Prepare weak vinegar solution (1 part vinegar : 3 parts water)
   2. Flush through tubing for 5 minutes
   3. Let soak for 30 minutes
   4. Flush with fresh water
   5. Restart pump test
   ```

4. **Check tower distribution**:

   ```
   1. Manually pour water into tower top
   2. Watch how fast it drains back to reservoir
   3. If slow → drip lines may be clogged
   4. Remove tower from base
   5. Inspect holes for mineral buildup
   6. Use needle to clear blocked drip holes
   ```

5. **Test pump independently**:
   ```
   1. Disconnect tower completely
   2. Hold discharge tube into bucket
   3. Run pump for 30 seconds
   4. Should pump 1-2 liters minimum
   5. If weak → pump impeller wear or bearing issue
   ```

**Prevention**:

- Change water completely every 2-3 weeks (reduces mineral buildup)
- Use distilled water in summer (tap water has minerals)
- Install inline pre-filter (mesh strainer)
- Inspect tower distribution holes monthly
- Keep tower outlet above water level (prevents siphon)

---

## 🟡 WARNINGS (Non-critical, but needs attention)

### LOW_WATER — Tank Water Level is Low

**What it means**:

- Water level sensor detected water at **LOW probe only**
- Tank level has dropped significantly
- Next pump cycle will be **skipped** to prevent dry-run

**Why it happens**:

- Plants or evaporation consumed water
- Nutrient solution concentrated as water depletes
- Leak in system (check connections)
- Measurement error (probe dirty)

**What happens**:

- Pump doesn't run (safety feature)
- Alert shown on dashboard
- Cycles skipped until tank refilled
- Fault logged for statistics

**How to fix**:

1. **Immediate**:

   ```
   1. Shut down system (save plants from heat)
   2. Disconnect nutrient tubing (prevent spill)
   3. Drain remaining water into bucket
   4. Measure volume remaining (for troubleshooting)
   ```

2. **Refill tank**:

   ```
   1. Add distilled or RO water (NOT tap water - too many minerals)
   2. Fill to TOP probe (full mark)
   3. Mix gently (don't create foam)
   4. Let sit 5 minutes to settle
   5. Turn system back on
   ```

3. **Troubleshoot leak** (if tank drained too fast):

   ```
   1. Check pump outlet connections (dripping?)
   2. Inspect tubing along tower (wet spots?)
   3. Look at tower base (water pooling?)
   4. Check tank bottom for cracks
   5. Verify level probe GND connection
   ```

4. **Recalibrate probes** (if reading wrong):
   ```
   1. Manually fill tank to exact MEDIUM level
   2. Use multimeter to test MED probe
   3. Should read ~100Ω when submerged
   4. Compare HIGH probe (should be same when submerged)
   5. If HIGH/MED give same reading → they're at same height
   6. Adjust probe positions if needed (should be 10cm apart)
   ```

**Prevention**:

- Check tank level **every morning** (1 minute)
- Add water daily (plants evaporate 3-5% per day)
- Use distilled water (prevents mineral buildup)
- Monitor nutrient TDS — as water evaporates, TDS increases
- Keep tank out of direct noon sun (slows evaporation)

---

### SENSOR_FAIL — Temperature or Level Sensor Broken

**What it means**:

- OneWire temperature sensor **not responding** (returning invalid reading like 85°C or -127°C)
- OR level probe showing **inconsistent behavior**
- Sensor likely disconnected or damaged

**Why it happens**:

- OneWire data line disconnected (GPIO25)
- Missing or bad 4.7kΩ pull-up resistor
- Temperature sensor damage (water entry, corrosion)
- Level probe corroded beyond repair
- Short circuit in sensor wiring

**What happens**:

- Temperature shows "—" on dashboard (null value)
- Water level detection unreliable
- Fault logged to database
- Pump may behave unpredictably without temp data

**How to fix**:

1. **OneWire (Temperature) Sensor**:

   ```
   1. Open Arduino Serial Monitor (baud 115200)
   2. Watch for sensor readings
   3. If shows 85°C → sensor disconnected
   4. If shows -127°C → sensor short circuit

   Physical checks:
   1. Check Yellow wire to GPIO25 (secure?)
   2. Verify 4.7kΩ resistor connected between GPIO25 and +5V
   3. Test resistor with multimeter (should read 4.7k)
   4. Reseat sensor connector
   5. Check for water inside wire jacket
   ```

2. **Temperature Sensor Details**:

   ```
   DS18B20 has 3 wires:
   - Red: +5V (check power)
   - Black: GND (check ground)
   - Yellow: Data/DQ (should go to GPIO25)

   Test with multimeter:
   1. Power on
   2. Red to +5V, Black to GND (should read ~0.1V on DQ)
   3. If no voltage on DQ → open circuit
   4. If DQ shorts to GND → short circuit (replace sensor)
   ```

3. **Level Probe Issues**:

   ```
   Test each probe with multimeter:
   1. Set multimeter to Ohms (Ω)
   2. One probe on GND metal rod
   3. Other probe on level probe (LOW/MED/HIGH)
   4. In air: should read very high (>1MΩ, open circuit)
   5. In water: should read 500-5000Ω (closed circuit)

   If probe doesn't change resistance in water:
   1. Check corrosion (white/green coating)
   2. Clean with vinegar (let soak 10 min)
   3. Scrub with soft brush
   4. If still won't work → probe is corroded beyond repair
   5. Replace with new brass rod
   ```

4. **OneWire Wiring Verification**:

   ```
   ESP32 → OneWire devices:
   GPIO25 (Data) ──┬── DS18B20 #1 (Yellow/DQ)
                  ├── DS18B20 #2 (Yellow/DQ)
                  ├── 4.7kΩ Resistor
                  └── Resistor other end to +5V

   All sensor grounds (Black) → GND terminal block
   All sensor reds (+) → +5V terminal block
   ```

5. **Replace sensor** (if damaged):
   ```
   1. Note current position and sensor number
   2. Unsolder or desolder old sensor (use desoldering wick)
   3. Install new DS18B20 with same polarity
   4. Resolder carefully (avoid cold solder joints)
   5. Test reading in Serial Monitor
   6. Should show valid temperature within 10 seconds
   ```

**Prevention**:

- Use waterproof connectors (not soldered directly in water)
- Enclose sensors in small plastic tubes (protects from direct mud/salt)
- Use stainless steel probes (brass oxidizes faster)
- Check sensor wiring monthly for corrosion
- Provide strain relief on wires (prevents physical damage)

---

### WIFI_LOST — Network Unavailable

**What it means**:

- ESP32 lost WiFi connection for **more than 5 minutes**
- Network may have been down, router rebooted, or signal poor
- System **kept running on local schedule** (didn't wait for cloud)
- Connection has now been **restored**

**Why it happens**:

- WiFi router power cycled
- Interference on 2.4 GHz band
- Signal strength dropped below -70 dBm
- Network password changed
- Temporary ISP outage
- ESP32 WiFi module issue

**What happens**:

- Pump continues operating on **local stored schedule** (good!)
- Dashboard updates stop during offline period
- Sensor data is queued locally
- When WiFi returns, data syncs to cloud
- Fault is logged for diagnostics

**How to fix**:

1. **Immediate check**:

   ```
   1. Watch Serial Monitor for reconnection message
   2. Check other WiFi devices (are they connected?)
   3. Restart WiFi router if no other devices working
   4. Restart ESP32 (press RESET button)
   ```

2. **Check WiFi signal**:

   ```
   1. Measure distance from ESP32 to router
   2. Should be <10 meters for stable connection
   3. Check for obstacles (metal, water, concrete walls)
   4. Move router closer or relocate ESP32
   5. Point antenna straight up (if external antenna)
   ```

3. **Verify WiFi credentials**:

   ```
   1. In Arduino code, verify SSID and password are correct
   2. Check for spaces, special characters, case sensitivity
   3. Restart WiFi (disconnect and reconnect)
   4. Try connecting another device to confirm network works
   5. If password recently changed, update ESP32 code
   ```

4. **Improve signal**:

   ```
   - Add external antenna (costs ₹50-100, improves 2× signal)
   - Move ESP32 closer to router
   - Elevate ESP32 (place on shelf, not on ground)
   - Reduce obstacles between ESP32 and router
   - Switch to 2.4 GHz band (if router supports dual-band)
   ```

5. **Monitor reconnection**:
   ```
   Serial Monitor shows:
   "✗ WiFi disconnected, reconnecting..."
   [after <1 minute]
   "✓ WiFi connected!"
   IP: 192.168.1.x
   ```

**Prevention**:

- Place ESP32 in good WiFi coverage area
- Use external antenna if available
- Restart WiFi router weekly (good practice)
- Monitor WiFi signal strength (target: -50 to -65 dBm)
- Keep WiFi password secure but remember it
- Have backup local-only operation (system still runs offline)

---

## ✅ OK — All Systems Healthy

**What it means**:

- No faults detected
- Pump operating normally
- Sensors responsive and within range
- WiFi connected (if applicable)

**When to expect it**:

- Most of the time during normal operation
- After successfully fixing a previous fault
- During idle periods (no pump cycle)

**What to monitor even with OK status**:

- Tank water level (should stay MEDIUM or FULL)
- Temperature trends (should be stable)
- Pump cycle frequency (should follow schedule)
- Flow success rate (should be >95%)
- pH drift (should be stable ±0.2)

---

## 🔧 Advanced Troubleshooting

### Faults Appearing Sporadically

**DRY_RUN appearing randomly**:

- Possible intermittent flow sensor connection
- Check GPIO26 wire for loose connections
- Test sensor by manually spinning wheel
- Replace flow sensor if inconsistent

**SENSOR_FAIL appearing then disappearing**:

- Likely OneWire data line noise
- Add 100nF capacitor between GPIO25 and GND
- Move sensor wires away from power lines
- Verify 4.7kΩ pull-up is exactly 4.7k (not 4.8k)

### Multiple Faults in One Day

- Something changed in environment or setup
- Check for new electrical interference
- Verify no accidental wire disconnections
- Test sensors with multimeter
- Review pump cycle logs for patterns

### Pump Cycles Skipping Unexpectedly

- Water level dropping faster than expected (leak?)
- Pump schedule misconfigured
- System time wrong (check NTP sync)
- Pump stalling due to blockage (causes FLOW_TIMEOUT)

---

## 📊 Fault Trending

Check dashboard **Pump Statistics** tab to see:

- **Fault count over time** — Trending up? Indicates developing problem
- **Success rate** — Below 90%? Investigate causes
- **Recent cycles** — Any pattern? (e.g., fails at certain time)

**Example analysis**:

```
Total cycles: 120
Successful: 108 (90%)
Failed: 12

Fault breakdown:
- DRY_RUN: 8 (early morning cycles)
  → Pump needs better priming
- FLOW_TIMEOUT: 3 (afternoon cycles)
  → Mineral buildup in discharge line
- LOW_WATER: 1 (isolated incident)
  → Normal, tank was low

Action:
1. Prime pump better (add 2L manually before cycle)
2. Flush discharge line with vinegar solution
3. Monitor success rate in coming days
```

---

## 📞 When to Replace Hardware

| Component              | Symptom                                                       | Action                            |
| ---------------------- | ------------------------------------------------------------- | --------------------------------- |
| **Flow Sensor**        | Always shows no flow, even when pump running + manually spins | Replace sensor (~₹250)            |
| **Temperature Sensor** | Always reads 85°C or -127°C, resolder doesn't fix             | Replace DS18B20 (~₹50)            |
| **Level Probe**        | Doesn't respond to water submersion, won't clean              | Replace with new brass rod (~₹30) |
| **Pump**               | Weak output, produces strange noise                           | Replace pump (~₹400-800)          |
| **Relay**              | Clicks but doesn't energize output                            | Replace relay module (~₹80-120)   |
| **ESP32**              | Multiple sensors fail, WiFi can't connect                     | Replace ESP32 (~₹500)             |

---

## 📋 Fault Log CSV Export

Example of fault log data (for analysis):

```csv
timestamp,fault_code,duration_sec,flowed,action_taken
2026-05-15T06:30:00Z,DRY_RUN,0,false,Primed pump - resolved
2026-05-15T07:00:00Z,OK,61,true,—
2026-05-15T07:30:00Z,OK,59,true,—
2026-05-15T14:00:00Z,FLOW_TIMEOUT,30,true,Flushed discharge line
2026-05-15T14:30:00Z,OK,62,true,—
```

Use this to identify patterns and predict failures!

---

**Last updated: 15-May-2026**  
**Version: 1.0**

Need help? Check [HARDWARE_SETUP.md](HARDWARE_SETUP.md#troubleshooting-guide) or contact support.
