# Quick Start Guide — Smart Tower Garden

Get your ESP32 hydroponic system running in 30 minutes!

---

## Step 1: Gather Hardware (5 min)

**Minimum kit**:

- ESP32 DevKit
- 5V Relay Module
- YF-S201 Flow Sensor
- 2× DS18B20 Temperature Sensors
- 12V Submersible Pump
- 3× Metal Probes (6mm brass rod)
- Waterproof box (IP65)
- Jumper wires & resistors (4.7kΩ, 10kΩ)

**From hardware store** (Karnataka):

- Rajesh Electronics (Bangalore)
- Electronics Paradise (Chennai)
- SP Road Market (Bangalore)
- Online: Amazon.in, Robocraze.com, ElectroDuino.com

---

## Step 2: Assemble Hardware (15 min)

### A. Wiring the Control Box

1. **ESP32 GPIO Setup**:
   - GPIO27 → Relay IN
   - GPIO26 → Flow sensor (Yellow)
   - GPIO25 → OneWire data (Temperature + 4.7kΩ pull-up to 5V)
   - GPIO33 → Level probe GND
   - GPIO32/35/34 → Level probes (with 10kΩ pull-downs)

2. **Power Connections**:
   - 5V USB PSU → Terminal block → ESP32 Vin, Relay +5V
   - 12V SMPS → Terminal block → Relay COM, Pump +12V
   - All GND together at single point

3. **Mount in box**:
   - ESP32 on 3M pads
   - Relay on DIN rail
   - Terminal blocks secured
   - Cable glands for water-tight routing

### B. Sensor Installation

**In the tank**:

- Temperature sensors in mesh bags, submerged 10cm deep
- Level probes suspended vertically (GND + 3 probes spaced 10cm apart)
- Flow sensor in pump discharge line (arrow pointing toward tank)

**Outside**:

- WiFi antenna external (if available)
- Power supplies plugged outside
- All cables routed through waterproof glands

---

## Step 3: Install Arduino IDE & Upload Code (8 min)

### 3.1 Install Arduino IDE

- Download: https://www.arduino.cc/en/software
- Install normally

### 3.2 Add ESP32 Support

1. **Preferences** → Additional Board URLs:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
2. **Sketch** → **Include Library** → **Manage Libraries**
3. Install:
   - `OneWire` (by Jim Studt)
   - `DallasTemperature` (by Miles Burton)

### 3.3 Upload Code

1. Download `tower-controller.ino` from the project
2. **Open in Arduino IDE**
3. **Edit configuration** (lines 20-30):
   ```cpp
   const char* WIFI_SSID = "YourWiFiName";
   const char* WIFI_PASS = "YourPassword";
   const char* API_BASE_URL = "https://your-domain.com";
   ```
4. **Tools** → **Board** → **ESP32 Dev Module**
5. **Tools** → **Port** → Select your COM port
6. **Upload** → Wait for "Hard resetting via RTS pin..."
7. **Tools** → **Serial Monitor** (baud 115200)

Watch for:

```
=== SMART TOWER GARDEN STARTING ===
✓ Temperature sensors initialized
✓ WiFi connected!
IP: 192.168.1.x
```

---

## Step 4: Configure Dashboard (2 min)

### A. Access Dashboard

Open: `https://your-domain.com` (or localhost:3000 if local)

### B. Set Pump Schedule

Go to **Schedule** tab:

- **Interval**: 30 minutes (how often pump runs)
- **Duration**: 60 seconds (how long pump runs each time)
- **Start hour**: 6 (morning)
- **End hour**: 19 (evening)
- **Enabled**: Toggle ON

Click **Save**

---

## Step 5: First Run Test (5 min)

### A. Prime the Pump

1. Fill tubing with water manually
2. ESP32 should auto-start pump in <1 minute
3. Watch **Serial Monitor** for flow detection

### B. Check Dashboard

- **Status** tab should show:
  - Pump: ON
  - Flow: YES (after 5 seconds)
  - Water Level: MEDIUM or FULL
  - Temperatures: ~20-25°C

### C. Manual Readings

1. Go to **Manual Readings** tab
2. Use handheld pH meter: test water, enter value
3. Use TDS meter: test water, enter value
4. Add note: "Initial setup"
5. Click **Log reading**

**Ideal ranges**:

- pH: 5.5–6.5
- TDS: 560–1400 ppm
- EC: 1.2–2.4 mS/cm

---

## Step 6: Daily Maintenance

### Morning (5 min)

1. **Check tank water level** — Refill if LOW
2. **Check pump** — Listen for clicking/humming
3. **Log manual readings** — pH, TDS (use meters)
4. **Watch temperature** — Note if >25°C or <15°C

