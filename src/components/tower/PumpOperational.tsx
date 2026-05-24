import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Clock,
  Play,
  Square,
  ToggleRight,
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
  BatteryCharging,
} from "lucide-react";
import type { LiveStatus, Schedule } from "@/lib/tower-storage";
import {
  PumpState,
  PUMP_STATE_LABELS,
  PUMP_STATE_COLORS,
  fetchFaultHistory,
  withDeviceHeaders,
} from "@/lib/tower-storage";

// ==================== PUMP STATE DISPLAY ====================

export function PumpStateDisplay({ status, online = true }: { status: LiveStatus; online?: boolean }) {
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

        {!online && (
          <div className="rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            Offline: showing the last known pump state until the ESP32 reports again.
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">Current cycle: {cycleLabel}</Badge>
          <Badge variant={status.pumpOn ? "default" : "outline"}>
            {status.pumpOn ? "Pump active" : "Pump idle"}
          </Badge>
        </div>

        <div className="text-sm text-muted-foreground">{label}</div>

        {status.pumpOn && (
          <div className="rounded-lg bg-green-50 p-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-900">
                Pump relay active{state === PumpState.RUNNING ? " — watering in progress" : ""}
              </span>
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

export function NextCyclePanel({
  status,
  schedule,
  online = true,
}: {
  status: LiveStatus;
  schedule: Schedule;
  online?: boolean;
}) {
  const [countdown, setCountdown] = useState<string>("--:--");
  const [retryCountdown, setRetryCountdown] = useState<string | null>(null);
  const manualOverrideActive = status.motorManualMode != null && status.motorManualMode !== "AUTO";
  const controlModeLabel = manualOverrideActive ? "MANUAL OVERRIDE" : "AUTOMATIC";
  const controlModeHint = manualOverrideActive
    ? `Motor: ${status.motorManualMode ?? "AUTO"}`
    : online
      ? "ESP32 and backend are following the automatic schedule"
      : "Controller offline: showing the last known schedule state";

  useEffect(() => {
    const updateCountdown = () => {
      if (!status.nextCycleISO || status.nextCycleIn < 0) {
        setCountdown("--:--");
        return;
      }

      if (status.nextCycleIn === 0) {
        // If schedule is due but the pump hasn't reported as running yet,
        // show a clearer message so users know we're awaiting device confirmation.
        if (!status.pumpOn) {
          setCountdown("DUE NOW — awaiting device");
        } else {
          setCountdown("RUNNING");
        }
        return;
      }

      const targetMs = new Date(status.nextCycleISO).getTime();
      if (Number.isNaN(targetMs)) {
        setCountdown("--:--");
        return;
      }

      const seconds = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));

      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      const formatted =
        mins < 100
          ? `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
          : `${mins}:${String(secs).padStart(2, "0")}`;

      setCountdown(formatted);
    };

    const updateRetryCountdown = () => {
      if (!status.retryNextCycleISO) {
        setRetryCountdown(null);
        return;
      }

      const targetMs = new Date(status.retryNextCycleISO).getTime();
      if (Number.isNaN(targetMs)) {
        setRetryCountdown(null);
        return;
      }

      const seconds = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setRetryCountdown(
        seconds <= 1
          ? "00:01"
          : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`,
      );
    };

    updateCountdown();
    updateRetryCountdown();
    const interval = setInterval(updateCountdown, 1000);
    const retryInterval = setInterval(updateRetryCountdown, 1000);
    return () => {
      clearInterval(interval);
      clearInterval(retryInterval);
    };
  }, [status.nextCycleISO, status.retryNextCycleISO, status.pumpOn]);

  if (!status.nextCycleISO) {
      const waitingText = schedule.enabled
        ? status.lastRunISO
          ? "Waiting for the next scheduled run"
          : "Awaiting first automatic cycle"
        : "Schedule disabled";
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="mb-1 text-sm font-medium text-muted-foreground">Next Cycle</div>
                <div className="text-xs text-muted-foreground">{waitingText}</div>
            </div>
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
            <div className="rounded-md border border-dashed border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              Control mode: <span className="font-semibold text-foreground">{controlModeLabel}</span>
              <div className="mt-1">{controlModeHint}</div>
            </div>
        </div>
      </Card>
    );
  }

  const nextDate = new Date(status.nextCycleISO);
  const isDayMode = (status.cycleMode ?? "DAY") === "DAY";
  const modeLabel = isDayMode ? "DAY MODE" : "NIGHT MODE";
  const expectedDuration = status.cycleOnDurationSeconds ?? (isDayMode
    ? schedule.dayDurationSeconds ?? schedule.durationSeconds
    : schedule.nightDurationSeconds ?? Math.max(15, Math.round((schedule.durationSeconds * 0.75) || 30)));
  const expectedOff = status.cycleOffIntervalMinutes ?? (isDayMode
    ? Math.min(schedule.dayIntervalMinutes ?? schedule.intervalMinutes, 7)
    : schedule.nightIntervalMinutes ?? Math.max(schedule.intervalMinutes, 15));
  const lightStartHour = schedule.lightStartHour ?? schedule.startHour;
  const lightEndHour = schedule.lightEndHour ?? schedule.endHour;
  const timeStr = nextDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  // Device-applied schedule timestamp (optional)
  const appliedAtRaw = (status as any).scheduleAppliedAt as number | string | undefined;
  const appliedAtMs = appliedAtRaw
    ? typeof appliedAtRaw === "number"
      ? appliedAtRaw > 1e12
        ? appliedAtRaw
        : appliedAtRaw * 1000
      : Date.parse(String(appliedAtRaw))
    : null;
  const appliedAtStr = appliedAtMs ? new Date(appliedAtMs).toLocaleString() : null;
  const appliedPlanName = (status as any).appliedPlanName as string | undefined;
  const plannedNextCycle = status.plannedNextCycleISO ? new Date(status.plannedNextCycleISO) : new Date(status.nextCycleISO);

  const timetable: Array<{ label: string; time: string }> = [];
  if (plannedNextCycle && !Number.isNaN(plannedNextCycle.getTime())) {
    const intervalMinutes = status.cycleOffIntervalMinutes ?? expectedOff;
    const slotCount = 4;
    for (let index = 0; index < slotCount; index += 1) {
      const slot = new Date(plannedNextCycle.getTime() + index * intervalMinutes * 60 * 1000);
      if (slot.getHours() >= schedule.endHour) break;
      timetable.push({
        label: index === 0 ? "Next" : `+${index}`,
        time: slot.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }),
      });
    }
  }

  // If pump is running, compute remaining on-time from lastRunISO + expectedDuration
  let runningRemainingSec: number | null = null;
  if (status.pumpOn && status.lastRunISO) {
    const raw = (status.lastRunISO as any) as number | string;
    const lastMs = typeof raw === "number" ? (raw > 1e12 ? raw : raw * 1000) : Date.parse(String(raw));
    const expectedMs = expectedDuration * 1000;
    runningRemainingSec = Math.max(0, Math.ceil((lastMs + expectedMs - Date.now()) / 1000));
  }

  // If light is on, compute remaining time until end of active window
  let lightRemainingSec: number | null = null;
  if (status.lightOn) {
    const now = new Date();
    const end = new Date(now);
    end.setHours(schedule.endHour, 0, 0, 0);
    if (end.getTime() <= now.getTime()) {
      // If already past end today, set to tomorrow's end
      end.setDate(end.getDate() + 1);
    }
    lightRemainingSec = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000));
  }

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
            {status.retryNextCycleISO && retryCountdown && (
              <div className="mt-1 text-xs font-medium text-red-700">Retrying in {retryCountdown}</div>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant={manualOverrideActive ? "destructive" : "default"}>{controlModeLabel}</Badge>
              <Badge variant={status.pumpState === PumpState.MANUAL_MODE ? "secondary" : "outline"}>
                Pump: {status.pumpState === PumpState.MANUAL_MODE ? "Manual" : "Automatic"}
              </Badge>
            </div>
            {appliedAtStr && (
              <div className="text-xs text-muted-foreground">Plan applied: {appliedAtStr} {appliedPlanName ? `· ${appliedPlanName}` : null}</div>
            )}
            <div className="text-xs text-muted-foreground">Lights: {String(lightStartHour).padStart(2, "0")}:00 - {String(lightEndHour).padStart(2, "0")}:00</div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
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
              <div className="rounded-md bg-secondary px-3 py-2">
                <div className="text-muted-foreground">Humidity</div>
                <div className="font-semibold">{status.humidityPct != null ? `${status.humidityPct.toFixed(1)}%` : "—"}</div>
              </div>
            </div>
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-md bg-secondary px-3 py-2">
                <div className="text-muted-foreground">Ambient light</div>
                <div className="font-semibold">{status.lightLux != null ? `${status.lightLux} lux` : "—"}</div>
              </div>
              <div className="rounded-md bg-secondary px-3 py-2">
                <div className="text-muted-foreground">Light relay</div>
                <div className="font-semibold">{status.lightOn ? "On" : "Off"}</div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs">
              Current cycle: <span className="font-semibold">{modeLabel}</span> · {expectedDuration}s ON · {expectedOff} min OFF
              <div className="mt-2 flex gap-3">
                {status.pumpOn && runningRemainingSec != null && (
                  <div className="rounded-md bg-green-50 px-2 py-1 text-xs">
                    <div className="text-muted-foreground">Running — time left</div>
                    <div className="font-semibold">{String(Math.floor(runningRemainingSec / 60)).padStart(2, "0")}:{String(runningRemainingSec % 60).padStart(2, "0")}</div>
                  </div>
                )}

                {status.lightOn && lightRemainingSec != null && (
                  <div className="rounded-md bg-amber-50 px-2 py-1 text-xs">
                    <div className="text-muted-foreground">Light — time left</div>
                    <div className="font-semibold">{Math.floor(lightRemainingSec / 60)}m {lightRemainingSec % 60}s</div>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-border bg-background/70 p-3 text-xs">
              <div className="mb-2 font-semibold uppercase tracking-[0.2em] text-muted-foreground">Blueprint timetable</div>
              {timetable.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {timetable.map((slot) => (
                    <div key={`${slot.label}-${slot.time}`} className="rounded-md bg-secondary px-3 py-2">
                      <div className="text-muted-foreground">{slot.label}</div>
                      <div className="font-semibold tabular-nums">{slot.time}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground">No timetable available for the current schedule.</div>
              )}
              <div className="mt-2 text-muted-foreground">
                Failed flow checks retry every 1 second without shifting the blueprint.
              </div>
            </div>
          </div>
          <Clock className="h-6 w-6 text-primary" />
        </div>
      </div>
    </Card>
  );
}

export function LiveCycleHistoryPanel({ deviceId }: { deviceId?: string | null }) {
  type Row = {
    id: string;
    startedAt: string;
    durationSeconds: number;
    flowed: boolean;
    fault: string | null;
    volumeLiters?: number | null;
    flowRateLpm?: number | null;
  };

  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [respLogs, respStatus] = await Promise.all([
          fetch("/api/pump-log", withDeviceHeaders({ method: "GET" }, deviceId)),
          fetch("/api/status", withDeviceHeaders({ method: "GET" }, deviceId)),
        ]);
        if (!respLogs.ok) return;
        const logsPayload = (await respLogs.json()) as { cycles: Row[] };
        const statusPayload = respStatus.ok ? (await respStatus.json()) as any : null;

        let combined: Row[] = logsPayload.cycles.slice(0, 5);

        // If pump is currently running, prepend an in-progress row
        if (statusPayload && statusPayload.pumpOn && statusPayload.lastRunISO) {
          const startedAt = new Date(statusPayload.lastRunISO).toISOString();
          const elapsed = Math.max(0, Math.round((Date.now() - new Date(statusPayload.lastRunISO).getTime()) / 1000));
          const runningRow: Row = {
            id: statusPayload.pumpLogId ?? "running",
            startedAt,
            durationSeconds: elapsed,
            flowed: false,
            fault: null,
          };
          combined = [runningRow, ...combined].slice(0, 5);
        }

        if (active) setRows(combined);
      } catch {
        // keep last good state
      }
    };

    load();
    const interval = setInterval(load, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [deviceId]);

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
                      {row.volumeLiters != null && (
                        <span> · {Number(row.volumeLiters).toFixed(2)} L</span>
                      )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {row.id === "running" && (
                    <Badge variant="secondary">Running</Badge>
                  )}
                  <Badge variant={ok ? "default" : "destructive"}>{ok ? "OK" : "CHECK"}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ==================== MANUAL CONTROL PANEL ====================

export function ManualControlPanel({
  status,
  deviceId,
  online = true,
  controlsAllowed = true,
}: {
  status: LiveStatus | null;
  deviceId?: string | null;
  online?: boolean;
  controlsAllowed?: boolean;
}) {
  const [pumpLoading, setPumpLoading] = useState(false);
  const [pumpModeLoading, setPumpModeLoading] = useState(false);
  const [lightLoading, setLightLoading] = useState(false);
  const [optimisticLightOn, setOptimisticLightOn] = useState<boolean | null>(null);
  const pumpModeIsManual = status?.motorManualMode !== "AUTO";
  const controlsEnabled = online && controlsAllowed && Boolean(status);

  const handleStart = async () => {
    if (!controlsEnabled || !pumpModeIsManual) return;
    setPumpLoading(true);
    try {
      const response = await fetch("/api/manual-pump", {
        method: "POST",
        ...withDeviceHeaders({ headers: { "Content-Type": "application/json" } }, deviceId),
        body: JSON.stringify({ action: "start" }),
      });

      if (response.ok) {
        // Success feedback
        console.log("Pump started manually");
      }
    } catch (error) {
      console.error("Failed to start pump:", error);
    } finally {
      setPumpLoading(false);
    }
  };

  const handleStop = async () => {
    if (!controlsEnabled || !pumpModeIsManual) return;
    setPumpLoading(true);
    try {
      const response = await fetch("/api/manual-pump", {
        method: "POST",
        ...withDeviceHeaders({ headers: { "Content-Type": "application/json" } }, deviceId),
        body: JSON.stringify({ action: "stop" }),
      });

      if (response.ok) {
        console.log("Pump stopped manually");
      }
    } catch (error) {
      console.error("Failed to stop pump:", error);
    } finally {
      setPumpLoading(false);
    }
  };

  const handlePumpModeToggle = async () => {
    setPumpModeLoading(true);
    if (!controlsEnabled) {
      setPumpModeLoading(false);
      return;
    }
    try {
      await fetch("/api/manual-pump", {
        method: "POST",
        ...withDeviceHeaders({ headers: { "Content-Type": "application/json" } }, deviceId),
        body: JSON.stringify({ action: pumpModeIsManual ? "auto" : "manual", desiredOn: false }),
      });
    } catch (error) {
      console.error("Failed to switch pump mode:", error);
    } finally {
      setPumpModeLoading(false);
    }
  };

  const handleLightToggle = async (action: "on" | "off") => {
    setLightLoading(true);
    if (!controlsEnabled) {
      setLightLoading(false);
      return;
    }
    // Optimistic update: show state immediately
    setOptimisticLightOn(action === "on");
    
    try {
      await fetch("/api/manual-light", {
        method: "POST",
        ...withDeviceHeaders({ headers: { "Content-Type": "application/json" } }, deviceId),
        body: JSON.stringify({ action }),
      });
      // Clear optimistic state on success (live data will update from polling)
      setTimeout(() => setOptimisticLightOn(null), 500);
    } catch (e) {
      console.error("Failed to toggle light:", e);
      // Revert optimistic update on error
      setOptimisticLightOn(null);
    } finally {
      setLightLoading(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Manual controls</div>
            <div className="text-xs text-muted-foreground">Pump controls require MANUAL mode. Light controls stay available.</div>
          </div>
          <div className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            Top priority controls
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Pump mode</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {!controlsEnabled
                ? "Offline mode: control actions are disabled until telemetry returns"
                : pumpModeIsManual
                  ? "Manual mode is active"
                  : "Auto mode is active and schedule control is restored"}
            </div>
          </div>
          <Button
            onClick={handlePumpModeToggle}
            disabled={!controlsEnabled || pumpModeLoading}
            variant={pumpModeIsManual ? "secondary" : "default"}
            className="w-full sm:w-auto"
          >
            {pumpModeIsManual ? "Switch Pump to AUTO" : "Switch Pump to MANUAL"}
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={handleStart}
            disabled={!controlsEnabled || !pumpModeIsManual || pumpLoading}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            variant="default"
          >
            <Play className="mr-2 h-4 w-4" />
            Start Pump Now
          </Button>
          <Button
            onClick={handleStop}
            disabled={!controlsEnabled || !pumpModeIsManual || pumpLoading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            variant="default"
          >
            <Square className="mr-2 h-4 w-4" />
            Emergency Stop
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => handleLightToggle("on")}
            disabled={!controlsEnabled || lightLoading}
            className={`flex-1 ${optimisticLightOn ? "bg-yellow-500 hover:bg-yellow-600" : "bg-indigo-600 hover:bg-indigo-700"} transition-colors`}
            variant="default"
          >
            <Zap className="mr-2 h-4 w-4" />
            {optimisticLightOn ? "Light ON" : "Turn Light On"}
          </Button>
          <Button
            onClick={() => handleLightToggle("off")}
            disabled={!controlsEnabled || lightLoading}
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
            {controlsEnabled
              ? "Manual controls override automatic scheduling. Remember to disable when done."
              : "Reconnect the controller to change relays or pump mode."}
          </div>
        </div>
        </div>
      </Card>
  );
}

type RelayStateCardProps = {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  manualMode?: string;
  modeLabel?: string;
  detail: string;
  toggleLabel?: string;
  onToggleMode?: () => void;
  toggling?: boolean;
};

function RelayStateCard({ label, icon, active, manualMode, modeLabel, detail, toggleLabel, onToggleMode, toggling = false }: RelayStateCardProps) {
  return (
    <Card className={`p-5 ${active ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className={`rounded-full p-2 ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
            {icon}
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{active ? "ON" : "OFF"}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <Badge variant={active ? "default" : "secondary"}>{active ? "Relay active" : "Relay idle"}</Badge>
          {toggleLabel && onToggleMode ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleMode}
              disabled={toggling}
              className="h-7 w-full px-2 text-[11px] uppercase tracking-[0.18em] sm:w-auto"
            >
              {toggleLabel}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {detail}
        {manualMode && manualMode !== "AUTO" ? ` • ${modeLabel ?? "Control mode"}: ${manualMode}` : ""}
      </div>
    </Card>
  );
}

export function RelayStatesCard({
  status,
  online = true,
  deviceId,
  controlsAllowed = true,
}: {
  status: LiveStatus | null;
  online?: boolean;
  deviceId?: string | null;
  controlsAllowed?: boolean;
}) {
  const [modeLoading, setModeLoading] = useState<{ pump: boolean; light: boolean; battery: boolean }>({
    pump: false,
    light: false,
    battery: false,
  });

  const toggleRelayMode = async (kind: "pump" | "light" | "battery", active: boolean, manualMode?: string) => {
    if (!online || !controlsAllowed || !status) return;
    const endpoint = kind === "pump" ? "/api/manual-pump" : kind === "light" ? "/api/manual-light" : "/api/manual-battery";
    const action = manualMode && manualMode !== "AUTO" ? "auto" : "manual";
    setModeLoading((current) => ({ ...current, [kind]: true }));
    try {
      await fetch(endpoint, {
        method: "POST",
        ...withDeviceHeaders({ headers: { "Content-Type": "application/json" } }, deviceId),
        body: JSON.stringify({ action, desiredOn: active }),
      });
    } finally {
      setModeLoading((current) => ({ ...current, [kind]: false }));
    }
  };

  if (!status) {
    return (
      <Card className="p-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Relay states</div>
              <div className="text-xs text-muted-foreground">Waiting for ESP32 telemetry</div>
            </div>
            <Badge variant="destructive" className="h-5 px-1.5 text-[10px] uppercase tracking-[0.18em]">
              {online ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
              {online ? "Online" : "Offline"}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">No live relay data yet from the controller.</div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Relay states</div>
              <div className="text-xs text-muted-foreground">
                {online ? "Major controls and their current relay state" : "Offline mode: showing the last known relay state"}
              </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant={online ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px] uppercase tracking-[0.18em]">
              {online ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}
                {online ? "Online" : "Offline"}
            </Badge>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase tracking-[0.18em]">
              Controls ready
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <RelayStateCard
            label="Motor / pump"
            icon={<ToggleRight className="h-4 w-4" />}
            active={status.pumpOn}
            manualMode={status.motorManualMode}
            modeLabel="Pump mode"
            detail={online ? (status.pumpOn ? "Relay state is on right now" : "Relay state is off") : "Last known relay state"}
          />
          <RelayStateCard
            label="LED grow light"
            icon={<ToggleRight className="h-4 w-4" />}
            active={Boolean(status.lightOn)}
            manualMode={status.lightManualMode}
            modeLabel="Light mode"
            detail={online ? (status.lightOn ? "Light relay is supplying the LED strip" : "Light relay is off") : "Last known relay state"}
            toggleLabel={status.lightManualMode && status.lightManualMode !== "AUTO" ? "AUTO" : "MANUAL"}
            onToggleMode={() => toggleRelayMode("light", Boolean(status.lightOn), status.lightManualMode)}
            toggling={modeLoading.light || !online || !controlsAllowed}
          />
          <RelayStateCard
            label="Battery charging"
            icon={<BatteryCharging className="h-4 w-4" />}
            active={Boolean(status.batteryChargeOn)}
            manualMode={status.batteryManualMode}
            modeLabel="Battery mode"
            detail={online ? (status.batteryChargeOn ? "Battery charge relay is active" : "Battery charge relay is off") : "Last known relay state"}
            toggleLabel={status.batteryManualMode && status.batteryManualMode !== "AUTO" ? "AUTO" : "MANUAL"}
            onToggleMode={() => toggleRelayMode("battery", Boolean(status.batteryChargeOn), status.batteryManualMode)}
            toggling={modeLoading.battery || !online || !controlsAllowed}
          />
        </div>

        <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
          Above cards show whether each relay is switched on or off. Use the buttons below to force pump or light manually.
        </div>
      </div>
    </Card>
  );
}

export function FlowPipeline({ status }: { status: LiveStatus }) {
  const stages = [
    {
      label: "Humidity sensor",
      done: status.humidityPct != null,
      icon: Droplets,
      doneText: status.humidityPct != null ? "Telemetry present" : "Waiting for humidity telemetry",
      pendingText: "Humidity sensor is part of the active build",
    },
    {
      label: "Pump relay",
      done: status.pumpOn,
      icon: Zap,
      doneText: status.pumpState === PumpState.MANUAL_MODE ? "Manual override active" : "Automatic relay active",
      pendingText: status.motorManualMode && status.motorManualMode !== "AUTO" ? `Manual mode: ${status.motorManualMode}` : "Relay idle",
    },
    {
      label: "Light control",
      done: Boolean(status.lightOn),
      icon: Network,
      doneText: "LED lighting active",
      pendingText: status.lightOn ? "Light relay is on" : "Light relay is off",
    },
    {
      label: "Live humidity",
      done: status.humidityPct != null,
      icon: Sprout,
      doneText: "Humidity telemetry active",
      pendingText: "Waiting for humidity data",
    },
  ];

  return (
    <Card className="p-6">
      <div className="mb-4 text-sm font-medium text-muted-foreground">Live sensor pipeline</div>
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
                {stage.done ? stage.doneText : stage.pendingText}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function FaultHistoryPanel({ deviceId }: { deviceId?: string | null }) {
  const [faults, setFaults] = useState<Array<{ timestamp: number; fault: string }>>([]);

  useEffect(() => {
    let active = true;

    fetchFaultHistory(deviceId).then((rows) => {
      if (!active) return;
      setFaults(rows);
    });

    const interval = setInterval(() => {
      fetchFaultHistory(deviceId).then((rows) => {
        if (!active) return;
        setFaults(rows);
      });
    }, 15000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [deviceId]);

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
      message: "Pump started but cycle could not be verified. Check relay, wiring, and pump line.",
    },
    LOW_WATER: {
      icon: AlertTriangle,
      severity: "warning",
      message: "Safety lock is active. Watering remains paused until cleared.",
    },
    FLOW_STOPPED: {
      icon: AlertTriangle,
      severity: "warning",
      message: "Pump stopped mid-cycle. Check power and relay output.",
    },
    PUMP_TIMEOUT: {
      icon: AlertTriangle,
      severity: "warning",
      message: "Pump runtime exceeded 2 minutes. Stopped for safety.",
    },
    TEMP_HIGH: {
      icon: AlertTriangle,
      severity: "warning",
      message: "Safety threshold reached. Watering paused.",
    },
    SENSOR_FAIL: {
      icon: AlertOctagon,
      severity: "critical",
      message: "A sensor input malfunction was detected. System in safe mode.",
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
