# ESP32 Smart Tower Garden — Hardware Setup Guide

## Overview

This is a **beginner-friendly IoT system** for an outdoor gravity-fed vertical aeroponic/hydroponic tower in India. The system is:

- ✅ **Low-cost** — ~₹8,000-12,000 (~$100-150 USD)
- ✅ **Reliable** — Simple components with proven designs
- ✅ **Easy to maintain** — Minimal calibration, manual readings only
- ✅ **Outdoor-safe** — Waterproof, weatherproof design

---

## Bill of Materials (BOM)

### Electronics

| Item                                 | Qty    | Purpose             | Est. Cost |
| ------------------------------------ | ------ | ------------------- | --------- |
| **ESP32 DevKit**                     | 1      | Main controller     | ₹400-600  |
| **5V Relay Module** (SRD-05VDC-SL-C) | 1      | Pump control        | ₹80-120   |
| **YF-S201 Flow Sensor**              | 1      | Flow verification   | ₹250-350  |
| **DS18B20 Waterproof**               | 2      | Temperature sensors | ₹150-200  |
| **12V SMPS Power Supply**            | 1      | Power for pump      | ₹300-400  |
| **5V USB Power**                     | 1      | ESP32 power         | ₹100-150  |
| **Resistors** (4.7kΩ)                | 3      | OneWire pull-ups    | ₹10       |
| **Resistors** (10kΩ)                 | 3      | Level probe sensing | ₹10       |
| **Wires** (22AWG)                    | 1 pack | Connections         | ₹80       |
| **Terminal blocks**                  | 2x3    | Power distribution  | ₹40       |
| **Waterproof box**                   | 1      | Housing             | ₹200-300  |
| **Weatherproof cable glands**        | 6      | Wire routing        | ₹80       |

### Mechanical

| Item                              | Qty       | Purpose           | Est. Cost |
| --------------------------------- | --------- | ----------------- | --------- |
| **Submersible 12V pump** (3-10W)  | 1         | Water circulation | ₹400-800  |
| **Copper/brass probes** (6mm rod) | 3 + 1 GND | Level sensing     | ₹100      |
| **Plastic tubing** (12mm)         | 2m        | Water channels    | ₹100      |
| **Metal enclosure mounting**      | 1 set     | Box mounting      | ₹150      |

### Water/Garden

| Item                      | Qty | Purpose               | Est. Cost |
| ------------------------- | --- | --------------------- | --------- |
| **pH Meter** (handheld)   | 1   | Manual pH reading     | ₹300-500  |
| **TDS Meter**             | 1   | Manual TDS/EC reading | ₹150-300  |
| **Reservoir tank**        | 1   | 50-100L capacity      | ₹600-1200 |
| **Hydroton/Clay pellets** | 2kg | Growing medium        | ₹300      |
| **Hydroponic nutrient**   | 1   | A + B formula         | ₹800-1200 |

**Total estimated cost: ₹5,000-10,000 (~$60-120 USD)**

---

## GPIO Pin Mapping

| ESP32 Pin  | Function    | Sensor/Module    | Notes                     |
| ---------- | ----------- | ---------------- | ------------------------- |
| **GPIO27** | Relay OUT   | 5V Relay Module  | Controls pump ON/OFF      |
| **GPIO26** | Interrupt   | YF-S201 Flow     | Rising edge pulses        |
| **GPIO25** | OneWire     | DS18B20 (both)   | Data line + 4.7kΩ pull-up |
| **GPIO33** | Digital OUT | Level probe GND  | Common ground for probes  |
| **GPIO32** | Digital IN  | Level LOW probe  | Low water threshold       |
| **GPIO35** | Digital IN  | Level MED probe  | Medium water threshold    |
| **GPIO34** | Digital IN  | Level HIGH probe | High water threshold      |
| **GND**    | Ground      | All sensors      | Common reference          |
| **5V**     | +5V         | Relay, sensors   | From USB power            |
| **12V**    | +12V        | Pump, SMPS       | From 12V power supply     |

