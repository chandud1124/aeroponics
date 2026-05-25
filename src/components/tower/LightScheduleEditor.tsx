import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { defaultSchedule, fetchSchedule, saveScheduleRemote, type Schedule } from "@/lib/tower-storage";

export function LightScheduleEditor() {
  const [s, setS] = useState<Schedule>(defaultSchedule);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSchedule()
      .then(setS)
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof Schedule>(k: K, v: Schedule[K]) => setS((prev) => ({ ...prev, [k]: v }));

  const applyPreset = (preset: Partial<Schedule>) => {
    setS((prev) => ({ ...prev, ...preset }));
  };

  const onSave = async () => {
    if (s.lightStartHour == null || s.lightEndHour == null) {
      toast.error("Set both light start and end hours");
      return;
    }
    if (s.lightStartHour < 0 || s.lightStartHour > 23 || s.lightEndHour < 0 || s.lightEndHour > 23) {
      toast.error("Light hours must be between 0 and 23");
      return;
    }
    if (s.lightStartHour >= s.lightEndHour) {
      toast.error("Light start hour must be earlier than light end hour");
      return;
    }

    setSaving(true);
    try {
      await saveScheduleRemote(s);
      toast.success("Light schedule saved.");
    } catch (e) {
      toast.error("Failed to save: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const lightWindowHours = Math.max(0, (s.lightEndHour ?? s.endHour) - (s.lightStartHour ?? s.startHour));
  const offWindowHours = Math.max(0, 24 - lightWindowHours);
  const lightStartHour = s.lightStartHour ?? s.startHour;
  const lightEndHour = s.lightEndHour ?? s.endHour;

  const presets = [
    {
      label: "Karnataka daylight",
      preset: { planName: "Karnataka daylight", lightStartHour: 5, lightEndHour: 21, lightEnabled: true },
    },
    {
      label: "Hot season",
      preset: { planName: "Hot season", lightStartHour: 6, lightEndHour: 20, lightEnabled: true, heatBoost: true },
    },
    {
      label: "Seedling boost",
      preset: { planName: "Seedling boost", lightStartHour: 6, lightEndHour: 22, lightEnabled: true },
    },
    {
      label: "Manual only",
      preset: { planName: "Manual only", lightEnabled: false },
    },
  ];

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Light schedule</h3>
        <p className="text-sm text-muted-foreground">
          Set a separate grow-light window from the pump timing. The relay follows the configured hours directly.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-secondary-foreground">
        <div className="font-semibold">How the light plan works</div>
        <ul className="mt-2 space-y-1">
          <li>Light ON window = the hours when the grow light turns on automatically.</li>
          <li>Outside the window, the grow light turns off automatically.</li>
          <li>Manual controls can still force the light ON or OFF at any time.</li>
          <li>Use presets below for common daylight windows.</li>
        </ul>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {presets.map(({ label, preset }) => (
          <Button key={label} variant="outline" onClick={() => applyPreset(preset)}>
            {label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="lightStart">Light ON hour</Label>
          <Input
            id="lightStart"
            type="number"
            min={0}
            max={23}
            value={lightStartHour}
            onChange={(e) => update("lightStartHour", Number(e.target.value))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lightEnd">Light OFF hour</Label>
          <Input
            id="lightEnd"
            type="number"
            min={1}
            max={23}
            value={lightEndHour}
            onChange={(e) => update("lightEndHour", Number(e.target.value))}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border p-3 sm:col-span-2">
          <div>
            <div className="font-medium">Light schedule enabled</div>
            <div className="text-xs text-muted-foreground">When OFF, the grow light is only controlled manually.</div>
          </div>
          <Switch checked={Boolean(s.lightEnabled ?? true)} onCheckedChange={(v) => update("lightEnabled", v)} />
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-secondary/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-semibold">Light window preview</h4>
          <Badge variant="outline">Separate from pump plan</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Light plan</div>
            <div className="font-semibold">{s.planName?.trim() || "Untitled plan"}</div>
          </div>
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Light window</div>
            <div className="font-semibold">{String(lightStartHour).padStart(2, "0")}:00 - {String(lightEndHour).padStart(2, "0")}:00</div>
          </div>
          <div className="rounded-md bg-background p-3">
            <div className="text-xs text-muted-foreground">Duration</div>
            <div className="font-semibold">{lightWindowHours}h ON · {offWindowHours}h OFF</div>
          </div>
        </div>
      </div>

      <Button className="mt-5" onClick={onSave} disabled={saving || loading}>
        {saving ? "Saving…" : "Save light schedule"}
      </Button>
    </Card>
  );
}