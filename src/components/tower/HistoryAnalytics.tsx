import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, CalendarRange, Download, Droplets, Zap, Gauge, Activity, Thermometer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  fetchAnalyticsSummary,
  fetchFaultHistory,
  fetchManualReadings,
  fetchPumpLogs,
  fetchSensorHistory,
  type AnalyticsSummary,
  type ManualReading,
  type PumpLogEntry,
  type SensorSnapshot,
} from "@/lib/tower-storage";
import { parseFault, FAULT_INFO } from "@/lib/tower-faults";

const RANGE_OPTIONS = [
  { label: "24h", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
] as const;

type RangeDays = (typeof RANGE_OPTIONS)[number]["days"];

type FaultRow = {
  timestamp: number;
  fault: string;
};

type SensorPoint = {
  label: string;
  value: number | null;
};

type PumpPoint = {
  label: string;
  cycles: number;
  successRate: number;
};

const EMPTY_SUMMARY: AnalyticsSummary = {
  days: 7,
  sensorPoints: 0,
  pumpCycles: 0,
  manualReadings: 0,
  successRate: 0,
  faultCount: 0,
  avgReservoirTempC: null,
  avgTowerTempC: null,
  minReservoirTempC: null,
  maxReservoirTempC: null,
  minTowerTempC: null,
  maxTowerTempC: null,
  estimatedWaterLiters: 0,
  daily: [],
};

function bucketMsForRange(days: RangeDays) {
  if (days <= 1) return 15 * 60 * 1000;
  if (days <= 7) return 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function bucketLabel(timestamp: number, days: RangeDays) {
  if (days <= 1) return format(timestamp, "HH:mm");
  if (days <= 7) return format(timestamp, "EEE HH:00");
  return format(timestamp, "MMM d");
}

function groupLightHistory(snapshots: SensorSnapshot[], days: RangeDays): SensorPoint[] {
  const bucketMs = bucketMsForRange(days);
  const buckets = new Map<number, number[]>();

  for (const snapshot of snapshots) {
    const bucketKey = Math.floor(snapshot.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    const bucket = buckets.get(bucketKey)!;
    if (snapshot.lightLux != null) bucket.push(snapshot.lightLux);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, values]) => ({
      label: bucketLabel(timestamp, days),
      value: values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    }));
}

function groupHumidityHistory(snapshots: SensorSnapshot[], days: RangeDays) {
  const bucketMs = bucketMsForRange(days);
  const buckets = new Map<number, number[]>();

  for (const snapshot of snapshots) {
    const bucketKey = Math.floor(snapshot.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    const arr = buckets.get(bucketKey)!;
    if (snapshot.humidityPct != null) arr.push(snapshot.humidityPct);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, values]) => ({
      label: bucketLabel(timestamp, days),
      humidityPct: values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null,
    }));
}

function groupPumpLogs(logs: PumpLogEntry[], days: RangeDays): PumpPoint[] {
  const bucketMs = bucketMsForRange(days);
  const buckets = new Map<number, { cycles: number; success: number }>();

  for (const log of logs) {
    const timestamp = new Date(log.startedAt).getTime();
    const bucketKey = Math.floor(timestamp / bucketMs) * bucketMs;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { cycles: 0, success: 0 });
    }
    const bucket = buckets.get(bucketKey)!;
    bucket.cycles += 1;
    if (log.flowed && !log.fault) bucket.success += 1;
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, bucket]) => ({
      label: bucketLabel(timestamp, days),
      cycles: bucket.cycles,
      successRate: bucket.cycles > 0 ? (bucket.success / bucket.cycles) * 100 : 0,
    }));
}

