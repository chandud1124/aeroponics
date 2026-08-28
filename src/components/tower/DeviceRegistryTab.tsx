import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Cpu, Plus, Trash2, ShieldCheck, Key, Settings, HelpCircle, HardDrive, ToggleLeft } from "lucide-react";
import {
  fetchDevices,
  createAdminDevice,
  deleteAdminDevice,
  rotateAdminDeviceSecret,
  updateAdminDeviceName,
  type DeviceListEntry,
  type GpioMapping,
} from "@/lib/tower-storage";

// Default fallback passkey
const DEFAULT_ADMIN_PASSKEY = "0990"; 

const VALID_GPIO_PINS = [1, 2, 4, 5, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36];

const SENSOR_ACTUATOR_TYPES = [
  "pH Sensor",
  "EC Sensor",
  "Water Level Sensor",
  "Water Level - Float Switch",
  "Water Level - Ultrasonic",
  "Water Level - Analog Sensor",
  "Humidity Sensor",
  "Water Temperature Sensor",
  "Water Temperature Sensor 2 (NFT)",
  "Relay - Water Pump",
  "Relay - Water Pump 2",
  "Relay - Nutrition A",
  "Relay - Nutrition B",
  "Relay - Nutrition C",
  "Relay - pH Down",
  "Motor Override Button",
  "Motor Override Button 2",
  "Other Sensor",
  "Other Actuator",
];

interface DeviceExtended extends DeviceListEntry {
  pins?: GpioMapping[];
}

