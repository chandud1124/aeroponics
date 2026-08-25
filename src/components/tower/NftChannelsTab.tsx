import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { QrCode, Sprout, ShoppingBag, Plus, Sparkles, Clipboard, Trash2, Edit3, Calendar, FileText, BarChart3, AlertTriangle, AlertCircle, History } from "lucide-react";
import { CameraQrScanner } from "@/components/tower/CameraQrScanner";
import {
  fetchNftChannels,
  saveNftChannels,
  plantCropRemote,
  harvestCropRemote,
  fetchHarvestHistory,
  type NftChannel,
  type NftCropEntry,
} from "@/lib/tower-storage";

export function NftChannelsTab() {
  const [channels, setChannels] = useState<NftChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStandFilter, setSelectedStandFilter] = useState("All Stands");
  const [viewMode, setViewMode] = useState<"grid" | "cards">("grid");

  // Forms states
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"plant" | "harvest" | "add-channel" | "edit-channel" | "incident" | "logs" | "transfer" | null>(null);
  
  const [channelName, setChannelName] = useState("");
  const [cropName, setCropName] = useState("");
  const [capacity, setCapacity] = useState<number>(50);
  const [currentCount, setCurrentCount] = useState<number>(40);
  const [plantedAt, setPlantedAt] = useState("");
  const [expectedHarvestISO, setExpectedHarvestISO] = useState("");
  const [notes, setNotes] = useState("");
  
  // Coordinate locations
  const [stand, setStand] = useState("");
  const [level, setLevel] = useState("");
  const [channelIndex, setChannelIndex] = useState<number>(1);

  // Harvest Audit states
  const [yieldQty, setYieldQty] = useState<number>(0);
  const [wasteQty, setWasteQty] = useState<number>(0);
  const [avgWeightGrams, setAvgWeightGrams] = useState<number>(0);

  // Incident Adjustments states
  const [incidentType, setIncidentType] = useState<"incident" | "removal">("incident");
  const [incidentDesc, setIncidentDesc] = useState("");
  const [incidentQty, setIncidentQty] = useState<number>(1);
  const [incidentCultivar, setIncidentCultivar] = useState("");

  // Logs states
  const [selectedChannelLogs, setSelectedChannelLogs] = useState<NftChannel | null>(null);
  const [channelHarvestHistory, setChannelHarvestHistory] = useState<any[]>([]);

  // Multi-crop list editing
  const [cropsList, setCropsList] = useState<NftCropEntry[]>([{ cropName: "", count: 20 }]);

  // Transfer / Shipping states
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferCount, setTransferCount] = useState<number>(5);
  const [transferCultivar, setTransferCultivar] = useState("");
  const [transferScanQr, setTransferScanQr] = useState("");
  const [showCameraScanner, setShowCameraScanner] = useState(false);

  const loadData = () => {
    setLoading(true);
    fetchNftChannels()
      .then((data) => {
        // Sort channels by stand, level, then channelIndex
        const sorted = [...data].sort((a, b) => {
          const standA = a.stand || "";
          const standB = b.stand || "";
          if (standA !== standB) return standA.localeCompare(standB);
          
          const levelA = a.level || "";
          const levelB = b.level || "";
          if (levelA !== levelB) return levelA.localeCompare(levelB);
          
          return (a.channelIndex ?? 0) - (b.channelIndex ?? 0);
        });
        setChannels(sorted);
      })
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

    if (validCrops.some((crop) => !Number.isFinite(crop.count) || crop.count <= 0)) {
      toast.error("Every crop variety must have a quantity greater than zero");
      return;
    }
    const cropNames = validCrops.map((crop) => crop.cropName.trim().toLowerCase());
    if (new Set(cropNames).size !== cropNames.length) {
      toast.error("Each crop variety can only be entered once");
      return;
    }
    const totalCount = validCrops.reduce((sum, c) => sum + c.count, 0);
    if (totalCount > capacity) {
      toast.error(`Total plants count (${totalCount}) exceeds channel capacity (${capacity})`);
      return;
    }

    try {
      const activeChan = channels.find((c) => c.id === activeChannelId);
      if (!activeChan) return;

      if (activeChan.status === "growing") {
        await harvestCropRemote(activeChan.id, activeChan.currentCount ?? 0, 0, 0, "Auto-logged on replant.");
      }

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
      await harvestCropRemote(activeChannelId, yieldQty, wasteQty, avgWeightGrams, notes);
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
    const locationTag = stand && level
      ? `${stand}-${level}-Ch ${channelIndex}`
      : newId;

    const newChan: NftChannel = {
      id: newId,
      name: channelName,
      qrCode: locationTag,
      cropName: "",
      plantedAt: null,
      harvestedAt: null,
      notes: "",
      status: "empty",
      capacity,
      currentCount: 0,
      expectedHarvestISO: null,
      stand: stand.trim() || undefined,
      level: level.trim() || undefined,
      channelIndex: channelIndex || undefined,
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

          const locationTag = stand && level
            ? `${stand}-${level}-Ch ${channelIndex}`
            : c.qrCode;

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
            stand: stand.trim() || undefined,
            level: level.trim() || undefined,
            channelIndex: channelIndex || undefined,
            qrCode: locationTag,
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

  const handleIncidentSubmit = async () => {
    if (!activeChannelId) return;
    if (!incidentDesc.trim()) {
      toast.error("Description is required");
      return;
    }
    if (incidentType === "removal") {
      if (!incidentCultivar.trim() || !Number.isFinite(incidentQty) || incidentQty <= 0) {
        toast.error("Select a cultivar and enter a removal quantity greater than zero");
        return;
      }
    }

    try {
      const updatedList = channels.map((c) => {
        if (c.id === activeChannelId) {
          const prevIncidents = c.incidents ?? [];
          const newIncident = {
            timestamp: new Date().toISOString(),
            type: incidentType,
            description: incidentType === "removal"
              ? `Removed ${incidentQty}x ${incidentCultivar || "plants"} - Reason: ${incidentDesc}`
              : incidentDesc,
            qtyRemoved: incidentType === "removal" ? incidentQty : undefined,
            cultivar: incidentType === "removal" ? incidentCultivar : undefined,
          };

          // Adjust counts if removal
          let nextCount = c.currentCount ?? 0;
          let nextCrops = c.crops ? [...c.crops] : [];
          if (incidentType === "removal") {
            const cropIndex = nextCrops.findIndex((crop) => crop.cropName.toLowerCase() === incidentCultivar.trim().toLowerCase());
            const availableCount = nextCrops.length > 0
              ? cropIndex >= 0 ? nextCrops[cropIndex].count : 0
              : c.cropName?.trim().toLowerCase() === incidentCultivar.trim().toLowerCase() ? nextCount : 0;
            if (availableCount <= 0 || incidentQty > availableCount) {
              throw new Error(`Cannot remove more than the available ${incidentCultivar} plants (${availableCount})`);
            }
            nextCount = Math.max(0, nextCount - incidentQty);
            nextCrops = nextCrops.map((crop) => {
              if (crop.cropName.toLowerCase() === incidentCultivar.trim().toLowerCase()) {
                return {
                  ...crop,
                  count: Math.max(0, crop.count - incidentQty)
                };
              }
              return crop;
            }).filter((crop) => crop.count > 0); // Drop cultivars if count is 0
          }

          const combinedCropName = nextCrops.length > 1
            ? nextCrops.map((vc) => `${vc.cropName} (${vc.count})`).join(", ")
            : (nextCrops[0]?.cropName || "");

          const isEmpty = incidentType === "removal" && nextCount === 0;
          return {
            ...c,
            currentCount: nextCount,
            crops: nextCrops,
            cropName: isEmpty ? "" : combinedCropName,
            status: isEmpty ? "empty" : c.status,
            plantedAt: isEmpty ? null : c.plantedAt,
            expectedHarvestISO: isEmpty ? null : c.expectedHarvestISO,
            incidents: [...prevIncidents, newIncident],
          };
        }
        return c;
      });

      await saveNftChannels(updatedList);
      toast.success(incidentType === "removal" ? "Plants removed & logged!" : "Incident logged successfully!");
      loadData();
      closeForm();
    } catch (e: any) {
      toast.error("Failed to log incident");
    }
  };

  const handleOpenLogs = async (chan: NftChannel) => {
    setSelectedChannelLogs(chan);
    try {
      const hist = await fetchHarvestHistory();
      const filtered = hist.filter((h) => h.channelId === chan.id);
      setChannelHarvestHistory(filtered);
      setActionType("logs");
    } catch {
      toast.error("Failed to load logs");
    }
  };

  const handleTransferSubmit = async () => {
    if (!activeChannelId) return;
    const sourceChan = channels.find((c) => c.id === activeChannelId);
    const targetChan = channels.find((c) => c.id === transferTargetId);

    if (!sourceChan) {
      toast.error("Source channel not found.");
      return;
    }
    if (!targetChan) {
      toast.error("Please select a target channel.");
      return;
    }
    if (sourceChan.id === targetChan.id) {
      toast.error("Source and target channels cannot be the same.");
      return;
    }
    if (transferCount <= 0) {
      toast.error("Please enter a valid quantity of plants to ship.");
      return;
    }
    if (!transferCultivar.trim()) {
      toast.error("Please select a cultivar to ship.");
      return;
    }

    // Determine current count of the selected cultivar on source
    let sourceCultivarCount = 0;
    if (sourceChan.crops && sourceChan.crops.length > 0) {
      const match = sourceChan.crops.find((cr) => cr.cropName.toLowerCase() === transferCultivar.toLowerCase());
      sourceCultivarCount = match ? match.count : 0;
    } else {
      sourceCultivarCount = sourceChan.cropName?.toLowerCase() === transferCultivar.toLowerCase() ? (sourceChan.currentCount ?? 0) : 0;
    }

    if (transferCount > sourceCultivarCount) {
      toast.error(`Cannot transfer more plants than available (${sourceCultivarCount}x ${transferCultivar}).`);
      return;
    }
    if (transferCount + (targetChan.currentCount ?? 0) > (targetChan.capacity ?? 0)) {
      toast.error(`Destination capacity exceeded. Available space: ${Math.max(0, (targetChan.capacity ?? 0) - (targetChan.currentCount ?? 0))} plants.`);
      return;
    }

    try {
      // 1. Deduct from source
      const nextSourceCrops = sourceChan.crops && sourceChan.crops.length > 0
        ? sourceChan.crops.map((cr) => {
            if (cr.cropName.toLowerCase() === transferCultivar.toLowerCase()) {
              return { ...cr, count: cr.count - transferCount };
            }
            return cr;
          }).filter((cr) => cr.count > 0)
        : [];
      
      const nextSourceCount = Math.max(0, (sourceChan.currentCount ?? 0) - transferCount);
      const isSourceEmpty = nextSourceCount === 0;

      const updatedSource: NftChannel = {
        ...sourceChan,
        status: isSourceEmpty ? "empty" : "growing",
        currentCount: nextSourceCount,
        crops: isSourceEmpty ? [] : nextSourceCrops,
        cropName: isSourceEmpty ? "" : (nextSourceCrops.length > 0 ? nextSourceCrops.map((c) => c.cropName).join(", ") : ""),
        plantedAt: isSourceEmpty ? null : sourceChan.plantedAt,
        expectedHarvestISO: isSourceEmpty ? null : sourceChan.expectedHarvestISO,
        incidents: [
          ...(sourceChan.incidents || []),
          {
            timestamp: new Date().toISOString(),
            type: "incident",
            description: `Shipped ${transferCount}x ${transferCultivar} to Gully: ${targetChan.name}`,
          },
        ],
      };

      // 2. Add to target
      let nextTargetCrops: NftCropEntry[] = [];
      if (targetChan.status === "growing") {
        const baseCrops = targetChan.crops && targetChan.crops.length > 0
          ? targetChan.crops
          : [{ cropName: targetChan.cropName || "Unknown", count: targetChan.currentCount ?? 0 }];
        
        const existingIdx = baseCrops.findIndex((cr) => cr.cropName.toLowerCase() === transferCultivar.toLowerCase());
        if (existingIdx > -1) {
          nextTargetCrops = baseCrops.map((cr, idx) => 
            idx === existingIdx ? { ...cr, count: cr.count + transferCount } : cr
          );
        } else {
          nextTargetCrops = [...baseCrops, { cropName: transferCultivar, count: transferCount }];
        }
      } else {
        nextTargetCrops = [{ cropName: transferCultivar, count: transferCount }];
      }

      const nextTargetCount = (targetChan.currentCount ?? 0) + transferCount;

      const updatedTarget: NftChannel = {
        ...targetChan,
        status: "growing",
        currentCount: nextTargetCount,
        crops: nextTargetCrops,
        cropName: nextTargetCrops.map((c) => c.cropName).join(", "),
        plantedAt: targetChan.plantedAt || new Date().toISOString(),
        incidents: [
          ...(targetChan.incidents || []),
          {
            timestamp: new Date().toISOString(),
            type: "incident",
            description: `Received ${transferCount}x ${transferCultivar} from Gully: ${sourceChan.name}`,
          },
        ],
      };

      // 3. Save channels list
      const updatedList = channels.map((c) => {
        if (c.id === sourceChan.id) return updatedSource;
        if (c.id === targetChan.id) return updatedTarget;
        return c;
      });

      await saveNftChannels(updatedList);
      toast.success(`Successfully shipped ${transferCount}x ${transferCultivar}!`);
      loadData();
      closeForm();
    } catch (e: any) {
      toast.error("Failed to transfer plants.");
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
    setStand(chan.stand || "");
    setLevel(chan.level || "");
    setChannelIndex(chan.channelIndex ?? 1);
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
    setStand("");
    setLevel("");
    setChannelIndex(1);
    setYieldQty(0);
    setWasteQty(0);
    setAvgWeightGrams(0);
    setIncidentType("incident");
    setIncidentDesc("");
    setIncidentQty(1);
    setIncidentCultivar("");
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

  // Dynamic stands extraction & grouping logic
  const stands = Array.from(new Set(channels.map((c) => c.stand).filter(Boolean) as string[])).sort();

  const filteredChannels = selectedStandFilter === "All Stands"
    ? channels
    : channels.filter((c) => c.stand === selectedStandFilter);

  const groupedLayout: {
    [standName: string]: {
      [levelName: string]: NftChannel[]
    }
  } = {};

  filteredChannels.forEach((chan) => {
    const standName = chan.stand || "Unassigned Racks";
    const levelName = chan.level || "Unassigned Levels";
    
    if (!groupedLayout[standName]) {
      groupedLayout[standName] = {};
    }
    if (!groupedLayout[standName][levelName]) {
      groupedLayout[standName][levelName] = [];
    }
    groupedLayout[standName][levelName].push(chan);
  });

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
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <div className="flex bg-muted p-0.5 rounded-lg border border-border/80 text-[11px] font-bold h-9 items-center">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`px-3 py-1 rounded-md transition-all h-8 ${viewMode === "grid" ? "bg-background text-foreground shadow-sm font-extrabold" : "text-muted-foreground hover:text-foreground font-semibold"}`}
            >
              📍 Layout Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={`px-3 py-1 rounded-md transition-all h-8 ${viewMode === "cards" ? "bg-background text-foreground shadow-sm font-extrabold" : "text-muted-foreground hover:text-foreground font-semibold"}`}
            >
              📑 Detailed Cards
            </button>
          </div>
          <Button onClick={() => { setChannelName(""); setCapacity(50); setActionType("add-channel"); }} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold flex items-center gap-2 text-xs py-2 h-9">
            <Plus className="h-4 w-4" />
            Add Channel Batch
          </Button>
        </div>
      </div>

      {/* Stand Filters Bar */}
      <div className="flex flex-wrap items-center gap-2 border-y border-border/50 py-3">
        <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1">
          <BarChart3 className="h-3.5 w-3.5" /> Filter Rack:
        </span>
        <Button
          onClick={() => setSelectedStandFilter("All Stands")}
          variant={selectedStandFilter === "All Stands" ? "default" : "outline"}
          className="h-7 text-[11px] font-bold px-3 py-1"
        >
          All Stands ({channels.length})
        </Button>
        {stands.map((st) => {
          const count = channels.filter((c) => c.stand === st).length;
          return (
            <Button
              key={st}
              onClick={() => setSelectedStandFilter(st)}
              variant={selectedStandFilter === st ? "default" : "outline"}
              className="h-7 text-[11px] font-bold px-3 py-1"
            >
              📍 {st} ({count})
            </Button>
          );
        })}
      </div>

      {/* Main Grouped rack views */}
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
        <div className="space-y-8">
          {Object.keys(groupedLayout).sort((a, b) => {
            if (a.startsWith("Unassigned")) return 1;
            if (b.startsWith("Unassigned")) return -1;
            return a.localeCompare(b);
          }).map((standKey) => {
            const levelsObj = groupedLayout[standKey];
            const levelKeys = Object.keys(levelsObj).sort((a, b) => {
              if (a.startsWith("Unassigned")) return 1;
              if (b.startsWith("Unassigned")) return -1;
              return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            });

            return (
              <div key={standKey} className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="font-bold text-sm text-foreground flex items-center gap-2">
                    📍 {standKey} Layout Rack
                  </span>
                  <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary">
                    {Object.values(levelsObj).flat().length} Gullies Mapped
                  </Badge>
                </div>

                <div className="space-y-6">
                  {levelKeys.map((levelKey) => {
                    const sortedChans = [...levelsObj[levelKey]].sort((a, b) => (a.channelIndex ?? 0) - (b.channelIndex ?? 0));

                    return (
                      <div key={levelKey} className="space-y-3 pl-2 border-l border-muted">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{levelKey}</span>
                          <div className="flex-1 h-px bg-border/40" />
                        </div>

                        {viewMode === "grid" ? (
                          <div className="flex flex-wrap gap-3 pt-1">
                            {sortedChans.map((chan) => {
                              const isGrowing = chan.status === "growing";
                              const cap = chan.capacity ?? 50;
                              const count = chan.currentCount ?? 0;

                              return (
                                <Button
                                  key={chan.id}
                                  type="button"
                                  onClick={() => handleOpenLogs(chan)}
                                  variant="outline"
                                  className={`h-auto py-2.5 px-4 rounded-xl flex flex-col items-start gap-1 text-left border transition-all ${
                                    isGrowing
                                      ? "bg-green-500/5 hover:bg-green-500/10 border-green-500/20 hover:border-green-500/40 text-foreground"
                                      : "bg-muted/10 hover:bg-muted/20 border-border/80 text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 font-bold text-xs">
                                    {isGrowing ? (
                                      <Sprout className="h-3.5 w-3.5 text-green-600 dark:text-green-400 animate-pulse" />
                                    ) : (
                                      <div className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                                    )}
                                    <span>Ch {chan.channelIndex ?? 1}: {chan.name}</span>
                                  </div>
                                  <div className="text-[10px] font-semibold text-muted-foreground">
                                    {isGrowing ? (
                                      <span className="text-green-700 dark:text-green-400 font-bold">
                                        🌱 {chan.cropName} ({count}/{cap})
                                      </span>
                                    ) : (
                                      <span>Vacant ({cap} cap)</span>
                                    )}
                                  </div>
                                </Button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {sortedChans.map((chan) => {
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
                                        <div className="flex flex-col gap-0.5">
                                          <span className="text-sm font-bold text-foreground">{chan.name}</span>
                                          {chan.stand && chan.level && (
                                            <span className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
                                              📍 {chan.stand} • {chan.level} • Ch {chan.channelIndex ?? 1}
                                            </span>
                                          )}
                                        </div>
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

                                      {chan.incidents && chan.incidents.length > 0 && (
                                        <div className="text-[10px] text-amber-600 dark:text-amber-400 border-t border-border/40 pt-1.5 space-y-1">
                                          <span className="font-bold flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Incidents & Adjustments:</span>
                                          <div className="max-h-20 overflow-y-auto space-y-1 pl-1">
                                            {chan.incidents.map((inc, i) => (
                                              <div key={i} className="leading-tight">
                                                • <span className="font-semibold">{new Date(inc.timestamp).toLocaleDateString()}:</span> {inc.description}
                                              </div>
                                            ))}
                                          </div>
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
                                      <Button
                                        onClick={() => handleOpenLogs(chan)}
                                        variant="ghost"
                                        size="icon"
                                        className="text-blue-500 hover:text-blue-600 hover:bg-blue-500/10 h-8 w-8"
                                        title="View Gully Seeding & Logs History"
                                      >
                                        <History className="h-4 w-4" />
                                      </Button>
                                      {chan.status === "growing" && (
                                        <Button
                                          onClick={() => {
                                            setActiveChannelId(chan.id);
                                            setIncidentType("incident");
                                            setIncidentDesc("");
                                            setIncidentQty(1);
                                            setIncidentCultivar(chan.crops && chan.crops.length > 0 ? chan.crops[0].cropName : chan.cropName);
                                            setActionType("incident");
                                          }}
                                          variant="ghost"
                                          size="icon"
                                          className="text-amber-500 hover:text-amber-600 hover:bg-amber-500/10 h-8 w-8"
                                          title="Log Incident or Remove Plants"
                                        >
                                          <AlertTriangle className="h-4 w-4" />
                                        </Button>
                                      )}
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
                      </div>
                    );
                  })}
                </div>
              </div>
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
                {actionType === "incident" && "Log Incident / Thin Plants"}
                {actionType === "logs" && "Gully Seeding & Logs Timeline"}
                {actionType === "transfer" && "Ship / Transfer Plants"}
              </span>
              <span className="text-xs text-muted-foreground block mt-0.5">
                {actionType === "plant" && "Configure cultivars and counts for this multi-crop batch."}
                {actionType === "harvest" && "Reset channel and log yield database metrics."}
                {actionType === "add-channel" && "Create a new physical NFT re-use location."}
                {actionType === "edit-channel" && "Modify details of this crop channel."}
                {actionType === "incident" && "Record pest/disease problems or log plant removals."}
                {actionType === "logs" && "Historical batch records and event tracking log for this channel location."}
                {actionType === "transfer" && "Deduct crop quantities from this gully and shift them directly to a target gully."}
              </span>
            </div>

            <div className="space-y-3">
              {(actionType === "add-channel" || actionType === "edit-channel") && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="chan-name" className="text-xs font-semibold">Channel Label / Name</Label>
                    <Input
                      id="chan-name"
                      placeholder="e.g. Channel B4"
                      value={channelName}
                      onChange={(e) => setChannelName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="chan-stand" className="text-xs font-semibold">Stand / Rack</Label>
                      <Input
                        id="chan-stand"
                        placeholder="e.g. Stand A"
                        value={stand}
                        onChange={(e) => setStand(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="chan-level" className="text-xs font-semibold">Level / Tier</Label>
                      <Input
                        id="chan-level"
                        placeholder="e.g. Level 1"
                        value={level}
                        onChange={(e) => setLevel(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="chan-index" className="text-xs font-semibold">Index Pos</Label>
                      <Input
                        id="chan-index"
                        type="number"
                        placeholder="1"
                        value={channelIndex}
                        onChange={(e) => { const v = e.target.value; setChannelIndex(v === "" ? "" as any : Number(v)); }}
                        className="text-xs"
                      />
                    </div>
                  </div>
                </>
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
                        onChange={(e) => { const v = e.target.value; setCapacity(v === "" ? "" as any : Number(v)); }}
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
                    onChange={(e) => { const v = e.target.value; setCapacity(v === "" ? "" as any : Number(v)); }}
                  />
                </div>
              )}

              {actionType === "harvest" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="yield-qty" className="text-xs font-semibold">Usable Yield (Plants)</Label>
                      <Input
                        id="yield-qty"
                        type="number"
                        min={0}
                        value={yieldQty}
                        onChange={(e) => { const v = e.target.value; setYieldQty(v === "" ? "" as any : Number(v)); }}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="waste-qty" className="text-xs font-semibold">Waste / Defective (Plants)</Label>
                      <Input
                        id="waste-qty"
                        type="number"
                        min={0}
                        value={wasteQty}
                        onChange={(e) => { const v = e.target.value; setWasteQty(v === "" ? "" as any : Number(v)); }}
                        className="text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="weight-g" className="text-xs font-semibold">Avg Weight per Plant (Grams)</Label>
                    <Input
                      id="weight-g"
                      type="number"
                      min={0}
                      value={avgWeightGrams}
                      onChange={(e) => { const v = e.target.value; setAvgWeightGrams(v === "" ? "" as any : Number(v)); }}
                      placeholder="e.g. 180"
                      className="text-xs"
                    />
                  </div>
                </>
              )}

              {actionType === "incident" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="inc-type" className="text-xs font-semibold">Action Type</Label>
                    <Select value={incidentType} onValueChange={(val: any) => setIncidentType(val)}>
                      <SelectTrigger id="inc-type" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="incident">Log Crop Issue (Pests/Disease)</SelectItem>
                        <SelectItem value="removal">Remove/Thin Plants</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {incidentType === "removal" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="inc-cultivar" className="text-xs font-semibold">Cultivar</Label>
                        <Input
                          id="inc-cultivar"
                          placeholder="e.g. Romaine"
                          value={incidentCultivar}
                          onChange={(e) => setIncidentCultivar(e.target.value)}
                          className="text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="inc-qty" className="text-xs font-semibold">Qty to Remove</Label>
                        <Input
                          id="inc-qty"
                          type="number"
                          min={1}
                          value={incidentQty}
                          onChange={(e) => { const v = e.target.value; setIncidentQty(v === "" ? "" as any : Number(v)); }}
                          className="text-xs"
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="inc-desc" className="text-xs font-semibold">
                      {incidentType === "removal" ? "Reason for removal" : "Incident description"}
                    </Label>
                    <Input
                      id="inc-desc"
                      placeholder={incidentType === "removal" ? "e.g. Root rot, stunted growth" : "e.g. Aphids detected on lower leaves"}
                      value={incidentDesc}
                      onChange={(e) => setIncidentDesc(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </>
              )}

              {actionType === "transfer" && (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="transfer-scan-qr" className="text-xs font-semibold">Scan / Enter Target Channel QR</Label>
                      <Button
                        type="button"
                        onClick={() => setShowCameraScanner(!showCameraScanner)}
                        variant="outline"
                        className="h-6 text-[10px] font-bold px-2 py-0 border-primary/45 text-primary hover:bg-primary/5 flex items-center gap-1"
                      >
                        📷 {showCameraScanner ? "Close Camera" : "Scan via Camera"}
                      </Button>
                    </div>
                    {showCameraScanner && (
                      <div className="py-2">
                        <CameraQrScanner
                          onScanSuccess={(val) => {
                            setTransferScanQr(val);
                            const matched = channels.find((c) => 
                              c.id.toLowerCase() === val.trim().toLowerCase() ||
                              (c.qrCode && c.qrCode.toLowerCase() === val.trim().toLowerCase()) ||
                              c.name.toLowerCase() === val.trim().toLowerCase() ||
                              (c.stand && c.level && `${c.stand}-${c.level}-Ch ${c.channelIndex}`.toLowerCase() === val.trim().toLowerCase())
                            );
                            if (matched) {
                              setTransferTargetId(matched.id);
                              toast.success(`Matched Target Gully: ${matched.name}!`);
                            } else {
                              toast.warning(`Scanned: "${val}", but no matching channel found.`);
                            }
                            setShowCameraScanner(false);
                          }}
                          onClose={() => setShowCameraScanner(false)}
                        />
                      </div>
                    )}
                    <Input
                      id="transfer-scan-qr"
                      placeholder="Type or scan target QR e.g. Stand A-Level 1-Ch 2"
                      value={transferScanQr}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTransferScanQr(val);
                        const matched = channels.find((c) => 
                          c.id.toLowerCase() === val.trim().toLowerCase() ||
                          (c.qrCode && c.qrCode.toLowerCase() === val.trim().toLowerCase()) ||
                          c.name.toLowerCase() === val.trim().toLowerCase() ||
                          (c.stand && c.level && `${c.stand}-${c.level}-Ch ${c.channelIndex}`.toLowerCase() === val.trim().toLowerCase())
                        );
                        if (matched) {
                          setTransferTargetId(matched.id);
                          toast.success(`Matched Target Gully: ${matched.name}!`);
                        }
                      }}
                      className="text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="transfer-target" className="text-xs font-semibold">Select Destination Channel</Label>
                    <Select value={transferTargetId} onValueChange={(val) => setTransferTargetId(val)}>
                      <SelectTrigger id="transfer-target" className="h-9 text-xs"><SelectValue placeholder="Select destination..." /></SelectTrigger>
                      <SelectContent>
                        {channels.filter((c) => c.id !== activeChannelId).map((chan) => (
                          <SelectItem key={chan.id} value={chan.id}>
                            {chan.name} {chan.stand ? `(${chan.stand}-${chan.level})` : ""} - {chan.status === "growing" ? `Active: ${chan.cropName}` : "Vacant"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(() => {
                    const sourceChan = channels.find((c) => c.id === activeChannelId);
                    const availableCrops = sourceChan?.crops && sourceChan.crops.length > 0
                      ? sourceChan.crops
                      : sourceChan?.cropName ? [{ cropName: sourceChan.cropName, count: sourceChan.currentCount || 0 }] : [];

                    return (
                      <>
                        <div className="space-y-1">
                          <Label htmlFor="transfer-cultivar" className="text-xs font-semibold">Cultivar to Ship</Label>
                          <Select value={transferCultivar} onValueChange={(val) => setTransferCultivar(val)}>
                            <SelectTrigger id="transfer-cultivar" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {availableCrops.map((c, idx) => (
                                <SelectItem key={idx} value={c.cropName}>
                                  {c.cropName} ({c.count} plants)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="transfer-count" className="text-xs font-semibold">Quantity to Ship</Label>
                          <Input
                            id="transfer-count"
                            type="number"
                            min={1}
                            max={availableCrops.find((c) => c.cropName === transferCultivar)?.count || 50}
                            value={transferCount}
                            onChange={(e) => { const v = e.target.value; setTransferCount(v === "" ? "" as any : Number(v)); }}
                            className="text-xs"
                          />
                        </div>
                      </>
                    );
                  })()}
                </>
              )}

              {actionType === "logs" && selectedChannelLogs && (
                <div className="space-y-4 font-sans text-xs">
                  {/* Quick Operations Console */}
                  <div className="space-y-1.5 p-3 rounded-lg border bg-blue-500/5 border-blue-500/20">
                    <span className="font-bold text-foreground text-[10px] uppercase block tracking-wider">Quick Operations Console</span>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {selectedChannelLogs.status === "growing" ? (
                        <>
                          <Button
                            onClick={() => {
                              setActiveChannelId(selectedChannelLogs.id);
                              setNotes(selectedChannelLogs.notes || "");
                              setActionType("harvest");
                            }}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold text-[10px] px-2.5 h-7 py-0.5 rounded shadow-sm"
                          >
                            Complete Harvest
                          </Button>
                          <Button
                            onClick={() => {
                              setActiveChannelId(selectedChannelLogs.id);
                              setIncidentType("incident");
                              setIncidentDesc("");
                              setIncidentQty(1);
                              setIncidentCultivar(selectedChannelLogs.crops && selectedChannelLogs.crops.length > 0 ? selectedChannelLogs.crops[0].cropName : selectedChannelLogs.cropName);
                              setActionType("incident");
                            }}
                            variant="outline"
                            className="text-amber-600 border-amber-500/30 hover:bg-amber-500/10 font-semibold text-[10px] px-2.5 h-7 py-0.5 rounded shadow-sm"
                          >
                            Log Incident/Thin
                          </Button>
                          <Button
                            onClick={() => {
                              setActiveChannelId(selectedChannelLogs.id);
                              setTransferTargetId("");
                              setTransferCount(Math.min(5, selectedChannelLogs.currentCount || 5));
                              setTransferCultivar(selectedChannelLogs.crops && selectedChannelLogs.crops.length > 0 ? selectedChannelLogs.crops[0].cropName : selectedChannelLogs.cropName);
                              setTransferScanQr("");
                              setActionType("transfer");
                            }}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] px-2.5 h-7 py-0.5 rounded shadow-sm"
                          >
                            Ship/Transfer
                          </Button>
                        </>
                      ) : (
                        <Button
                          onClick={() => handleOpenPlant(selectedChannelLogs)}
                          className="bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-[10px] px-2.5 h-7 py-0.5 rounded shadow-sm"
                        >
                          Plant Crop Batch
                        </Button>
                      )}
                      <Button
                        onClick={() => handleOpenEdit(selectedChannelLogs)}
                        variant="outline"
                        className="text-[10px] font-semibold px-2.5 h-7 py-0.5"
                      >
                        Edit Settings
                      </Button>
                      <Button
                        onClick={() => {
                          if (confirm("Are you sure you want to delete this channel?")) {
                            handleDeleteChannel(selectedChannelLogs.id);
                            closeForm();
                          }
                        }}
                        variant="ghost"
                        className="text-red-500 hover:text-red-600 hover:bg-red-500/10 text-[10px] font-semibold px-2.5 h-7 py-0.5"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  {/* Current Active Status */}
                  <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                    <span className="font-bold text-foreground block border-b pb-1">Current Active Batch</span>
                    {selectedChannelLogs.status === "growing" ? (
                      <div className="space-y-1">
                        <div className="flex justify-between font-semibold">
                          <span>Cultivar(s):</span>
                          <span>{selectedChannelLogs.cropName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Planted On:</span>
                          <span>{selectedChannelLogs.plantedAt ? new Date(selectedChannelLogs.plantedAt).toLocaleDateString() : "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Capacity Load:</span>
                          <span>{selectedChannelLogs.currentCount} / {selectedChannelLogs.capacity} Plants</span>
                        </div>
                        {selectedChannelLogs.notes && (
                          <div className="text-[10px] text-muted-foreground italic bg-background p-1.5 rounded mt-1">
                            Notes: {selectedChannelLogs.notes}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic block">Channel is currently vacant.</span>
                    )}
                  </div>

                  {/* Incident Logs Timeline */}
                  <div className="space-y-2">
                    <span className="font-bold text-foreground block border-b pb-1">Event Logs & Incident Timeline</span>
                    {selectedChannelLogs.incidents && selectedChannelLogs.incidents.length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {selectedChannelLogs.incidents.map((inc, i) => (
                          <div key={i} className="pl-3 border-l-2 border-amber-500 py-0.5 space-y-0.5">
                            <span className="text-[9px] text-muted-foreground block font-mono">
                              {new Date(inc.timestamp).toLocaleString()}
                            </span>
                            <p className="text-[11px] leading-tight text-foreground">{inc.description}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic text-[11px] block">No incident events logged in this cycle.</span>
                    )}
                  </div>

                  {/* Past Harvest History */}
                  <div className="space-y-2">
                    <span className="font-bold text-foreground block border-b pb-1">Completed Yield Harvest Audits</span>
                    {channelHarvestHistory.length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {channelHarvestHistory.map((item) => (
                          <div key={item.id} className="pl-3 border-l-2 border-green-500 py-0.5 space-y-1">
                            <div className="flex justify-between items-center text-[10px] font-bold text-foreground">
                              <span>{item.cropName}</span>
                              <span className="text-green-600">Yield: {item.yieldQty ?? item.currentCount}</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground flex justify-between">
                              <span>Harvested: {new Date(item.harvestedAt).toLocaleDateString()}</span>
                              {item.wasteQty !== undefined && item.wasteQty > 0 && <span>Waste: {item.wasteQty}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic text-[11px] block">No completed harvests recorded for this channel location.</span>
                    )}
                  </div>
                </div>
              )}

              {actionType !== "add-channel" && actionType !== "incident" && actionType !== "logs" && actionType !== "transfer" && (
                <div className="space-y-1">
                  <Label htmlFor="notes" className="text-xs font-semibold">Notes / History logs</Label>
                  <Input
                    id="notes"
                    placeholder="e.g. EC level used, tray origin..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
              <Button onClick={closeForm} variant="outline" className="text-xs font-semibold px-4 h-9">
                {actionType === "logs" ? "Close" : "Cancel"}
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
              {actionType === "incident" && (
                <Button onClick={handleIncidentSubmit} className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-4 h-9">
                  {incidentType === "removal" ? "Confirm Removal" : "Log Issue"}
                </Button>
              )}
              {actionType === "transfer" && (
                <Button onClick={handleTransferSubmit} className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 h-9">
                  Confirm Shipment
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