---

## Wiring Diagrams

### Block Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       WiFi + Internet                            │
│                    (Schedule, Manual control)                    │
└─────────────────┬───────────────────────────────┬────────────────┘
                  │                               │
         ┌────────▼────────┐          ┌──────────▼──────────┐
         │   Web Dashboard │          │  Supabase Backend   │
         │  (React + UI)   │          │ (Firestore-like DB) │
         └────────────────┘          └──────────────────────┘
                                              ▲
                                              │
                                    ┌─────────▼──────────┐
                                    │   ESP32 Controller │
                                    │  (Arduino Sketch)  │
                                    └─┬───────────┬──┬───┘
                 ┌──────────────────┘ │           │  └──────────────┐
                 │                    │           │                 │
      ┌──────────▼────┐  ┌────────────▼─┐  ┌─────▼──────┐  ┌───────▼──┐
      │ Relay Module  │  │ Flow Sensor  │  │Temperature │  │Level     │
      │ (GPIO27)      │  │ (GPIO26)     │  │(GPIO25)    │  │Probe     │
      └────┬──────────┘  └──────────────┘  └────────────┘  │GPIO33/32 │
           │                                                │GPIO35/34 │
           │                                                └───────┬──┘
           │                                                        │
      ┌────▼─────────┐                    ┌────────────────────────▼──┐
      │ 12V Pump     │                    │Probe Circuit (Explained   │
      │(12V SMPS)    │                    │in next section)           │
      └──────────────┘                    └───────────────────────────┘
```

### Relay + Pump Wiring

```
12V SMPS
  ├─ +12V ─────┬──────── Pump (+)
  │            │
  │            ├─── Relay COM
  │            │
  └─ GND ──────┼──────── Pump (-)
               │
               ├─── Relay GND
               │
       ┌───────▼─ Relay IN (GPIO27)
       │
     ESP32
```

### Flow Sensor Wiring

```
YF-S201
  ├─ Red (+5V) ────── +5V
  ├─ Black (GND) ─── GND
  └─ Yellow (Pulse) ─ GPIO26 (with pull-up to +5V)
```

### Temperature Sensor Wiring (OneWire)

```
Both DS18B20 sensors wired in parallel on same data line:

DS18B20 #1 (Reservoir)
  ├─ Red (+) ────── +5V
  ├─ Black (-) ─── GND
  └─ Yellow (DQ) ──┐
                   ├─── GPIO25 (with 4.7kΩ pull-up to +5V)
DS18B20 #2 (Tower) │
  ├─ Red (+) ────── +5V
  ├─ Black (-) ─── GND
  └─ Yellow (DQ) ──┘

4.7kΩ Resistor:
  ├─ One end: +5V
  └─ Other end: GPIO25
```

### Water Level Probe Wiring (3-Point Capacitive)

```
Metal Probes (Brass or stainless steel):

  GND Probe (common, placed at tank bottom)
  └─ GPIO33 (Digital OUT, LOW = always)

  LOW Probe (lowest point where pump should stop)
  └─ GPIO32 (Digital IN)
     └─ 10kΩ Resistor to GND

  MED Probe (middle level)
  └─ GPIO35 (Digital IN)
     └─ 10kΩ Resistor to GND

  HIGH Probe (top, tank full)
  └─ GPIO34 (Digital IN)
     └─ 10kΩ Resistor to GND

Circuit Logic:
  When probe is submerged, it conducts via water → pin reads HIGH
  When dry, no conduction → pin reads LOW
