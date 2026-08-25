import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Cpu, Plus, Trash2, Edit2, ShieldAlert, Sparkles, HelpCircle } from "lucide-react";
import {
  fetchGpioMappings,
  saveGpioMappings,
  type GpioMapping,
} from "@/lib/tower-storage";

const VALID_GPIO_PINS = [4, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36];

const SENSOR_ACTUATOR_TYPES = [
  "pH Sensor",
  "EC Sensor",
  "Water Level Sensor",
  "Humidity Sensor",
  "Water Temperature Sensor",
  "Relay - Water Pump",
  "Relay - Nutrition A",
  "Relay - Nutrition B",
  "Relay - pH Down",
  "Other Sensor",
  "Other Actuator",
];

export function GpioConfigTab() {
  const [mappings, setMappings] = useState<GpioMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Modal / Form state
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [connName, setConnName] = useState("");
  const [connType, setConnType] = useState<GpioMapping["type"]>("Other Sensor");
  const [connDirection, setConnDirection] = useState<"INPUT" | "OUTPUT">("INPUT");
  const [connPin, setConnPin] = useState<number>(32);

  const loadData = () => {
    setLoading(true);
    fetchGpioMappings()
      .then(setMappings)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenAdd = () => {
    setEditId(null);
    setConnName("");
    setConnType("Other Sensor");
    setConnDirection("INPUT");
    setConnPin(32);
    setShowForm(true);
  };

  const handleOpenEdit = (m: GpioMapping) => {
    setEditId(m.id);
    setConnName(m.name);
    setConnType(m.type);
    setConnDirection(m.direction);
    setConnPin(m.pin);
    setShowForm(true);
  };

  const handleSaveConnection = async () => {
    if (!connName.trim()) {
      toast.error("Connection name is required");
      return;
    }

    // Check duplicate pin mappings (excluding the current one being edited)
    const duplicatePin = mappings.find((m) => m.pin === connPin && m.id !== editId);
    if (duplicatePin) {
      toast.error(`Pin GPIO ${connPin} is already assigned to "${duplicatePin.name}"`);
      return;
    }

    // Check duplicate type mapping (e.g. only one pH sensor or water pump relay)
    if (connType !== "Other Sensor" && connType !== "Other Actuator") {
      const duplicateType = mappings.find((m) => m.type === connType && m.id !== editId);
      if (duplicateType) {
        toast.error(`"${connType}" is already assigned to connection "${duplicateType.name}"`);
        return;
      }
    }

    let updatedList: GpioMapping[];
    if (editId) {
      updatedList = mappings.map((m) =>
        m.id === editId
          ? { ...m, name: connName, type: connType, direction: connDirection, pin: connPin }
          : m
      );
    } else {
      const newMapping: GpioMapping = {
        id: `map-${Date.now()}`,
        name: connName,
        type: connType,
        direction: connDirection,
        pin: connPin,
      };
      updatedList = [...mappings, newMapping];
    }

    setSaving(true);
    try {
      await saveGpioMappings(updatedList);
      toast.success(editId ? "Connection updated!" : "New connection mapped!");
      loadData();
      setShowForm(false);
    } catch (e: any) {
      toast.error("Failed to save GPIO mapping");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this GPIO mapping? This will stop ESP32 controls for this pin.")) return;
    const updatedList = mappings.filter((m) => m.id !== id);
    try {
      await saveGpioMappings(updatedList);
      toast.success("GPIO mapping deleted");
      loadData();
    } catch (e) {
      toast.error("Failed to delete mapping");
    }
  };

  // Automatically adjust default direction based on selected type
  const handleTypeChange = (val: string) => {
    setConnType(val as GpioMapping["type"]);
    if (val.startsWith("Relay") || val === "Other Actuator") {
      setConnDirection("OUTPUT");
    } else {
      setConnDirection("INPUT");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            Dynamic GPIO Pin Configuration
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Map hardware sensors & actuators to ESP32 GPIO pins. Remote firmware updates pin direction and tasks automatically.
          </p>
        </div>
        <Button onClick={handleOpenAdd} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold flex items-center gap-2 text-xs py-2">
          <Plus className="h-4 w-4" />
          Add Connection Mapped
        </Button>
      </div>

      {/* Info Warning */}
      <Card className="p-4 border-amber-500/20 bg-amber-500/5 flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-amber-600 dark:text-amber-400 block text-xs">Pin Mode Reconfiguration Notice</span>
          <span className="text-[11px] text-amber-700 dark:text-amber-300 block mt-0.5">
            Changing these values will instantly update the pin initialization configurations in the ESP32. Ensure physical wires match the new GPIO pin configuration to prevent short circuits.
          </span>
        </div>
      </Card>

      {/* Main Connections Table Card */}
      <Card className="border-border/80 overflow-hidden">
        {loading ? (
          <div className="text-center py-10 text-xs text-muted-foreground">Loading GPIO mappings...</div>
        ) : mappings.length === 0 ? (
          <div className="text-center py-10 text-xs text-muted-foreground italic">No GPIO mappings defined.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-muted/50 border-b border-border/80 text-muted-foreground font-semibold">
                  <th className="p-4">Sensor / Actuator Name</th>
                  <th className="p-4">Remapped Type</th>
                  <th className="p-4">Mode / Direction</th>
                  <th className="p-4">GPIO Pin</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {mappings.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/10 transition-colors">
                    <td className="p-4 font-bold text-foreground">{m.name}</td>
                    <td className="p-4">
                      <span className="text-slate-600 dark:text-slate-300">{m.type}</span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        m.direction === "OUTPUT" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" : "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300"
                      }`}>
                        {m.direction}
                      </span>
                    </td>
                    <td className="p-4 font-mono font-bold text-foreground">GPIO {m.pin}</td>
                    <td className="p-4 text-right space-x-1.5">
                      <Button
                        onClick={() => handleOpenEdit(m)}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        onClick={() => handleDelete(m.id)}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Floating Form Overlay Panel */}
      {showForm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4">
            <div>
              <span className="font-bold text-base text-foreground block">
                {editId ? "Edit GPIO Connection" : "Add Mapped Connection"}
              </span>
              <span className="text-xs text-muted-foreground block mt-0.5">
                Set pin mapping, description details, and direction.
              </span>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="conn-name" className="text-xs font-semibold">Sensor / Actuator Name</Label>
                <Input
                  id="conn-name"
                  placeholder="e.g. pH Water Probe"
                  value={connName}
                  onChange={(e) => setConnName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Device Type</Label>
                <Select value={connType} onValueChange={handleTypeChange}>
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {SENSOR_ACTUATOR_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">ESP32 Pin Mode</Label>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setConnDirection("INPUT")}
                    type="button"
                    variant={connDirection === "INPUT" ? "default" : "outline"}
                    className="flex-1 text-xs py-1.5 h-8 font-bold"
                  >
                    INPUT (Read Sensor)
                  </Button>
                  <Button
                    onClick={() => setConnDirection("OUTPUT")}
                    type="button"
                    variant={connDirection === "OUTPUT" ? "default" : "outline"}
                    className="flex-1 text-xs py-1.5 h-8 font-bold"
                  >
                    OUTPUT (Write/Relay)
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold flex items-center gap-1">
                  GPIO Pin Selection
                  {connDirection === "INPUT" && (connType.includes("pH") || connType.includes("EC")) && (
                    <span className="inline-flex text-[9px] text-amber-500 font-bold bg-amber-500/10 px-1 rounded">ADC1 Preferred</span>
                  )}
                </Label>
                <Select value={String(connPin)} onValueChange={(val) => setConnPin(Number(val))}>
                  <SelectTrigger className="w-full text-xs font-mono font-bold">
                    <SelectValue placeholder="Select GPIO Pin..." />
                  </SelectTrigger>
                  <SelectContent className="font-mono">
                    {VALID_GPIO_PINS.map((pin) => (
                      <SelectItem key={pin} value={String(pin)} className="text-xs">
                        GPIO {pin} {(pin === 34 || pin === 35 || pin === 36 || pin === 32 || pin === 33) ? " (ADC-Ready)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <Button onClick={() => setShowForm(false)} variant="outline" className="text-xs font-semibold px-4 h-9">
                Cancel
              </Button>
              <Button
                onClick={handleSaveConnection}
                disabled={saving}
                className="bg-primary text-primary-foreground font-bold text-xs px-4 h-9"
              >
                {saving ? "Saving..." : "Apply Config"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
