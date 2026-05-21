import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  fetchReadings,
  addReadingRemote,
  deleteReadingRemote,
  type ManualReading,
} from "@/lib/tower-storage";
import { Trash2 } from "lucide-react";

const IDEAL = {
  ph: { min: 5.5, max: 6.5 },
  tds: { min: 560, max: 1400 },
  ec: { min: 1.2, max: 2.4 },
};

function rangeBadge(value: number | null, range: { min: number; max: number }) {
  if (value == null) return null;
  if (value < range.min) return <Badge variant="destructive">LOW</Badge>;
  if (value > range.max) return <Badge variant="destructive">HIGH</Badge>;
  return <Badge>OK</Badge>;
}

export function ManualReadings() {
  const [readings, setReadings] = useState<ManualReading[]>([]);
  const [mounted, setMounted] = useState(false);
  const [ph, setPh] = useState("");
  const [tds, setTds] = useState("");
  const [ec, setEc] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    fetchReadings().then((r) => {
      setReadings(r);
      setMounted(true);
    });
  }, []);

  const addReading = async () => {
    if (!ph && !tds && !ec) {
      toast.error("Enter at least one value (pH, TDS, or EC)");
      return;
    }
    try {
      await addReadingRemote({
        ph: ph ? Number(ph) : null,
        tds: tds ? Number(tds) : null,
        ec: ec ? Number(ec) : null,
        notes: notes.trim(),
      });
      const fresh = await fetchReadings();
      setReadings(fresh);
      setPh("");
      setTds("");
      setEc("");
      setNotes("");
      toast.success("Reading saved locally");
    } catch (e) {
      toast.error("Failed: " + (e as Error).message);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteReadingRemote(id);
      setReadings((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      toast.error("Failed: " + (e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Log a manual reading</h3>
          <p className="text-sm text-muted-foreground">
            Use your handheld pH / TDS / EC meter and record values here. Ideal for leafy greens:{" "}
            <strong>pH 5.5–6.5</strong>, <strong>TDS 560–1400 ppm</strong>,{" "}
            <strong>EC 1.2–2.4 mS/cm</strong>.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="ph">pH</Label>
            <Input
              id="ph"
              inputMode="decimal"
              placeholder="6.0"
              value={ph}
              onChange={(e) => setPh(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tds">TDS (ppm)</Label>
            <Input
              id="tds"
              inputMode="numeric"
              placeholder="800"
              value={tds}
              onChange={(e) => setTds(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ec">EC (mS/cm)</Label>
            <Input
              id="ec"
              inputMode="decimal"
              placeholder="1.6"
              value={ec}
              onChange={(e) => setEc(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea
            id="notes"
            placeholder="e.g. added 50 ml nutrient A + B, topped up with 5 L water"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <Button className="mt-4" onClick={addReading}>
          Log reading
        </Button>
      </Card>

      <Card className="p-6">
        <h3 className="mb-4 text-lg font-semibold">History</h3>
        {!mounted ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : readings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No readings yet.</p>
        ) : (
          <div className="space-y-3">
            {readings.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm">
                  <div className="font-medium">{new Date(r.timestamp).toLocaleString()}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-muted-foreground">
                    {r.ph != null && (
                      <span className="flex items-center gap-1">
                        pH {r.ph} {rangeBadge(r.ph, IDEAL.ph)}
                      </span>
                    )}
                    {r.tds != null && (
                      <span className="flex items-center gap-1">
                        TDS {r.tds} ppm {rangeBadge(r.tds, IDEAL.tds)}
                      </span>
                    )}
                    {r.ec != null && (
                      <span className="flex items-center gap-1">
                        EC {r.ec} {rangeBadge(r.ec, IDEAL.ec)}
                      </span>
                    )}
                  </div>
                  {r.notes && <div className="mt-1 text-xs italic">{r.notes}</div>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(r.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