```

---

## Probe-Based Water Level Sensing Explained

### Why NOT Ultrasonic or Float?

- **Ultrasonic**: Fails in rain, condensation, salt deposits on sensor
- **Float switch**: Mechanical failure, gets stuck with algae/debris
- **Capacitive probe method**: Simple, reliable, no moving parts

### How the Probe Method Works

The three metal probes act as **capacitive level sensors**:

1. **Setup**: Each probe is a metal rod (6mm brass or stainless steel) suspended in the tank
2. **Detection**: When water surrounds a probe, the water's conductivity completes a circuit → pin reads HIGH
3. **Logic**:
   - All dry → "LOW" (critically low)
   - LOW probe wet → "LOW" (refill needed)
   - MED probe wet → "MEDIUM" (normal operation)
   - HIGH probe wet → "FULL" (tank full)

### Why Use Resistors?

- **Pull-down resistors (10kΩ)** ensure pins read LOW when probes are dry
- Without them, floating pins give random readings

### Corrosion Prevention

- **Probe material**: Use stainless steel **304 or 316** (not copper — oxidizes fast)
- **Alternative**: Brass with clear lacquer coating (food-grade)
- **Maintenance**: Rinse probes monthly with distilled water
- **Anti-fouling**: Clean probes if algae/mineral buildup occurs

---

## Power Distribution

### 5V Line (ESP32 + Sensors)

```
USB 5V PSU
  ├─ +5V ─── Terminal Block ─┬─ ESP32 Vin
  │                          ├─ Relay Module +5V
  │                          ├─ OneWire +5V
  │                          ├─ 4.7kΩ pull-up
  │                          └─ Level probe +5V (if needed)
  │
  └─ GND ─── Terminal Block ─┬─ ESP32 GND
                             ├─ Relay GND
                             ├─ All sensors GND
                             └─ Level probe GND
```

### 12V Line (Pump)

```
12V SMPS (2-3A rated)
  ├─ +12V ─── Terminal Block ─┬─ Relay COM
  │                           └─ Pump +
  │
  └─ GND ─── Terminal Block ───┬─ Relay GND
                               └─ Pump -
```

### Grounding Best Practices

- **Single-point ground**: All grounds connect to one terminal block
- **Avoid ground loops**: Don't run ESP32 GND and Pump GND separately
- **Separate 5V/12V**: Use separate PSUs, then connect grounds at one point only
- **Short paths**: Minimize wire lengths to reduce noise

---

## Waterproof Enclosure Setup

### Outside the Tank

```
┌──────────────────────────────────┐
│  Weatherproof Plastic Box        │
│                                  │
│  ┌────────────────────────────┐  │
│  │    ESP32 DevKit            │  │
│  │  (mounted on 3M pads)      │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌──────────────────────┐       │
│  │ 5V Relay Module      │       │
│  │ (DIN rail mounted)   │       │
│  └──────────────────────┘       │
│                                  │
│  ┌──────────────────────┐       │
│  │ Terminal Blocks      │       │
│  │ (5V + 12V separated) │       │
│  └──────────────────────┘       │
│                                  │
│  ┌──────────────────────┐       │
│  │ 5V USB PSU           │       │
│  │ (Plug outside)       │       │
│  └──────────────────────┘       │
└──────────────────────────────────┘
         │  Cable glands
         ├─ To Pump (12V)
         ├─ To Flow sensor
         ├─ To Temperature
         ├─ To Level probes
         └─ To WiFi antenna
