import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Clock,
  Play,
  Square,
  Droplets,
  AlertTriangle,
  AlertOctagon,
  Zap,
  Network,
  Gauge,
  History,
  Sprout,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { LiveStatus, Schedule } from "@/lib/tower-storage";
import {
  PumpState,
  PUMP_STATE_LABELS,
  PUMP_STATE_COLORS,
  fetchFaultHistory,
} from "@/lib/tower-storage";

// ==================== PUMP STATE DISPLAY ====================

export function PumpStateDisplay({ status }: { status: LiveStatus }) {
  const state = status.pumpState || PumpState.IDLE;
  const label = PUMP_STATE_LABELS[state];
  const colorClass = PUMP_STATE_COLORS[state];
  const cycleLabel =
    state === PumpState.RUNNING || state === PumpState.VERIFYING_FLOW || state === PumpState.STARTING
      ? "MISTING"
      : state === PumpState.MANUAL_MODE
        ? "MANUAL MODE"
        : state === PumpState.FAULT_NO_FLOW || state === PumpState.LOW_WATER_LOCK || state === PumpState.TEMP_PAUSE
          ? "LOCKED"
          : "WAITING";

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium text-muted-foreground">Pump Status</div>
          <div className={`inline-flex items-center rounded-lg px-4 py-3 ${colorClass}`}>
            <Zap className="mr-2 h-5 w-5" />
            <span className="font-semibold">{state}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">Current cycle: {cycleLabel}</Badge>
          <Badge variant={status.flowing ? "default" : "outline"}>
            {status.flowing ? "Flow verified" : state === PumpState.VERIFYING_FLOW ? "Verifying flow" : "Oxygen break"}
          </Badge>
        </div>

        <div className="text-sm text-muted-foreground">{label}</div>

        {/* Flow verification indicator */}
        {state === PumpState.VERIFYING_FLOW && (
          <div className="rounded-lg bg-orange-50 p-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-orange-500" />
              <span className="text-sm font-medium text-orange-900">Waiting for flow sensor...</span>
            </div>
          </div>
        )}

        {/* Flowing indicator */}
        {state === PumpState.RUNNING && (
          <div className="rounded-lg bg-green-50 p-3">
            <div className="flex items-center gap-2">
              <Droplets className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-900">Water flowing ✓</span>
            </div>
          </div>
        )}

        {/* Fault indicator */}
        {(state === PumpState.FAULT_NO_FLOW ||
          state === PumpState.LOW_WATER_LOCK ||
          state === PumpState.TEMP_PAUSE) && (
          <div className="rounded-lg bg-red-50 p-3">
            <div className="flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-red-600" />
              <span className="text-sm font-medium text-red-900">System paused - check conditions</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ==================== NEXT CYCLE PANEL ====================

export function NextCyclePanel({ status, schedule }: { status: LiveStatus; schedule: Schedule }) {
  const [countdown, setCountdown] = useState<string>("--:--");

  useEffect(() => {
    const updateCountdown = () => {
      const seconds = status.nextCycleIn;

      if (seconds < 0) {
        setCountdown("--:--");
        return;
      }

      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const formatted =
        mins < 100
          ? `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
          : `${mins}:${String(secs).padStart(2, "0")}`;

      setCountdown(formatted);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [status.nextCycleIn]);

  if (!status.nextCycleISO) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="mb-1 text-sm font-medium text-muted-foreground">Next Cycle</div>
              <div className="text-xs text-muted-foreground">Schedule disabled</div>
            </div>
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </Card>
    );
  }

  const nextDate = new Date(status.nextCycleISO);
  const hour = new Date().getHours();
  const isDayMode = hour >= schedule.startHour && hour < schedule.endHour;
  const modeLabel = isDayMode ? "DAY MODE" : "NIGHT MODE";
  const expectedDuration = isDayMode
    ? schedule.dayDurationSeconds ?? schedule.durationSeconds
    : schedule.nightDurationSeconds ?? Math.max(15, Math.round((schedule.durationSeconds * 0.75) || 30));
  const expectedOff = isDayMode
    ? schedule.dayIntervalMinutes ?? schedule.intervalMinutes
    : schedule.nightIntervalMinutes ?? Math.max(schedule.intervalMinutes, 15);
  const timeStr = nextDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="mb-1 text-sm font-medium text-muted-foreground">Next Cycle</div>
            <div className="mb-2 flex items-baseline gap-2">
              <div className="text-4xl font-black tracking-tight tabular-nums">{countdown}</div>
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">next mist</span>
            </div>
            <div className="text-xs text-muted-foreground">Next run: {timeStr}</div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-md bg-secondary px-3 py-2">
                <div className="text-muted-foreground">Mode</div>
                <div className="font-semibold">{modeLabel}</div>
              </div>
              <div className="rounded-md bg-secondary px-3 py-2">
                <div className="text-muted-foreground">Expected duration</div>
                <div className="font-semibold">{expectedDuration} sec</div>
              </div>
              <div className="rounded-md bg-secondary px-3 py-2">
                <div className="text-muted-foreground">OFF interval</div>
                <div className="font-semibold">{expectedOff} min</div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs">
              Current cycle: <span className="font-semibold">{modeLabel}</span> · {expectedDuration}s ON · {expectedOff} min OFF
            </div>
          </div>
          <Clock className="h-6 w-6 text-primary" />
        </div>
      </div>
    </Card>
  );
}

export function LiveCycleHistoryPanel() {
  type Row = {
    id: string;
    startedAt: string;
    durationSeconds: number;
    flowed: boolean;
    fault: string | null;
  };

  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch("/api/pump-log");
        if (!response.ok) return;
        const payload = (await response.json()) as { cycles: Row[] };
        if (active) setRows(payload.cycles.slice(0, 5));
      } catch {
        // keep last good state
      }
    };

    load();
    const interval = setInterval(load, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-muted-foreground">Recent cycles</div>
          <div className="text-xs text-muted-foreground">Last 5 watering events</div>
        </div>
        <History className="h-5 w-5 text-muted-foreground" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No cycles logged yet. The controller will show misting history here after the first run.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const ok = row.flowed && !row.fault;
            return (
              <div key={row.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">
                    {new Date(row.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.durationSeconds}s ON · {ok ? "Success" : row.fault ?? "Skipped"}
                  </div>
                </div>
                <Badge variant={ok ? "default" : "destructive"}>{ok ? "OK" : "CHECK"}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ==================== MANUAL CONTROL PANEL ====================

export function ManualControlPanel() {
  const [loading, setLoading] = useState(false);
  const [optimisticLightOn, setOptimisticLightOn] = useState<boolean | null>(null);

  const handleStart = async () => {
    try {
      const response = await fetch("/api/manual-pump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });

      if (response.ok) {
        // Success feedback
        console.log("Pump started manually");
      }
    } catch (error) {
      console.error("Failed to start pump:", error);
    }
  };

  const handleStop = async () => {
    try {
      const response = await fetch("/api/manual-pump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });

      if (response.ok) {
        console.log("Pump stopped manually");
      }
    } catch (error) {
      console.error("Failed to stop pump:", error);
    }
  };

  const handleLightToggle = async (action: "on" | "off") => {
    setLoading(true);
    // Optimistic update: show state immediately
    setOptimisticLightOn(action === "on");
    
    try {
      await fetch("/api/manual-light", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // Clear optimistic state on success (live data will update from polling)
      setTimeout(() => setOptimisticLightOn(null), 500);
    } catch (e) {
      console.error("Failed to toggle light:", e);
      // Revert optimistic update on error
      setOptimisticLightOn(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="text-sm font-medium text-muted-foreground">Manual Controls</div>
        <div className="flex gap-2">
          <Button
            onClick={handleStart}
            className="flex-1 bg-green-600 hover:bg-green-700"
            variant="default"
          >
            <Play className="mr-2 h-4 w-4" />
            Start Pump Now
          </Button>
          <Button onClick={handleStop} className="flex-1 bg-red-600 hover:bg-red-700" variant="default">
            <Square className="mr-2 h-4 w-4" />
            Emergency Stop
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => handleLightToggle("on")}
            disabled={loading}
            className={`flex-1 ${optimisticLightOn ? "bg-yellow-500 hover:bg-yellow-600" : "bg-indigo-600 hover:bg-indigo-700"} transition-colors`}
            variant="default"
          >
            <Zap className="mr-2 h-4 w-4" />
            {optimisticLightOn ? "Light ON" : "Turn Light On"}
          </Button>
          <Button
            onClick={() => handleLightToggle("off")}
            disabled={loading}
            className={`flex-1 ${optimisticLightOn === false ? "bg-slate-400 hover:bg-slate-500" : "bg-slate-600 hover:bg-slate-700"} transition-colors`}
            variant="default"
          >
            <Square className="mr-2 h-4 w-4" />
            {optimisticLightOn === false ? "Light OFF" : "Turn Light Off"}
          </Button>
        </div>
        <div className="flex items-start gap-2 rounded-md bg-yellow-50 p-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600" />
          <div className="text-xs text-yellow-900">
            Manual controls override automatic scheduling. Remember to disable when done.
          </div>
        </div>
        </div>
      </Card>
  );
}

function scoreFromStatus(status: LiveStatus) {
  let score = 100;

  if (status.fault && status.fault !== "OK") score -= 35;
  if (status.pumpOn && !status.flowing) score -= 20;
  if (status.reservoirTempC != null && status.reservoirTempC > 28) score -= 10;
  if (status.towerTempC != null && status.towerTempC > 32) score -= 5;

  return Math.max(0, score);
}

export function SystemHealthCard({ status, online = true }: { status: LiveStatus | null; online?: boolean }) {
  const score = status ? scoreFromStatus(status) : null;
  const label = score == null ? "Offline" : score >= 90 ? "Healthy" : score >= 70 ? "Attention" : "Critical";
  const tone =
    score == null
      ? "bg-slate-100 text-slate-700"
      : score >= 90
        ? "bg-green-50 text-green-800"
        : score >= 70
          ? "bg-amber-50 text-amber-800"
          : "bg-red-50 text-red-800";

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span>System Health</span>
              <Badge variant={online ? "secondary" : "destructive"} className="h-5 px-1.5 text-[10px] uppercase tracking-[0.18em]">
                {online ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
                {online ? "Online" : "Offline"}
              </Badge>
            </div>
            <div className={`inline-flex rounded-lg px-3 py-2 text-lg font-bold ${tone}`}>
              {score == null ? "--" : `${score}%`}
            </div>
          </div>
          <Gauge className="h-6 w-6 text-primary" />
        </div>
        <div className="text-sm text-muted-foreground">
          {score == null
            ? "No current telemetry from the ESP32. Historical records remain available below."
            : `${label} based on flow, temperature, and faults.`}
        </div>
      </div>
    </Card>
  );
}

export function FlowPipeline({ status }: { status: LiveStatus }) {
  const stages = [
    { label: "Water sensor", done: true, icon: Droplets },
    { label: "Pump", done: status.pumpOn, icon: Zap },
    { label: "Flow verified", done: status.flowing, icon: Network },
    { label: "Tower active", done: status.flowing, icon: Sprout },
  ];

  return (
    <Card className="p-6">
      <div className="mb-4 text-sm font-medium text-muted-foreground">Live cycle pipeline</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <div key={stage.label} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <div className={`rounded-full p-2 ${stage.done ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-sm font-medium">{stage.label}</div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {stage.done ? "Verified" : index === 0 ? "Waiting" : "Pending"}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function FaultHistoryPanel() {
  const [faults, setFaults] = useState<Array<{ timestamp: number; fault: string }>>([]);

  useEffect(() => {
    let active = true;

    fetchFaultHistory().then((rows) => {
      if (!active) return;
      setFaults(rows);
    });

    const interval = setInterval(() => {
      fetchFaultHistory().then((rows) => {
        if (!active) return;
        setFaults(rows);
      });
    }, 15000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-muted-foreground">Fault history</div>
          <div className="text-xs text-muted-foreground">Recent safety events from the controller</div>
        </div>
        <History className="h-5 w-5 text-muted-foreground" />
      </div>

      {faults.length === 0 ? (
        <div className="text-sm text-muted-foreground">No recent faults logged.</div>
      ) : (
        <div className="space-y-3">
          {faults.slice(0, 5).map((fault) => (
            <div key={`${fault.timestamp}-${fault.fault}`} className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">{fault.fault}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(fault.timestamp).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ==================== FAULT ALERT ====================

export function FaultAlertBanner({ status }: { status: LiveStatus }) {
  if (!status.fault || status.fault === "OK") return null;

  const faultMap: Record<string, { icon: typeof AlertOctagon; severity: string; message: string }> = {
    DRY_RUN: {
      icon: AlertOctagon,
      severity: "critical",
      message: "Pump running but no water flow detected. Check for blocked pipe or failed sensor.",
    },
    LOW_WATER: {
      icon: AlertTriangle,
      severity: "warning",
      message: "Water level too low. Watering cycle paused until tank is refilled.",
    },
    FLOW_STOPPED: {
      icon: AlertTriangle,
      severity: "warning",
      message: "Water flow stopped mid-cycle. Pump has been stopped.",
    },
    PUMP_TIMEOUT: {
      icon: AlertTriangle,
      severity: "warning",
      message: "Pump runtime exceeded 2 minutes. Stopped for safety.",
    },
    TEMP_HIGH: {
      icon: AlertTriangle,
      severity: "warning",
      message: "Reservoir temperature too high. Watering paused until cooled.",
    },
    SENSOR_FAIL: {
      icon: AlertOctagon,
      severity: "critical",
      message: "Temperature sensor malfunction. System in safe mode.",
    },
  };

  const faultInfo = faultMap[status.fault];
  if (!faultInfo) return null;

  const Icon = faultInfo.icon;
  const variant = faultInfo.severity === "critical" ? "destructive" : "default";

  return (
    <Alert variant={variant} className="mb-4">
      <Icon className="h-4 w-4" />
      <AlertDescription>
        <strong>{status.fault}</strong> — {faultInfo.message}
      </AlertDescription>
    </Alert>
  );
}
