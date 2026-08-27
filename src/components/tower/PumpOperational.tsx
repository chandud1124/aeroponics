import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Clock,
  Play,
  Square,
  Droplets,
  AlertTriangle,
  AlertOctagon,
  Zap,
  Cpu,
  History,
  Sprout,
  Wifi,
  WifiOff,
  Sun,
  Moon,
  ToggleLeft,
  ToggleRight,
  ShieldCheck,
  CheckCircle,
  PlayCircle,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  PumpState,
  PUMP_STATE_LABELS,
  PUMP_STATE_COLORS,
  fetchFaultHistory,
  fetchPumpLogs,
  type LiveStatus,
  type Schedule,
} from "@/lib/tower-storage";

// ==================== PUMP STATE DISPLAY ====================
export function PumpStateDisplay({ status, online = true }: { status: LiveStatus; online?: boolean }) {
  const state = status.pumpState || PumpState.IDLE;
  const label = PUMP_STATE_LABELS[state];
  const colorClass = PUMP_STATE_COLORS[state];

  // Visual status indicators
  const getIcon = () => {
    switch (state) {
      case PumpState.RUNNING:
      case PumpState.VERIFYING_FLOW:
      case PumpState.STARTING:
        return <Droplets className="h-6 w-6 text-emerald-500 animate-bounce" />;
      case PumpState.FAULT_NO_FLOW:
      case PumpState.LOW_WATER_LOCK:
        return <AlertTriangle className="h-6 w-6 text-red-500 animate-pulse" />;
      default:
        return <Clock className="h-6 w-6 text-indigo-500" />;
    }
  };

  return (
    <Card className="p-6 border-border/80 bg-card/70 flex flex-col justify-between hover:border-primary/30 transition-colors">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">Operational State</span>
          <Badge variant={online ? "default" : "destructive"}>
            {online ? "Active Stream" : "Last Known"}
          </Badge>
        </div>

        <div className="flex items-center gap-4">
          <div className="p-3 bg-muted rounded-xl border border-border">
            {getIcon()}
          </div>
          <div>
            <span className="text-2xl font-black tracking-tight block text-foreground">
              {state.replace("_", " ")}
            </span>
            <span className="text-xs text-muted-foreground block">{label}</span>
          </div>
        </div>

        {/* Dynamic sub-panels */}
        {status.pumpOn && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 p-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
              Irrigation pump active — watering crops in progress
            </span>
          </div>
        )}

        {(state === PumpState.FAULT_NO_FLOW || state === PumpState.LOW_WATER_LOCK) && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/25 p-3 flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-red-500 animate-pulse" />
            <span className="text-xs font-bold text-red-600 dark:text-red-400">
              Misting lockout active. Safety triggers engaged.
            </span>
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
  const isDayMode = (status.cycleMode ?? "DAY") === "DAY";
  const expectedDuration = status.cycleOnDurationSeconds ?? (isDayMode ? schedule.dayDurationSeconds ?? schedule.durationSeconds : schedule.nightDurationSeconds ?? 30);
  const expectedOff = status.cycleOffIntervalMinutes ?? (isDayMode ? schedule.dayIntervalMinutes ?? schedule.intervalMinutes : schedule.nightIntervalMinutes ?? 15);

  const expectedDuration_2 = isDayMode 
    ? (schedule.dayDurationSeconds_2 ?? schedule.durationSeconds_2 ?? schedule.durationSeconds)
    : (schedule.nightDurationSeconds_2 ?? schedule.durationSeconds_2 ?? schedule.durationSeconds);
  const expectedOff_2 = isDayMode 
    ? (schedule.dayIntervalMinutes_2 ?? schedule.intervalMinutes_2 ?? schedule.intervalMinutes)
    : (schedule.nightIntervalMinutes_2 ?? schedule.intervalMinutes_2 ?? schedule.intervalMinutes);

  const formatInterval = (minutesVal: number) => {
    const totalSeconds = Math.round(minutesVal * 60);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  const formatDuration = (secondsVal: number) => {
    if (secondsVal < 60) return `${secondsVal}s`;
    const mins = Math.floor(secondsVal / 60);
    const secs = secondsVal % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  const [pump1State, setPump1State] = useState({ mistingRemainingSec: 0, idleCountdown: "--:--" });
  const [pump2State, setPump2State] = useState({ mistingRemainingSec: 0, idleCountdown: "--:--" });

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      
      // Calculate Pump 1
      const nextCycleTargetISO1 = status.plannedNextCycleISO ?? status.nextCycleISO;
      const pumpEndTargetISO1 = status.pumpEndISO ?? status.lastRunISO;
      
      let p1Misting = 0;
      let p1Idle = "--:--";
      
      if (status.motorManualMode === "FORCED_OFF") {
        p1Misting = 0;
        p1Idle = "PAUSED";
      } else if (status.motorManualMode === "FORCED_ON") {
        p1Misting = expectedDuration;
        p1Idle = "FORCED";
      } else if (status.pumpOn && pumpEndTargetISO1) {
        const endTime = new Date(pumpEndTargetISO1).getTime();
        p1Misting = Math.max(0, Math.ceil((endTime - now) / 1000));
        p1Idle = "MISTING";
      } else if (nextCycleTargetISO1) {
        const nextTime = new Date(nextCycleTargetISO1).getTime();
        const diffMs = nextTime - now;
        if (diffMs <= 0) {
          p1Idle = "00:00";
        } else {
          const totalSec = Math.ceil(diffMs / 1000);
          const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
          const ss = String(totalSec % 60).padStart(2, "0");
          p1Idle = `${mm}:${ss}`;
        }
      }
      setPump1State({ mistingRemainingSec: p1Misting, idleCountdown: p1Idle });

      // Calculate Pump 2
      const nextCycleTargetISO2 = status.plannedNextCycleISO_2;
      const pumpEndTargetISO2 = status.pumpEndISO_2 ?? status.lastRunISO_2;

      let p2Misting = 0;
      let p2Idle = "--:--";

      if (status.motorManualMode_2 === "FORCED_OFF") {
        p2Misting = 0;
        p2Idle = "PAUSED";
      } else if (status.motorManualMode_2 === "FORCED_ON") {
        p2Misting = expectedDuration_2;
        p2Idle = "FORCED";
      } else if (status.pumpOn_2 && pumpEndTargetISO2) {
        const endTime = new Date(pumpEndTargetISO2).getTime();
        p2Misting = Math.max(0, Math.ceil((endTime - now) / 1000));
        p2Idle = "MISTING";
      } else if (nextCycleTargetISO2) {
        const nextTime = new Date(nextCycleTargetISO2).getTime();
        const diffMs = nextTime - now;
        if (diffMs <= 0) {
          p2Idle = "00:00";
        } else {
          const totalSec = Math.ceil(diffMs / 1000);
          const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
          const ss = String(totalSec % 60).padStart(2, "0");
          p2Idle = `${mm}:${ss}`;
        }
      }
      setPump2State({ mistingRemainingSec: p2Misting, idleCountdown: p2Idle });
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [status, expectedDuration, expectedDuration_2, isDayMode]);

  return (
    <Card className="p-6 border-border/80 bg-card/70 flex flex-col justify-between hover:border-primary/30 transition-colors">
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border/50">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">Irrigation Scheduler</span>
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            {isDayMode ? <Sun className="h-4 w-4 text-amber-500" /> : <Moon className="h-4 w-4 text-indigo-500" />}
            {isDayMode ? "DAY CYCLE" : "NIGHT CYCLE"}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Pump 1 Countdown */}
          <div className="flex items-center justify-center p-4 bg-muted/20 border border-border/50 rounded-xl relative overflow-hidden">
            <div className="text-center space-y-1">
              <span className="text-[10px] text-muted-foreground font-bold tracking-wider uppercase block">
                Mist Pump 1: {status.pumpOn ? "Misting" : "Idle"}
              </span>
              <span className="text-2xl font-black font-mono tracking-tight text-foreground block">
                {status.pumpOn ? `${pump1State.mistingRemainingSec}s` : pump1State.idleCountdown}
              </span>
              <span className="text-[9px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded block w-fit mx-auto mt-1">
                Interval: {formatInterval(expectedOff)} | Duration: {formatDuration(expectedDuration)}
              </span>
            </div>
          </div>

          {/* Pump 2 Countdown */}
          <div className="flex items-center justify-center p-4 bg-muted/20 border border-border/50 rounded-xl relative overflow-hidden">
            <div className="text-center space-y-1">
              <span className="text-[10px] text-muted-foreground font-bold tracking-wider uppercase block">
                Mist Pump 2: {status.pumpOn_2 ? "Misting" : "Idle"}
              </span>
              <span className="text-2xl font-black font-mono tracking-tight text-foreground block">
                {status.pumpOn_2 ? `${pump2State.mistingRemainingSec}s` : pump2State.idleCountdown}
              </span>
              <span className="text-[9px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded block w-fit mx-auto mt-1">
                Interval: {formatInterval(expectedOff_2)} | Duration: {formatDuration(expectedDuration_2)}
              </span>
            </div>
          </div>
        </div>
      </div>
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
  deviceId: string | null;
  online?: boolean;
  controlsAllowed?: boolean;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [manualModes, setManualModes] = useState({ motor: "AUTO", motor_2: "AUTO", ph: "AUTO", nutrition: "AUTO" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setManualModes({
      motor: status?.motorManualMode ?? "AUTO",
      motor_2: status?.motorManualMode_2 ?? "AUTO",
      ph: status?.phManualMode ?? "AUTO",
      nutrition: status?.nutritionManualMode ?? "AUTO",
    });
  }, [status?.motorManualMode, status?.motorManualMode_2, status?.phManualMode, status?.nutritionManualMode]);

  const toggleMode = async (pumpKey: "motor" | "motor_2" | "ph" | "nutrition", currentMode: string) => {
    if (!controlsAllowed || !deviceId) return;
    const nextMode = currentMode === "AUTO" ? "FORCED_OFF" : "AUTO";
    setLoading(pumpKey);
    try {
      const endpoint = pumpKey === "motor" 
        ? "/api/manual-pump" 
        : pumpKey === "motor_2"
          ? "/api/manual-pump-2"
          : pumpKey === "ph"
            ? "/api/manual-ph-down"
            : "/api/manual-nutrition";

      const headers = { "Content-Type": "application/json", "x-device-id": deviceId };
      const body = pumpKey === "motor" || pumpKey === "motor_2"
        ? { action: nextMode === "AUTO" ? "auto" : "manual" }
        : { action: nextMode === "AUTO" ? "auto" : "manual", desiredOn: false };

      await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      setManualModes((current) => ({ ...current, [pumpKey]: nextMode }));
      toast.success(`Control mode updated successfully!`);
    } catch {
      toast.error("Failed to switch pump mode");
    } finally {
      setLoading(null);
    }
  };

  const handlePulseRelay = async (type: "pump" | "pump_2" | "ph" | "nutrition", action: "on" | "off") => {
    if (!controlsAllowed || !deviceId) return;
    let endpoint = "/api/manual-pump";
    if (type === "pump_2") endpoint = "/api/manual-pump-2";
    if (type === "ph") endpoint = "/api/manual-ph-down";
    if (type === "nutrition") endpoint = "/api/manual-nutrition";

    const requestAction = (type === "pump" || type === "pump_2")
      ? (action === "on" ? "start" : "stop")
      : action;

    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-device-id": deviceId },
        body: JSON.stringify({ action: requestAction }),
      });
      toast.success(`Triggered manual override: ${type} ${action}`);
    } catch {
      toast.error("Override request failed");
    }
  };

  const formatDuration = (updatedAtMs: number | null | undefined) => {
    if (!updatedAtMs) return "N/A";
    const diffSec = Math.max(0, Math.floor((Date.now() - updatedAtMs) / 1000));
    if (diffSec < 60) return `${diffSec}s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ${diffSec % 60}s`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h ${diffMin % 60}m`;
  };

  const motorMode = manualModes.motor;
  const motor2Mode = manualModes.motor_2;
  const phMode = manualModes.ph;
  const nutriMode = manualModes.nutrition;

  return (
    <Card className="min-w-0 border-border/80 bg-card p-4 sm:p-6">
      <div className="border-b border-border/60 pb-3 mb-6">
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary animate-pulse" />
          Hardware Relays Switchboard
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">Override automatic settings to test, flush, or prime dosing pumps.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 md:gap-6">
        {/* Irrigation Pump 1 */}
        <div className="bg-muted/30 border rounded-xl p-4 space-y-4 flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-foreground block">Mist Pump 1 (GPIO 27)</span>
            <span className="text-[10px] text-muted-foreground block">Irrigation loops for main lines.</span>
          </div>

          <div className="space-y-3">
            <div className="border-t border-border/40 pt-2 text-[10px] space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className={`font-bold ${status?.pumpOn ? "text-emerald-500" : "text-slate-400"}`}>
                  {status?.pumpOn ? "ON" : "OFF"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">State Duration:</span>
                <span className="font-mono font-bold">{formatDuration(status?.pumpOnUpdatedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode Time:</span>
                <span className="font-mono font-bold text-slate-500">{formatDuration(status?.motorManualModeUpdatedAt)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
              <span className="text-[11px] font-semibold">Mode Override:</span>
              <Button
                variant={motorMode === "AUTO" ? "outline" : "default"}
                onClick={() => toggleMode("motor", motorMode)}
                disabled={loading === "motor" || !controlsAllowed}
                className="h-7 text-[10px] px-2 font-bold"
              >
                {motorMode === "AUTO" ? "Switch Manual" : "Switch Auto"}
              </Button>
            </div>

            {motorMode !== "AUTO" && (
              <div className="flex gap-2 border-t pt-2.5">
                <Button
                  onClick={() => handlePulseRelay("pump", "on")}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-[10px] h-7 font-bold"
                >
                  ON
                </Button>
                <Button
                  onClick={() => handlePulseRelay("pump", "off")}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white text-[10px] h-7 font-bold"
                >
                  OFF
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Irrigation Pump 2 */}
        <div className="bg-muted/30 border rounded-xl p-4 space-y-4 flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-foreground block">Mist Pump 2 (GPIO 14)</span>
            <span className="text-[10px] text-muted-foreground block">Irrigation loops for secondary lines.</span>
          </div>

          <div className="space-y-3">
            <div className="border-t border-border/40 pt-2 text-[10px] space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className={`font-bold ${status?.pumpOn_2 ? "text-emerald-500" : "text-slate-400"}`}>
                  {status?.pumpOn_2 ? "ON" : "OFF"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">State Duration:</span>
                <span className="font-mono font-bold">{formatDuration(status?.pumpOnUpdatedAt_2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode Time:</span>
                <span className="font-mono font-bold text-slate-500">{formatDuration(status?.motorManualModeUpdatedAt_2)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
              <span className="text-[11px] font-semibold">Mode Override:</span>
              <Button
                variant={motor2Mode === "AUTO" ? "outline" : "default"}
                onClick={() => toggleMode("motor_2", motor2Mode)}
                disabled={loading === "motor_2" || !controlsAllowed}
                className="h-7 text-[10px] px-2 font-bold"
              >
                {motor2Mode === "AUTO" ? "Switch Manual" : "Switch Auto"}
              </Button>
            </div>

            {motor2Mode !== "AUTO" && (
              <div className="flex gap-2 border-t pt-2.5">
                <Button
                  onClick={() => handlePulseRelay("pump_2", "on")}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-[10px] h-7 font-bold"
                >
                  ON
                </Button>
                <Button
                  onClick={() => handlePulseRelay("pump_2", "off")}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white text-[10px] h-7 font-bold"
                >
                  OFF
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Nutrients Pumps */}
        <div className="bg-muted/30 border rounded-xl p-4 space-y-4 flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-foreground block">Nutrition Mixers (A/B/C)</span>
            <span className="text-[10px] text-muted-foreground block">Relays pushing nutrient concentrates.</span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
              <span className="text-[11px] font-semibold">Mode Override:</span>
              <Button
                variant={nutriMode === "AUTO" ? "outline" : "default"}
                onClick={() => toggleMode("nutrition", nutriMode)}
                disabled={loading === "nutrition" || !controlsAllowed}
                className="h-7 text-[10px] px-2 font-bold"
              >
                {nutriMode === "AUTO" ? "Switch Manual" : "Switch Auto"}
              </Button>
            </div>

            {nutriMode !== "AUTO" && (
              <div className="flex gap-2 border-t pt-2.5">
                <Button
                  onClick={() => handlePulseRelay("nutrition", "on")}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-[10px] h-7 font-bold"
                >
                  ON
                </Button>
                <Button
                  onClick={() => handlePulseRelay("nutrition", "off")}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white text-[10px] h-7 font-bold"
                >
                  OFF
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* pH Down Pump */}
        <div className="bg-muted/30 border rounded-xl p-4 space-y-4 flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-foreground block">pH Down Dosing Pump</span>
            <span className="text-[10px] text-muted-foreground block">Pumps acid buffers to reservoir.</span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
              <span className="text-[11px] font-semibold">Mode Override:</span>
              <Button
                variant={phMode === "AUTO" ? "outline" : "default"}
                onClick={() => toggleMode("ph", phMode)}
                disabled={loading === "ph" || !controlsAllowed}
                className="h-7 text-[10px] px-2 font-bold"
              >
                {phMode === "AUTO" ? "Switch Manual" : "Switch Auto"}
              </Button>
            </div>

            {phMode !== "AUTO" && (
              <div className="flex gap-2 border-t pt-2.5">
                <Button
                  onClick={() => handlePulseRelay("ph", "on")}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white text-[10px] h-7 font-bold"
                >
                  ON
                </Button>
                <Button
                  onClick={() => handlePulseRelay("ph", "off")}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white text-[10px] h-7 font-bold"
                >
                  OFF
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ==================== RELAY STATES CARD ====================
export function RelayStatesCard({
  status,
  online = true,
  deviceId,
  controlsAllowed = true,
}: {
  status: LiveStatus | null;
  online?: boolean;
  deviceId: string | null;
  controlsAllowed?: boolean;
}) {
  const isPumpActive = status?.pumpOn ?? false;
  const isPhDosingActive = status?.phDosingOn ?? false;
  const isNutriADosingActive = status?.nutritionADosingOn ?? false;
  const isNutriBDosingActive = status?.nutritionBDosingOn ?? false;

  return (
    <Card className="min-w-0 border-border/80 bg-card p-4 sm:p-6">
      <div className="border-b border-border/60 pb-3 mb-6">
        <h3 className="text-base font-bold text-foreground">Relay Board Terminal</h3>
        <p className="text-xs text-muted-foreground mt-0.5">LED diagnostics representing real-time pin levels on the ESP32.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
        <div className={`p-3 rounded-lg border flex flex-col justify-between h-20 ${
          isPumpActive ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-muted/40 border-border"
        }`}>
          <span className="font-bold">MIST PUMP</span>
          <div className="flex items-center gap-1.5 font-bold">
            <span className={`h-2.5 w-2.5 rounded-full ${isPumpActive ? "bg-emerald-500 animate-ping" : "bg-slate-400"}`} />
            {isPumpActive ? "ACTIVE" : "STANDBY"}
          </div>
        </div>

        <div className={`p-3 rounded-lg border flex flex-col justify-between h-20 ${
          isPhDosingActive ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-muted/40 border-border"
        }`}>
          <span className="font-bold">pH DOWN PUMP</span>
          <div className="flex items-center gap-1.5 font-bold">
            <span className={`h-2.5 w-2.5 rounded-full ${isPhDosingActive ? "bg-emerald-500 animate-ping" : "bg-slate-400"}`} />
            {isPhDosingActive ? "ACTIVE" : "STANDBY"}
          </div>
        </div>

        <div className={`p-3 rounded-lg border flex flex-col justify-between h-20 ${
          isNutriADosingActive ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-muted/40 border-border"
        }`}>
          <span className="font-bold">NUTRIENT A</span>
          <div className="flex items-center gap-1.5 font-bold">
            <span className={`h-2.5 w-2.5 rounded-full ${isNutriADosingActive ? "bg-emerald-500 animate-ping" : "bg-slate-400"}`} />
            {isNutriADosingActive ? "ACTIVE" : "STANDBY"}
          </div>
        </div>

        <div className={`p-3 rounded-lg border flex flex-col justify-between h-20 ${
          isNutriBDosingActive ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" : "bg-muted/40 border-border"
        }`}>
          <span className="font-bold">NUTRIENT B</span>
          <div className="flex items-center gap-1.5 font-bold">
            <span className={`h-2.5 w-2.5 rounded-full ${isNutriBDosingActive ? "bg-emerald-500 animate-ping" : "bg-slate-400"}`} />
            {isNutriBDosingActive ? "ACTIVE" : "STANDBY"}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ==================== LIVE CYCLE HISTORY PANEL ====================
export function LiveCycleHistoryPanel({ deviceId }: { deviceId: string | null }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchPumpLogs(1, 5, deviceId)
      .then((entries) => setLogs(entries))
      .finally(() => setLoading(false));
  }, [deviceId]);

  return (
    <Card className="p-6 border-border/80 bg-card">
      <div className="border-b border-border/60 pb-3 mb-6">
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          Recent Irrigation Activity (24h)
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">Chronological list of watering mist duration events logged by the ESP32.</p>
      </div>

      <div className="space-y-3 font-mono text-xs">
        {loading ? <div className="py-4 text-center text-muted-foreground">Loading real pump activity...</div> : null}
        {!loading && logs.length === 0 ? <div className="py-4 text-center text-muted-foreground">No pump cycles recorded in the last 24 hours.</div> : null}
        {logs.map((log) => (
          <div key={log.id} className="flex items-center justify-between gap-3 rounded bg-muted/40 p-2">
            <div className="flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-emerald-500" />
              <div>
                <span className="font-bold text-foreground">Mist Duration: {log.durationSeconds}s</span>
                <span className="text-[10px] text-muted-foreground block">Mode: {log.mode}</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-foreground block">{new Date(log.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className={`rounded px-1 text-[9px] font-bold ${log.flowed && !log.fault ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>
                {log.flowed && !log.fault ? "VERIFIED" : "CHECK"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ==================== FAULT HISTORY PANEL ====================
export function FaultHistoryPanel({ deviceId }: { deviceId: string | null }) {
  const [faults, setFaults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchFaultHistory(deviceId)
      .then((entries) => setFaults(entries.slice(0, 5)))
      .finally(() => setLoading(false));
  }, [deviceId]);

  return (
    <Card className="p-6 border-border/80 bg-card">
      <div className="border-b border-border/60 pb-3 mb-6">
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          System Safety Checkpoints
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">Logs of automated checkpoints, resets, or safety interlock locks.</p>
      </div>

      <div className="space-y-3 font-mono text-xs">
        {loading ? <div className="py-4 text-center text-muted-foreground">Loading safety history...</div> : null}
        {!loading && faults.length === 0 ? <div className="py-4 text-center text-muted-foreground">No safety events recorded.</div> : null}
        {faults.map((f) => (
          <div key={`${f.timestamp}-${f.fault}`} className="flex items-center justify-between gap-3 rounded bg-muted/40 p-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-primary" />
              <div>
                <span className="font-bold text-foreground">{f.fault}</span>
                <span className="text-[10px] text-muted-foreground block">Recorded by the controller</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-foreground block">{new Date(f.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-[9px] text-primary font-bold bg-primary/10 px-1 rounded">{f.type}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ==================== FAULT ALERT BANNER ====================
export function FaultAlertBanner({ status }: { status: LiveStatus }) {
  const hasFault1 = status.fault && status.fault !== "NONE" && status.fault !== "OK";
  const hasFault2 = status.fault_2 && status.fault_2 !== "NONE" && status.fault_2 !== "OK";

  if (!hasFault1 && !hasFault2) return null;

  return (
    <Alert variant="destructive" className="border-red-500/30 bg-red-500/10 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <AlertOctagon className="h-4 w-4 text-red-500 shrink-0 animate-pulse" />
        <span className="text-xs font-bold text-red-700 dark:text-red-300 uppercase tracking-wider">Critical Hardware Locking Engaged</span>
      </div>
      <div className="space-y-1 font-mono text-[11px] pl-6 text-red-600 dark:text-red-400">
        {hasFault1 && (
          <div>
            <strong>Pump 1 Fault:</strong> {status.fault} — Irrigation loop halted. Check lines/relays.
          </div>
        )}
        {hasFault2 && (
          <div>
            <strong>Pump 2 Fault:</strong> {status.fault_2} — Secondary irrigation loop halted.
          </div>
        )}
      </div>
    </Alert>
  );
}