export function DeviceRegistryTab() {
  const [adminPasskey, setAdminPasskey] = useState(DEFAULT_ADMIN_PASSKEY);
  const [devices, setDevices] = useState<DeviceExtended[]>([]);
  const [loading, setLoading] = useState(true);

  // Device form
  const [showAddModal, setShowAddModal] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [macAddress, setMacAddress] = useState("");

  // Secret display
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [generatedSecret, setGeneratedSecret] = useState("");
  const [generatedId, setGeneratedId] = useState("");

  // Pins configuration form
  const [selectedDevice, setSelectedDevice] = useState<DeviceExtended | null>(null);
  const [devicePins, setDevicePins] = useState<GpioMapping[]>([]);
  
  // Connection line form
  const [newConnName, setNewConnName] = useState("");
  const [newConnType, setNewConnType] = useState<GpioMapping["type"]>("Other Sensor");
  const [newConnDirection, setNewConnDirection] = useState<"INPUT" | "OUTPUT">("INPUT");
  const [newConnPin, setNewConnPin] = useState<number>(18);
  const [newConnTxPin, setNewConnTxPin] = useState<number>(5);

  // Calibration parameters state
  const [emptyDistanceCm, setEmptyDistanceCm] = useState<number>(50);
  const [fullDistanceCm, setFullDistanceCm] = useState<number>(10);
  const [tankCapacityLiters, setTankCapacityLiters] = useState<number>(200);
  const [tankWidthCm, setTankWidthCm] = useState<number>(50);
  const [tankLengthCm, setTankLengthCm] = useState<number>(50);
  const [tankHeightCm, setTankHeightCm] = useState<number>(80);

  const loadData = () => {
    setLoading(true);
    fetchDevices()
      .then((data) => {
        setDevices(data);
      })
      .catch(() => {
        setDevices([]);
        toast.error("Failed to load devices - sign in with an administrator account");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRegisterDevice = async () => {
    if (!deviceName.trim()) {
      toast.error("Device name is required");
      return;
    }
    if (!macAddress.trim() || !macAddress.includes(":")) {
      toast.error("Valid MAC address is required (e.g. AA:BB:CC:DD:EE:FF)");
      return;
    }
    try {
      const formattedMac = macAddress.trim().toUpperCase();
      const res = await createAdminDevice(adminPasskey, deviceName, formattedMac);
      if ('error' in res) {
        toast.error(res.error);
        return;
      }
      setGeneratedId(res.deviceId);
      setGeneratedSecret(res.secret || "");
      setShowAddModal(false);
      setShowSecretModal(true);
      loadData();
      
      setDeviceName("");
      setMacAddress("");
    } catch (e: any) {
      toast.error(e.message || "Failed to create device");
    }
  };

  const handleRenameDevice = async (deviceId: string, currentName: string | null) => {
    const newName = prompt("Enter new name for ESP32 device:", currentName ?? "");
    if (newName === null) return; // User cancelled
    if (!newName.trim()) {
      toast.error("Device name cannot be empty");
      return;
    }
    try {
      await updateAdminDeviceName(adminPasskey, deviceId, newName.trim());
      toast.success("Device renamed successfully");
      loadData();
    } catch (e: any) {
      toast.error("Failed to rename: " + e.message);
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    if (!confirm("Are you sure you want to remove this microcontroller device registry?")) return;
    try {
      await deleteAdminDevice(adminPasskey, deviceId);
      toast.success("Device removed from farm registry");
      loadData();
    } catch (e) {
      toast.error("Failed to delete device");
    }
  };

  const handleRotateSecret = async (deviceId: string) => {
    if (!confirm("Are you sure you want to invalidate and regenerate the device secret token?")) return;
    try {
      const res = await rotateAdminDeviceSecret(adminPasskey, deviceId);
      setGeneratedId(res.deviceId);
      setGeneratedSecret(res.secret);
      setShowSecretModal(true);
      loadData();
    } catch (e) {
      toast.error("Failed to rotate secret");
    }
  };

  // Pins remapper helpers
  const handleOpenRemapPins = (dev: DeviceExtended) => {
    setSelectedDevice(dev);
    setDevicePins(dev.pins || []);
    
    // reset connection line form
    const waterMapping = (dev.pins || []).find((pin) =>
      pin.type === "Water Level - Ultrasonic" || pin.type === "Water Level - Analog Sensor"
    );
    setNewConnName(waterMapping?.name ?? "");
    setNewConnType(waterMapping?.type ?? "Other Sensor");
    setNewConnDirection(waterMapping?.direction ?? "INPUT");
    setNewConnPin(waterMapping?.pin ?? 18);
    setNewConnTxPin(waterMapping?.txPin ?? 5);
    setEmptyDistanceCm(waterMapping?.emptyDistanceCm ?? 50);
    setFullDistanceCm(waterMapping?.fullDistanceCm ?? 10);
    setTankWidthCm(waterMapping?.tankWidthCm ?? 50);
    setTankLengthCm(waterMapping?.tankLengthCm ?? 50);
    setTankHeightCm(waterMapping?.tankHeightCm ?? 80);
    setTankCapacityLiters(waterMapping?.tankCapacityLiters ?? 200);
    setNewConnTxPin(waterMapping?.txPin ?? 5);
  };

  const handleAddConnectionLine = () => {
    if (!newConnName.trim()) {
      toast.error("Sensor/Relay name label is required");
      return;
    }
    const existingWaterMapping = devicePins.find((p) =>
      p.type === "Water Level - Ultrasonic" || p.type === "Water Level - Analog Sensor"
    );
    if (existingWaterMapping && (newConnType === "Water Level - Ultrasonic" || newConnType === "Water Level - Analog Sensor")) {
      if (newConnType === "Water Level - Ultrasonic" && newConnPin === newConnTxPin) {
        toast.error("Ultrasonic TRIG and ECHO must use different GPIO pins");
        return;
      }
      setDevicePins(devicePins.map((mapping) => mapping.id === existingWaterMapping.id ? {
        ...mapping,
        name: newConnName,
        type: newConnType,
        direction: newConnDirection,
        pin: newConnPin,
        ...(newConnType === "Water Level - Ultrasonic" ? { txPin: newConnTxPin } : { txPin: undefined }),
        emptyDistanceCm,
        fullDistanceCm,
        tankWidthCm,
        tankLengthCm,
        tankHeightCm,
        tankCapacityLiters,
      } : mapping));
      toast.success("Water tank calibration updated locally!");
      return;
    }

    // Duplicate pin validation
    const duplicatePin = devicePins.find((p) => p.pin === newConnPin);
    if (duplicatePin) {
      toast.error(`Pin GPIO ${newConnPin} is already mapped to connection: "${duplicatePin.name}"`);
      return;
    }
    if (newConnType === "Water Level - Ultrasonic" && newConnPin === newConnTxPin) {
      toast.error("Ultrasonic TRIG and ECHO must use different GPIO pins");
      return;
    }
    if (newConnType === "Water Level - Ultrasonic") {
      const duplicateTrigPin = devicePins.find((p) => p.pin === newConnTxPin || p.txPin === newConnTxPin);
      if (duplicateTrigPin) {
        toast.error(`Pin GPIO ${newConnTxPin} is already mapped to connection: "${duplicateTrigPin.name}"`);
        return;
      }
    }
    const newMapping: GpioMapping = {
      id: `map-${Date.now()}`,
      name: newConnName,
      type: newConnType,
      direction: newConnDirection,
      pin: newConnPin,
      ...(newConnType === "Water Level - Ultrasonic" || newConnType === "Water Level - Analog Sensor" ? {
        ...(newConnType === "Water Level - Ultrasonic" ? { txPin: newConnTxPin } : {}),
        emptyDistanceCm,
        fullDistanceCm,
        tankWidthCm,
        tankLengthCm,
        tankHeightCm,
        tankCapacityLiters,
      } : {}),
    };
    setDevicePins([...devicePins, newMapping]);
    
    // reset connection line form
    setNewConnName("");
    toast.success("Pin mapping line added locally!");
  };

  const handleRemoveConnectionLine = (id: string) => {
    setDevicePins(devicePins.filter((p) => p.id !== id));
  };

  const handleSaveDevicePins = async () => {
    if (!selectedDevice) return;
    try {
      const res = await fetch(`${window.location.origin}/api/admin/devices/${encodeURIComponent(selectedDevice.deviceId)}/pins`, {
        credentials: "include",
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pins: devicePins }),
      });
      if (res.ok) {
        toast.success("Hardware GPIO pin mapping saved successfully!");
        setSelectedDevice(null);
        loadData();
      } else {
        toast.error("Failed to save device hardware map");
      }
    } catch (e) {
      toast.error("Server communication error");
    }
  };

  const handleTypeChange = (val: string) => {
    setNewConnType(val as GpioMapping["type"]);
    if (val.startsWith("Relay") || val === "Other Actuator") {
      setNewConnDirection("OUTPUT");
    } else {
      setNewConnDirection("INPUT");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top action block */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            Microcontroller Device Registry
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Register ESP32 controller boards by MAC address and map their physical relays or sensor connections to GPIO pins.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowAddModal(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold flex items-center gap-2 text-xs py-2 h-9">
            <Plus className="h-4 w-4" />
            Add ESP32 Controller
          </Button>
        </div>
      </div>

      {/* Main registry list */}
      {loading ? (
        <div className="text-center py-10 text-xs text-muted-foreground">Loading controllers registry...</div>
      ) : devices.length === 0 ? (
        <Card className="p-8 text-center border-border/80">
          <Cpu className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <span className="text-xs font-semibold text-muted-foreground block font-mono">No Microcontrollers Connected</span>
          <Button onClick={() => setShowAddModal(true)} variant="outline" className="mt-4 text-xs font-semibold">
            Register New ESP32 Node
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {devices.map((dev) => (
            <Card key={dev.id} className="p-5 border-border/80 bg-card flex flex-col justify-between hover:border-primary/50 transition-colors">
              <div className="space-y-4">
                {/* Device identifier headers */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-foreground block">{dev.name || "Unnamed Device"}</span>
                      <Button
                        onClick={() => handleRenameDevice(dev.deviceId, dev.name)}
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 rounded-full hover:bg-muted text-muted-foreground p-0"
                        title="Rename Device"
                      >
                        <Settings className="h-3 w-3" />
                      </Button>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 block">ID: {dev.deviceId}</span>
                    {dev.lastSeen && (
                      <span className="text-[9px] font-mono text-slate-400 block">
                        Last ping: {new Date(dev.lastSeen).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Badge className={`text-[10px] font-mono font-bold border ${dev.online ? "bg-green-500/10 text-green-600 border-green-500/20" : "bg-red-500/10 text-red-600 border-red-500/20"}`}>
                      {dev.online ? "ONLINE" : "OFFLINE"}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] font-mono font-bold bg-muted/30 text-muted-foreground border-border/80">
                      MAC: {dev.macAddress || "—"}
                    </Badge>
                  </div>
                </div>

                {/* Remapped status display */}
                <div className="border-t border-border/60 pt-3 space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Mapped Sensors & Controls</span>
                  
                  {dev.pins && dev.pins.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      {dev.pins.map((p) => (
                        <div key={p.id} className="flex flex-col bg-muted/40 p-1.5 rounded border border-border/40 font-mono text-[10px] space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-foreground font-bold truncate max-w-25">{p.name}</span>
                            <span className="text-primary font-bold text-[9px]">GPIO {p.pin}</span>
                          </div>
                          {(p.emptyDistanceCm != null || p.fullDistanceCm != null) && (
                            <span className="text-[8px] text-muted-foreground block border-t border-border/20 pt-0.5">
                              Cal: {p.emptyDistanceCm}cm-{p.fullDistanceCm}cm ({p.tankCapacityLiters}L)
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic bg-muted/15 p-2 rounded border border-dashed border-border/65">
                      No custom pin maps. Using server-wide default GPIO configurations.
                    </div>
                  )}
                </div>
              </div>

              {/* Remap & Admin action buttons */}
              <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between">
                <Button
                  onClick={() => handleDeleteDevice(dev.deviceId)}
                  variant="ghost"
                  size="icon"
                  className="text-red-500 hover:text-red-600 hover:bg-red-500/10 h-8 w-8"
                  title="Remove Device"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>

                <div className="flex gap-2">
                  <Button
                    onClick={() => handleRotateSecret(dev.deviceId)}
                    variant="outline"
                    className="text-xs font-semibold px-3 h-8 flex items-center gap-1"
                    title="Rotate Key"
                  >
                    <Key className="h-3.5 w-3.5" />
                    Reset Key
                  </Button>
                  <Button
                    onClick={() => handleOpenRemapPins(dev)}
                    className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-xs px-4 h-8 flex items-center gap-1"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Remap GPIO Pins
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Remap GPIO Config Modal */}
      {selectedDevice && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="p-6 max-w-xl w-full border-border/80 shadow-lg space-y-4 max-h-[85vh] overflow-y-auto">
            <div>
              <span className="font-bold text-base text-foreground block">
                Remap Pins — {selectedDevice.name}
              </span>
              <span className="text-xs text-muted-foreground block mt-0.5">
                Map custom sensor parameters or relay drives to microcontroller pins.
              </span>
            </div>

            {/* Existing mapped table */}
            <div className="border border-border/60 rounded-md overflow-hidden max-h-48 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-muted text-muted-foreground font-semibold border-b border-border/60">
                    <th className="p-2.5">Name</th>
                    <th className="p-2.5">Hardware Type</th>
                    <th className="p-2.5">GPIO Pin</th>
                    <th className="p-2.5 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {devicePins.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-muted-foreground italic">
                        No pins mapped yet. Add a mapping line below.
                      </td>
                    </tr>
                  ) : (
                    devicePins.map((p) => (
                      <tr key={p.id} className="hover:bg-muted/30">
                        <td className="p-2.5 font-bold text-foreground">{p.name}</td>
                        <td className="p-2.5">{p.type} ({p.direction})</td>
                        <td className="p-2.5 font-mono font-bold text-primary">GPIO {p.pin}</td>
                        <td className="p-2.5 text-right">
                          <Button
                            onClick={() => handleRemoveConnectionLine(p.id)}
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Add new mapping fields */}
            <div className="bg-muted/30 p-4 rounded-lg border border-border/60 space-y-3">
              <span className="text-xs font-bold text-foreground block">Add Sensor / Actuator line</span>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="conn-name" className="text-[11px] font-bold">Custom Name Label</Label>
                  <Input
                    id="conn-name"
                    placeholder="e.g. Nutrient Pump C"
                    value={newConnName}
                    onChange={(e) => setNewConnName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                
                <div className="space-y-1">
                  <Label className="text-[11px] font-bold">Select Hardware Type</Label>
                  <Select value={newConnType} onValueChange={handleTypeChange}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {SENSOR_ACTUATOR_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {newConnType === "Water Level - Ultrasonic" && (
                <div className="space-y-1">
                  <Label className="text-[11px] font-bold">Ultrasonic TRIG GPIO</Label>
                  <Select value={String(newConnTxPin)} onValueChange={(val) => setNewConnTxPin(Number(val))}>
                    <SelectTrigger className="h-8 text-xs font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="font-mono">
                      {VALID_GPIO_PINS.map((pin) => (
                        <SelectItem key={pin} value={String(pin)} className="text-xs">GPIO {pin}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] font-bold">Direction Mode</Label>
                  <Input
                    value={newConnDirection}
                    disabled
                    className="h-8 text-xs bg-muted/60"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-bold">{newConnType === "Water Level - Ultrasonic" ? "Ultrasonic ECHO GPIO" : "Select GPIO Pin"}</Label>
                  <Select value={String(newConnPin)} onValueChange={(val) => setNewConnPin(Number(val))}>
                    <SelectTrigger className="h-8 text-xs font-mono">
                      <SelectValue placeholder="Select Pin..." />
                    </SelectTrigger>
                    <SelectContent className="font-mono">
                      {VALID_GPIO_PINS.map((pin) => (
                        <SelectItem key={pin} value={String(pin)} className="text-xs">
                          GPIO {pin} {(pin === 34 || pin === 35 || pin === 36 || pin === 32 || pin === 33) ? " (ADC)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Dynamic Calibration parameters inputs for Water level sensors */}
              {(newConnType === "Water Level - Ultrasonic" || newConnType === "Water Level - Analog Sensor") && (
                <div className="p-3 border rounded-lg bg-primary/5 border-primary/10 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                  <div className="space-y-1">
                    <Label htmlFor="cal-empty" className="text-[9px] font-bold text-muted-foreground uppercase">Empty Distance (cm)</Label>
                    <Input
                      id="cal-empty"
                      type="number"
                      value={emptyDistanceCm}
                      onChange={(e) => setEmptyDistanceCm(Number(e.target.value))}
                      className="h-8 text-xs font-mono"
                      placeholder="e.g. 50"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cal-full" className="text-[9px] font-bold text-muted-foreground uppercase">Full Distance (cm)</Label>
                    <Input
                      id="cal-full"
                      type="number"
                      value={fullDistanceCm}
                      onChange={(e) => setFullDistanceCm(Number(e.target.value))}
                      className="h-8 text-xs font-mono"
                      placeholder="e.g. 10"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cal-width" className="text-[9px] font-bold text-muted-foreground uppercase">Tank Width (cm)</Label>
                    <Input
                      id="cal-width"
                      type="number"
                      value={tankWidthCm}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setTankWidthCm(value);
                        setTankCapacityLiters((value * tankLengthCm * tankHeightCm) / 1000);
                      }}
                      className="h-8 text-xs font-mono"
                      placeholder="e.g. 50"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cal-length" className="text-[9px] font-bold text-muted-foreground uppercase">Tank Length (cm)</Label>
                    <Input id="cal-length" type="number" value={tankLengthCm} onChange={(e) => {
                      const value = Number(e.target.value);
                      setTankLengthCm(value);
                      setTankCapacityLiters((tankWidthCm * value * tankHeightCm) / 1000);
                    }} className="h-8 text-xs font-mono" placeholder="e.g. 50" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cal-height" className="text-[9px] font-bold text-muted-foreground uppercase">Tank Height (cm)</Label>
                    <Input id="cal-height" type="number" value={tankHeightCm} onChange={(e) => {
                      const value = Number(e.target.value);
                      setTankHeightCm(value);
                      setTankCapacityLiters((tankWidthCm * tankLengthCm * value) / 1000);
                    }} className="h-8 text-xs font-mono" placeholder="e.g. 80" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cal-capacity" className="text-[9px] font-bold text-muted-foreground uppercase">Calculated Capacity (L)</Label>
                    <Input id="cal-capacity" type="number" value={tankCapacityLiters} readOnly className="h-8 text-xs font-mono bg-muted/60" />
                  </div>
                </div>
              )}

              <Button
                onClick={handleAddConnectionLine}
                className="w-full bg-slate-800 text-white hover:bg-slate-700 font-bold text-xs h-8 flex items-center gap-1 mt-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Connection Line
              </Button>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <Button onClick={() => setSelectedDevice(null)} variant="outline" className="text-xs font-semibold px-4 h-9">
                Cancel
              </Button>
              <Button onClick={handleSaveDevicePins} className="bg-primary text-primary-foreground font-bold text-xs px-5 h-9">
                Apply Hardware Mappings
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Add Device Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4">
            <div>
              <span className="font-bold text-base text-foreground block">
                Register Microcontroller (ESP32)
              </span>
              <span className="text-xs text-muted-foreground block mt-0.5">
                Add MAC Address & name for secure sync pairing.
              </span>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="dev-name" className="text-xs font-semibold">Device Name Label</Label>
                <Input
                  id="dev-name"
                  placeholder="e.g. Nursery Tower Node"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="mac" className="text-xs font-semibold">MAC Address</Label>
                <Input
                  id="mac"
                  placeholder="e.g. E0:5A:1B:C2:59:7C"
                  value={macAddress}
                  onChange={(e) => setMacAddress(e.target.value)}
                />
              </div>

            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <Button onClick={() => setShowAddModal(false)} variant="outline" className="text-xs font-semibold px-4 h-9">
                Cancel
              </Button>
              <Button onClick={handleRegisterDevice} className="bg-primary text-primary-foreground font-bold text-xs px-4 h-9">
                Register Device
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Secret Token Key Display Modal */}
      {showSecretModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4">
            <div className="text-center space-y-2">
              <ShieldCheck className="h-10 w-10 text-emerald-500 mx-auto" />
              <span className="font-bold text-base text-foreground block">Device Token Generated</span>
              <span className="text-xs text-muted-foreground block">
                Copy these credentials and save them in your ESP32 controller firmware config:
              </span>
            </div>

            <div className="bg-muted p-3.5 rounded border border-border/80 font-mono text-xs space-y-2">
              <div>
                <span className="text-[10px] text-muted-foreground block">DEVICE_ID:</span>
                <span className="text-foreground font-bold select-all block">{generatedId}</span>
              </div>
              <div className="pt-2 border-t border-border/40">
                <span className="text-[10px] text-muted-foreground block">DEVICE_SECRET:</span>
                <span className="text-primary font-bold select-all break-all block">{generatedSecret}</span>
              </div>
            </div>

            <Button onClick={() => setShowSecretModal(false)} className="w-full bg-primary text-primary-foreground font-bold text-xs h-9">
              I Have Saved These Credentials
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