```

### Cable Routing

- **Waterproof cable glands**: Use M20 glands (6 pieces)
- **Silicone sealant**: Around gland threads
- **Cable strain relief**: Secure cables inside box
- **IP65 box minimum**: Protects against rain spray
- **Antenna**: Mount externally (pigtail + external antenna better than built-in)

### Inside Tank Sensor Routing

- **Temperature sensors**: In small plastic tubes (prevents direct mud contact)
- **Flow sensor**: In main pump outlet line
- **Level probes**: Suspended vertically with zip ties, NOT touching tank walls
- **Cables**: Route outside tank through waterproof connector, NO exposed wiring in water

---

## Arduino IDE Setup

### 1. Install Arduino IDE

Download from: https://www.arduino.cc/en/software

### 2. Add ESP32 Board Support

1. Open Arduino IDE → **Preferences**
2. In "Additional Board Manager URLs", paste:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Go to **Sketch → Include Library → Manage Libraries**
4. Search and install:
   - `OneWire` (by Jim Studt)
   - `DallasTemperature` (by Miles Burton)

### 3. Select Board

1. **Tools → Board → ESP32 → ESP32 Dev Module**
2. **Tools → Port** → Select your COM port
3. **Tools → Upload Speed → 921600** (for faster uploads)

### 4. Upload Code

1. Copy the `tower-controller.ino` code
2. Paste into Arduino IDE
3. **Edit configuration**:
   ```cpp
   const char* WIFI_SSID = "YOUR_SSID";
   const char* WIFI_PASS = "YOUR_PASSWORD";
   const char* API_BASE_URL = "https://your-domain.com";
   ```
4. Click **Upload** → Wait for "Hard resetting via RTS pin..."

### 5. Monitor Serial Output

1. **Tools → Serial Monitor**
2. **Baud rate: 115200**
3. Watch for:
   ```
   === SMART TOWER GARDEN STARTING ===
   ✓ Temperature sensors initialized
   ✓ WiFi connected!
   IP: 192.168.x.x
   ```

---

## Sensor Placement Guide

### Temperature Sensors

**Reservoir sensor (DS18B20 #1)**:

- Place in a small mesh bag
- Submerge 10cm below surface
- Away from pump inlet (turbulent zone)
- Ideal: 18–24°C

**Tower sensor (DS18B20 #2)**:

- Place in root zone (middle of tower)
- Inside a small tube to protect from direct sun
- Typical: 20–25°C

### Flow Sensor

- Install **vertically** in the main pump discharge line
- Arrow on sensor should point toward reservoir (flow direction)
- Place AFTER pump, BEFORE any split/distribution
- Secure with zip ties, not glued (for easy replacement)

### Level Probes

- **LOW probe**: 5cm from tank bottom (prevents dry-run)
- **MED probe**: Mid-tank height (normal operation point)
- **HIGH probe**: 5cm from top (tank full indicator)
- **GND probe**: At tank bottom, any position
- Space probes **10cm apart** vertically

---

## Ideal Parameter Ranges

### Water Quality (Manual Readings)

| Parameter | Ideal Range | Unit  | Check Frequency |
| --------- | ----------- | ----- | --------------- |
| **pH**    | 5.5–6.5     | pH    | Daily           |
| **TDS**   | 560–1400    | ppm   | Daily           |
| **EC**    | 1.2–2.4     | mS/cm | Daily           |

### Temperature Ranges

| Location        | Optimal | Min  | Max  | Impact if wrong                            |
| --------------- | ------- | ---- | ---- | ------------------------------------------ |
| **Reservoir**   | 18–22°C | 15°C | 25°C | >25°C: algae, root rot; <15°C: slow growth |
| **Tower/Roots** | 20–24°C | 18°C | 28°C | >28°C: wilting; <18°C: stunted growth      |

### Pump Schedule (User Configured)

| Parameter      | Default | Range      | Notes                         |
| -------------- | ------- | ---------- | ----------------------------- |
| **Interval**   | 30 min  | 15–120 min | How often pump runs           |
| **Duration**   | 60 sec  | 30–300 sec | How long pump runs each cycle |
| **Start Hour** | 6 AM    | 5–8 AM     | When daily cycles start       |
| **End Hour**   | 7 PM    | 5–8 PM     | When daily cycles stop        |
| **Enabled**    | Yes     | On/Off     | Master switch                 |

---

## Troubleshooting Guide

### ESP32 won't connect to WiFi

- **Check WiFi name/password** in code
- **Check WiFi signal**: ESP32 needs -60dBm or better
- **Restart ESP32**: Press RESET button
- **Check antenna**: External antenna performs 2x better
- **Solution**: Add this in setup:
  ```cpp
  WiFi.mode(WIFI_STA);
  WiFi.setAutoConnect(true);
  WiFi.setAutoReconnect(true);
  ```

### Temperature sensors show 85°C or -127°C

- **Sensor disconnected**: Check wiring to GPIO25
- **No pull-up**: Verify 4.7kΩ resistor connected
- **Short circuit**: Check for exposed wires
- **Solution**: Reseat sensor connectors

### No flow detected (but pump is running)

- **Flow sensor not triggered**: Check Yellow wire connection to GPIO26
- **Wrong flow direction**: Verify arrow on sensor points toward tank
- **Sensor clogged**: Clean filter/strainer
- **Pump primering failed**: Fill tube manually first
- **Solution**: Manually trigger by spinning sensor wheel

### Water level always shows "LOW"

- **Probes not submerged**: Check probe placement depth
- **Corroded probes**: Clean with vinegar + soft brush
- **Probe not in water**: Verify tank has water
- **GPIO misconfiguration**: Check GPIO numbers in code
- **Solution**: Test probes manually with multimeter

### Relay clicks but pump doesn't run

- **Pump power disconnected**: Check 12V supply
- **Pump jammed**: Try manual hand-turn
- **Relay contact stuck**: Replace relay module
- **Polarity reversed**: Check +12V and GND at pump
- **Solution**: Connect external 12V LED to relay OUT for testing

### API calls timeout / 504 errors

- **WiFi dropout**: Check signal strength
- **API backend down**: Verify Supabase/backend is running
- **Firewall blocking**: Check Cloudflare/security rules
- **Solution**: Add retry logic (already in code)

### Tank overflows

- **HIGH probe not working**: Test with multimeter
- **Tank too small**: Increase tank size or reduce pump duration
- **Solution**: Lower HIGH probe position by 5cm

---

## Safety Guidelines

### Electrical Safety

- ⚠️ **12V supply**: Keep wiring **secured and insulated**
- ⚠️ **No wet connections**: Always work with dry hands
- ⚠️ **SMPS protection**: Use fused 12V supply (minimum 1A)
- ⚠️ **Relay risk**: Never exceed relay rating (30A max typical)
- ⚠️ **Grounding**: Always connect ground before power
- ✅ Use weatherproof enclosure (IP65 minimum)
- ✅ Test with multimeter before powering on

### Water/Garden Safety

- ⚠️ **Pump priming**: Always fill tube before first run (prevents dry-run fault)
- ⚠️ **Algae prevention**: Cover tank, add air stone if possible
- ⚠️ **Nutrient handling**: Wear gloves, wash hands after contact
- ⚠️ **pH fluctuation**: Avoid rapid changes (pH shock hurts plants)
- ✅ Change water every 2-3 weeks
- ✅ Daily pH/TDS checks first 2 weeks

### Environmental

- ⚠️ **Rain protection**: Keep electronics box elevated, drain holes
- ⚠️ **Sun exposure**: Monitor tower temperature in extreme heat
- ⚠️ **Wind**: Secure pump tubing and enclosure against strong winds
- ⚠️ **Animals**: Cover tank to prevent mosquito breeding
- ✅ Place in well-ventilated area (prevents fungal issues)
- ✅ Morning misting helps in 40°C+ heat

---

## Next Steps

1. ✅ Assemble hardware (this guide)
2. ✅ Upload ESP32 code (tower-controller.ino)
3. ✅ Configure WiFi credentials
4. ✅ Set pump schedule via dashboard
5. ✅ Log manual readings daily
6. ✅ Monitor dashboard for faults
7. ✅ Adjust pH/TDS based on readings

---

## Support & Resources

- **Arduino ESP32**: https://docs.espressif.com/projects/arduino-esp32/
- **OneWire library**: https://www.pjrc.com/teensy/td_libs_OneWire.html
- **Dallas Temperature**: https://github.com/milesburton/Arduino-Temperature-Control-Library
- **Hydroponic basics**: https://www.hydroponics.net/

---

**Last updated: 15-May-2026**  
**Version: 1.0**  
**License: MIT (Beginner-friendly, non-commercial)**
