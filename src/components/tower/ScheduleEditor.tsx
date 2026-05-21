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
      toast.success("Schedule saved locally. ESP32 will pick it up on next poll.");
    } catch (e) {
      toast.error("Failed to save: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cyclesPerDay = Math.max(
    0,
    Math.floor(((s.endHour - s.startHour) * 60) / s.intervalMinutes),
  );
  const litresEstimate = ((cyclesPerDay * s.durationSeconds) / 60) * 2;
  const dayCycles = Math.max(0, Math.floor(((s.endHour - s.startHour) * 60) / (s.dayIntervalMinutes ?? s.intervalMinutes)));
  const nightCycles = Math.max(0, Math.floor((24 - (s.endHour - s.startHour)) * 60 / (s.nightIntervalMinutes ?? s.intervalMinutes)));

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Watering plan</h3>
        <p className="text-sm text-muted-foreground">
          Set day and night watering behavior, then let the ESP32 enforce safety checks locally.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: "Leafy Greens - Normal",
            preset: { dayDurationSeconds: 45, dayIntervalMinutes: 7, nightDurationSeconds: 30, nightIntervalMinutes: 15 },
          },
          {
            label: "Leafy Greens - Hot Weather",
            preset: { dayDurationSeconds: 50, dayIntervalMinutes: 6, nightDurationSeconds: 30, nightIntervalMinutes: 12, heatBoost: true },
          },
          {
            label: "Herbs",
            preset: { dayDurationSeconds: 35, dayIntervalMinutes: 8, nightDurationSeconds: 20, nightIntervalMinutes: 18 },
          },
          {
            label: "Seedling Stage",
            preset: { dayDurationSeconds: 20, dayIntervalMinutes: 5, nightDurationSeconds: 15, nightIntervalMinutes: 10 },
          },
          {
            label: "Custom",
            preset: {},
          },
        ].map((preset) => (
          <Button key={preset.label} variant="outline" onClick={() => applyPreset(preset.preset)}>
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="interval">Day OFF interval (minutes)</Label>
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
        </div>
        <div className="space-y-2">
          <Label htmlFor="duration">Day ON duration (seconds)</Label>
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
        </div>
        <div className="space-y-2">
          <Label htmlFor="start">Active from (hour, 0–23)</Label>
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
          <Label htmlFor="end">Active until (hour, 0–23)</Label>
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
              When OFF, ESP32 stays in manual/maintenance mode.
            </div>
          </div>
          <Switch checked={s.enabled} onCheckedChange={(v) => update("enabled", v)} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-semibold">Day mode</h4>
            <Badge variant="secondary">Heat aware</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dayDuration">ON duration</Label>
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
              <Label htmlFor="dayInterval">OFF interval</Label>
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
            <h4 className="font-semibold">Night mode</h4>
            <Badge variant="secondary">Water saving</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nightDuration">ON duration</Label>
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
              <Label htmlFor="nightInterval">OFF interval</Label>
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
          <h4 className="font-semibold">Live cycle preview</h4>
          <Badge variant="outline">Preview only</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Current cycle</div>
            <div className="font-semibold">ON {s.dayDurationSeconds ?? s.durationSeconds}s / OFF {s.dayIntervalMinutes ?? s.intervalMinutes}m</div>
          </div>
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Expected next mist</div>
            <div className="font-semibold">After controller verification + countdown</div>
          </div>
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Est. daily usage</div>
            <div className="font-semibold">{litresEstimate.toFixed(1)} L/day</div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-md bg-secondary p-4 text-sm text-secondary-foreground">
        <div>
          ≈ <strong>{cyclesPerDay}</strong> pump cycles / day
        </div>
        <div>
          ≈ <strong>{dayCycles}</strong> day cycles, <strong>{nightCycles}</strong> night cycles
        </div>
        <div>
          ≈ <strong>{litresEstimate.toFixed(1)} L</strong> water moved / day (assuming 2 L/min pump)
        </div>
      </div>

      <Button className="mt-5" onClick={onSave} disabled={saving || loading}>
        {saving ? "Saving…" : "Save plan"}
      </Button>
    </Card>
  );
}
