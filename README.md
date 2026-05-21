# 🌱 Smart Tower Garden — ESP32 IoT Hydroponic System

A **beginner-friendly, low-cost, outdoor-safe** IoT system for vertical aeroponic/hydroponic towers. Perfect for growing leafy greens in Karnataka, India.

**Status**: ✅ Production-ready | **Cost**: ₹8,000-12,000 (~$100-150 USD) | **Maintenance**: 5 min/day

---

## 🎯 Quick Start (30 minutes)

1. **Gather hardware** (₹8-12K budget) — See [BOM in HARDWARE_SETUP.md](HARDWARE_SETUP.md#bill-of-materials-bom)
2. **Wire the ESP32** (15 min) — Follow [wiring diagrams](HARDWARE_SETUP.md#wiring-diagrams)
3. **Upload Arduino code** (8 min) — [tower-controller.ino](esp32-code/tower-controller.ino)
4. **Configure dashboard** (2 min) — Set pump schedule
5. **Log first readings** (5 min) — pH, TDS, EC

👉 **[Full Quick Start Guide →](QUICKSTART.md)**

---

## ✨ Features

### Automatic Pump Control

- Scheduled pump cycles (configurable interval/duration)
- Flow verification (detects pump failures)
- Dry-run protection (stops pump if no water detected)
- Water level monitoring (skip cycles if tank is low)

### Real-Time Monitoring

- **Live Dashboard** — Pump status, flow, temperatures, water level
- **Manual Readings** — pH, TDS, EC logging (3× daily recommended)
- **Pump Statistics** — Success rate, fault breakdown, trends
- **Fault Alerts** — Color-coded warnings (dry-run, low-water, sensor errors)

### Sensor Integration

- **Flow sensor** (YF-S201) — Detects pump operation
- **Temperature sensors** (2× DS18B20) — Reservoir & tower/root zone
- **Water level probe** (3-point method) — LOW / MEDIUM / FULL detection
- **Manual meters** — pH, TDS, EC (checked daily)

### Beginner-Friendly Design

- ✅ No cloud AI or complex automation
- ✅ Manual nutrient/pH adjustments (safer for learning)
- ✅ Simple REST API (easy to extend)
- ✅ Clear fault codes with actionable hints
- ✅ Works offline (local scheduling)
- ✅ Fully documented with wiring diagrams

---

## 📊 System Architecture

```
ESP32 Controller
  ├─ WiFi → Backend API (REST polling)
  ├─ Sensors
  │  ├─ Flow Sensor (GPIO26) → Pump verification
  │  ├─ Temperature (GPIO25) → 2× DS18B20 via OneWire
  │  └─ Water Level (GPIO32-34) → 3-probe capacitive
  └─ Relay (GPIO27) → 12V pump control

Dashboard (React)
  ├─ Live Status (Supabase real-time)
  ├─ Manual Readings (pH/TDS/EC)
  ├─ Pump Schedule Editor
  ├─ Fault Alerts (with hints)
  └─ Pump Statistics (success rate, trends)

Supabase Backend
  ├─ tower_schedule → Pump schedule
  ├─ tower_status → Live sensor readings
  ├─ tower_pump_log → Pump cycle history
  └─ tower_readings → Manual pH/TDS/EC entries
```

---

## 🛠️ Hardware Setup

### Components (Total: ~₹8-12K)

| Component                | Cost      | Purpose           |
| ------------------------ | --------- | ----------------- |
| **ESP32 DevKit**         | ₹400-600  | Main controller   |
| **5V Relay Module**      | ₹80-120   | Pump control      |
| **YF-S201 Flow Sensor**  | ₹250-350  | Flow detection    |
| **2× DS18B20**           | ₹150-200  | Temperature       |
| **12V SMPS**             | ₹300-400  | Pump power        |
| **Submersible pump**     | ₹400-800  | Water circulation |
| **Metal probes**         | ₹100      | Level sensing     |
| **Waterproof box**       | ₹200-300  | Enclosure         |
| **Misc wires/resistors** | ₹200      | Connections       |
| **Tank**                 | ₹600-1200 | Water storage     |
| **Nutrient kit**         | ₹800-1200 | A+B formula       |
| **pH/TDS meters**        | ₹450-800  | Manual readings   |
| **Hydroton pellets**     | ₹300      | Growing medium    |

### Quick Links

- 📐 **[Wiring Diagrams](HARDWARE_SETUP.md#wiring-diagrams)** — GPIO mapping, schematics, cable routing
- 📋 **[Probe Sensing Explained](HARDWARE_SETUP.md#probe-based-water-level-sensing-explained)** — How 3-probe method works
- ⚙️ **[GPIO Pin Mapping](HARDWARE_SETUP.md#gpio-pin-mapping)** — All connections at a glance
- 🔌 **[Power Distribution](HARDWARE_SETUP.md#power-distribution)** — 5V/12V separate supplies, grounding
- 🔧 **[Arduino IDE Setup](HARDWARE_SETUP.md#arduino-ide-setup)** — Install libraries, upload code

---

## 💻 Software Setup

### Option 1: Local Testing (Recommended First)

```bash
# Clone project
git clone https://github.com/your-repo/smart-tower-garden.git
cd smart-tower-garden

# Install dependencies
npm install

# Start dev server
npm run dev

# Opens http://localhost:3000
```

### Option 2: Deploy to Cloudflare

```bash
# Build for Cloudflare Workers
npm run build

# Deploy
npm run deploy
```

### ESP32 Arduino Code

1. Download [tower-controller.ino](esp32-code/tower-controller.ino)
2. Open in **Arduino IDE** → **Tools** → **Board** → **ESP32 Dev Module**
3. Edit WiFi/API credentials (lines 20-30)
4. Click **Upload**

---

## 📡 API Endpoints

All requests return JSON. No authentication required (single tower, local deployment).

### GET /api/status — Current sensor readings

```bash
curl https://your-domain.com/api/status
```

Response: `{pumpOn, flowing, reservoirTempC, towerTempC, waterLevel, fault, lastRunISO}`

### PATCH /api/status — Update status (ESP32 posts sensor data)

```bash
curl -X PATCH https://your-domain.com/api/status \
  -H "Content-Type: application/json" \
  -d '{"pumpOn":true,"flowing":true,"reservoirTempC":22.3,"fault":"OK"}'
```

### POST /api/schedule — Fetch pump schedule

```bash
curl -X POST https://your-domain.com/api/schedule
```

Response: `{intervalMinutes, durationSeconds, startHour, endHour, enabled}`

### GET /api/pump-log — Pump cycle history & stats

```bash
curl https://your-domain.com/api/pump-log
```

Response: `{cycles: [...], stats: {totalCycles, successRate, faultCounts, ...}}`

### POST /api/pump-log — Log a pump cycle (ESP32)

```bash
curl -X POST https://your-domain.com/api/pump-log \
  -H "Content-Type: application/json" \
  -d '{"durationSeconds":61,"flowed":true,"fault":null}'
```

👉 **[Full API Reference →](API_REFERENCE.md)**

---

## 📚 Documentation

| Document                                   | Purpose                                            |
| ------------------------------------------ | -------------------------------------------------- |
| **[QUICKSTART.md](QUICKSTART.md)**         | 30-minute setup guide (recommended first!)         |
| **[HARDWARE_SETUP.md](HARDWARE_SETUP.md)** | Detailed wiring, sensor placement, troubleshooting |
| **[API_REFERENCE.md](API_REFERENCE.md)**   | REST endpoints, database schema, cURL examples     |
| **[FAULTS.md](FAULTS.md)**                 | Fault codes explained, causes, fixes               |

---

## 🚀 Daily Operation

### Morning (5 min)

1. Check tank water level (refill if LOW)
2. Log pH reading with handheld meter
3. Check dashboard for faults
4. Listen for pump sounds (clicking/humming)

### Afternoon (2 min)

1. Check dashboard status (pump ON/OFF cycling normally?)
2. Log TDS reading

### Weekly (15 min)

1. Clean flow sensor (rinse, remove debris)
2. Clean level probes (vinegar + soft brush)
3. Check tubing (cracks? algae?)
4. Log full readings (pH, TDS, EC)
5. Refill tank if depleted

### Monthly (20 min)

1. **Drain & refill tank** (complete water change)
2. Deep-clean all probes
3. Verify sensor accuracy (test with calibration solutions)
4. Check pump operation (manual water circulation test)
5. Review dashboard trends

---

## ⚠️ Fault Codes

| Code             | Severity    | Meaning                  | Fix                                |
| ---------------- | ----------- | ------------------------ | ---------------------------------- |
| **OK**           | ℹ️ info     | All good                 | —                                  |
| **DRY_RUN**      | 🔴 critical | Pump on, no flow in 5s   | Prime pump, check blockage         |
| **FLOW_TIMEOUT** | 🔴 critical | Flow stopped mid-cycle   | Check discharge line clog          |
| **LOW_WATER**    | 🟡 warning  | Tank level at LOW probe  | Refill tank soon                   |
| **SENSOR_FAIL**  | 🟡 warning  | Temp/level sensor broken | Check OneWire wiring               |
| **WIFI_LOST**    | ℹ️ info     | Network was down >5 min  | Check WiFi signal, reconnect ESP32 |

👉 **[Detailed fault guide →](FAULTS.md)**

---

## 💡 Ideal Parameters

### Water Quality (Manual readings, check 1-2× daily)

| Parameter | Ideal | Range    | Unit  |
| --------- | ----- | -------- | ----- |
| pH        | 6.0   | 5.5-6.5  | pH    |
| TDS       | 1000  | 560-1400 | ppm   |
| EC        | 1.6   | 1.2-2.4  | mS/cm |

### Temperature (Auto-monitored)

| Location    | Ideal | Min  | Max  |
| ----------- | ----- | ---- | ---- |
| Reservoir   | 20°C  | 15°C | 25°C |
| Tower/Roots | 22°C  | 18°C | 28°C |

### Pump Schedule (Configurable)

| Parameter  | Default | Adjustable |
| ---------- | ------- | ---------- |
| Interval   | 30 min  | 15-120 min |
| Duration   | 60 sec  | 30-300 sec |
| Start time | 6 AM    | 5-8 AM     |
| End time   | 7 PM    | 5-8 PM     |

---

## 🔍 Troubleshooting

### ESP32 won't connect to WiFi

- Check WiFi name/password in code (lines 20-22)
- Restart ESP32 (press RESET button)
- Verify WiFi signal is strong (-60 dBm or better)
- Check antenna installation (external antenna 2× better)

### No flow detected (pump running)

- Manually spin flow sensor wheel to test
- Check Yellow wire connected to GPIO26
- Verify arrow on flow sensor points correct direction
- Clean sensor strainer/filter

### Temperature reads 85°C or -127°C

- Sensor disconnected — check GPIO25 wiring
- Missing 4.7kΩ pull-up resistor
- Short circuit — check exposed wires
- Solution: Reseat sensor connectors, check solder joints

### Water level always "LOW"

- Probes not submerged — check depth
- Probes corroded — clean with vinegar
- GPIO misconfigured — verify GPIO32/34/35 in code
- Test probes with multimeter

### Tank overflows

- HIGH probe not working — test with multimeter
- Lower HIGH probe position by 5cm
- Tank too small for pump — increase tank size

👉 **[Full troubleshooting guide →](HARDWARE_SETUP.md#troubleshooting-guide)**

---

## 🌱 Plant Care Tips

### Best Crops

- Leafy greens (lettuce, spinach, kale)
- Herbs (basil, mint, parsley)
- Microgreens (fast growth, high yield)

### Growing Medium

- Hydroton clay pellets (lightweight, reusable)
- Coconut coir + perlite (sustainable)
- Rockwool (fast root development)

### Lighting

- 12-14 hours LED / full sun (outdoor)
- Minimum 200 µmol/m²/s (leafy greens)
- South-facing placement (India)

### Nutrients

- Use **hydroponic A+B formula** (not soil nutrients)
- Check TDS daily (target 560-1400 ppm)
- Adjust pH to 5.5-6.5 before planting
- Change water every 2-3 weeks

---

## 📦 Project Structure

```
smart-tower-garden/
├── esp32-code/
│   └── tower-controller.ino      # Main ESP32 sketch
├── src/
│   ├── routes/
│   │   ├── index.tsx              # Dashboard main page
│   │   ├── api.status.ts          # GET/PATCH status endpoint
│   │   ├── api.schedule.ts        # GET schedule endpoint
│   │   └── api.pump-log.ts        # GET/POST pump log endpoint
│   ├── components/tower/
│   │   ├── StatusCards.tsx        # Live status display
│   │   ├── ScheduleEditor.tsx     # Pump schedule configurator
│   │   ├── ManualReadings.tsx     # pH/TDS/EC entry form
│   │   ├── PumpStats.tsx          # Pump cycle analytics
│   │   ├── Documentation.tsx      # Build guide
│   │   └── EnhancedStatusCards.tsx # Fault alerts component
│   ├── lib/
│   │   ├── tower-storage.ts       # Supabase queries
│   │   ├── tower-faults.ts        # Fault code definitions
│   │   └── utils.ts
│   └── integrations/supabase/
│       └── client.ts
├── supabase/
│   └── migrations/
│       └── 20260514...sql         # Database schema
├── QUICKSTART.md                   # 30-min setup guide
├── HARDWARE_SETUP.md               # Detailed wiring & BOM
├── API_REFERENCE.md                # API docs
├── FAULTS.md                       # Fault code reference
└── README.md                        # This file
```

---

## 🎓 Learning Resources

- **Arduino OneWire**: https://www.pjrc.com/teensy/td_libs_OneWire.html
- **Dallas Temperature**: https://github.com/milesburton/Arduino-Temperature-Control-Library
- **Hydroponic basics**: https://www.hydroponics.net/
- **ESP32 docs**: https://docs.espressif.com/projects/arduino-esp32/

---

## 🔒 Safety Considerations

⚠️ **Electrical**:

- Keep 12V wiring secured and insulated
- Always turn off power when working on electronics
- Test with multimeter before powering on
- Use grounding and proper fusing

⚠️ **Water**:

- Always prime pump before first run
- Don't run pump with empty tank (causes dry-run fault)
- Change water every 2-3 weeks to prevent algae/disease

⚠️ **Garden**:

- Never use soil nutrients in hydroponics (algae clogging)
- Check pH daily (rapid pH changes shock plants)
- Cover tank to prevent mosquito breeding
- Use gloves when handling nutrients

---

## 📝 License

MIT — Use, modify, distribute freely. Perfect for hobbyists, students, and small-scale growers.

---

## 🤝 Contributing

Issues, improvements, and pull requests welcome!

- Found a bug? → Open GitHub Issue
- Want to add feature? → Submit PR
- Questions? → Discussions tab

---

## 📧 Support

- **Discord community**: [Join our server]
- **GitHub Issues**: [Report bugs]
- **Email**: support@example.com

---

**Made with 💚 for beginner hydroponic gardeners in India**

**Last updated: 15-May-2026** | **Version: 1.0** | **Status: ✅ Stable**

---

## 🚀 Next Steps

1. ✅ Read [QUICKSTART.md](QUICKSTART.md) (30 minutes)
2. ✅ Order hardware from [BOM](HARDWARE_SETUP.md#bill-of-materials-bom)
3. ✅ Assemble according to [wiring diagrams](HARDWARE_SETUP.md#wiring-diagrams)
4. ✅ Upload [ESP32 code](esp32-code/tower-controller.ino)
5. ✅ Set up dashboard & configure schedule
6. ✅ Plant seedlings & monitor daily
7. ✅ Join community for tips & troubleshooting

**Happy growing!** 🌱
