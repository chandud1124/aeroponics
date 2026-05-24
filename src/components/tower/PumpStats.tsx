import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Timer, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseFault, FAULT_INFO, type FaultCode } from "@/lib/tower-faults";
import { withDeviceHeaders } from "@/lib/tower-storage";

type LogRow = {
  id: string;
  started_at: string;
  duration_seconds: number | null;
  flowed: boolean | null;
  fault: string | null;
};

type Summary = {
  total: number;
  last24h: number;
  avgDuration: number;
  successRate: number;
  faulted: number;
  faultBreakdown: Record<FaultCode, number>;
  recent: LogRow[];
};

const EMPTY: Summary = {
  total: 0,
  last24h: 0,
  avgDuration: 0,
  successRate: 0,
  faulted: 0,
  faultBreakdown: {} as Record<FaultCode, number>,
  recent: [],
};

async function loadSummary(deviceId?: string | null): Promise<Summary> {
  const response = await fetch("/api/pump-log", withDeviceHeaders({ method: "GET" }, deviceId));
  if (!response.ok) return EMPTY;
  const payload = (await response.json()) as {
    cycles: Array<{
      id: string;
      startedAt: string;
      durationSeconds: number | null;
      flowed: boolean | null;
      fault: string | null;
    }>;
  };

  const rows = payload.cycles.map((log) => ({
    id: log.id,
    started_at: log.startedAt,
    duration_seconds: log.durationSeconds,
    flowed: log.flowed,
    fault: log.fault,
  })) as LogRow[];

  if (rows.length === 0) return EMPTY;

  const total = rows.length;

  const cutoff = Date.now() - 24 * 3600 * 1000;
  const last24h = rows.filter((r) => new Date(r.started_at).getTime() >= cutoff).length;
  const durations = rows.map((r) => r.duration_seconds ?? 0).filter((d) => d > 0);
  const avgDuration =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const completedCount = rows.filter((r) => !r.fault).length;
  const successRate = total > 0 ? (completedCount / total) * 100 : 0;
  const faulted = rows.filter((r) => r.fault).length;
  const faultBreakdown = {} as Record<FaultCode, number>;
  for (const r of rows) {
    const code = parseFault(r.fault);
    if (!code || code === "OK") continue;
    faultBreakdown[code] = (faultBreakdown[code] ?? 0) + 1;
  }
  return {
    total,
    last24h,
    avgDuration,
    successRate,
    faulted,
    faultBreakdown,
    recent: rows.slice(0, 10),
  };
}

function StatCard({
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

export function PumpStats({ deviceId }: { deviceId?: string | null }) {
  const [summary, setSummary] = useState<Summary>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadSummary(deviceId)
      .then(setSummary)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [deviceId]);

  const breakdownEntries = Object.entries(summary.faultBreakdown) as [FaultCode, number][];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pump cycle summary</h2>
          <p className="text-xs text-muted-foreground">
            Aggregated from <code className="rounded bg-muted px-1">tower_pump_log</code> (last 500
            cycles).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="Total cycles"
          value={summary.total}
          hint={`${summary.last24h} in last 24 h`}
        />
        <StatCard
          icon={<Timer className="h-5 w-5" />}
          label="Avg duration"
          value={`${summary.avgDuration.toFixed(0)} s`}
          hint="Per cycle"
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="Cycle success"
          value={`${summary.successRate.toFixed(0)}%`}
          hint="Cycles completed without faults"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Faulted cycles"
          value={summary.faulted}
          hint={summary.faulted > 0 ? "See breakdown below" : "Healthy"}
        />
      </div>

      {breakdownEntries.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Fault breakdown</div>
          <div className="flex flex-wrap gap-2">
            {breakdownEntries.map(([code, n]) => {
              const info = FAULT_INFO[code];
              const variant =
                info.severity === "bad"
                  ? "destructive"
                  : info.severity === "warn"
                    ? "default"
                    : "secondary";
              return (
                <Badge key={code} variant={variant}>
                  {info.label}: {n}
                </Badge>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-secondary/40 px-4 py-2 text-sm font-medium">
          Recent cycles
        </div>
        {summary.recent.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No pump cycles logged yet. The ESP32 inserts a row into{" "}
            <code className="rounded bg-muted px-1">tower_pump_log</code> after every cycle.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Duration</th>
                <th className="px-3 py-2 text-left">Cycle</th>
                <th className="px-3 py-2 text-left">Fault</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent.map((r) => {
                const code = parseFault(r.fault);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      {new Date(r.started_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.duration_seconds ?? "—"} s</td>
                    <td className="px-3 py-2">
                      {!r.fault ? (
                        <Badge variant="default">OK</Badge>
                      ) : (
                        <Badge variant="destructive">FAULT</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {code && code !== "OK" ? FAULT_INFO[code].label : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
