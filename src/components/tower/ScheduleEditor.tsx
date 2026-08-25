import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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

  const onSave = async () => {
    if (s.durationSeconds < 5 || s.durationSeconds > 600) {
      toast.error("Duration must be between 5 and 600 seconds");
      return;
    }
    const intervalSeconds = Math.round(s.intervalMinutes * 60);
    if (intervalSeconds < 5 || intervalSeconds > 14400) {
      toast.error("OFF interval must be between 5 and 14400 seconds");
      return;
    }
    const dayIntervalSeconds = Math.round((s.dayIntervalMinutes ?? s.intervalMinutes) * 60);
    if (dayIntervalSeconds < 5 || dayIntervalSeconds > 14400) {
      toast.error("Day OFF interval must be between 5 and 14400 seconds");
      return;
    }
    const nightIntervalSeconds = Math.round((s.nightIntervalMinutes ?? Math.max(s.intervalMinutes, 15)) * 60);
    if (nightIntervalSeconds < 5 || nightIntervalSeconds > 14400) {
      toast.error("Night OFF interval must be between 5 and 14400 seconds");
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

  const dayRestMinutes = s.dayIntervalMinutes ?? s.intervalMinutes;
  const nightRestMinutes = s.nightIntervalMinutes ?? Math.max(s.intervalMinutes, 15);
  const dayRestSeconds = Math.max(0, Math.round(dayRestMinutes * 60));
  const nightRestSeconds = Math.max(0, Math.round(nightRestMinutes * 60));
  const dayRunSeconds = s.dayDurationSeconds ?? s.durationSeconds;
  const nightRunSeconds = s.nightDurationSeconds ?? Math.max(15, Math.round(s.durationSeconds * 0.75));
  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds} seconds`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds ? `${minutes} min ${remainingSeconds} sec` : `${minutes} minutes`;
  };

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Watering plan</h3>
        <p className="text-sm text-muted-foreground">
          Set pump timing in plain language for day and night windows.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-secondary-foreground">
        <div className="font-semibold">Set it in three steps</div>
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
          <span><strong>1.</strong> Choose a preset or name your plan.</span>
          <span><strong>2.</strong> Set how long the pump runs and rests.</span>
          <span><strong>3.</strong> Save the plan to send it to the controller.</span>
        </div>
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

      <div className="mb-5 grid grid-cols-1 gap-5 rounded-lg border border-border p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="start">Day pump starts at hour</Label>
          <Input id="start" type="number" min={0} max={23} value={s.startHour} onChange={(e) => update("startHour", Number(e.target.value))} />
          <div className="text-xs text-muted-foreground">Example: 06 means the day plan starts at 6:00 AM.</div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="end">Day pump ends at hour</Label>
          <Input id="end" type="number" min={1} max={23} value={s.endHour} onChange={(e) => update("endHour", Number(e.target.value))} />
          <div className="text-xs text-muted-foreground">Example: 18 means the day plan ends at 6:00 PM.</div>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border p-3 sm:col-span-2">
          <div>
            <div className="font-medium">Automatic watering enabled</div>
            <div className="text-xs text-muted-foreground">
              Turn this off to pause scheduled watering. Manual controls still work.
            </div>
          </div>
          <Switch checked={s.enabled} onCheckedChange={(v) => update("enabled", v)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h4 className="font-semibold">Day settings</h4>
              <p className="text-xs text-muted-foreground">Used from {s.startHour}:00 to {s.endHour}:00</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="dayDuration">Run pump for (seconds)</Label>
              <Input
                id="dayDuration"
                type="number"
                min={5}
                max={600}
                value={s.dayDurationSeconds ?? s.durationSeconds}
                onChange={(e) => update("dayDurationSeconds", Number(e.target.value))}
              />
              <div className="text-xs text-muted-foreground">Runs for {formatDuration(dayRunSeconds)} each cycle.</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dayInterval">Then wait (seconds)</Label>
              <Input
                id="dayInterval"
                type="number"
                min={5}
                max={14400}
                value={Math.round((s.dayIntervalMinutes ?? s.intervalMinutes) * 60)}
                onChange={(e) => update("dayIntervalMinutes", Number(e.target.value) / 60)}
              />
              <div className="text-xs text-muted-foreground">Rests for {formatDuration(dayRestSeconds)} before starting again.</div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h4 className="font-semibold">Night settings</h4>
              <p className="text-xs text-muted-foreground">Used outside the day window</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nightDuration">Run pump for (seconds)</Label>
              <Input
                id="nightDuration"
                type="number"
                min={5}
                max={600}
                value={s.nightDurationSeconds ?? Math.max(15, Math.round(s.durationSeconds * 0.75))}
                onChange={(e) => update("nightDurationSeconds", Number(e.target.value))}
              />
              <div className="text-xs text-muted-foreground">Runs for {formatDuration(nightRunSeconds)} each cycle.</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nightInterval">Then wait (seconds)</Label>
              <Input
                id="nightInterval"
                type="number"
                min={5}
                max={14400}
                value={Math.round((s.nightIntervalMinutes ?? Math.max(s.intervalMinutes, 15)) * 60)}
                onChange={(e) => update("nightIntervalMinutes", Number(e.target.value) / 60)}
              />
              <div className="text-xs text-muted-foreground">Rests for {formatDuration(nightRestSeconds)} before starting again.</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-3 sm:col-span-2 lg:col-span-2">
          <div>
            <div className="font-medium">Run watering at night</div>
            <div className="text-xs text-muted-foreground">
              When OFF, watering pauses after the day window until the next morning.
            </div>
          </div>
          <Switch checked={Boolean(s.nightEnabled ?? true)} onCheckedChange={(v) => update("nightEnabled", v)} />
        </div>
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-foreground lg:col-span-2">
        <div className="font-semibold">Repeats automatically</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Day: ON {formatDuration(dayRunSeconds)}, then OFF {formatDuration(dayRestSeconds)}. Night: ON {formatDuration(nightRunSeconds)}, then OFF {formatDuration(nightRestSeconds)}.
        </p>
      </div>

      <Button className="mt-5 w-full sm:w-auto" onClick={onSave} disabled={saving || loading}>
        {saving ? "Saving…" : "Save plan"}
      </Button>
    </Card>
  );
}