### Afternoon (2 min)

1. **Check dashboard** — Any red faults?
2. **Monitor flow** — Listen for water sound in tower

### Weekly (10 min)

1. **Clean flow sensor** — Remove debris, rinse with distilled water
2. **Clean level probes** — Vinegar + soft brush to remove mineral buildup
3. **Check tubing** — Look for cracks or algae inside
4. **Verify nutrient** — TDS should stay 560-1400 ppm
5. **Top up tank** — Add distilled water (not nutrient)

### Monthly (20 min)

1. **Full water change** — Drain & refill completely
2. **Deep clean probes** — Scrub with soft brush
3. **Check pH drift** — Should be stable ±0.2
4. **Inspect pump** — No water leaks?
5. **Test each sensor** — Verify readings are accurate

---

## Troubleshooting Quick Reference

| Problem                    | Check                         | Fix                                            |
| -------------------------- | ----------------------------- | ---------------------------------------------- |
| **Pump won't turn on**     | ESP32 WiFi connected?         | Restart ESP32, check WiFi name/pass            |
|                            | Relay clicking?               | Check 12V supply to relay                      |
|                            | Pump power ok?                | Test 12V at pump with multimeter               |
| **No flow**                | Flow sensor triggered?        | Manual spin sensor wheel while watching Serial |
|                            | Pump prime ok?                | Fill tube manually, clear blockage             |
|                            | Sensor yellow wire connected? | Reseat GPIO26 connection                       |
| **Low water alert**        | Tank level low?               | Refill to MEDIUM or FULL                       |
|                            | Level probe corroded?         | Clean probe, test with multimeter              |
| **Wrong temperature**      | Sensor in water?              | Verify placement, check depth                  |
|                            | OneWire pull-up ok?           | Test 4.7kΩ resistor with multimeter            |
| **WiFi disconnects**       | Signal weak?                  | Move antenna, move box closer to router        |
|                            | Password wrong?               | Check WiFi credentials in code                 |
| **Dashboard not updating** | API URL correct?              | Verify `API_BASE_URL` matches your domain      |
|                            | Backend running?              | Check Supabase/backend status                  |

---

## Fault Codes Explained

See dashboard **Status** tab:

- 🟢 **OK** — All good, normal operation
- 🟡 **LOW_WATER** — Tank needs refill (not pumping)
- 🔴 **DRY_RUN** — Pump on but no flow (blockage?)
- 🔴 **FLOW_TIMEOUT** — Flow stopped mid-cycle (clog?)
- 🟡 **SENSOR_FAIL** — Temperature or level sensor broken (check wiring)
- 🟡 **WIFI_LOST** — Network was down briefly (auto-recovered)

---

## Optional Enhancements

### Add External WiFi Antenna

- Improves signal 2× better than built-in
- Cost: ₹50-100
- Install: Screw SMA connector to ESP32 (pigtail cable)

### Add pH Automatic Adjustment

- Use solenoid valves + acids/bases
- Advanced (not recommended for beginners)
- Cost: +₹2,000

### Add Automatic Nutrient Dosing

- Requires EC/CF sensor + peristaltic pump
- Advanced (not recommended for beginners)
- Cost: +₹3,000

### Add Mobile App Notifications

- Use Telegram/email API
- Simple: ~50 lines of code
- Alerts on LOW_WATER, DRY_RUN faults

---

## Important Safety Reminders

⚠️ **Electrical**:

- Always turn off power when working on electronics
- Check 12V supply before plugging in
- Never touch exposed 12V wires with wet hands

⚠️ **Water**:

- Always prime pump before first start
- Don't run pump with LOW water level
- Change water every 2-3 weeks

⚠️ **Garden**:

- Don't use tap water alone (no nutrients)
- Check pH daily (changes kill plants fast)
- Remove algae/debris weekly

---

## Support Resources

- **Full Hardware Guide**: See `HARDWARE_SETUP.md`
- **API Reference**: See `API_REFERENCE.md`
- **Arduino OneWire Lib**: https://www.pjrc.com/teensy/td_libs_OneWire.html
- **Hydroponic Basics**: https://www.hydroponics.net/

---

## Next Steps After Setup

1. ✅ Run for 3-5 days, watch dashboard daily
2. ✅ Log pH/TDS/EC every morning
3. ✅ Adjust pump schedule based on tank depletion
4. ✅ Fine-tune nutrient levels (TDS) if drifting
5. ✅ Plant seedlings after 2 weeks of stable readings

---

**Happy growing! 🌱**

**Questions?** Check Discord community or GitHub Issues.

---

**Last updated: 15-May-2026**  
**Version: 1.0 — Beginner-Friendly**