function downloadCsv(name: string, lines: string[]) {
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-primary">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function HistoryAnalyticsTab({ deviceId }: { deviceId?: string | null }) {
  const [days, setDays] = useState<RangeDays>(7);
  const [summary, setSummary] = useState<AnalyticsSummary>(EMPTY_SUMMARY);
  const [sensorHistory, setSensorHistory] = useState<SensorSnapshot[]>([]);
  const [pumpLogs, setPumpLogs] = useState<PumpLogEntry[]>([]);
  const [manualReadings, setManualReadings] = useState<ManualReading[]>([]);
  const [faults, setFaults] = useState<FaultRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Custom date selection state
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [useCustomRange, setUseCustomRange] = useState(false);

  // Table pagination state
  const [sensorPage, setSensorPage] = useState(0);
  const SENSOR_PAGE_SIZE = 10;

  const refresh = async () => {
    setLoading(true);
    try {
      const queryDays = useCustomRange && customStart 
        ? Math.max(1, Math.ceil((Date.now() - new Date(customStart).getTime()) / (24 * 60 * 60 * 1000)))
        : days;

      const [nextSummary, nextSensors, nextLogs, nextReadings, nextFaults] = await Promise.all([
        fetchAnalyticsSummary(queryDays, deviceId),
        fetchSensorHistory(queryDays, deviceId),
        fetchPumpLogs(queryDays, 500, deviceId),
        fetchManualReadings(),
        fetchFaultHistory(deviceId),
      ]);

      setSummary(nextSummary ?? EMPTY_SUMMARY);
      setSensorHistory(nextSensors);
      setPumpLogs(nextLogs);
      
      const filterCutoff = Date.now() - queryDays * 24 * 60 * 60 * 1000;
      setManualReadings(nextReadings.filter((reading: ManualReading) => reading.timestamp >= filterCutoff));
      setFaults((nextFaults as FaultRow[]).filter((fault) => fault.timestamp >= filterCutoff));
    } catch (e) {
      console.error("Failed to fetch analytics data", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, useCustomRange]);

  const handleApplyCustomRange = () => {
    if (!customStart || !customEnd) return;
    setUseCustomRange(true);
    setSensorPage(0);
    refresh();
  };

  const handleClearCustomRange = () => {
    setUseCustomRange(false);
    setCustomStart("");
    setCustomEnd("");
    setDays(7);
    setSensorPage(0);
  };

  // Client-side filtering based on custom calendar input
  const filteredSensors = useCustomRange && customStart && customEnd
    ? sensorHistory.filter((pt) => {
        const tStr = format(pt.timestamp, "yyyy-MM-dd");
        return tStr >= customStart && tStr <= customEnd;
      })
    : sensorHistory;

  const filteredPumpLogs = useCustomRange && customStart && customEnd
    ? pumpLogs.filter((pt) => {
        const tStr = format(new Date(pt.startedAt), "yyyy-MM-dd");
        return tStr >= customStart && tStr <= customEnd;
      })
    : pumpLogs;

  const filteredManualReadings = useCustomRange && customStart && customEnd
    ? manualReadings.filter((pt) => {
        const tStr = format(pt.timestamp, "yyyy-MM-dd");
        return tStr >= customStart && tStr <= customEnd;
      })
    : manualReadings;

  const filteredFaults = useCustomRange && customStart && customEnd
    ? faults.filter((pt) => {
        const tStr = format(pt.timestamp, "yyyy-MM-dd");
        return tStr >= customStart && tStr <= customEnd;
      })
    : faults;

  // Bucketed/grouped telemetry for performance mapping
  const chartDays = useCustomRange && customStart && customEnd
    ? Math.max(1, Math.ceil((new Date(customEnd).getTime() - new Date(customStart).getTime()) / (24 * 60 * 60 * 1000)))
    : days;

  const bucketMs = bucketMsForRange(chartDays);
  const buckets = new Map<number, SensorSnapshot[]>();

  for (const snapshot of filteredSensors) {
    const bucketKey = Math.floor(snapshot.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey)!.push(snapshot);
  }

  const groupedSensorData = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, values]) => {
      const phs = values.map(v => v.ph).filter(v => v != null) as number[];
      const ecs = values.map(v => v.ec).filter(v => v != null) as number[];
      const temps = values.map(v => v.reservoirTempC).filter(v => v != null) as number[];
      const nftTemps = values.map(v => v.nftTempC).filter(v => v != null) as number[];
      const hums = values.map(v => v.humidityPct).filter(v => v != null) as number[];
      return {
        label: bucketLabel(timestamp, chartDays),
        ph: phs.length > 0 ? phs.reduce((a, b) => a + b, 0) / phs.length : null,
        ec: ecs.length > 0 ? ecs.reduce((a, b) => a + b, 0) / ecs.length : null,
        reservoirTempC: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
        nftTempC: nftTemps.length > 0 ? nftTemps.reduce((a, b) => a + b, 0) / nftTemps.length : null,
        humidityPct: hums.length > 0 ? hums.reduce((a, b) => a + b, 0) / hums.length : null,
      };
    });

  const pumpData = groupPumpLogs(filteredPumpLogs, chartDays);
  const recentFaults = filteredFaults.slice(0, 8);
  const manualRows = [...filteredManualReadings].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);

  // EXCEL / CSV Export Rows
  const exportRows = [
    "Timestamp,Date,Time,pH,EC Index (mS/cm),Water Temp (C),NFT Temp (C),Air Humidity (%),Water Level,Ultrasonic Distance (cm),Water Volume (L)"
  ];
  for (const snapshot of filteredSensors) {
    const dt = new Date(snapshot.timestamp);
    exportRows.push([
      dt.toISOString(),
      format(dt, "yyyy-MM-dd"),
      format(dt, "HH:mm:ss"),
      snapshot.ph != null ? snapshot.ph.toFixed(2) : "",
      snapshot.ec != null ? snapshot.ec.toFixed(2) : "",
      snapshot.reservoirTempC != null ? snapshot.reservoirTempC.toFixed(1) : "",
      snapshot.nftTempC != null ? snapshot.nftTempC.toFixed(1) : "",
      snapshot.humidityPct != null ? snapshot.humidityPct.toFixed(1) : "",
      snapshot.waterLevel || "",
      snapshot.waterDistanceCm != null ? snapshot.waterDistanceCm.toFixed(1) : "",
      snapshot.waterVolumeLiters != null ? snapshot.waterVolumeLiters.toFixed(1) : "",
    ].join(","));
  }

  // Calculate Averages for Summary Cards
  const avgPh = (() => {
    const vals = filteredSensors.map((s) => s.ph).filter((v) => typeof v === "number") as number[];
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();

  const avgEc = (() => {
    const vals = filteredSensors.map((s) => s.ec).filter((v) => typeof v === "number") as number[];
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();

  const avgWaterTemp = (() => {
    const vals = filteredSensors.map((s) => s.reservoirTempC).filter((v) => typeof v === "number") as number[];
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();

  const avgNftTemp = (() => {
    const vals = filteredSensors.map((s) => s.nftTempC).filter((v) => typeof v === "number") as number[];
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();

  const avgHumidity = (() => {
    const vals = filteredSensors.map((s) => s.humidityPct).filter((v) => typeof v === "number") as number[];
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  })();

  // Pagination bounds
  const totalSensorPages = Math.ceil(filteredSensors.length / SENSOR_PAGE_SIZE);
  const paginatedSensors = filteredSensors.slice(sensorPage * SENSOR_PAGE_SIZE, (sensorPage + 1) * SENSOR_PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Dynamic Date Filtering Dashboard Toolbar */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarRange className="h-4 w-4 text-emerald-500 animate-pulse" />
            Historical Operations Audits
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">Sensor History & Trends</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Check historical pH, EC, water temperature, and humidity trends over custom ranges.
          </p>
        </div>

        {/* Date presets and calendar inputs */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/80">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.days}
                variant={!useCustomRange && days === option.days ? "secondary" : "ghost"}
                size="sm"
                className="text-xs h-7 px-2.5 font-bold"
                onClick={() => {
                  setUseCustomRange(false);
                  setDays(option.days);
                  setSensorPage(0);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-muted/20 px-2.5 py-1">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-muted-foreground font-bold uppercase">From</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-transparent text-xs font-mono font-bold border-none focus:outline-none w-26 h-5"
              />
            </div>
            <div className="flex items-center gap-1 border-l pl-2">
              <span className="text-[9px] text-muted-foreground font-bold uppercase">To</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-transparent text-xs font-mono font-bold border-none focus:outline-none w-26 h-5"
              />
            </div>
            <Button 
              size="xs" 
              variant="default" 
              onClick={handleApplyCustomRange} 
              disabled={!customStart || !customEnd} 
              className="h-6 px-2 text-[10px] font-bold"
            >
              Apply
            </Button>
            {useCustomRange && (
              <Button 
                size="xs" 
                variant="ghost" 
                onClick={handleClearCustomRange} 
                className="h-6 px-2 text-[10px] text-red-500 hover:text-red-600 font-bold"
              >
                Clear
              </Button>
            )}
          </div>

          <Button 
            variant="outline" 
            size="sm" 
            className="text-xs border-emerald-500/30 hover:bg-emerald-50/50 hover:text-emerald-700 font-bold"
            onClick={() => downloadCsv(`sensor_history_${useCustomRange ? customStart + "_to_" + customEnd : days + "d"}.csv`, exportRows)}
          >
            <Download className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
            Export Excel (CSV)
          </Button>
        </div>
      </div>

      {/* Numerical Averages Summary Cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
        <SummaryCard
          icon={<Gauge className="h-5 w-5 text-indigo-500" />}
          label="Average pH"
          value={avgPh != null ? avgPh.toFixed(2) : "——"}
          hint="Target range: 5.5 - 6.5"
        />
        <SummaryCard
          icon={<Activity className="h-5 w-5 text-amber-500" />}
          label="Average EC"
          value={avgEc != null ? `${avgEc.toFixed(2)} mS` : "——"}
          hint="Target range: 0.8 - 1.2"
        />
        <SummaryCard
          icon={<Thermometer className="h-5 w-5 text-sky-500" />}
          label="Avg Water Temp"
          value={avgWaterTemp != null ? `${avgWaterTemp.toFixed(1)}°C` : "——"}
          hint="Comfort band: 20°C - 26°C"
        />
        <SummaryCard
          icon={<Thermometer className="h-5 w-5 text-amber-500" />}
          label="Avg NFT Temp"
          value={avgNftTemp != null ? `${avgNftTemp.toFixed(1)}°C` : "——"}
          hint="Comfort band: 20°C - 26°C"
        />
        <SummaryCard
          icon={<Droplets className="h-5 w-5 text-emerald-500" />}
          label="Avg Air Humidity"
          value={avgHumidity != null ? `${avgHumidity.toFixed(1)}%` : "——"}
          hint="Ideal range: 50% - 70%"
        />
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5 text-indigo-500" />}
          label="History Window"
          value={`${chartDays} Days`}
          hint={`Total Logged: ${filteredSensors.length}`}
        />
      </div>

      {/* Advanced Trend Area Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* pH & EC Historical Balance Chart */}
        <Card className="p-5 border-border bg-card">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">pH & EC Solution Balance</div>
              <div className="text-2xs text-muted-foreground mt-0.5">Dual Y-axis chart outlining pH (left) vs Electrical Conductivity (right)</div>
            </div>
            <Badge variant="outline" className="text-2xs">Target pH 5.5–6.5 | EC 0.8–1.2</Badge>
          </div>
          
          <div className="h-64 w-full">
            <ChartContainer config={{ 
              ph: { label: "pH Value", color: "#6366f1" },
              ec: { label: "EC Index", color: "#f59e0b" }
            }} className="h-full w-full">
              <AreaChart data={groupedSensorData} margin={{ left: -10, right: -10, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorHistoryPh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorHistoryEc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} className="text-[10px] font-semibold" />
                <YAxis yAxisId="left" domain={[4.5, 7.5]} allowDecimals={true} tickLine={false} axisLine={false} className="text-[10px] font-mono fill-muted-foreground" />
                <YAxis yAxisId="right" orientation="right" domain={[0.4, 2.0]} allowDecimals={true} tickLine={false} axisLine={false} className="text-[10px] font-mono fill-muted-foreground" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend content={<ChartLegendContent />} />
                <ReferenceLine yAxisId="left" y={5.5} stroke="#a5b4fc" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="left" y={6.5} stroke="#a5b4fc" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="right" y={0.8} stroke="#fde047" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="right" y={1.2} stroke="#fde047" strokeDasharray="4 4" />
                <Area yAxisId="left" type="monotone" dataKey="ph" stroke="var(--color-ph)" strokeWidth={2} fillOpacity={1} fill="url(#colorHistoryPh)" dot={false} connectNulls />
                <Area yAxisId="right" type="monotone" dataKey="ec" stroke="var(--color-ec)" strokeWidth={2} fillOpacity={1} fill="url(#colorHistoryEc)" dot={false} connectNulls />
              </AreaChart>
            </ChartContainer>
          </div>
        </Card>

        {/* Water Temperature & Air Humidity Trend Chart */}
        <Card className="p-5 border-border bg-card">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Temperatures & Air Humidity</div>
              <div className="text-2xs text-muted-foreground mt-0.5">Water and NFT temperatures (left) plotted against local air humidity (right)</div>
            </div>
            <Badge variant="outline" className="text-2xs">Comfort: 20–26°C | Humidity 40–90%</Badge>
          </div>
          
          <div className="h-64 w-full">
            <ChartContainer config={{ 
              temp: { label: "Water Temp", color: "#0ea5e9" },
              nftTemp: { label: "NFT Temp", color: "#f59e0b" },
              humidity: { label: "Air Humidity", color: "#10b981" }
            }} className="h-full w-full">
              <AreaChart data={groupedSensorData} margin={{ left: -10, right: -10, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorHistoryTemp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorHistoryNftTemp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorHistoryHum" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} className="text-[10px] font-semibold" />
                <YAxis yAxisId="left" domain={[15, 32]} allowDecimals={true} tickLine={false} axisLine={false} className="text-[10px] font-mono fill-muted-foreground" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} allowDecimals={false} tickLine={false} axisLine={false} className="text-[10px] font-mono fill-muted-foreground" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend content={<ChartLegendContent />} />
                <ReferenceLine yAxisId="right" y={40} stroke="#6ee7b7" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="right" y={90} stroke="#6ee7b7" strokeDasharray="4 4" />
                <Area yAxisId="left" type="monotone" dataKey="reservoirTempC" stroke="var(--color-temp)" strokeWidth={2} fillOpacity={1} fill="url(#colorHistoryTemp)" dot={false} connectNulls />
                <Area yAxisId="left" type="monotone" dataKey="nftTempC" stroke="var(--color-nftTemp)" strokeWidth={2} fillOpacity={1} fill="url(#colorHistoryNftTemp)" dot={false} connectNulls />
                <Area yAxisId="right" type="monotone" dataKey="humidityPct" stroke="var(--color-humidity)" strokeWidth={2} fillOpacity={1} fill="url(#colorHistoryHum)" dot={false} connectNulls />
              </AreaChart>
            </ChartContainer>
          </div>
        </Card>
      </div>

      {/* Historical Data Tables Audit Logs */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* Sensor Logs Paginated Table */}
        <Card className="p-5 xl:col-span-2 border-border bg-card">
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Historical Sensor Registry</div>
              <div className="text-2xs text-muted-foreground mt-0.5">Paginated tabular logs of every raw ESP32 sensor transmission</div>
            </div>
            
            {/* Simple Pagination Buttons */}
            {totalSensorPages > 1 && (
              <div className="flex items-center gap-1.5 self-end">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={sensorPage === 0}
                  onClick={() => setSensorPage((p) => p - 1)}
                  className="h-6 w-14 text-[10px]"
                >
                  Prev
                </Button>
                <span className="text-[10px] font-bold text-muted-foreground font-mono">
                  {sensorPage + 1} / {totalSensorPages}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={sensorPage >= totalSensorPages - 1}
                  onClick={() => setSensorPage((p) => p + 1)}
                  className="h-6 w-14 text-[10px]"
                >
                  Next
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-border/80">
            <table className="w-full text-xs">
              <thead className="bg-secondary text-secondary-foreground">
                <tr className="font-bold text-2xs uppercase tracking-wider">
                  <th className="px-3 py-2 text-left">Timestamp</th>
                  <th className="px-3 py-2 text-center">pH</th>
                  <th className="px-3 py-2 text-center">EC</th>
                  <th className="px-3 py-2 text-center">Temp</th>
                  <th className="px-3 py-2 text-center">Humidity</th>
                  <th className="px-3 py-2 text-center">Volume (L)</th>
                  <th className="px-3 py-2 text-right">Distance</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSensors.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      No sensor logs recorded in this date range.
                    </td>
                  </tr>
                ) : (
                  paginatedSensors.map((snapshot) => (
                    <tr key={snapshot.timestamp} className="border-t border-border hover:bg-muted/10 transition-colors">
                      <td className="px-3 py-2 font-mono text-2xs">
                        {format(snapshot.timestamp, "yyyy-MM-dd HH:mm:ss")}
                      </td>
                      <td className="px-3 py-2 text-center font-bold text-indigo-600">
                        {snapshot.ph != null ? snapshot.ph.toFixed(2) : "——"}
                      </td>
                      <td className="px-3 py-2 text-center font-bold text-amber-600">
                        {snapshot.ec != null ? snapshot.ec.toFixed(2) : "——"}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold text-sky-600">
                        {snapshot.reservoirTempC != null ? `${snapshot.reservoirTempC.toFixed(1)}°C` : "——"}
                        {snapshot.nftTempC != null && (
                          <div className="text-[10px] text-amber-600 font-semibold mt-0.5">
                            NFT: {snapshot.nftTempC.toFixed(1)}°C
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold text-emerald-600">
                        {snapshot.humidityPct != null ? `${snapshot.humidityPct.toFixed(1)}%` : "——"}
                      </td>
                      <td className="px-3 py-2 text-center font-mono">
                        {snapshot.waterVolumeLiters != null ? `${snapshot.waterVolumeLiters.toFixed(1)} L` : "——"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">
                        {snapshot.waterDistanceCm != null ? `${snapshot.waterDistanceCm.toFixed(1)} cm` : "——"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Fault Timeline Panel */}
        <Card className="p-5 border-border bg-card">
          <div className="mb-4">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Anomaly & Fault Logs</div>
            <div className="text-2xs text-muted-foreground mt-0.5">WDT reboots, dry runs, and dosing error markers</div>
          </div>
          {recentFaults.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 p-4 text-xs text-muted-foreground">
              No recent anomalies logged in the selected window.
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {recentFaults.map((fault) => {
                const code = parseFault(fault.fault);
                const info = code ? FAULT_INFO[code] : null;
                const tone = code === "DRY_RUN" || code === "FLOW_TIMEOUT" ? "destructive" : "secondary";
                return (
                  <div key={`${fault.timestamp}-${fault.fault}`} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold">{info?.label ?? fault.fault}</div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{format(new Date(fault.timestamp), "MMM d, HH:mm")}</div>
                      </div>
                      <Badge variant={tone} className="text-3xs uppercase font-bold">{code ?? "INFO"}</Badge>
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground leading-relaxed">{info?.hint ?? "Hardware event recorded by core microcontrollers."}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {loading && <p className="text-xs text-muted-foreground animate-pulse">Syncing logs and data metrics…</p>}
    </div>
  );
}
