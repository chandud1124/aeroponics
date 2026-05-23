import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  defaultSchedule,
  fetchSchedule,
  saveScheduleRemote,
  type Schedule,
} from "@/lib/tower-storage";

export function ScheduleEditor() {
  const [s, setS] = useState<Schedule>(defaultSchedule);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSchedule()
      .then(setS)
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof Schedule>(k: K, v: Schedule[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const applyPreset = (preset: Partial<Schedule>) => {
    setS((prev) => ({ ...prev, ...preset }));
  };

  const onSave = async () => {
    if (s.durationSeconds < 5 || s.durationSeconds > 600) {
      toast.error("Duration must be between 5 and 600 seconds");
      return;
    }
    if (s.intervalMinutes < 5 || s.intervalMinutes > 240) {
      toast.error("Interval must be between 5 and 240 minutes");
      return;
    }
    if (s.startHour >= s.endHour) {
      toast.error("Start hour must be earlier than end hour");
      return;
    }
    setSaving(true);
    try {
      await saveScheduleRemote(s);
      toast.success("Plan saved. The ESP32 keeps the last saved plan even if the backend is offline.");
    } catch (e) {
      toast.error("Failed to save: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const activeWindowHours = Math.max(0, s.endHour - s.startHour);
  const inactiveWindowHours = Math.max(0, 24 - activeWindowHours);
  const dayRestMinutes = Math.min(s.dayIntervalMinutes ?? s.intervalMinutes, 7);
  const nightRestMinutes = s.nightIntervalMinutes ?? Math.max(s.intervalMinutes, 15);
  const dayRunSeconds = s.dayDurationSeconds ?? s.durationSeconds;
  const nightRunSeconds = s.nightDurationSeconds ?? Math.max(15, Math.round(s.durationSeconds * 0.75));
  const dayCycles = activeWindowHours > 0 ? Math.max(0, Math.floor((activeWindowHours * 60) / dayRestMinutes)) : 0;
  const nightCycles = inactiveWindowHours > 0 ? Math.max(0, Math.floor((inactiveWindowHours * 60) / nightRestMinutes)) : 0;
  const totalCycles = dayCycles + nightCycles;
  const litresEstimate = (((dayCycles * dayRunSeconds) + (nightCycles * nightRunSeconds)) / 60) * 2;
  const dayCycleMinutes = Math.round((dayRunSeconds + dayRestMinutes * 60) / 60);
  const nightCycleMinutes = Math.round((nightRunSeconds + nightRestMinutes * 60) / 60);

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Watering plan</h3>
        <p className="text-sm text-muted-foreground">
          Set pump timing in plain language. Daytime rest is capped at 7 minutes for safety, even if a longer value is entered.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-secondary-foreground">
        <div className="font-semibold">How the plan works</div>
        <ul className="mt-2 space-y-1">
          <li>Pump ON duration = how long the motor runs each cycle.</li>
          <li>Pump OFF interval = how long the controller waits before the next cycle.</li>
          <li>Active from / until = the daylight window for the plan.</li>
          <li>Use the Light tab for the grow-light window and presets.</li>
          <li>Custom plan name = the label you want to remember for this setup.</li>
        </ul>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="planName">Plan name</Label>
          <Input
            id="planName"
            type="text"
            value={s.planName ?? ""}
            placeholder="Example: Tomato morning plan"
            onChange={(e) => update("planName", e.target.value)}
          />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Easy start",
            preset: { planName: "Easy start", dayDurationSeconds: 45, dayIntervalMinutes: 7, nightDurationSeconds: 30, nightIntervalMinutes: 15 },
          },
          {
            label: "Hot weather",
            preset: { planName: "Hot weather", dayDurationSeconds: 50, dayIntervalMinutes: 6, nightDurationSeconds: 30, nightIntervalMinutes: 12, heatBoost: true },
          },
          {
            label: "Short cycles",
            preset: { planName: "Short cycles", dayDurationSeconds: 35, dayIntervalMinutes: 8, nightDurationSeconds: 20, nightIntervalMinutes: 18 },
          },
          {
            label: "Seedlings",
            preset: { planName: "Seedlings", dayDurationSeconds: 20, dayIntervalMinutes: 5, nightDurationSeconds: 15, nightIntervalMinutes: 10 },
          },
        ].map((preset) => (
          <Button key={preset.label} variant="outline" onClick={() => applyPreset(preset.preset)}>
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="interval">Pump rest time during the day (OFF interval, minutes)</Label>
          <Input
            id="interval"
            type="number"
            min={5}
            max={240}
            value={s.dayIntervalMinutes ?? s.intervalMinutes}
            onChange={(e) => {
              const value = Number(e.target.value);
              update("dayIntervalMinutes", value);
              update("intervalMinutes", value);
            }}
          />
          <div className="text-xs text-muted-foreground">Example: set 7 if you want the pump to stay off for 7 minutes.</div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="duration">Pump run time during the day (ON duration, seconds)</Label>
          <Input
            id="duration"
            type="number"
            min={5}
            max={600}
            value={s.dayDurationSeconds ?? s.durationSeconds}
            onChange={(e) => {
              const value = Number(e.target.value);
              update("dayDurationSeconds", value);
              update("durationSeconds", value);
            }}
          />
          <div className="text-xs text-muted-foreground">Example: set 180 to run the pump for 3 minutes each cycle.</div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="start">Daylight start hour (0–23)</Label>
          <Input
            id="start"
            type="number"
            min={0}
            max={23}
            value={s.startHour}
            onChange={(e) => update("startHour", Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end">Daylight end hour (0–23)</Label>
          <Input
            id="end"
            type="number"
            min={1}
            max={23}
            value={s.endHour}
            onChange={(e) => update("endHour", Number(e.target.value))}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border p-3 sm:col-span-2">
          <div>
            <div className="font-medium">Schedule enabled</div>
            <div className="text-xs text-muted-foreground">
              When OFF, the controller stops automatic timing and keeps only manual controls active.
            </div>
          </div>
          <Switch checked={s.enabled} onCheckedChange={(v) => update("enabled", v)} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-semibold">Day pump timing</h4>
            <Badge variant="secondary">Heat aware</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dayDuration">Pump run time</Label>
              <Input
                id="dayDuration"
                type="number"
                min={5}
                max={600}
                value={s.dayDurationSeconds ?? s.durationSeconds}
                onChange={(e) => update("dayDurationSeconds", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dayInterval">Pump rest time (OFF interval)</Label>
              <Input
                id="dayInterval"
                type="number"
                min={5}
                max={240}
                value={s.dayIntervalMinutes ?? s.intervalMinutes}
                onChange={(e) => update("dayIntervalMinutes", Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-semibold">Night pump timing</h4>
            <Badge variant="secondary">Water saving</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nightDuration">Pump run time</Label>
              <Input
                id="nightDuration"
                type="number"
                min={5}
                max={600}
                value={s.nightDurationSeconds ?? Math.max(15, Math.round(s.durationSeconds * 0.75))}
                onChange={(e) => update("nightDurationSeconds", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nightInterval">Pump rest time (OFF interval)</Label>
              <Input
                id="nightInterval"
                type="number"
                min={5}
                max={240}
                value={s.nightIntervalMinutes ?? Math.max(s.intervalMinutes, 15)}
                onChange={(e) => update("nightIntervalMinutes", Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-semibold">Environment rules</h4>
          <Badge variant="outline">Auto-safe</Badge>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["temperatureProtection", "Temperature protection"],
            ["rainPause", "Pause watering during rain"],
            ["heatBoost", "Increase cycles in heat"],
            ["lowWaterAutoLock", "Low water auto-lock"],
          ].map(([key, label]) => (
            <div key={key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">Controller applies this locally</div>
              </div>
              <Switch
                checked={Boolean(s[key as keyof Schedule])}
                onCheckedChange={(checked) => update(key as keyof Schedule, checked as Schedule[keyof Schedule])}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-secondary/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-semibold">What these settings do</h4>
          <Badge variant="outline">Preview only</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Current plan</div>
            <div className="font-semibold">{s.planName?.trim() || "Untitled plan"}</div>
          </div>
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Day pump cycle</div>
            <div className="font-semibold">Every {dayCycleMinutes} min: ON {Math.round(dayRunSeconds / 60)} min, OFF {dayRestMinutes} min</div>
          </div>
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Night pump cycle</div>
            <div className="font-semibold">Every {nightCycleMinutes} min: ON {Math.round(nightRunSeconds / 60)} min, OFF {nightRestMinutes} min</div>
          </div>
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Light schedule</div>
            <div className="font-semibold">Manage light hours in the Light tab</div>
          </div>
          <div className="rounded-md bg-background p-3 sm:col-span-2 xl:col-span-2">
            <div className="text-xs text-muted-foreground">Estimated daily activity</div>
            <div className="font-semibold">{totalCycles} cycles, {litresEstimate.toFixed(1)} L/day</div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-md bg-secondary p-4 text-sm text-secondary-foreground">
        <div>
          ≈ <strong>{dayCycles}</strong> day cycles and <strong>{nightCycles}</strong> night cycles per day
        </div>
        <div>
          ≈ <strong>{litresEstimate.toFixed(1)} L</strong> water moved / day (assuming 2 L/min pump)
        </div>
        <div>
          For a 10-minute plan, use about 3 minutes ON and 7 minutes OFF.
        </div>
        <div>
          If backend is offline, the ESP32 keeps using the last saved plan from its own memory.
        </div>
      </div>

      <Button className="mt-5" onClick={onSave} disabled={saving || loading}>
        {saving ? "Saving…" : "Save plan"}
      </Button>
    </Card>
  );
}
