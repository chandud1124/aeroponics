import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { QrCode, Sprout, ShoppingBag, Plus, Sparkles, Clipboard, Trash2, Edit3, Calendar, FileText, BarChart3 } from "lucide-react";
import {
  fetchNftChannels,
  saveNftChannels,
  plantCropRemote,
  harvestCropRemote,
  type NftChannel,
  type NftCropEntry,
} from "@/lib/tower-storage";

export function NftChannelsTab() {
  const [channels, setChannels] = useState<NftChannel[]>([]);
  const [loading, setLoading] = useState(true);

  // Forms states
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"plant" | "harvest" | "add-channel" | "edit-channel" | null>(null);
  
  const [channelName, setChannelName] = useState("");
  const [cropName, setCropName] = useState("");
  const [capacity, setCapacity] = useState<number>(50);
  const [currentCount, setCurrentCount] = useState<number>(40);
  const [plantedAt, setPlantedAt] = useState("");
  const [expectedHarvestISO, setExpectedHarvestISO] = useState("");
  const [notes, setNotes] = useState("");

  // Multi-crop list editing
  const [cropsList, setCropsList] = useState<NftCropEntry[]>([{ cropName: "", count: 20 }]);

  const loadData = () => {
    setLoading(true);
    fetchNftChannels()
      .then(setChannels)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddCropRow = () => {
    setCropsList([...cropsList, { cropName: "", count: 10 }]);
  };

  const handleRemoveCropRow = (index: number) => {
    if (cropsList.length === 1) {
      toast.error("At least one plant variety row must remain");
      return;
    }
    setCropsList(cropsList.filter((_, idx) => idx !== index));
  };

  const handleCropRowChange = (index: number, field: "cropName" | "count", value: any) => {
    setCropsList(
      cropsList.map((c, idx) => {
        if (idx === index) {
          return {
            ...c,
            [field]: field === "count" ? Number(value) : value,
          };
        }
        return c;
      })
    );
  };

  const handlePlant = async () => {
    if (!activeChannelId) return;

    // Filter valid crop varieties input
    const validCrops = cropsList.filter((c) => c.cropName.trim() !== "");
    if (validCrops.length === 0) {
      toast.error("At least one plant variety name is required");
      return;
    }

    const totalCount = validCrops.reduce((sum, c) => sum + Number(c.count || 0), 0);
    if (totalCount > capacity) {
      toast.error(`Total plants count (${totalCount}) exceeds channel capacity (${capacity})`);
      return;
    }

    try {
      const activeChan = channels.find((c) => c.id === activeChannelId);
      if (!activeChan) return;

      const firstCropName = validCrops[0].cropName;
      const combinedCropName = validCrops.length > 1
        ? validCrops.map((c) => `${c.cropName} (${c.count})`).join(", ")
        : firstCropName;

      const updatedChan: NftChannel = {
        ...activeChan,
        cropName: combinedCropName,
        crops: validCrops,
        status: "growing",
        plantedAt: plantedAt ? new Date(plantedAt).toISOString() : new Date().toISOString(),
        expectedHarvestISO: expectedHarvestISO ? new Date(expectedHarvestISO).toISOString() : null,
        capacity,
        currentCount: totalCount,
        notes,
      };

      const updatedList = channels.map((c) => c.id === activeChannelId ? updatedChan : c);
      await saveNftChannels(updatedList);
      toast.success("Crop batch planted successfully!");
      loadData();
      closeForm();
    } catch (e: any) {
      toast.error(e.message || "Failed to plant crop");
    }
  };

  const handleHarvest = async () => {
    if (!activeChannelId) return;
    try {
      await harvestCropRemote(activeChannelId, notes);
      toast.success("Crop batch harvested successfully!");
      loadData();
      closeForm();
    } catch (e: any) {
      toast.error(e.message || "Failed to harvest crop");
    }
  };

  const handleAddChannel = async () => {
    if (!channelName.trim()) {
      toast.error("Channel name is required");
      return;
    }
    const newId = `channel-${Date.now()}`;
    const newChan: NftChannel = {
      id: newId,
      name: channelName,
      qrCode: newId,
      cropName: "",
      plantedAt: null,
      harvestedAt: null,
      notes: "",
      status: "empty",
      capacity,
      currentCount: 0,
      expectedHarvestISO: null,
    };
    try {
      const updatedList = [...channels, newChan];
      await saveNftChannels(updatedList);
      toast.success("New NFT Channel added!");
      loadData();
      closeForm();
    } catch (e: any) {
      toast.error(e.message || "Failed to add channel");
    }
  };

  const handleSaveEdit = async () => {
    if (!activeChannelId) return;
    if (!channelName.trim()) {
      toast.error("Channel name is required");
      return;
    }

    const validCrops = cropsList.filter((c) => c.cropName.trim() !== "");
    const totalCount = validCrops.reduce((sum, c) => sum + Number(c.count || 0), 0);
    if (totalCount > capacity) {
      toast.error(`Total plants count (${totalCount}) exceeds channel capacity (${capacity})`);
      return;
    }

    try {
      const updatedList = channels.map((c) => {
        if (c.id === activeChannelId) {
          const combinedCropName = validCrops.length > 1
            ? validCrops.map((vc) => `${vc.cropName} (${vc.count})`).join(", ")
            : (validCrops[0]?.cropName || "");

          return {
            ...c,
            name: channelName,
            capacity,
            currentCount: c.status === "growing" ? totalCount : 0,
            cropName: c.status === "growing" ? combinedCropName : "",
            crops: c.status === "growing" ? validCrops : [],
            plantedAt: c.status === "growing" ? (plantedAt ? new Date(plantedAt).toISOString() : c.plantedAt) : null,
            expectedHarvestISO: c.status === "growing" ? (expectedHarvestISO ? new Date(expectedHarvestISO).toISOString() : null) : null,
            notes,
          };
        }
        return c;
      });
      await saveNftChannels(updatedList);
      toast.success("NFT Channel updated!");
      loadData();
      closeForm();
    } catch (e: any) {
      toast.error("Failed to edit channel");
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm("Are you sure you want to delete this NFT channel?")) return;
    try {
      const updatedList = channels.filter((c) => c.id !== id);
      await saveNftChannels(updatedList);
      toast.success("Channel deleted");
      loadData();
    } catch (e: any) {
      toast.error("Failed to delete channel");
    }
  };

  const handleOpenEdit = (chan: NftChannel) => {
    setActiveChannelId(chan.id);
    setChannelName(chan.name);
    if (chan.crops && chan.crops.length > 0) {
      setCropsList(chan.crops);
    } else {
      setCropsList([{ cropName: chan.cropName || "", count: chan.currentCount ?? 20 }]);
    }
    setCropName(chan.cropName || "");
    setCapacity(chan.capacity ?? 50);
    setCurrentCount(chan.currentCount ?? 0);
    setPlantedAt(chan.plantedAt ? new Date(chan.plantedAt).toISOString().split("T")[0] : "");
    setExpectedHarvestISO(chan.expectedHarvestISO ? new Date(chan.expectedHarvestISO).toISOString().split("T")[0] : "");
    setNotes(chan.notes || "");
    setActionType("edit-channel");
  };

  const handleOpenPlant = (chan: NftChannel) => {
    setActiveChannelId(chan.id);
    if (chan.crops && chan.crops.length > 0) {
      setCropsList(chan.crops);
    } else {
      setCropsList([{ cropName: chan.cropName || "", count: chan.capacity ? Math.round(chan.capacity * 0.8) : 40 }]);
    }
    setCropName("");
    setCapacity(chan.capacity ?? 50);
    setCurrentCount(chan.capacity ?? 40);
    setPlantedAt(new Date().toISOString().split("T")[0]);
    setExpectedHarvestISO("");
    setNotes(chan.notes || "");
    setActionType("plant");
  };

  const closeForm = () => {
    setActiveChannelId(null);
    setActionType(null);
    setChannelName("");
    setCropName("");
    setCapacity(50);
    setCurrentCount(40);
    setPlantedAt("");
    setExpectedHarvestISO("");
    setNotes("");
    setCropsList([{ cropName: "", count: 20 }]);
  };

  const calculateDays = (plantedAtISO: string | null) => {
    if (!plantedAtISO) return 0;
    const diff = Date.now() - new Date(plantedAtISO).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const calculateDaysRemaining = (expectedHarvestISO: string | null) => {
    if (!expectedHarvestISO) return null;
    const diff = new Date(expectedHarvestISO).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            NFT Crop Channel Batch Tracker
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Track crop variety progression, batch dates, plant capacities, and expected harvest dates using permanent QR codes.
          </p>
        </div>
        <Button onClick={() => { setChannelName(""); setCapacity(50); setActionType("add-channel"); }} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold flex items-center gap-2 text-xs py-2">
          <Plus className="h-4 w-4" />
          Add Channel Batch
        </Button>
      </div>

      {/* Main Grid view */}
      {loading ? (
        <div className="text-center py-10 text-xs text-muted-foreground">Loading channels...</div>
      ) : channels.length === 0 ? (
        <Card className="p-8 text-center border-border/80">
          <Sprout className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <span className="text-xs font-semibold text-muted-foreground block">No NFT Channels Registered Yet</span>
          <Button onClick={() => setActionType("add-channel")} variant="outline" className="mt-4 text-xs font-semibold">
            Add Your First Channel
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {channels.map((chan) => {
            const cap = chan.capacity ?? 50;
            const count = chan.currentCount ?? 0;
            const percentage = Math.min(100, Math.round((count / cap) * 100));
            const daysRemaining = calculateDaysRemaining(chan.expectedHarvestISO ?? null);

            return (
              <Card key={chan.id} className="p-5 border-border/80 bg-card flex flex-col justify-between hover:border-primary/50 transition-colors relative overflow-hidden">
                <div className="flex gap-4">
                  {/* QR Code section */}
                  <div className="flex flex-col items-center gap-2 shrink-0 bg-white p-2 rounded-lg border border-slate-200">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(chan.id)}`}
                      alt="QR Code"
                      className="w-24 h-24 object-contain"
                    />
                    <span className="text-[9px] text-slate-500 font-mono tracking-wider">{chan.id}</span>
                  </div>

                  {/* Crop details */}
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-foreground">{chan.name}</span>
                      <Badge variant={chan.status === "growing" ? "default" : "secondary"}>
                        {chan.status === "growing" ? "Growing" : "Empty"}
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      {/* Capacity progress */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> Capacity:</span>
                          <span className="font-bold text-foreground">{count} / {cap} Plants ({percentage}%)</span>
                        </div>
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="bg-primary h-full rounded-full" style={{ width: `${percentage}%` }} />
                        </div>
                      </div>

                      {chan.status === "growing" ? (
                        <div className="space-y-1 text-xs">
                          <div className="text-foreground font-semibold flex flex-col gap-0.5">
                            <span className="text-[10px] text-muted-foreground uppercase block font-bold tracking-wider">Planted Crops</span>
                            {chan.crops && chan.crops.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {chan.crops.map((c, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px] font-bold bg-green-500/5 border-green-500/20 text-green-700">
                                    {c.cropName} ({c.count})
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <Sprout className="h-3.5 w-3.5 text-green-500" />
                                <span>{chan.cropName}</span>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground pt-2">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              Planted: {chan.plantedAt ? new Date(chan.plantedAt).toLocaleDateString() : "—"}
                            </div>
                            <div className="flex items-center gap-1">
                              <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
                              Age: {calculateDays(chan.plantedAt)} days
                            </div>
                          </div>
                          {daysRemaining !== null && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded w-fit flex items-center gap-1 mt-1">
                              <Calendar className="h-3 w-3" /> Expected Harvest in {daysRemaining} days ({chan.expectedHarvestISO ? new Date(chan.expectedHarvestISO).toLocaleDateString() : ""})
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="py-2 text-xs text-muted-foreground italic flex items-center gap-1.5">
                          <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground opacity-55" />
                          Ready for next crop batch seeding.
                        </div>
                      )}
                    </div>

                    {chan.notes && (
                      <div className="text-[10px] text-muted-foreground border-t border-border/40 pt-1.5 flex items-start gap-1">
                        <FileText className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="line-clamp-2" title={chan.notes}>{chan.notes}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer options */}
                <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between">
                  <div className="flex gap-1">
                    <Button
                      onClick={() => handleDeleteChannel(chan.id)}
                      variant="ghost"
                      size="icon"
                      className="text-red-500 hover:text-red-600 hover:bg-red-500/10 h-8 w-8"
                      title="Delete Channel"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={() => handleOpenEdit(chan)}
                      variant="ghost"
                      size="icon"
                      className="text-slate-600 dark:text-slate-300 hover:bg-muted h-8 w-8"
                      title="Edit Channel Batch Settings"
                    >
                      <Edit3 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex gap-2">
                    {chan.status === "growing" ? (
                      <Button
                        onClick={() => {
                          setActiveChannelId(chan.id);
                          setNotes(chan.notes || "");
                          setActionType("harvest");
                        }}
                        className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs px-4 py-1.5 h-8 shadow-sm"
                      >
                        Complete Harvest
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleOpenPlant(chan)}
                        className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-xs px-4 py-1.5 h-8 shadow-sm"
                      >
                        Plant Crop Batch
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Floating Dialog Modals */}
      {actionType && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <span className="font-bold text-base text-foreground block">
                {actionType === "plant" && "Plant Crop Batch"}
                {actionType === "harvest" && "Log Batch Harvest & Reset"}
                {actionType === "add-channel" && "Add NFT Channel"}
                {actionType === "edit-channel" && "Edit Channel Settings"}
              </span>
              <span className="text-xs text-muted-foreground block mt-0.5">
                {actionType === "plant" && "Configure cultivars and counts for this multi-crop batch."}
                {actionType === "harvest" && "Reset channel to empty status."}
                {actionType === "add-channel" && "Create a new physical NFT re-use location."}
                {actionType === "edit-channel" && "Modify details of this crop channel."}
              </span>
            </div>

            <div className="space-y-3">
              {(actionType === "add-channel" || actionType === "edit-channel") && (
                <div className="space-y-1">
                  <Label htmlFor="chan-name" className="text-xs font-semibold">Channel Label / Name</Label>
                  <Input
                    id="chan-name"
                    placeholder="e.g. Channel B4"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                  />
                </div>
              )}

              {(actionType === "plant" || actionType === "edit-channel") && (
                <>
                  {/* Multi-crop rows */}
                  <div className="space-y-2 border border-border p-2.5 rounded-lg bg-muted/15">
                    <div className="flex justify-between items-center pb-1.5 border-b">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cultivars Planted</span>
                      <Button onClick={handleAddCropRow} variant="outline" size="sm" className="h-6 text-[10px] font-bold px-2 py-0">
                        + Add Row
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-36 overflow-y-auto pt-1">
                      {cropsList.map((crop, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <Input
                            placeholder="e.g. Romaine"
                            value={crop.cropName}
                            onChange={(e) => handleCropRowChange(idx, "cropName", e.target.value)}
                            className="h-8 text-xs flex-1"
                          />
                          <Input
                            type="number"
                            placeholder="Qty"
                            value={crop.count}
                            onChange={(e) => handleCropRowChange(idx, "count", e.target.value)}
                            className="h-8 text-xs w-16"
                          />
                          <Button
                            onClick={() => handleRemoveCropRow(idx)}
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10 shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="text-[10px] text-muted-foreground text-right font-bold pt-1.5 border-t">
                      Total: {cropsList.reduce((sum, c) => sum + Number(c.count || 0), 0)} / {capacity} Plants
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="cap" className="text-xs font-semibold">Max Capacity</Label>
                      <Input
                        id="cap"
                        type="number"
                        value={capacity}
                        onChange={(e) => setCapacity(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="plant-date" className="text-xs font-semibold">Planted Date</Label>
                    <Input
                      id="plant-date"
                      type="date"
                      value={plantedAt}
                      onChange={(e) => setPlantedAt(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="harvest-date" className="text-xs font-semibold">Expected Harvest Date</Label>
                    <Input
                      id="harvest-date"
                      type="date"
                      value={expectedHarvestISO}
                      onChange={(e) => setExpectedHarvestISO(e.target.value)}
                    />
                  </div>
                </>
              )}

              {actionType === "add-channel" && (
                <div className="space-y-1">
                  <Label htmlFor="chan-capacity" className="text-xs font-semibold">Max Capacity (Pots)</Label>
                  <Input
                    id="chan-capacity"
                    type="number"
                    value={capacity}
                    onChange={(e) => setCapacity(Number(e.target.value))}
                  />
                </div>
              )}

              {actionType !== "add-channel" && (
                <div className="space-y-1">
                  <Label htmlFor="notes" className="text-xs font-semibold">Notes / History logs</Label>
                  <Input
                    id="notes"
                    placeholder="e.g. EC level used, tray origin..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <Button onClick={closeForm} variant="outline" className="text-xs font-semibold px-4 h-9">
                Cancel
              </Button>
              {actionType === "plant" && (
                <Button onClick={handlePlant} className="bg-primary text-primary-foreground font-bold text-xs px-4 h-9">
                  Confirm Seeding
                </Button>
              )}
              {actionType === "harvest" && (
                <Button onClick={handleHarvest} className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs px-4 h-9">
                  Log Yield & Harvest
                </Button>
              )}
              {actionType === "add-channel" && (
                <Button onClick={handleAddChannel} className="bg-primary text-primary-foreground font-bold text-xs px-4 h-9">
                  Add Channel
                </Button>
              )}
              {actionType === "edit-channel" && (
                <Button onClick={handleSaveEdit} className="bg-primary text-primary-foreground font-bold text-xs px-4 h-9">
                  Save Changes
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
