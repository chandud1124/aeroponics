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
  // ── Derived schedule values ─────────────────────────────────────────
  const isDayMode = (status.cycleMode ?? "DAY") === "DAY";
  const nightModeEnabled = schedule.nightEnabled !== false;
  const nightModeActive = !isDayMode && nightModeEnabled;
  const modeLabel = nightModeActive
    ? "NIGHT MODE"
    : !nightModeEnabled && !isDayMode
      ? "NIGHT MODE OFF"
      : "DAY MODE";
  const expectedDuration = status.cycleOnDurationSeconds ?? (isDayMode || !nightModeEnabled
    ? schedule.dayDurationSeconds ?? schedule.durationSeconds
    : schedule.nightDurationSeconds ?? Math.max(15, Math.round((schedule.durationSeconds * 0.75) || 30)));
  const expectedOff = status.cycleOffIntervalMinutes ?? (isDayMode || !nightModeEnabled
    ? schedule.dayIntervalMinutes ?? schedule.intervalMinutes
    : schedule.nightIntervalMinutes ?? Math.max(schedule.intervalMinutes, 15));
  const lightStartHour = schedule.lightStartHour ?? schedule.startHour;
  const lightEndHour = schedule.lightEndHour ?? schedule.endHour;

  // ── Pump running state ──────────────────────────────────────────────
  const isMisting = Boolean(status.pumpOn);
  const manualOverrideActive = status.motorManualMode != null && status.motorManualMode !== "AUTO";

  // ── Live countdowns ─────────────────────────────────────────────────
  // mistingRemainingSec: seconds the pump still has left this cycle
  const [mistingRemainingSec, setMistingRemainingSec] = useState<number>(0);
  // idleCountdown: MM:SS until next mist
  const [idleCountdown, setIdleCountdown] = useState<string>("--:--");
  const [retryCountdown, setRetryCountdown] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();

      const nextCycleTargetISO = status.plannedNextCycleISO ?? status.nextCycleISO;
      const pumpEndTargetISO = status.pumpEndISO ?? status.lastRunISO;

      // ── MANUAL FORCE OFF ──────────────────────────────────────────
      if (status.motorManualMode === "FORCED_OFF") {
        setMistingRemainingSec(0);
        setIdleCountdown("PAUSED");
      }
      // ── MISTING countdown (remaining ON time / manual elapsed time) ──
      else if (isMisting && pumpEndTargetISO) {
        if (status.motorManualMode === "FORCED_ON") {
          const elapsed = Math.max(0, Math.floor((now - new Date(pumpEndTargetISO).getTime()) / 1000));
          setMistingRemainingSec(elapsed);
          setIdleCountdown("PAUSED");
        } else {
          const onEndMs = new Date(pumpEndTargetISO).getTime();
          const remaining = Math.max(0, Math.ceil((onEndMs - now) / 1000));
          setMistingRemainingSec(remaining);

          if (nextCycleTargetISO) {
            const nextMistMs = new Date(nextCycleTargetISO).getTime();
            if (Number.isFinite(nextMistMs)) {
              const nextSecs = Math.max(0, Math.floor((nextMistMs - now) / 1000));
              const mm = String(Math.floor(nextSecs / 60)).padStart(2, "0");
              const ss = String(nextSecs % 60).padStart(2, "0");
              setIdleCountdown(`${mm}:${ss}`);
            } else {
              setIdleCountdown("--:--");
            }
          } else {
            setIdleCountdown("--:--");
          }
        }
      } else if (!isMisting && nextCycleTargetISO) {
        // ── IDLE countdown (pump is OFF, waiting for next mist) ─────
        setMistingRemainingSec(0);
        const targetMs = new Date(nextCycleTargetISO).getTime();
        if (Number.isFinite(targetMs)) {
          const nextSecs = Math.max(0, Math.floor((targetMs - now) / 1000));
          if (nextSecs <= 0) {
            setIdleCountdown("DUE NOW");
          } else {
            const mm = String(Math.floor(nextSecs / 60)).padStart(2, "0");
            const ss = String(nextSecs % 60).padStart(2, "0");
            setIdleCountdown(`${mm}:${ss}`);
          }
        } else {
          setIdleCountdown("--:--");
        }
      } else {
        // No reliable schedule data — fall back to backend fields only.
        setMistingRemainingSec(0);
        if (!nextCycleTargetISO || status.nextCycleIn < 0) {
          setIdleCountdown("--:--");
        } else {
          const targetMs = new Date(nextCycleTargetISO).getTime();
          if (Number.isNaN(targetMs)) {
            setIdleCountdown("--:--");
          } else {
            const secs = Math.max(0, Math.floor((targetMs - now) / 1000));
            const mm = String(Math.floor(secs / 60)).padStart(2, "0");
            const ss = String(secs % 60).padStart(2, "0");
            setIdleCountdown(`${mm}:${ss}`);
          }
        }
      }

      // ── RETRY countdown ──────────────────────────────────────────
      if (!status.retryNextCycleISO) {
        setRetryCountdown(null);
      } else {
        const targetMs = new Date(status.retryNextCycleISO).getTime();
        if (Number.isNaN(targetMs)) {
          setRetryCountdown(null);
        } else {
          const secs = Math.max(0, Math.ceil((targetMs - now) / 1000));
          setRetryCountdown(
            secs <= 1
              ? "00:01"
              : `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`,
          );
        }
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [
    isMisting,
    status.lastRunISO,
    expectedDuration,
    expectedOff,
    status.nextCycleISO,
    status.plannedNextCycleISO,
    status.pumpEndISO,
    status.nextCycleIn,
    status.retryNextCycleISO,
    status.motorManualMode,
  ]);

  // ── Blueprint timetable ─────────────────────────────────────────────
  const plannedNextCycle = status.plannedNextCycleISO
    ? new Date(status.plannedNextCycleISO)
    : status.nextCycleISO
      ? new Date(status.nextCycleISO)
      : null;

  const timetable: Array<{ label: string; time: string }> = [];
  if (plannedNextCycle && !Number.isNaN(plannedNextCycle.getTime())) {
    for (let i = 0; i < 4; i++) {
      const totalCycleMs = (expectedOff * 60 + expectedDuration) * 1000;
      const slot = new Date(plannedNextCycle.getTime() + i * totalCycleMs);
      if (slot.getHours() >= schedule.endHour) break;
      timetable.push({
        label: i === 0 ? "Next" : `+${i}`,
        time: slot.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }),
      });
    }
  }

  // ── Plan applied metadata ───────────────────────────────────────────
  const appliedAtRaw = (status as any).scheduleAppliedAt as number | string | undefined;
  const appliedAtMs = appliedAtRaw
    ? typeof appliedAtRaw === "number"
      ? appliedAtRaw > 1e12 ? appliedAtRaw : appliedAtRaw * 1000
      : Date.parse(String(appliedAtRaw))
    : null;
  const appliedAtStr = appliedAtMs ? new Date(appliedAtMs).toLocaleString("en-IN") : null;

  // ── Next run time string ────────────────────────────────────────────
  const nextTimeStr = status.nextCycleISO
    ? new Date(status.nextCycleISO).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "—";

  // ── Misting remaining formatted ─────────────────────────────────────
  const mistingMM = String(Math.floor(mistingRemainingSec / 60)).padStart(2, "0");
  const mistingSS = String(mistingRemainingSec % 60).padStart(2, "0");

  return (
    <Card className="overflow-hidden p-0">
      {/* ── MISTING ACTIVE banner ─────────────────────────────────── */}
      {isMisting && (
        <div className="flex items-center gap-3 bg-emerald-500 px-5 py-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
          </span>
          <div className="flex-1">
            <div className="text-sm font-bold uppercase tracking-widest text-white">
              🌿 {status.motorManualMode === "FORCED_ON" ? "MANUAL RUN ACTIVE" : "MISTING NOW"}
            </div>
            <div className="text-xs text-emerald-100">
              {status.motorManualMode === "FORCED_ON"
                ? "Pump is running in manual override mode"
                : "Pump relay is energised — aeroponics cycle active"}
            </div>
          </div>
          {/* Remaining or Elapsed ON time */}
          <div className="text-right">
            <div className="font-mono text-2xl font-black tabular-nums text-white">
              {mistingMM}:{mistingSS}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-100">
              {status.motorManualMode === "FORCED_ON" ? "elapsed" : "left ON"}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4 p-5">
        {/* ── Header row ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {status.motorManualMode === "FORCED_ON" || status.motorManualMode === "FORCED_OFF"
                ? "Next mist (suspended)"
                : isMisting
                ? "Current Cycle"
                : "Next Cycle"}
            </div>

            {/* Big countdown */}
            <div className="flex items-baseline gap-2">
              <div
                className={`font-mono text-5xl font-black tabular-nums tracking-tight ${
                  isMisting && status.motorManualMode !== "FORCED_ON" ? "text-emerald-600 animate-pulse" : "text-foreground"
                }`}
              >
                {status.motorManualMode === "FORCED_ON" || status.motorManualMode === "FORCED_OFF"
                  ? "PAUSED"
                  : isMisting
                  ? "ACTIVE"
                  : idleCountdown}
              </div>
              {!isMisting && status.motorManualMode !== "FORCED_OFF" && idleCountdown !== "DUE NOW" && idleCountdown !== "--:--" && (
                <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  until mist
                </span>
              )}
            </div>

            {/* Next run time */}
            {!isMisting && status.motorManualMode !== "FORCED_OFF" && (
              <div className="mt-1 text-xs text-muted-foreground">
                Starts at <span className="font-semibold text-foreground">{nextTimeStr}</span>
              </div>
            )}

            {retryCountdown && (
              <div className="mt-1 text-xs font-medium text-red-600">
                ⚠ Retrying in {retryCountdown}
              </div>
            )}
          </div>

          {/* Control mode badge */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] ${
                manualOverrideActive
                  ? "bg-amber-100 text-amber-800"
                  : "bg-sky-100 text-sky-700"
              }`}
            >
              {manualOverrideActive ? `⚡ ${status.motorManualMode}` : "🔄 AUTO"}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {modeLabel}
            </span>
          </div>
        </div>

        {/* ── Cycle stats grid ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg bg-secondary px-3 py-2.5">
            <div className="text-muted-foreground">ON duration</div>
            <div className="mt-0.5 font-bold text-foreground">{expectedDuration}s</div>
          </div>
          <div className="rounded-lg bg-secondary px-3 py-2.5">
            <div className="text-muted-foreground">OFF interval</div>
            <div className="mt-0.5 font-bold text-foreground">{expectedOff} min</div>
          </div>
          <div className="rounded-lg bg-secondary px-3 py-2.5">
            <div className="text-muted-foreground">Humidity</div>
            <div className="mt-0.5 font-bold text-foreground">
              {status.humidityPct != null ? `${status.humidityPct.toFixed(1)}%` : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-secondary px-3 py-2.5">
            <div className="text-muted-foreground">Ambient light</div>
            <div className="mt-0.5 font-bold text-foreground">
              {status.lightLux != null ? `${status.lightLux} lx` : "—"}
            </div>
          </div>
        </div>

        {/* ── Light & schedule info ─────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            💡 Light window:{" "}
            <span className="font-medium text-foreground">
              {String(lightStartHour).padStart(2, "0")}:00 – {String(lightEndHour).padStart(2, "0")}:00
            </span>
          </span>
          <span>
            Light relay:{" "}
            <span className={`font-medium ${status.lightOn ? "text-emerald-600" : "text-foreground"}`}>
              {status.lightOn ? "ON ✓" : "OFF"}
            </span>
          </span>
          {appliedAtStr && (
            <span>
              Plan synced:{" "}
              <span className="font-medium text-foreground">{appliedAtStr}</span>
            </span>
          )}
        </div>

        {/* ── Blueprint timetable ───────────────────────────────────── */}
        {timetable.length > 0 && status.motorManualMode !== "FORCED_ON" && status.motorManualMode !== "FORCED_OFF" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <div className="mb-2 font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Upcoming mists
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {timetable.map((slot) => (
                <div
                  key={`${slot.label}-${slot.time}`}
                  className={`rounded-md px-3 py-2 ${
                    slot.label === "Next" && isMisting
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-secondary"
                  }`}
                >
                  <div className="text-muted-foreground">{slot.label}</div>
                  <div className="font-semibold tabular-nums">{slot.time}</div>
                </div>
              ))}
            </div>
          </div>
        )}
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
        const statusObj = statusPayload?.status;
        if (statusObj && statusObj.pumpOn && statusObj.lastRunISO) {
          const startedAt = new Date(statusObj.lastRunISO).toISOString();
          const elapsed = Math.max(0, Math.round((Date.now() - new Date(statusObj.lastRunISO).getTime()) / 1000));
          const runningRow: Row = {
            id: statusObj.pumpLogId ?? "running",
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
  const [batteryLoading, setBatteryLoading] = useState(false);
  const [optimisticLightOn, setOptimisticLightOn] = useState<boolean | null>(null);
  const pumpModeIsManual = status?.motorManualMode !== "AUTO";
  const batteryModeIsManual = status?.batteryManualMode !== "AUTO";
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

  const handleBatteryModeToggle = async () => {
    if (!controlsEnabled) return;

    setBatteryLoading(true);
    try {
      await fetch("/api/manual-battery", {
        method: "POST",
        ...withDeviceHeaders({ headers: { "Content-Type": "application/json" } }, deviceId),
        body: JSON.stringify({
          action: batteryModeIsManual ? "auto" : "manual",
          desiredOn: Boolean(status?.batteryChargeOn),
        }),
      });
    } catch (error) {
      console.error("Failed to switch battery mode:", error);
    } finally {
      setBatteryLoading(false);
    }
  };

  const handleBatteryToggle = async (action: "on" | "off") => {
    if (!controlsEnabled || !batteryModeIsManual) return;

    setBatteryLoading(true);
    try {
      await fetch("/api/manual-battery", {
        method: "POST",
        ...withDeviceHeaders({ headers: { "Content-Type": "application/json" } }, deviceId),
        body: JSON.stringify({ action }),
      });
    } catch (error) {
      console.error(`Failed to turn battery charger ${action}:`, error);
    } finally {
      setBatteryLoading(false);
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

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/30 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Battery charger</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {!controlsEnabled
                  ? "Offline mode: charger actions are disabled until telemetry returns"
                  : batteryModeIsManual
                    ? "Manual mode is active. Turn the charger on or off directly."
                    : "Auto mode is active. Switch to manual to expose charger on/off buttons."}
              </div>
            </div>
            <Button
              onClick={handleBatteryModeToggle}
              disabled={!controlsEnabled || batteryLoading}
              variant={batteryModeIsManual ? "secondary" : "default"}
              className="w-full sm:w-auto"
            >
              {batteryModeIsManual ? "Switch Battery to AUTO" : "Switch Battery to MANUAL"}
            </Button>
          </div>

          {batteryModeIsManual && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => handleBatteryToggle("on")}
                disabled={!controlsEnabled || batteryLoading}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                variant="default"
              >
                <BatteryCharging className="mr-2 h-4 w-4" />
                Turn Charger On
              </Button>
              <Button
                onClick={() => handleBatteryToggle("off")}
                disabled={!controlsEnabled || batteryLoading}
                className="flex-1 bg-slate-600 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                variant="default"
              >
                <Square className="mr-2 h-4 w-4" />
                Turn Charger Off
              </Button>
            </div>
          )}
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
              ? "Manual controls override automatic scheduling. Battery on/off buttons appear only in manual mode."
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
  controlsAllowed?: boolean;
  online?: boolean;
};

function RelayStateCard({
  label,
  icon,
  active,
  manualMode,
  detail,
  toggleLabel,
  onToggleMode,
  toggling = false,
  controlsAllowed = true,
  online = true,
}: RelayStateCardProps) {
  const isManual = manualMode && manualMode !== "AUTO";
  const canToggle = online && controlsAllowed && Boolean(toggleLabel) && Boolean(onToggleMode);

  return (
    <div
      className={`relative flex flex-col gap-3 rounded-xl border p-4 transition-all ${
        active
          ? "border-emerald-400/50 bg-emerald-50/60 dark:bg-emerald-950/20"
          : "border-border bg-card"
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
            }`}
          >
            {icon}
          </div>
          <span className="text-sm font-semibold leading-tight text-foreground">{label}</span>
        </div>
        {/* Live ON/OFF pill */}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tracking-widest ${
            active
              ? "bg-emerald-500 text-white"
              : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              active ? "animate-pulse bg-white" : "bg-slate-400"
            }`}
          />
          {active ? "ON" : "OFF"}
        </span>
      </div>

      {/* Detail text */}
      <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>

      {/* Footer row: mode badge + toggle button */}
      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] ${
            isManual
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              : "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
          }`}
        >
          {isManual ? `MANUAL · ${manualMode}` : "AUTO"}
        </span>
        {toggleLabel && onToggleMode ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleMode}
            disabled={!canToggle || toggling}
            className="h-6 px-2.5 text-[10px] font-semibold uppercase tracking-[0.15em]"
          >
            {toggling ? "…" : toggleLabel}
          </Button>
        ) : null}
      </div>
    </div>
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
    <div className="flex flex-col gap-4">
      {/* Section header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">Relay States</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {online
              ? "Live relay output from the ESP32 controller"
              : "Offline — showing last known relay state"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {online ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <Wifi className="h-3 w-3" />
              Online
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
              <WifiOff className="h-3 w-3" />
              Offline
            </span>
          )}
        </div>
      </div>

      {/* Relay cards grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RelayStateCard
          label="Motor / Pump"
          icon={<ToggleRight className="h-4 w-4" />}
          active={status.pumpOn}
          manualMode={status.motorManualMode}
          detail={
            !online
              ? "Last known relay state"
              : status.pumpOn
              ? "Pump relay is energised — water is flowing"
              : "Pump relay is open — watering idle"
          }
          online={online}
          controlsAllowed={controlsAllowed}
        />
        <RelayStateCard
          label="LED Grow Light"
          icon={<ToggleRight className="h-4 w-4" />}
          active={Boolean(status.lightOn)}
          manualMode={status.lightManualMode}
          detail={
            !online
              ? "Last known relay state"
              : status.lightOn
              ? "LED strip is powered on"
              : "LED strip relay is open"
          }
          toggleLabel={
            status.lightManualMode && status.lightManualMode !== "AUTO" ? "Set AUTO" : "Force ON/OFF"
          }
          onToggleMode={() =>
            toggleRelayMode("light", Boolean(status.lightOn), status.lightManualMode)
          }
          toggling={modeLoading.light}
          online={online}
          controlsAllowed={controlsAllowed}
        />
        <RelayStateCard
          label="Battery Charging"
          icon={<BatteryCharging className="h-4 w-4" />}
          active={Boolean(status.batteryChargeOn)}
          manualMode={status.batteryManualMode}
          detail={
            !online
              ? "Last known relay state"
              : status.batteryChargeOn
              ? "Charge relay active — battery is charging"
              : "Charge relay open — battery idle"
          }
          toggleLabel={
            status.batteryManualMode && status.batteryManualMode !== "AUTO"
              ? "Set AUTO"
              : "Force ON/OFF"
          }
          onToggleMode={() =>
            toggleRelayMode("battery", Boolean(status.batteryChargeOn), status.batteryManualMode)
          }
          toggling={modeLoading.battery}
          online={online}
          controlsAllowed={controlsAllowed}
        />
      </div>

      {/* Info footer */}
      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3">
        <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each card reflects the actual ESP32 relay output. Green&nbsp;=&nbsp;energised, grey&nbsp;=&nbsp;idle.
          Use the toggle buttons to override AUTO mode temporarily.
        </p>
      </div>
    </div>
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
