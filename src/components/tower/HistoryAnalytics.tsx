import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
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
import { AlertCircle, CalendarRange, Download, Droplets, Thermometer, Zap } from "lucide-react";
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

type TempPoint = {
  label: string;
  reservoirTempC: number | null;
  towerTempC: number | null;
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

function groupSensorHistory(snapshots: SensorSnapshot[], days: RangeDays): TempPoint[] {
  const bucketMs = bucketMsForRange(days);
  const buckets = new Map<number, { reservoir: number[]; tower: number[] }>();

  for (const snapshot of snapshots) {
    const bucketKey = Math.floor(snapshot.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { reservoir: [], tower: [] });
    }
    const bucket = buckets.get(bucketKey)!;
    if (snapshot.reservoirTempC != null) bucket.reservoir.push(snapshot.reservoirTempC);
    if (snapshot.towerTempC != null) bucket.tower.push(snapshot.towerTempC);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, bucket]) => ({
      label: bucketLabel(timestamp, days),
      reservoirTempC:
        bucket.reservoir.length > 0
          ? bucket.reservoir.reduce((sum, value) => sum + value, 0) / bucket.reservoir.length
          : null,
      towerTempC:
        bucket.tower.length > 0 ? bucket.tower.reduce((sum, value) => sum + value, 0) / bucket.tower.length : null,
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

export function HistoryAnalyticsTab() {
  const [days, setDays] = useState<RangeDays>(7);
  const [summary, setSummary] = useState<AnalyticsSummary>(EMPTY_SUMMARY);
  const [sensorHistory, setSensorHistory] = useState<SensorSnapshot[]>([]);
  const [pumpLogs, setPumpLogs] = useState<PumpLogEntry[]>([]);
  const [manualReadings, setManualReadings] = useState<ManualReading[]>([]);
  const [faults, setFaults] = useState<FaultRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextSummary, nextSensors, nextLogs, nextReadings, nextFaults] = await Promise.all([
        fetchAnalyticsSummary(days),
        fetchSensorHistory(days),
        fetchPumpLogs(days, 250),
        fetchManualReadings(),
        fetchFaultHistory(),
      ]);

      setSummary(nextSummary ?? EMPTY_SUMMARY);
      setSensorHistory(nextSensors);
      setPumpLogs(nextLogs);
      setManualReadings(nextReadings.filter((reading) => reading.timestamp >= Date.now() - days * 24 * 60 * 60 * 1000));
      setFaults((nextFaults as FaultRow[]).filter((fault) => fault.timestamp >= Date.now() - days * 24 * 60 * 60 * 1000));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const tempData = groupSensorHistory(sensorHistory, days);
  const humidityData = groupHumidityHistory(sensorHistory, days);
  const pumpData = groupPumpLogs(pumpLogs, days);
  const avgLightLux = (() => {
    const vals = sensorHistory.map((s) => s.lightLux).filter((v) => typeof v === "number") as number[];
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  })();
  const recentFaults = faults.slice(0, 8);
  const manualRows = [...manualReadings].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);

  const exportRows: string[] = [
    "type,timestamp,reservoirTempC,towerTempC,pumpState,fault,mode,durationSeconds,flowed,ph,tds,ec,notes",
  ];

  for (const snapshot of sensorHistory) {
    exportRows.push(
      [
        "sensor",
        new Date(snapshot.timestamp).toISOString(),
        snapshot.reservoirTempC ?? "",
        snapshot.towerTempC ?? "",
        snapshot.pumpState,
        snapshot.fault ?? "",
        "",
        "",
        "",
        "",
        "",
        "",
      ].join(","),
    );
  }

  for (const cycle of pumpLogs) {
    exportRows.push(
      [
        "pump",
        cycle.startedAt,
        "",
        "",
        "",
        "",
        cycle.fault ?? "",
        cycle.mode,
        cycle.durationSeconds,
        cycle.flowed ? "true" : "false",
        "",
        "",
        "",
        "",
      ].join(","),
    );
  }

  for (const reading of manualReadings) {
    exportRows.push(
      [
        "manual",
        new Date(reading.timestamp).toISOString(),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        reading.ph ?? "",
        reading.tds ?? "",
        reading.ec ?? "",
        (reading.notes ?? "").replaceAll(",", ";"),
      ].join(","),
    );
  }

  const latestTemp = sensorHistory[0];
  const latestReading = manualRows[0];

  const tempChartConfig = {
    reservoir: { label: "Reservoir", color: "hsl(var(--chart-1))" },
    tower: { label: "Tower", color: "hsl(var(--chart-2))" },
  };

  const pumpChartConfig = {
    cycles: { label: "Cycles", color: "hsl(var(--chart-3))" },
    successRate: { label: "Success %", color: "hsl(var(--chart-2))" },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarRange className="h-4 w-4" />
            History & Analytics
          </div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Data logging and trend analysis</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Track temperature, cycles, manual readings, and faults over time. Charts update from the local ESP32 API.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map((option) => (
            <Button
              key={option.days}
              variant={days === option.days ? "default" : "outline"}
              size="sm"
              onClick={() => setDays(option.days)}
            >
              {option.label}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => downloadCsv(`tower-analytics-${days}d.csv`, exportRows)}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <SummaryCard
          icon={<Thermometer className="h-5 w-5" />}
          label="Reservoir temp"
          value={summary.avgReservoirTempC != null ? `${summary.avgReservoirTempC.toFixed(1)} °C` : "Waiting"}
          hint={`Peak ${summary.maxReservoirTempC != null ? summary.maxReservoirTempC.toFixed(1) : "—"} °C`}
        />
        <SummaryCard
          icon={<Thermometer className="h-5 w-5" />}
          label="Tower temp"
          value={summary.avgTowerTempC != null ? `${summary.avgTowerTempC.toFixed(1)} °C` : "Waiting"}
          hint={`Peak ${summary.maxTowerTempC != null ? summary.maxTowerTempC.toFixed(1) : "—"} °C`}
        />
        <SummaryCard
          icon={<Zap className="h-5 w-5" />}
          label="Pump success"
          value={`${summary.successRate.toFixed(1)}%`}
          hint={`${summary.pumpCycles} cycles in range`}
        />
        <SummaryCard
          icon={<Droplets className="h-5 w-5" />}
          label="Estimated water"
          value={`${summary.estimatedWaterLiters.toFixed(1)} L`}
          hint="From logged pump durations"
        />
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="Faults"
          value={summary.faultCount}
          hint={`${summary.sensorPoints} sensor samples`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Temperature trends</div>
              <div className="text-xs text-muted-foreground">Reservoir and tower average per bucket</div>
            </div>
            <Badge variant="outline">Heat threshold 30°C</Badge>
          </div>
          <ChartContainer config={tempChartConfig} className="h-80 w-full">
            <LineChart data={tempData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="6 6" />
              <Line type="monotone" dataKey="reservoirTempC" stroke="var(--color-reservoir)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="towerTempC" stroke="var(--color-tower)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Pump performance</div>
              <div className="text-xs text-muted-foreground">Daily cycles and success rate</div>
            </div>
            <Badge variant="outline">{days}-day window</Badge>
          </div>
          <ChartContainer config={pumpChartConfig} className="h-80 w-full">
            <BarChart data={pumpData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis yAxisId="left" tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} domain={[0, 100]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend content={<ChartLegendContent />} />
              <Bar yAxisId="left" dataKey="cycles" fill="var(--color-cycles)" radius={[6, 6, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="successRate"
                stroke="var(--color-successRate)"
                strokeWidth={2}
                dot={false}
              />
            </BarChart>
          </ChartContainer>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Humidity trends</div>
              <div className="text-xs text-muted-foreground">Average humidity per bucket</div>
            </div>
            <Badge variant="outline">Target 50–70%</Badge>
          </div>
          <ChartContainer config={{ value: { label: "Humidity", color: "hsl(var(--chart-4))" } }} className="h-80 w-full">
            <LineChart data={humidityData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis tickLine={false} axisLine={false} domain={[0, 100]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ReferenceLine y={50} stroke="#60a5fa" strokeDasharray="4 4" />
              <ReferenceLine y={70} stroke="#34d399" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="humidityPct" stroke="var(--color-value)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Recent cycles</div>
              <div className="text-xs text-muted-foreground">Mode, ON duration, OFF interval, and fault status</div>
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Mode</th>
                  <th className="px-3 py-2 text-left">ON</th>
                  <th className="px-3 py-2 text-left">OFF</th>
                  <th className="px-3 py-2 text-left">Flow</th>
                  <th className="px-3 py-2 text-left">Fault</th>
                </tr>
              </thead>
              <tbody>
                {pumpLogs.slice(0, 10).map((cycle) => {
                  const code = parseFault(cycle.fault);
                  const info = code ? FAULT_INFO[code] : null;
                  return (
                    <tr key={cycle.id} className="border-t border-border">
                      <td className="px-3 py-2">{format(new Date(cycle.startedAt), "MMM d, HH:mm")}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{cycle.mode}</Badge>
                      </td>
                      <td className="px-3 py-2 font-mono">{cycle.onDurationSeconds}s</td>
                      <td className="px-3 py-2 font-mono">{cycle.offIntervalMinutes}m</td>
                      <td className="px-3 py-2">
                        <Badge variant={cycle.flowed && !cycle.fault ? "default" : "destructive"}>
                          {cycle.flowed && !cycle.fault ? "Success" : "Check"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{info?.label ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 text-sm font-medium text-muted-foreground">Fault timeline</div>
          {recentFaults.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No recent faults logged.
            </div>
          ) : (
            <div className="space-y-3">
              {recentFaults.map((fault) => {
                const code = parseFault(fault.fault);
                const info = code ? FAULT_INFO[code] : null;
                const tone = code === "DRY_RUN" || code === "FLOW_TIMEOUT" ? "destructive" : "secondary";
                return (
                  <div key={`${fault.timestamp}-${fault.fault}`} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{info?.label ?? fault.fault}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(fault.timestamp), "MMM d, HH:mm")}</div>
                      </div>
                      <Badge variant={tone}>{code ?? "INFO"}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">{info?.hint ?? "Event logged by the controller"}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {[
          { label: "pH history", color: "hsl(var(--chart-1))", data: manualRows.filter((r) => r.ph != null).map((r) => ({ label: format(r.timestamp, "HH:mm"), value: r.ph })) },
          { label: "TDS history", color: "hsl(var(--chart-2))", data: manualRows.filter((r) => r.tds != null).map((r) => ({ label: format(r.timestamp, "HH:mm"), value: r.tds })) },
          { label: "EC history", color: "hsl(var(--chart-3))", data: manualRows.filter((r) => r.ec != null).map((r) => ({ label: format(r.timestamp, "HH:mm"), value: r.ec })) },
        ].map((series) => (
          <Card className="p-5" key={series.label}>
            <div className="mb-4">
              <div className="text-sm font-medium text-muted-foreground">{series.label}</div>
              <div className="text-xs text-muted-foreground">Latest manual readings</div>
            </div>
              <ChartContainer config={{ value: { label: series.label, color: series.color } }} className="h-55 w-full">
                <LineChart data={series.data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="value" stroke="var(--color-value)" strokeWidth={2} dot={false} />
                  {series.label === "pH history" && (
                    <>
                      <ReferenceLine y={5.5} stroke="#f59e0b" strokeDasharray="4 4" />
                      <ReferenceLine y={6.2} stroke="#34d399" strokeDasharray="4 4" />
                    </>
                  )}
                  {series.label === "TDS history" && (
                    <>
                      <ReferenceLine y={560} stroke="#f59e0b" strokeDasharray="4 4" />
                      <ReferenceLine y={840} stroke="#34d399" strokeDasharray="4 4" />
                    </>
                  )}
                  {series.label === "EC history" && (
                    <>
                      <ReferenceLine y={0.8} stroke="#f59e0b" strokeDasharray="4 4" />
                      <ReferenceLine y={1.2} stroke="#34d399" strokeDasharray="4 4" />
                    </>
                  )}
                </LineChart>
              </ChartContainer>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Manual readings history</div>
            <div className="text-xs text-muted-foreground">Handheld meter entries captured in the dashboard</div>
          </div>
          <Badge variant="outline">{manualRows.length} shown</Badge>
        </div>

        {manualRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No manual pH/TDS/EC readings in the selected range.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">pH</th>
                  <th className="px-3 py-2 text-left">TDS</th>
                  <th className="px-3 py-2 text-left">EC</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {manualRows.map((reading) => (
                  <tr key={reading.id} className="border-t border-border">
                    <td className="px-3 py-2">{format(reading.timestamp, "MMM d, HH:mm")}</td>
                    <td className="px-3 py-2">{reading.ph ?? "—"}</td>
                    <td className="px-3 py-2">{reading.tds ?? "—"}</td>
                    <td className="px-3 py-2">{reading.ec ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{reading.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {loading && <p className="text-xs text-muted-foreground">Refreshing analytics…</p>}
    </div>
  );
}
