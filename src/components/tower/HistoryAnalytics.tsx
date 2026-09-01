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
  { label: "90 days", days: 90 },
  { label: "365 days", days: 365 },
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

function bucketMsForRange(days: number) {
  if (days <= 1) return 15 * 60 * 1000;
  if (days <= 7) return 60 * 60 * 1000;
  if (days <= 30) return 24 * 60 * 60 * 1000;
  if (days <= 90) return 3 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function bucketLabel(timestamp: number, days: number) {
  if (days <= 1) return format(timestamp, "HH:mm");
  if (days <= 7) return format(timestamp, "EEE HH:00");
  if (days <= 90) return format(timestamp, "MMM d");
  return format(timestamp, "MMM d, yy");
}

function groupLightHistory(snapshots: SensorSnapshot[], days: number): SensorPoint[] {
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

function groupHumidityHistory(snapshots: SensorSnapshot[], days: number) {
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

function groupPumpLogs(logs: PumpLogEntry[], days: number): PumpPoint[] {
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
  const [registryDateFilter, setRegistryDateFilter] = useState("");

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
  const tableFilteredSensors = registryDateFilter
    ? filteredSensors.filter((s) => format(s.timestamp, "yyyy-MM-dd") === registryDateFilter)
    : filteredSensors;

  const totalSensorPages = Math.ceil(tableFilteredSensors.length / SENSOR_PAGE_SIZE);
  const paginatedSensors = tableFilteredSensors.slice(sensorPage * SENSOR_PAGE_SIZE, (sensorPage + 1) * SENSOR_PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Dynamic Date Filtering Dashboard Toolbar */}
      <div className="flex flex-col gap-3 rounded-lg sm:rounded-2xl border border-border bg-card p-3 sm:p-6 shadow-sm md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
            <CalendarRange className="h-4 w-4 text-emerald-500 animate-pulse flex-shrink-0" />
            <span className="truncate">Historical Audits</span>
          </div>
          <h2 className="mt-1 text-lg sm:text-2xl font-bold tracking-tight line-clamp-2">Sensor History & Trends</h2>
          <p className="mt-0.5 sm:mt-1 text-[9px] sm:text-xs text-muted-foreground line-clamp-2">
            Check pH, EC, temperature, and humidity trends.
          </p>
        </div>

        {/* Date presets and calendar inputs */}
        <div className="flex flex-col gap-2 md:gap-3 md:flex-row md:items-center md:justify-end md:flex-wrap">
          <div className="flex items-center gap-0.5 bg-muted/40 p-0.5 rounded-lg border border-border/80 overflow-x-auto">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.days}
                variant={!useCustomRange && days === option.days ? "secondary" : "ghost"}
                size="sm"
                className="text-[8px] xs:text-[9px] sm:text-xs h-6 xs:h-7 px-1.5 xs:px-2.5 font-bold whitespace-nowrap flex-shrink-0"
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

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 rounded-lg border border-border/80 bg-muted/20 px-2 xs:px-2.5 py-1">
            <div className="flex items-center gap-1">
              <span className="text-[7px] xs:text-[8px] text-muted-foreground font-bold uppercase whitespace-nowrap">From</span>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-transparent text-[8px] xs:text-xs font-mono font-bold border-none focus:outline-none w-auto min-w-20 h-5"
              />
            </div>
            <div className="hidden sm:flex items-center border-l pl-2 gap-1">
              <span className="text-[7px] xs:text-[8px] text-muted-foreground font-bold uppercase whitespace-nowrap">To</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-transparent text-[8px] xs:text-xs font-mono font-bold border-none focus:outline-none w-auto min-w-20 h-5"
              />
            </div>
            <div className="flex sm:hidden items-center gap-1">
              <span className="text-[7px] xs:text-[8px] text-muted-foreground font-bold uppercase whitespace-nowrap">To</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-transparent text-[8px] xs:text-xs font-mono font-bold border-none focus:outline-none w-auto min-w-20 h-5"
              />
            </div>
            <Button 
              size="xs" 
              variant="default" 
              onClick={handleApplyCustomRange} 
              disabled={!customStart || !customEnd} 
              className="h-5 xs:h-6 px-1.5 xs:px-2 text-[7px] xs:text-[8px] font-bold whitespace-nowrap"
            >
              Apply
            </Button>
            {useCustomRange && (
              <Button 
                size="xs" 
                variant="ghost" 
                onClick={handleClearCustomRange} 
                className="h-5 xs:h-6 px-1.5 xs:px-2 text-[7px] xs:text-[8px] text-red-500 hover:text-red-600 font-bold whitespace-nowrap"
              >
                Clear
              </Button>
            )}
          </div>

          <Button 
            variant="outline" 
            size="sm" 
            className="text-[8px] xs:text-[9px] sm:text-xs border-emerald-500/30 hover:bg-emerald-50/50 hover:text-emerald-700 font-bold h-6 xs:h-7 whitespace-nowrap"
            onClick={() => downloadCsv(`sensor_history_${useCustomRange ? customStart + "_to_" + customEnd : days + "d"}.csv`, exportRows)}
          >
            <Download className="mr-1 h-3 w-3 xs:h-3.5 xs:w-3.5 text-emerald-500 flex-shrink-0" />
            <span className="hidden xs:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Numerical Averages Summary Cards */}
      <div className="grid grid-cols-2 gap-2 xs:gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard
          icon={<Gauge className="h-4 w-4 xs:h-5 xs:w-5 text-indigo-500" />}
          label="pH"
          value={avgPh != null ? avgPh.toFixed(2) : "——"}
          hint="5.5–6.5"
        />
        <SummaryCard
          icon={<Activity className="h-4 w-4 xs:h-5 xs:w-5 text-amber-500" />}
          label="EC"
          value={avgEc != null ? `${avgEc.toFixed(2)}` : "——"}
          hint="0.8–1.2"
        />
        <SummaryCard
          icon={<Thermometer className="h-4 w-4 xs:h-5 xs:w-5 text-sky-500" />}
          label="Tank T°"
          value={avgWaterTemp != null ? `${avgWaterTemp.toFixed(1)}°` : "——"}
          hint="20–26°C"
        />
        <SummaryCard
          icon={<Thermometer className="h-4 w-4 xs:h-5 xs:w-5 text-amber-500" />}
          label="NFT T°"
          value={avgNftTemp != null ? `${avgNftTemp.toFixed(1)}°` : "——"}
          hint="20–26°C"
        />
        <SummaryCard
          icon={<Droplets className="h-4 w-4 xs:h-5 xs:w-5 text-emerald-500" />}
          label="Humidity"
          value={avgHumidity != null ? `${avgHumidity.toFixed(1)}%` : "——"}
          hint="50–70%"
        />
        <SummaryCard
          icon={<AlertCircle className="h-4 w-4 xs:h-5 xs:w-5 text-indigo-500" />}
          label="Window"
          value={`${chartDays}d`}
          hint={`${filteredSensors.length} pts`}
        />
      </div>

      {/* Advanced Trend Area Charts */}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        {/* pH & EC Historical Balance Chart */}
        <Card className="p-3 sm:p-5 border-border bg-card">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-wider line-clamp-1">pH & EC Balance</div>
              <div className="text-[8px] sm:text-2xs text-muted-foreground mt-0.5 line-clamp-2">Dual Y-axis chart: pH (left) vs EC (right)</div>
            </div>
            <Badge variant="outline" className="text-[7px] sm:text-2xs whitespace-nowrap">5.5–6.5 | 0.8–1.2</Badge>
          </div>
          
          <div className="h-40 w-full xs:h-48 sm:h-64">
            <ChartContainer config={{ 
              ph: { label: "pH", color: "#6366f1" },
              ec: { label: "EC", color: "#f59e0b" }
            }} className="h-full w-full">
              <AreaChart data={groupedSensorData} margin={{ left: -20, right: -10, top: 5, bottom: 0 }}>
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
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} className="text-[8px] xs:text-[9px] font-semibold" />
                <YAxis yAxisId="left" domain={[4.5, 7.5]} allowDecimals={true} tickLine={false} axisLine={false} className="text-[8px] xs:text-[9px] font-mono fill-muted-foreground" width={28} />
                <YAxis yAxisId="right" orientation="right" domain={[0.4, 2.0]} allowDecimals={true} tickLine={false} axisLine={false} className="text-[8px] xs:text-[9px] font-mono fill-muted-foreground" width={28} />
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
        <Card className="p-3 sm:p-5 border-border bg-card">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] sm:text-xs font-bold text-muted-foreground uppercase tracking-wider line-clamp-1">Temperatures & Humidity</div>
              <div className="text-[8px] sm:text-2xs text-muted-foreground mt-0.5 line-clamp-2">Water and NFT temps (left) vs air humidity (right)</div>
            </div>
            <Badge variant="outline" className="text-[7px] sm:text-2xs whitespace-nowrap">20–26°C | 40–90%</Badge>
          </div>
          
          <div className="h-40 w-full xs:h-48 sm:h-64">
            <ChartContainer config={{ 
              temp: { label: "Tank T°", color: "#0ea5e9" },
              nftTemp: { label: "NFT T°", color: "#f59e0b" },
              humidity: { label: "Humidity %", color: "#10b981" }
            }} className="h-full w-full">
              <AreaChart data={groupedSensorData} margin={{ left: -20, right: -10, top: 5, bottom: 0 }}>
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
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} className="text-[8px] xs:text-[9px] font-semibold" />
                <YAxis yAxisId="left" domain={[15, 32]} allowDecimals={true} tickLine={false} axisLine={false} className="text-[8px] xs:text-[9px] font-mono fill-muted-foreground" width={28} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} allowDecimals={false} tickLine={false} axisLine={false} className="text-[8px] xs:text-[9px] font-mono fill-muted-foreground" width={28} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend content={<ChartLegendContent />} />
                <ReferenceLine yAxisId="right" y={40} stroke="#6ee7b7" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="right" y={90} stroke="#6ee7b7" strokeDasharray="4 4" />
                <Area yAxisId="left" type="monotone" dataKey="reservoirTempC" stroke="var(--color-temp)" strokeWidth={1.5} fillOpacity={1} fill="url(#colorHistoryTemp)" dot={false} connectNulls />
                <Area yAxisId="left" type="monotone" dataKey="nftTempC" stroke="var(--color-nftTemp)" strokeWidth={1.5} fillOpacity={1} fill="url(#colorHistoryNftTemp)" dot={false} connectNulls />
                <Area yAxisId="right" type="monotone" dataKey="humidityPct" stroke="var(--color-humidity)" strokeWidth={1.5} fillOpacity={1} fill="url(#colorHistoryHum)" dot={false} connectNulls />
              </AreaChart>
            </ChartContainer>
          </div>
        </Card>
      </div>

      {/* Historical Data Tables Audit Logs */}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        {/* Sensor Logs Paginated Table */}
        <Card className="p-3 sm:p-5 xl:col-span-2 border-border bg-card space-y-3">
          <div className="space-y-3 sm:space-y-0">
            <div className="flex flex-col gap-2.5">
              <div>
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Historical Sensor Registry</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Paginated logs of every ESP32 sensor transmission</div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="text-[9px] text-muted-foreground font-bold uppercase whitespace-nowrap">Filter Date:</label>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <input
                    type="date"
                    value={registryDateFilter}
                    onChange={(e) => {
                      setRegistryDateFilter(e.target.value);
                      setSensorPage(0);
                    }}
                    className="h-8 w-full rounded border border-border/80 bg-muted/20 px-2 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 sm:w-40"
                  />
                  {registryDateFilter && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setRegistryDateFilter("");
                        setSensorPage(0);
                      }}
                      className="h-8 px-2 text-[9px] font-bold text-red-500"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {totalSensorPages > 1 && (
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span className="text-[9px] font-bold text-muted-foreground font-mono">
                  Page {sensorPage + 1} / {totalSensorPages}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={sensorPage === 0}
                    onClick={() => setSensorPage((p) => p - 1)}
                    className="h-7 px-2 text-[9px]"
                  >
                    Prev
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={sensorPage >= totalSensorPages - 1}
                    onClick={() => setSensorPage((p) => p + 1)}
                    className="h-7 px-2 text-[9px]"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto -mx-3 sm:-mx-5">
            <div className="min-w-[620px] px-3 sm:px-5">
              <table className="w-full text-[9px] sm:text-xs">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr className="font-bold text-[8px] uppercase tracking-wider">
                    <th className="px-2 py-2 text-left sm:px-3">Time</th>
                    <th className="px-2 py-2 text-center sm:px-3">pH</th>
                    <th className="px-2 py-2 text-center sm:px-3">EC</th>
                    <th className="hidden px-2 py-2 text-center sm:table-cell sm:px-3">Temp</th>
                    <th className="hidden px-2 py-2 text-center md:table-cell sm:px-3">Humidity</th>
                    <th className="hidden px-2 py-2 text-center lg:table-cell sm:px-3">Volume</th>
                    <th className="hidden px-2 py-2 text-right lg:table-cell sm:px-3">Distance</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSensors.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground text-xs">
                        No sensor logs recorded in this date range.
                      </td>
                    </tr>
                  ) : (
                    paginatedSensors.map((snapshot) => (
                      <tr key={snapshot.timestamp} className="border-t border-border/50 hover:bg-muted/10 transition-colors">
                        <td className="px-2 py-2 font-mono text-[9px] text-muted-foreground sm:px-3">
                          <div className="font-semibold text-foreground">{format(snapshot.timestamp, "HH:mm:ss")}</div>
                          <div className="text-[8px] sm:hidden">{format(snapshot.timestamp, "MM/dd")}</div>
                        </td>
                        <td className="px-2 py-2 text-center font-bold text-indigo-600 dark:text-indigo-400 sm:px-3">
                          {snapshot.ph != null ? snapshot.ph.toFixed(2) : "——"}
                        </td>
                        <td className="px-2 py-2 text-center font-bold text-amber-600 dark:text-amber-400 sm:px-3">
                          {snapshot.ec != null ? snapshot.ec.toFixed(2) : "——"}
                        </td>
                        <td className="hidden px-2 py-2 text-center font-semibold text-sky-600 dark:text-sky-400 sm:table-cell sm:px-3">
                          <div>{snapshot.reservoirTempC != null ? `${snapshot.reservoirTempC.toFixed(1)}°` : "——"}</div>
                          {snapshot.nftTempC != null && (
                            <div className="text-[8px] text-amber-600 dark:text-amber-400">
                              NFT {snapshot.nftTempC.toFixed(1)}°
                            </div>
                          )}
                        </td>
                        <td className="hidden px-2 py-2 text-center font-semibold text-emerald-600 dark:text-emerald-400 md:table-cell sm:px-3">
                          {snapshot.humidityPct != null ? `${snapshot.humidityPct.toFixed(1)}%` : "——"}
                        </td>
                        <td className="hidden px-2 py-2 text-center font-mono text-muted-foreground lg:table-cell sm:px-3">
                          {snapshot.waterVolumeLiters != null ? `${snapshot.waterVolumeLiters.toFixed(1)}L` : "——"}
                        </td>
                        <td className="hidden px-2 py-2 text-right font-mono text-slate-500 dark:text-slate-400 lg:table-cell sm:px-3">
                          {snapshot.waterDistanceCm != null ? `${snapshot.waterDistanceCm.toFixed(1)}cm` : "——"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t border-border/50 pt-2 text-[8px] text-muted-foreground sm:hidden">
            <div>Tip: swipe horizontally to view more sensor columns.</div>
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
