import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FlaskConical, Gauge, Activity, Settings, Zap, ShieldAlert, Sparkles, AlertCircle } from "lucide-react";
import {
  fetchSchedule,
  saveScheduleRemote,
  type Schedule,
  type LiveStatus,
  type GpioMapping,
} from "@/lib/tower-storage";

interface NutritionTabProps {
  status: LiveStatus | null;
  schedule: Schedule;
  onScheduleChange: (s: Schedule) => void;
  deviceId?: string | null;
  controlsAllowed?: boolean;
}

interface DeviceListEntry {
  id: string;
  name: string;
  deviceId: string;
  macAddress: string | null;
  pins: GpioMapping[];
}

export function NutritionTab({ status, schedule, onScheduleChange, deviceId, controlsAllowed = true }: NutritionTabProps) {
  const [s, setS] = useState<Schedule>(schedule);
  const [saving, setSaving] = useState(false);
  const [dosingActive, setDosingActive] = useState<Record<string, boolean>>({});

  // Devices mapping
  const [devices, setDevices] = useState<DeviceListEntry[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [loadingDevices, setLoadingDevices] = useState(true);

  // Calibration defaults (stored in local state/localStorage or fallbacks)
  const [pumpCalibrations, setPumpCalibrations] = useState<Record<string, number>>({
    phDown: 100, // mL/min
    nutriA: 100,
    nutriB: 100,
    nutriC: 100,
  });

  const [doseMlTargets, setDoseMlTargets] = useState<Record<string, number>>({
    phDown: 5, // mL
    nutriA: 10,
    nutriB: 10,
    nutriC: 10,
  });

  const loadDevices = async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/admin/devices`, {
        headers: { "x-admin-passkey": "admin123" }
      });
      const data = await res.json();
      if (data && data.devices) {
        setDevices(data.devices);
        if (data.devices.length > 0) {
          setSelectedDeviceId(data.devices[0].deviceId);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    loadDevices();
    fetchSchedule().then((fetched) => {
      setS(fetched);
    });
  }, []);

  const updateKey = <K extends keyof Schedule>(k: K, v: Schedule[K]) => {
    setS((prev) => ({ ...prev, [k]: v }));
  };

  // Compute active connection mappings for selected device
  const activeDevice = devices.find((d) => d.deviceId === selectedDeviceId);
  const activePins = activeDevice?.pins || [];

  const hasPhDownPump = activePins.some((p) => p.type === "Relay - pH Down");
  const hasNutriAPump = activePins.some((p) => p.type === "Relay - Nutrition A");
  const hasNutriBPump = activePins.some((p) => p.type === "Relay - Nutrition B");
  const hasNutriCPump = activePins.some((p) => p.type === "Relay - Nutrition C");
  const hasRegisteredAny = devices.length > 0;

  const handlePulseDose = async (pumpType: "phDown" | "nutriA" | "nutriB" | "nutriC") => {
    if (!status || !controlsAllowed) return;
    
    // Calculate dosing seconds based on mL target & flow rate calibration
    const ml = doseMlTargets[pumpType] || 5;
    const flowRate = pumpCalibrations[pumpType] || 100;
    const durationSeconds = Math.round((ml / flowRate) * 60);

    if (durationSeconds <= 0) {
      toast.error("Calibration results in 0 seconds dosing time.");
      return;
    }

    setDosingActive((prev) => ({ ...prev, [pumpType]: true }));
    
    let apiEndpoint = "/api/manual-nutrition";
    if (pumpType === "phDown") {
      apiEndpoint = "/api/manual-ph-down";
    }

    try {
      await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "on", deviceId: selectedDeviceId }),
      });
      
      toast.info(`Pulse dosing ${ml} mL (${durationSeconds}s) via pump...`);

      setTimeout(async () => {
        await fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "off", deviceId: selectedDeviceId }),
        });
        setDosingActive((prev) => ({ ...prev, [pumpType]: false }));
        toast.success(`Dosing pulse complete.`);
      }, durationSeconds * 1000);
    } catch {
      toast.error("Manual pulse failed");
      setDosingActive((prev) => ({ ...prev, [pumpType]: false }));
    }
  };

  const onSave = async () => {
    setSaving(true);
    
    // Convert target mL to seconds using flow rates to send to microcontroller
    const phSec = Math.round(((doseMlTargets.phDown || 5) / (pumpCalibrations.phDown || 100)) * 60);
    const ecSec = Math.round(((doseMlTargets.nutriA || 10) / (pumpCalibrations.nutriA || 100)) * 60);

    const updatedSchedule: Schedule = {
      ...s,
      phDoseSeconds: phSec > 0 ? phSec : 5,
      ecDoseSeconds: ecSec > 0 ? ecSec : 10,
    };

    try {
      await saveScheduleRemote(updatedSchedule);
      onScheduleChange(updatedSchedule);
      toast.success("Dosing configurations & automation rules saved!");
    } catch (e: any) {
      toast.error(e.message || "Failed to save configurations");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Device Lock Warning */}
      {!hasRegisteredAny ? (
        <Card className="p-6 border-red-500/20 bg-red-500/5 flex flex-col items-center text-center space-y-4">
          <AlertCircle className="h-10 w-10 text-red-500 animate-bounce" />
          <div className="space-y-1">
            <span className="font-bold text-base text-foreground block">Dosing Controls Locked</span>
            <span className="text-xs text-muted-foreground block max-w-md">
              Dosing operations are disabled. You must register an ESP32 microcontroller in the Device Registry before you can configure nutrient mixing flow rates or manual calibrations.
            </span>
          </div>
        </Card>
      ) : (
        <>
          {/* Active device selector */}
          <Card className="p-4 border-border/80 bg-muted/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">Dosing Hardware Scope</span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">Select registered controller to verify active inputs/outputs.</span>
            </div>
            <div className="w-full sm:w-64">
              <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select device..." />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId} className="text-xs">{d.name} ({d.macAddress})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          {/* Active status grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* pH card */}
            <Card className="p-5 border-border/80 bg-card/75 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider block">pH Automation</span>
                <div className="mt-4 flex items-baseline gap-4">
                  <span className="text-4xl font-extrabold tracking-tight">
                    {status?.ph != null ? status.ph.toFixed(2) : "——"}
                  </span>
                  <div className="text-xs text-muted-foreground">
                    Target pH: <span className="font-bold text-foreground">{s.targetPh?.toFixed(1) ?? "6.0"}</span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {status?.ph && status.ph > (s.targetPh ?? 6.0) + 0.3
                    ? "pH is high. Auto-dosing acid correction."
                    : "pH is in balanced range."}
                </div>
              </div>

              {hasPhDownPump ? (
                <div className="mt-6 pt-4 border-t border-border/60 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold">Calibration (mL/min)</Label>
                      <Input
                        type="number"
                        value={pumpCalibrations.phDown}
                        onChange={(e) => setPumpCalibrations({ ...pumpCalibrations, phDown: Number(e.target.value) })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold">Target Size (mL)</Label>
                      <Input
                        type="number"
                        value={doseMlTargets.phDown}
                        onChange={(e) => setDoseMlTargets({ ...doseMlTargets, phDown: Number(e.target.value) })}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={() => handlePulseDose("phDown")}
                    disabled={dosingActive.phDown}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs h-9 shadow-sm"
                  >
                    {dosingActive.phDown ? "Dosing pH Down..." : `Manual Pulse ${doseMlTargets.phDown} mL`}
                  </Button>
                </div>
              ) : (
                <div className="mt-6 text-xs text-muted-foreground bg-muted/30 p-3 rounded text-center italic border border-dashed">
                  No pH Down relay mapped to this device pins.
                </div>
              )}
            </Card>

            {/* EC Nutrition Card */}
            <Card className="p-5 border-border/80 bg-card/75 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold text-amber-500 uppercase tracking-wider block">EC Conductivity</span>
                <div className="mt-4 flex items-baseline gap-4">
                  <span className="text-4xl font-extrabold tracking-tight">
                    {status?.ec != null ? status.ec.toFixed(2) : "——"}
                  </span>
                  <div className="text-xs text-muted-foreground">
                    Target EC: <span className="font-bold text-foreground">{s.targetEc?.toFixed(1) ?? "1.2"}</span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {status?.ec && status.ec < (s.targetEc ?? 1.2) - 0.2
                    ? "EC is low. Auto-dosing nutrient mixes."
                    : "EC concentration is sufficient."}
                </div>
              </div>

              {/* Dynamic nutrient pumps */}
              {(hasNutriAPump || hasNutriBPump || hasNutriCPump) ? (
                <div className="mt-6 pt-4 border-t border-border/60 space-y-4">
                  <div className="space-y-3">
                    {hasNutriAPump && (
                      <div className="flex items-center justify-between p-2 rounded bg-muted/40 border">
                        <span className="text-[11px] font-bold">Nutrient A Pump</span>
                        <div className="flex gap-2 items-center">
                          <Input
                            type="number"
                            value={doseMlTargets.nutriA}
                            onChange={(e) => setDoseMlTargets({ ...doseMlTargets, nutriA: Number(e.target.value) })}
                            className="h-8 w-16 text-xs"
                            title="Target mL"
                          />
                          <Button
                            onClick={() => handlePulseDose("nutriA")}
                            disabled={dosingActive.nutriA}
                            className="bg-amber-600 hover:bg-amber-700 text-white text-[10px] h-8 px-2"
                          >
                            Pulse
                          </Button>
                        </div>
                      </div>
                    )}
                    {hasNutriBPump && (
                      <div className="flex items-center justify-between p-2 rounded bg-muted/40 border">
                        <span className="text-[11px] font-bold">Nutrient B Pump</span>
                        <div className="flex gap-2 items-center">
                          <Input
                            type="number"
                            value={doseMlTargets.nutriB}
                            onChange={(e) => setDoseMlTargets({ ...doseMlTargets, nutriB: Number(e.target.value) })}
                            className="h-8 w-16 text-xs"
                            title="Target mL"
                          />
                          <Button
                            onClick={() => handlePulseDose("nutriB")}
                            disabled={dosingActive.nutriB}
                            className="bg-amber-600 hover:bg-amber-700 text-white text-[10px] h-8 px-2"
                          >
                            Pulse
                          </Button>
                        </div>
                      </div>
                    )}
                    {hasNutriCPump && (
                      <div className="flex items-center justify-between p-2 rounded bg-muted/40 border">
                        <span className="text-[11px] font-bold">Nutrient C Pump</span>
                        <div className="flex gap-2 items-center">
                          <Input
                            type="number"
                            value={doseMlTargets.nutriC}
                            onChange={(e) => setDoseMlTargets({ ...doseMlTargets, nutriC: Number(e.target.value) })}
                            className="h-8 w-16 text-xs"
                            title="Target mL"
                          />
                          <Button
                            onClick={() => handlePulseDose("nutriC")}
                            disabled={dosingActive.nutriC}
                            className="bg-amber-600 hover:bg-amber-700 text-white text-[10px] h-8 px-2"
                          >
                            Pulse
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="space-y-1">
                      <Label className="text-[10px] font-bold">Nutrient Flow Rate (mL/min)</Label>
                      <Input
                        type="number"
                        value={pumpCalibrations.nutriA}
                        onChange={(e) => setPumpCalibrations({
                          ...pumpCalibrations,
                          nutriA: Number(e.target.value),
                          nutriB: Number(e.target.value),
                          nutriC: Number(e.target.value),
                        })}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 text-xs text-muted-foreground bg-muted/30 p-3 rounded text-center italic border border-dashed">
                  No Nutrient pumps mapped to this device.
                </div>
              )}
            </Card>
          </div>

          {/* Dosing Locked state */}
          {status?.waterLevel === "LOW" && (
            <Card className="p-4 border-red-500/30 bg-red-500/10 flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-red-600 dark:text-red-400 block text-xs">Dosing Locked: Low Water Level</span>
                <span className="text-[11px] text-red-700 dark:text-red-300 block mt-1">
                  Reservoir water level is LOW. Dosing is locked to prevent pump dry runs.
                </span>
              </div>
            </Card>
          )}

          {/* Closed-loop settings */}
          <Card className="p-6 border-border/80 bg-card">
            <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-6">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold text-foreground">Closed-Loop Dosing Settings</h3>
              </div>
              <Badge variant={s.nutritionEnabled ? "default" : "secondary"}>
                {s.nutritionEnabled ? "Auto Enabled" : "Auto Off"}
              </Badge>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/20 p-4">
                <div>
                  <div className="text-sm font-semibold">Enable Dosing Automation</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Triggers dosing output relays to match sensor targets automatically.
                  </div>
                </div>
                <Switch
                  checked={Boolean(s.nutritionEnabled)}
                  onCheckedChange={(checked) => updateKey("nutritionEnabled", checked)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="ph-t" className="text-xs font-semibold">Target pH Level</Label>
                  <Input
                    id="ph-t"
                    type="number"
                    step="0.1"
                    value={s.targetPh}
                    onChange={(e) => updateKey("targetPh", Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ec-t" className="text-xs font-semibold">Target EC (mS/cm)</Label>
                  <Input
                    id="ec-t"
                    type="number"
                    step="0.1"
                    value={s.targetEc}
                    onChange={(e) => updateKey("targetEc", Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={onSave} disabled={saving} className="bg-primary text-primary-foreground font-bold text-xs px-6 h-9">
                  {saving ? "Saving Configuration..." : "Apply Dosing Configuration"}
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
