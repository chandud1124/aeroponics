import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { QrCode, Sprout, ShoppingBag, Plus, Sparkles, Clipboard, Trash2, Edit3, Calendar, FileText, BarChart3, AlertTriangle, AlertCircle, History, Search, RotateCcw } from "lucide-react";
import { CameraQrScanner } from "@/components/tower/CameraQrScanner";
import {
  fetchNftChannels,
  saveNftChannels,
  plantCropRemote,
  harvestCropRemote,
  fetchHarvestHistory,
  saveHarvestHistoryRemote,
  appendCropLifecycleEvent,
  fetchCropLifecycleEvents,
  fetchNurseryStore,
  saveNurseryStore,
  type NftChannel,
  type NftCropEntry,
} from "@/lib/tower-storage";
import type { CropConfig, HolePlantRecord } from "@/lib/tower-shared";
import type { CropLifecycleEvent } from "@/lib/tower-shared";

const SUGGESTED_CROPS_LIST = [
  "Green Lettuce",
  "Red Lettuce",
  "Butterhead Lettuce",
  "Lollo Bionda",
  "Romaine Lettuce",
  "Pak Choi",
  "Kale",
  "Swiss Chard",
  "Rocket / Arugula",
  "Spinach",
  "Coriander",
  "Basil",
  "Amaranth",
  "Capsicum Yellow",
  "Capsicum Red",
  "Capsicum Green",
  "Cherry Tomato Yellow",
  "Cherry Tomato Red"
];

const CROP_COLOR_PALETTE = [
  { bg: "bg-emerald-500/10 dark:bg-emerald-500/25", border: "border-emerald-500", text: "text-emerald-800 dark:text-emerald-200", dot: "bg-emerald-500" },
  { bg: "bg-sky-500/10 dark:bg-sky-500/25", border: "border-sky-500", text: "text-sky-800 dark:text-sky-200", dot: "bg-sky-500" },
  { bg: "bg-amber-500/10 dark:bg-amber-500/25", border: "border-amber-500", text: "text-amber-800 dark:text-amber-200", dot: "bg-amber-500" },
  { bg: "bg-purple-500/10 dark:bg-purple-500/25", border: "border-purple-500", text: "text-purple-800 dark:text-purple-200", dot: "bg-purple-500" },
  { bg: "bg-rose-500/10 dark:bg-rose-500/25", border: "border-rose-500", text: "text-rose-800 dark:text-rose-200", dot: "bg-rose-500" },
  { bg: "bg-teal-500/10 dark:bg-teal-500/25", border: "border-teal-500", text: "text-teal-800 dark:text-teal-200", dot: "bg-teal-500" },
  { bg: "bg-orange-500/10 dark:bg-orange-500/25", border: "border-orange-500", text: "text-orange-800 dark:text-orange-200", dot: "bg-orange-500" },
  { bg: "bg-fuchsia-500/10 dark:bg-fuchsia-500/25", border: "border-fuchsia-500", text: "text-fuchsia-800 dark:text-fuchsia-200", dot: "bg-fuchsia-500" },
];

function getCropStyle(cropName: string, active: boolean, cropConfigs: CropConfig[]) {
  if (!cropName || !active) {
    return {
      bg: "bg-muted/10 hover:bg-muted/20 border-border/80 text-muted-foreground",
      border: "border border-dashed border-muted-foreground/30",
      dot: "bg-transparent",
      text: "text-muted-foreground"
    };
  }

  const nameKey = cropName.trim();
  let color = CROP_COLOR_PALETTE[0];
  let found = false;

  try {
      const config = cropConfigs.find((c) => c.name.toLowerCase() === nameKey.toLowerCase());
      if (config) {
        const keyMap: { [key: string]: number } = {
          emerald: 0,
          sky: 1,
          amber: 2,
          purple: 3,
          rose: 4,
          teal: 5,
          orange: 6,
          fuchsia: 7
        };
        const idx = keyMap[config.colorKey];
        if (idx !== undefined) {
          color = CROP_COLOR_PALETTE[idx];
          found = true;
        }
      }
  } catch (e) {
    // Ignore and fallback
  }

  if (!found) {
    let hash = 0;
    for (let i = 0; i < nameKey.length; i++) {
      hash = nameKey.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % CROP_COLOR_PALETTE.length;
    color = CROP_COLOR_PALETTE[index];
  }

  return {
    bg: color.bg,
    border: `border-2 ${color.border}`,
    dot: color.dot,
    text: color.text
  };
}

function channelLocation(channel: NftChannel) {
  return {
    polyhouse: channel.polyhouse,
    block: channel.block,
    row: channel.row,
    stand: channel.stand,
    level: channel.level,
    channelIndex: channel.channelIndex,
    holeConfig: channel.holeConfig,
  };
}

export function NftChannelsTab({ initialChannelId, cropConfigs = [] }: { initialChannelId?: string | null; cropConfigs?: CropConfig[] } = {}) {
  const [channels, setChannels] = useState<NftChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "cards">("grid");

  // Advanced Filters State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPolyhouse, setSelectedPolyhouse] = useState("all");
  const [selectedBlock, setSelectedBlock] = useState("all");
  const [selectedLevel, setSelectedLevel] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  // Forms states
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"plant" | "harvest" | "add-channel" | "edit-channel" | "incident" | "logs" | "transfer" | "edit-planted-crops" | "re-shift" | null>(null);
  
  const [channelName, setChannelName] = useState("");
  const [cropName, setCropName] = useState("");
  const [capacity, setCapacity] = useState<number>(50);
  const [currentCount, setCurrentCount] = useState<number>(40);
  const [plantedAt, setPlantedAt] = useState("");
  const [expectedHarvestISO, setExpectedHarvestISO] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedNurseryTrayId, setSelectedNurseryTrayId] = useState<string | null>(null);
  
  // Coordinate locations
  const [stand, setStand] = useState("");
  const [level, setLevel] = useState("");
  const [channelIndex, setChannelIndex] = useState<number>(1);
  const [polyhouse, setPolyhouse] = useState("PH01");
  const [block, setBlock] = useState("B01");
  const [row, setRow] = useState("R01");
  const [holeConfig, setHoleConfig] = useState("HA01");

  // Harvest Audit states
  const [yieldQty, setYieldQty] = useState<number>(0);
  const [wasteQty, setWasteQty] = useState<number>(0);
  const [avgWeightGrams, setAvgWeightGrams] = useState<number>(0);
  const [harvestCultivar, setHarvestCultivar] = useState("");

  // Incident Adjustments states
  const [incidentType, setIncidentType] = useState<"incident" | "removal">("incident");
  const [incidentDesc, setIncidentDesc] = useState("");
  const [incidentQty, setIncidentQty] = useState<number>(1);
  const [incidentCultivar, setIncidentCultivar] = useState("");

  // Logs states
  const [selectedChannelLogs, setSelectedChannelLogs] = useState<NftChannel | null>(null);
  const [channelHarvestHistory, setChannelHarvestHistory] = useState<any[]>([]);
  const [recentTransfers, setRecentTransfers] = useState<CropLifecycleEvent[]>([]);
  const [recentHarvests, setRecentHarvests] = useState<any[]>([]);

  // Harvest undo/re-shift states
  const [reshiftTargetId, setReshiftTargetId] = useState("");
  const [reshiftNotes, setReshiftNotes] = useState("");
  const [showReshiftForm, setShowReshiftForm] = useState(false);
  const [selectedHarvestToReshifted, setSelectedHarvestToReshifted] = useState<any>(null);

  // Multi-crop list editing
  const [cropsList, setCropsList] = useState<NftCropEntry[]>([{ cropName: "", count: 20 }]);

  // Transfer / Shipping states
  const [transferTargetId, setTransferTargetId] = useState("");
  const [transferCount, setTransferCount] = useState<number>(5);
  const [transferCultivar, setTransferCultivar] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [transferScanQr, setTransferScanQr] = useState("");
  const [showCameraScanner, setShowCameraScanner] = useState(false);

  // Hole-range planting state
  const [usesHoleRanges, setUsesHoleRanges] = useState(false);
  const [holeRanges, setHoleRanges] = useState<Array<{
    startHole: number;
    endHole: number;
    cropName: string;
    plantDate: string;
    expectedHarvestDate: string;
    sourceNurseryTrayId?: string | null;
  }>>([]);
  const [originalHoles, setOriginalHoles] = useState<Array<{ holeId: number; cropName: string; plantedAt: string; expectedHarvestAt: string | null; count: number; sourceNurseryTrayId: string | null }> | null>(null);
  const [nurseryTrays, setNurseryTrays] = useState<any[]>([]);

  // Hole-range harvest state
  const [selectedHolesToHarvest, setSelectedHolesToHarvest] = useState<Set<number>>(new Set());

  // Re-shift state (for multi-hole management)
  const [reshiftSourceHoles, setReshiftSourceHoles] = useState({ start: 1, end: 5 });
  const [reshiftDestHoles, setReshiftDestHoles] = useState({ start: 6, end: 10 });
  const [reshiftNewCrop, setReshiftNewCrop] = useState("");
  const [reshiftNewDate, setReshiftNewDate] = useState("");
  const [reshiftSourceTray, setReshiftSourceTray] = useState("");

  const loadData = () => {
    setLoading(true);
    Promise.all([
      fetchNftChannels(),
      fetchCropLifecycleEvents(),
      fetchHarvestHistory(),
      fetchNurseryStore()
    ])
      .then(([data, events, harvests, nurseryStore]) => {
        // Sort channels by polyhouse, block, row, level, then channelIndex
        const sorted = [...data].sort((a, b) => {
          const phA = a.polyhouse || "";
          const phB = b.polyhouse || "";
          if (phA !== phB) return phA.localeCompare(phB);

          const blkA = a.block || "";
          const blkB = b.block || "";
          if (blkA !== blkB) return blkA.localeCompare(blkB);

          const rowA = a.row || "";
          const rowB = b.row || "";
          if (rowA !== rowB) return rowA.localeCompare(rowB);
          
          const levelA = a.level || "";
          const levelB = b.level || "";
          if (levelA !== levelB) return levelA.localeCompare(levelB);
          
          return (a.channelIndex ?? 0) - (b.channelIndex ?? 0);
        });
        setChannels(sorted);

        // Load nursery trays
        setNurseryTrays(nurseryStore?.trays || []);

        // Filter for recent transfers (last 20)
        const transfers = events
          .filter((e) => e.type === "transferred")
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 20);
        setRecentTransfers(transfers);

        // Sort harvests by date descending and keep last 20, excluding undo/reversal rows
        const sortedHarvests = Array.from(
          new Map(
            [...harvests]
              .filter((harvest) => !isUndoHarvestRecord(harvest))
              .map((harvest) => [getHarvestFingerprint(harvest), harvest])
          ).values()
        )
          .sort((a, b) => new Date(b.harvestedAt).getTime() - new Date(a.harvestedAt).getTime())
          .slice(0, 20);
        setRecentHarvests(sortedHarvests);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddCropRow = () => {
    const currentSum = cropsList.reduce((sum, c) => sum + (c.count || 0), 0);
    const remaining = Math.max(0, capacity - currentSum);
    setCropsList([...cropsList, { cropName: "", count: remaining }]);
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

  const validateHoleRanges = (): boolean => {
    if (holeRanges.length === 0) {
      toast.error("At least one hole range must be defined");
      return false;
    }

    for (const range of holeRanges) {
      if (!range.cropName.trim()) {
        toast.error("All hole ranges must have a crop name");
        return false;
      }
      if (range.startHole < 1 || range.endHole < 1 || range.startHole > range.endHole) {
        toast.error("Hole ranges must have valid start and end holes (start ≤ end)");
        return false;
      }
    }

    // Check for overlaps
    for (let i = 0; i < holeRanges.length; i++) {
      for (let j = i + 1; j < holeRanges.length; j++) {
        const r1 = holeRanges[i];
        const r2 = holeRanges[j];
        // Check overlap: NOT (r1.end < r2.start OR r2.end < r1.start)
        if (!(r1.endHole < r2.startHole || r2.endHole < r1.startHole)) {
          toast.error(`Hole ranges overlap: ${r1.startHole}-${r1.endHole} and ${r2.startHole}-${r2.endHole}`);
          return false;
        }
      }
    }

    return true;
  };

  const handleAddHoleRange = () => {
    setHoleRanges([...holeRanges, {
      startHole: 1,
      endHole: 5,
      cropName: "",
      plantDate: plantedAt,
      expectedHarvestDate: expectedHarvestISO || "",
    }]);
  };

  const handleRemoveHoleRange = (index: number) => {
    setHoleRanges(holeRanges.filter((_, idx) => idx !== index));
  };

  const handleHoleRangeChange = (
    index: number,
    field: "startHole" | "endHole" | "cropName" | "plantDate" | "expectedHarvestDate" | "sourceNurseryTrayId",
    value: any
  ) => {
    setHoleRanges(
      holeRanges.map((r, idx) => {
        if (idx === index) {
          return {
            ...r,
            [field]: field.includes("Hole") ? Number(value) : value,
          };
        }
        return r;
      })
    );
  };

  const isUndoHarvestRecord = (harvestEntry: any): boolean => {
    const note = String(harvestEntry?.notes || "").toLowerCase();
    return note.includes("undo harvest") || note.includes("restored ") || note.includes("restored to") || note.includes("reversed harvest");
  };

  const getHarvestFingerprint = (harvestEntry: any): string => {
    const harvestedAt = String(harvestEntry?.harvestedAt || "");
    const cropName = String(harvestEntry?.cropName || "").trim();
    const yieldQty = Number(harvestEntry?.yieldQty ?? harvestEntry?.currentCount ?? 0);
    const wasteQty = Number(harvestEntry?.wasteQty ?? 0);
    return `${harvestedAt}|${cropName}|${yieldQty}|${wasteQty}`;
  };

  const isUndoAvailable = (harvestEntry: any): boolean => {
    if (!harvestEntry) return false;
    if (isUndoHarvestRecord(harvestEntry)) return false;
    if (!harvestEntry.undoableUntil) return true; // Legacy entries without timestamp can still be undone
    return Date.now() < harvestEntry.undoableUntil;
  };

  // Calculate days since planting for a hole range
  const getDaysSincePlanting = (plantedAtISO: string | null): number => {
    if (!plantedAtISO) return 0;
    const diff = Date.now() - new Date(plantedAtISO).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  // Calculate days remaining until harvest for a hole range
  const getDaysUntilHarvest = (expectedHarvestISO: string | null): number | null => {
    if (!expectedHarvestISO) return null;
    const diff = new Date(expectedHarvestISO).getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0; // 0 means ready now
  };

  // Get status of a hole range (ready, growing, etc)
  const getHoleRangeStatus = (hole: HolePlantRecord): { status: "ready" | "growing"; daysRemaining: number | null } => {
    const daysRemaining = getDaysUntilHarvest(hole.expectedHarvestAt);
    if (daysRemaining === null) {
      // If no expected harvest, check if 30+ days have passed (default maturity)
      const daysPassed = getDaysSincePlanting(hole.plantedAt);
      return { status: daysPassed >= 30 ? "ready" : "growing", daysRemaining: null };
    }
    return {
      status: daysRemaining === 0 ? "ready" : "growing",
      daysRemaining
    };
  };

  // Convert Multi-Crop data to Hole-Range format (preserves tray info if available)
  const convertMultiCropToHoleRanges = (): Array<{
    startHole: number;
    endHole: number;
    cropName: string;
    plantDate: string;
    expectedHarvestDate: string;
    sourceNurseryTrayId: string | null;
  }> => {
    // If original holes exist, convert them back to ranges (preserves sourceNurseryTrayId)
    if (originalHoles && originalHoles.length > 0) {
      const ranges: Array<{
        startHole: number;
        endHole: number;
        cropName: string;
        plantDate: string;
        expectedHarvestDate: string;
        sourceNurseryTrayId: string | null;
      }> = [];
      let i = 0;
      while (i < originalHoles.length) {
        const startHole = originalHoles[i].holeId;
        const cropName = originalHoles[i].cropName;
        const plantDate = originalHoles[i].plantedAt.split("T")[0];
        const expectedHarvestDate = originalHoles[i].expectedHarvestAt?.split("T")[0] || "";
        const sourceNurseryTrayId = originalHoles[i].sourceNurseryTrayId;
        
        let endHole = startHole;
        let j = i + 1;
        // Group consecutive holes with same crop and date
        while (j < originalHoles.length && 
               originalHoles[j].cropName === cropName &&
               originalHoles[j].plantedAt === originalHoles[i].plantedAt &&
               originalHoles[j].holeId === endHole + 1) {
          endHole = originalHoles[j].holeId;
          j++;
        }
        
        ranges.push({ startHole, endHole, cropName, plantDate, expectedHarvestDate, sourceNurseryTrayId });
        i = j;
      }
      return ranges;
    }
    
    // Otherwise, convert from multi-crop crops list (no tray info available)
    const ranges: Array<{
      startHole: number;
      endHole: number;
      cropName: string;
      plantDate: string;
      expectedHarvestDate: string;
      sourceNurseryTrayId: string | null;
    }> = [];
    let currentHole = 1;

    for (const crop of cropsList) {
      const count = Number(crop.count || 0);
      if (count > 0) {
        ranges.push({
          startHole: currentHole,
          endHole: currentHole + count - 1,
          cropName: crop.cropName,
          plantDate: plantedAt,
          expectedHarvestDate: expectedHarvestISO || "",
          sourceNurseryTrayId: selectedNurseryTrayId || null,
        });
        currentHole += count;
      }
    }
    return ranges;
  };

  // Convert Hole-Range data to Multi-Crop format
  const convertHoleRangesToMultiCrop = (): Array<{ cropName: string; count: string }> => {
    const cropMap = new Map<string, number>();
    
    for (const range of holeRanges) {
      const count = range.endHole - range.startHole + 1;
      const current = cropMap.get(range.cropName) || 0;
      cropMap.set(range.cropName, current + count);
    }
    
    return Array.from(cropMap.entries()).map(([cropName, count]) => ({
      cropName,
      count: String(count)
    }));
  };

  // Handle harvest of specific hole ranges
  const handleHarvestHoleRanges = async () => {
    if (!activeChannelId) return;
    try {
      const activeChan = channels.find(c => c.id === activeChannelId);
      if (!activeChan || !activeChan.holes || activeChan.holes.length === 0) {
        toast.error("No hole-range planting data found for this channel.");
        return;
      }

      if (selectedHolesToHarvest.size === 0) {
        toast.error("Please select at least one hole range to harvest.");
        return;
      }

      // Get holes to harvest
      const holesToHarvest = activeChan.holes.filter(h => selectedHolesToHarvest.has(h.holeId));
      if (holesToHarvest.length === 0) {
        toast.error("No holes selected for harvest.");
        return;
      }

      const harvestCount = holesToHarvest.length;
      const totalHarvested = yieldQty + wasteQty;

      if (totalHarvested !== harvestCount) {
        toast.warning(`Selected ${harvestCount} holes, but harvest quantity is ${totalHarvested}. Adjusting to ${harvestCount}.`);
      }

      // Update channel - remove harvested holes, keep others
      const remainingHoles = activeChan.holes.filter(h => !selectedHolesToHarvest.has(h.holeId));
      const harvestedCrops = holesToHarvest.map(h => h.cropName).filter((c, i, arr) => arr.indexOf(c) === i);
      
      const updatedChan: NftChannel = {
        ...activeChan,
        holes: remainingHoles.length > 0 ? remainingHoles : undefined,
        currentCount: remainingHoles.length,
        status: remainingHoles.length > 0 ? "growing" : "empty",
        harvestedAt: remainingHoles.length === 0 ? new Date().toISOString() : null,
        crops: remainingHoles.length > 0 
          ? remainingHoles.map(h => ({ cropName: h.cropName, count: 1 }))
            .reduce((acc: any[], cur) => {
              const existing = acc.find(c => c.cropName === cur.cropName);
              if (existing) existing.count++;
              else acc.push(cur);
              return acc;
            }, [])
          : []
      };

      const updatedList = channels.map((c) => c.id === activeChannelId ? updatedChan : c);
      await saveNftChannels(updatedList);

      // Save harvest history for undo capability (with nursery tray sync)
      try {
        const harvestHistory = await fetchHarvestHistory();
        const now = Date.now();
        
        // Create one harvest entry per hole for detailed undo tracking
        for (const hole of holesToHarvest) {
          const newEntry: HarvestHistoryEntry = {
            id: `harv-hole-${now}-${hole.holeId}`,
            channelId: activeChannelId,
            channelName: activeChan.name,
            cropName: hole.cropName,
            crops: [{ cropName: hole.cropName, count: 1 }],
            plantedAt: hole.plantedAt || null,
            harvestedAt: new Date().toISOString(),
            notes: notes || `Harvested hole ${hole.holeId}`,
            capacity: 1,
            currentCount: 1,
            yieldQty: 1,
            wasteQty: 0,
            avgWeightGrams: 0,
            undoableUntil: now + (24 * 60 * 60 * 1000),
            sourceNurseryTrayId: hole.sourceNurseryTrayId || null, // ← KEY: Store which nursery tray this came from
            holes: [hole], // Store full hole data for undo
          };
          harvestHistory.push(newEntry);
        }
        
        await saveHarvestHistoryRemote(harvestHistory);
      } catch (err: any) {
        console.warn("Failed to save harvest history for holes:", err);
        // Don't fail the harvest if history save fails
      }

      // Create lifecycle events
      for (const crop of harvestedCrops) {
        const cropHoleCount = holesToHarvest.filter(h => h.cropName === crop).length;
        await appendCropLifecycleEvent({
          id: `lifecycle-harvested-holes-${Date.now()}-${crop}`,
          type: "harvested",
          timestamp: new Date().toISOString(),
          cropName: crop,
          quantity: cropHoleCount,
          sourceId: activeChannelId,
          sourceName: activeChan.name,
          location: channelLocation(activeChan),
          notes: `Harvested ${cropHoleCount} holes (${holesToHarvest.map(h => h.holeId).join(",")}) of ${crop}`,
        });
      }

      toast.success(`Successfully harvested ${harvestCount} holes!`);
      setSelectedHolesToHarvest(new Set());
      loadData();
      closeForm();
    } catch (e: any) {
      toast.error(e.message || "Failed to harvest holes");
    }
  };

  // Handle re-shifting plants between hole ranges
  const handleReshiftPlants = async () => {
    if (!activeChannelId) return;
    try {
      const activeChan = channels.find(c => c.id === activeChannelId);
      if (!activeChan || !activeChan.holes) {
        toast.error("No hole-range data found for this channel.");
        return;
      }

      // Validate inputs
      if (reshiftSourceHoles.start < 1 || reshiftSourceHoles.end < reshiftSourceHoles.start ||
          reshiftDestHoles.start < 1 || reshiftDestHoles.end < reshiftDestHoles.start) {
        toast.error("Invalid hole ranges for re-shift.");
        return;
      }

      if (!reshiftNewCrop.trim()) {
        toast.error("Please enter a crop name for the re-shifted holes.");
        return;
      }

      // Check for overlap
      if (!(reshiftSourceHoles.end < reshiftDestHoles.start || reshiftDestHoles.end < reshiftSourceHoles.start)) {
        toast.error("Source and destination hole ranges cannot overlap.");
        return;
      }

      // Get source and destination hole counts
      const sourceCount = reshiftSourceHoles.end - reshiftSourceHoles.start + 1;
      const destCount = reshiftDestHoles.end - reshiftDestHoles.start + 1;

      if (sourceCount !== destCount) {
        toast.error(`Source holes (${sourceCount}) and destination holes (${destCount}) must be the same count.`);
        return;
      }

      // Create new holes for destination range
      const newHoles: HolePlantRecord[] = [];
      for (let i = 0; i < sourceCount; i++) {
        newHoles.push({
          holeId: reshiftDestHoles.start + i,
          cropName: reshiftNewCrop.trim(),
          plantedAt: reshiftNewDate ? new Date(reshiftNewDate).toISOString() : new Date().toISOString(),
          expectedHarvestAt: null,
          count: 1,
          sourceNurseryTrayId: reshiftSourceTray || null,
        });
      }

      // Remove source holes, add destination holes
      const updatedHoles = activeChan.holes
        .filter(h => h.holeId < reshiftSourceHoles.start || h.holeId > reshiftSourceHoles.end)
        .concat(newHoles)
        .sort((a, b) => a.holeId - b.holeId);

      // Update crops list
      const newCropCount = newHoles.length;
      const allCrops = updatedHoles.map(h => h.cropName);
      const uniqueCrops = [...new Set(allCrops)];
      const cropEntries = uniqueCrops.map(crop => ({
        cropName: crop,
        count: allCrops.filter(c => c === crop).length
      }));

      const updatedChan: NftChannel = {
        ...activeChan,
        holes: updatedHoles,
        currentCount: updatedHoles.length,
        status: "growing",
        crops: cropEntries,
        cropName: cropEntries.map(c => `${c.cropName} (${c.count})`).join(", ")
      };

      const updatedList = channels.map((c) => c.id === activeChannelId ? updatedChan : c);
      await saveNftChannels(updatedList);

      // Update nursery tray if sourced from nursery
      if (reshiftSourceTray) {
        try {
          const nurseryStore = await fetchNurseryStore();
          const trayIndex = nurseryStore.trays.findIndex(t => t.id === reshiftSourceTray);
          if (trayIndex >= 0) {
            nurseryStore.trays[trayIndex].germinated = Math.max(
              0,
              (nurseryStore.trays[trayIndex].germinated || 0) - newCropCount
            );
            await saveNurseryStore(nurseryStore);
            toast.success(`${newCropCount} plants moved from Nursery Tray`);
          }
        } catch (err: any) {
          console.warn("Failed to update nursery tray:", err);
        }
      }

      // Create lifecycle event
      await appendCropLifecycleEvent({
        id: `lifecycle-reshifted-${Date.now()}`,
        type: "transferred",
        timestamp: new Date().toISOString(),
        cropName: reshiftNewCrop.trim(),
        quantity: sourceCount,
        destinationId: activeChannelId,
        destinationName: activeChan.name,
        sourceNurseryTrayId: reshiftSourceTray || null,
        location: channelLocation(activeChan),
        notes: `Re-shifted: Holes ${reshiftSourceHoles.start}-${reshiftSourceHoles.end} → ${reshiftDestHoles.start}-${reshiftDestHoles.end}`,
      });

      toast.success(`Successfully re-shifted ${sourceCount} holes!`);
      setShowReshiftForm(false);
      setSelectedHolesToHarvest(new Set());
      loadData();
    } catch (e: any) {
      toast.error(e.message || "Failed to re-shift plants");
    }
  };

  const handlePlant = async () => {
    if (!activeChannelId) return;

    try {
      const activeChan = channels.find((c) => c.id === activeChannelId);
      if (!activeChan) return;

      if (activeChan.status === "growing" && actionType === "plant") {
        await harvestCropRemote(activeChan.id, activeChan.currentCount ?? 0, 0, 0, "Auto-logged on replant.");
      }

      // Handle hole-range planting
      if (usesHoleRanges) {
        if (!validateHoleRanges()) return;

        // Create HolePlantRecord array from hole ranges
        const holes: HolePlantRecord[] = [];
        let totalPlants = 0;

        for (const range of holeRanges) {
          const holeCount = range.endHole - range.startHole + 1;
          totalPlants += holeCount;

          for (let holeId = range.startHole; holeId <= range.endHole; holeId++) {
            holes.push({
              holeId,
              cropName: range.cropName.trim(),
              plantedAt: range.plantDate ? new Date(range.plantDate).toISOString() : new Date().toISOString(),
              expectedHarvestAt: range.expectedHarvestDate ? new Date(range.expectedHarvestDate).toISOString() : null,
              count: 1,
              sourceNurseryTrayId: range.sourceNurseryTrayId || null,
            });
          }
        }

        // Update nursery tray capacity if sourced from nursery
        for (const range of holeRanges) {
          if (range.sourceNurseryTrayId) {
            const trayIndex = nurseryTrays.findIndex((t) => t.id === range.sourceNurseryTrayId);
            if (trayIndex >= 0) {
              const holeCountForTray = holeRanges
                .filter((r) => r.sourceNurseryTrayId === range.sourceNurseryTrayId)
                .reduce((sum, r) => sum + (r.endHole - r.startHole + 1), 0);

              nurseryTrays[trayIndex].germinated = Math.max(
                0,
                (nurseryTrays[trayIndex].germinated || 0) - holeCountForTray
              );
            }
          }
        }

        // Update nursery store
        if (nurseryTrays.some((t) => holeRanges.some((r) => r.sourceNurseryTrayId === t.id))) {
          await saveNurseryStore({ trays: nurseryTrays, history: [], configs: [] });
        }

        // Create crop entries for compatibility
        const cropEntries: NftCropEntry[] = [];
        for (const range of holeRanges) {
          const existing = cropEntries.find((c) => c.cropName === range.cropName.trim());
          if (existing) {
            existing.count += (range.endHole - range.startHole + 1);
          } else {
            cropEntries.push({
              cropName: range.cropName.trim(),
              count: range.endHole - range.startHole + 1,
            });
          }
        }

        const combinedCropName = cropEntries
          .map((c) => `${c.cropName} (${c.count})`)
          .join(", ");

        const updatedChan: NftChannel = {
          ...activeChan,
          cropName: combinedCropName,
          crops: cropEntries,
          holes,
          status: "growing",
          plantedAt: holeRanges[0]?.plantDate ? new Date(holeRanges[0].plantDate).toISOString() : new Date().toISOString(),
          expectedHarvestISO: holeRanges[0]?.expectedHarvestDate ? new Date(holeRanges[0].expectedHarvestDate).toISOString() : null,
          capacity: capacity || 50,
          currentCount: totalPlants,
          notes,
        };

        const updatedList = channels.map((c) => c.id === activeChannelId ? updatedChan : c);
        await saveNftChannels(updatedList);

        // Create lifecycle events for each crop type
        for (const [index, crop] of cropEntries.entries()) {
          const sourceNurseryTrayId = holeRanges.find((r) => r.cropName === crop.cropName)?.sourceNurseryTrayId;
          await appendCropLifecycleEvent({
            id: `lifecycle-planted-${Date.now()}-${index}`,
            type: "planted",
            timestamp: new Date().toISOString(),
            cropName: crop.cropName,
            quantity: crop.count,
            destinationId: updatedChan.id,
            destinationName: updatedChan.name,
            sourceNurseryTrayId: sourceNurseryTrayId || null,
            location: channelLocation(updatedChan),
            notes: notes || "NFT channel planted from nursery",
          });
        }

        toast.success(`Planted ${totalPlants} plants across ${holeRanges.length} hole range(s)!`);
        loadData();
        onDataChanged?.();
        closeForm();
        return;
      }

      // Traditional multi-crop planting (existing logic)
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

      // Update nursery tray capacity if sourced from nursery
      if (selectedNurseryTrayId) {
        const trayIndex = nurseryTrays.findIndex((t) => t.id === selectedNurseryTrayId);
        if (trayIndex >= 0) {
          nurseryTrays[trayIndex].germinated = Math.max(
            0,
            (nurseryTrays[trayIndex].germinated || 0) - totalCount
          );
          await saveNurseryStore({ trays: nurseryTrays, history: [], configs: [] });
        }
      }

      const updatedList = channels.map((c) => c.id === activeChannelId ? updatedChan : c);
      await saveNftChannels(updatedList);
      for (const [index, crop] of validCrops.entries()) {
        await appendCropLifecycleEvent({
          id: `lifecycle-planted-${Date.now()}-${index}`,
          type: "planted",
          timestamp: new Date().toISOString(),
          cropName: crop.cropName.trim(),
          quantity: crop.count,
          destinationId: updatedChan.id,
          destinationName: updatedChan.name,
          sourceNurseryTrayId: selectedNurseryTrayId || null,
          location: channelLocation(updatedChan),
          notes: notes || "NFT channel planted",
        });
      }
      toast.success("Crop batch planted successfully!");
      loadData();
      onDataChanged?.();
      closeForm();
    } catch (e: any) {
      toast.error(e.message || "Failed to plant crop");
    }
  };

  const handleHarvest = async () => {
    if (!activeChannelId) return;
    try {
      const activeChan = channels.find(c => c.id === activeChannelId);
      const totalHarvested = yieldQty + wasteQty;
      if (totalHarvested <= 0) {
        toast.error("Please specify a harvest quantity greater than 0.");
        return;
      }
      if (activeChan && totalHarvested > (activeChan.currentCount ?? 0)) {
        toast.error(`Harvest quantity (${totalHarvested}) exceeds current plant count (${activeChan.currentCount ?? 0}) in this channel.`);
        return;
      }

      await harvestCropRemote(activeChannelId, yieldQty, wasteQty, avgWeightGrams, notes, harvestCultivar || undefined);
      if (yieldQty > 0) {
        await appendCropLifecycleEvent({
          id: `lifecycle-harvested-${Date.now()}`,
          type: "harvested",
          timestamp: new Date().toISOString(),
          cropName: harvestCultivar || activeChan?.cropName || "Unknown crop",
          quantity: yieldQty,
          sourceId: activeChannelId,
          sourceName: activeChan?.name,
          location: activeChan ? channelLocation(activeChan) : undefined,
          notes: notes || "NFT crop harvested",
        });
      }
      if (wasteQty > 0) {
        await appendCropLifecycleEvent({
          id: `lifecycle-removed-${Date.now()}`,
          type: "removed",
          timestamp: new Date().toISOString(),
          cropName: harvestCultivar || activeChan?.cropName || "Unknown crop",
          quantity: wasteQty,
          sourceId: activeChannelId,
          sourceName: activeChan?.name,
          location: activeChan ? channelLocation(activeChan) : undefined,
          notes: notes || "NFT harvest waste or defects",
        });
      }
      toast.success("Crop batch harvested successfully!");
      loadData();
      onDataChanged?.();
      closeForm();
    } catch (e: any) {
      toast.error(e.message || "Failed to harvest crop");
    }
  };

  const handleAddChannel = async () => {
    if (!polyhouse.trim() || !block.trim() || !row.trim() || !level.trim() || !channelIndex) {
      toast.error("All coordinate values (Polyhouse, Block, Row, Level, Channel Index) must be entered.");
      return;
    }

    const generatedName = `${polyhouse.trim().toUpperCase()}-${block.trim().toUpperCase()}-${row.trim().toUpperCase()}-${level.trim().toUpperCase()}${holeConfig ? `-${holeConfig.trim().toUpperCase()}` : ""}-C${String(channelIndex).padStart(2, "0")}`;

    const newId = generatedName;

    if (channels.some((c) => c.id === newId)) {
      toast.error(`A channel with location ID "${newId}" already exists!`);
      return;
    }

    const newChan: NftChannel = {
      id: newId,
      name: generatedName,
      qrCode: generatedName,
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
      polyhouse: polyhouse.trim() || undefined,
      block: block.trim() || undefined,
      row: row.trim() || undefined,
      holeConfig: holeConfig.trim() || undefined,
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
    if (!polyhouse.trim() || !block.trim() || !row.trim() || !level.trim() || !channelIndex) {
      toast.error("All coordinate values (Polyhouse, Block, Row, Level, Channel Index) must be entered.");
      return;
    }

    const locationTag = `${polyhouse.trim().toUpperCase()}-${block.trim().toUpperCase()}-${row.trim().toUpperCase()}-${level.trim().toUpperCase()}${holeConfig ? `-${holeConfig.trim().toUpperCase()}` : ""}-C${String(channelIndex).padStart(2, "0")}`;

    if (channels.some((c) => c.id === locationTag && c.id !== activeChannelId)) {
      toast.error(`A channel with location ID "${locationTag}" already exists!`);
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
            id: locationTag,
            name: locationTag,
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
            polyhouse: polyhouse.trim() || undefined,
            block: block.trim() || undefined,
            row: row.trim() || undefined,
            holeConfig: holeConfig.trim() || undefined,
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

      const activeChan = channels.find((c) => c.id === activeChannelId);
      if (activeChan) {
        const targetCrop = activeChan.crops?.find(crop => crop.cropName.toLowerCase() === incidentCultivar.trim().toLowerCase());
        const availableCount = targetCrop ? targetCrop.count : (activeChan.cropName?.trim().toLowerCase() === incidentCultivar.trim().toLowerCase() ? (activeChan.currentCount ?? 0) : 0);
        if (incidentQty > availableCount) {
          toast.error(`Cannot remove more than the available ${incidentCultivar} plants (${availableCount})`);
          return;
        }
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
      if (incidentType === "removal") {
        const removedChannel = channels.find((channel) => channel.id === activeChannelId);
        await appendCropLifecycleEvent({
          id: `lifecycle-removed-${Date.now()}`,
          type: "removed",
          timestamp: new Date().toISOString(),
          cropName: incidentCultivar,
          quantity: incidentQty,
          sourceId: activeChannelId,
          sourceName: removedChannel?.name,
          location: removedChannel ? channelLocation(removedChannel) : undefined,
          notes: incidentDesc,
        });
      }
      toast.success(incidentType === "removal" ? "Plants removed & logged!" : "Incident logged successfully!");
      loadData();
      onDataChanged?.();
      closeForm();
    } catch (e: any) {
      toast.error("Failed to log incident");
    }
  };

  const handleOpenLogs = async (chan: NftChannel) => {
    const filteredIncidents = (chan.incidents || []).filter(
      (incident) => !String(incident.description).includes("[UNDO HARVEST]")
    );
    setSelectedChannelLogs({ ...chan, incidents: filteredIncidents });
    try {
      const hist = await fetchHarvestHistory();
      const deduped = Array.from(
        new Map(
          hist
            .filter((h) => h.channelId === chan.id)
            .filter((h) => !isUndoHarvestRecord(h))
            .map((h) => [getHarvestFingerprint(h), h])
        ).values()
      );
      setChannelHarvestHistory(deduped);
      setActionType("logs");
    } catch {
      toast.error("Failed to load logs");
    }
  };

  useEffect(() => {
    if (!initialChannelId) return;
    const channel = channels.find((item) => item.id === initialChannelId);
    if (channel) handleOpenLogs(channel);
  }, [initialChannelId, channels.length]);

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
      await appendCropLifecycleEvent({
        id: `lifecycle-transferred-${Date.now()}`,
        type: "transferred",
        timestamp: new Date().toISOString(),
        cropName: transferCultivar,
        quantity: transferCount,
        sourceId: sourceChan.id,
        sourceName: sourceChan.name,
        destinationId: targetChan.id,
        destinationName: targetChan.name,
        location: channelLocation(updatedTarget),
        notes: transferNotes.trim() || "Transferred between NFT channels",
      });
      toast.success(`Successfully shipped ${transferCount}x ${transferCultivar}!`);
      setTransferNotes("");
      loadData();
      onDataChanged?.();
      closeForm();
    } catch (e: any) {
      toast.error("Failed to transfer plants.");
    }
  };

  const handleUndoTransfer = async (transferEvent: CropLifecycleEvent) => {
    if (!transferEvent.sourceId || !transferEvent.destinationId) {
      toast.error("Cannot undo this transfer: missing source or destination data.");
      return;
    }

    if (!confirm(`Undo transfer of ${transferEvent.quantity}x ${transferEvent.cropName} from ${transferEvent.sourceName} to ${transferEvent.destinationName}?`)) {
      return;
    }

    try {
      const sourceChan = channels.find((c) => c.id === transferEvent.destinationId);
      const targetChan = channels.find((c) => c.id === transferEvent.sourceId);

      if (!sourceChan || !targetChan) {
        toast.error("Source or destination channel not found.");
        return;
      }

      const moveQty = transferEvent.quantity;

      // Move back from destination to source
      const nextSourceCrops = sourceChan.crops && sourceChan.crops.length > 0
        ? sourceChan.crops.map((cr) => {
            if (cr.cropName.toLowerCase() === transferEvent.cropName.toLowerCase()) {
              return { ...cr, count: Math.max(0, cr.count - moveQty) };
            }
            return cr;
          }).filter((cr) => cr.count > 0)
        : [];
      
      const nextSourceCount = Math.max(0, (sourceChan.currentCount ?? 0) - moveQty);
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
            description: `[UNDO] Reverted ${moveQty}x ${transferEvent.cropName} from ${targetChan.name}`,
          },
        ],
      };

      let nextTargetCrops: NftCropEntry[] = [];
      if (targetChan.status === "growing") {
        const baseCrops = targetChan.crops && targetChan.crops.length > 0
          ? targetChan.crops
          : [{ cropName: targetChan.cropName || "Unknown", count: targetChan.currentCount ?? 0 }];
        
        const existingIdx = baseCrops.findIndex((cr) => cr.cropName.toLowerCase() === transferEvent.cropName.toLowerCase());
        if (existingIdx > -1) {
          nextTargetCrops = baseCrops.map((cr, idx) => 
            idx === existingIdx ? { ...cr, count: cr.count + moveQty } : cr
          );
        } else {
          nextTargetCrops = [...baseCrops, { cropName: transferEvent.cropName, count: moveQty }];
        }
      } else {
        nextTargetCrops = [{ cropName: transferEvent.cropName, count: moveQty }];
      }

      const nextTargetCount = (targetChan.currentCount ?? 0) + moveQty;

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
            description: `[UNDO] Received back ${moveQty}x ${transferEvent.cropName} from ${sourceChan.name}`,
          },
        ],
      };

      const updatedList = channels.map((c) => {
        if (c.id === sourceChan.id) return updatedSource;
        if (c.id === targetChan.id) return updatedTarget;
        return c;
      });

      await saveNftChannels(updatedList);
      await appendCropLifecycleEvent({
        id: `lifecycle-undo-${Date.now()}`,
        type: "transferred",
        timestamp: new Date().toISOString(),
        cropName: transferEvent.cropName,
        quantity: moveQty,
        sourceId: transferEvent.destinationId,
        sourceName: transferEvent.destinationName,
        destinationId: transferEvent.sourceId,
        destinationName: transferEvent.sourceName,
        location: channelLocation(updatedTarget),
        notes: `Undo: ${transferEvent.notes || "Transfer reverted"}`,
      });

      toast.success(`Successfully undone transfer of ${moveQty}x ${transferEvent.cropName}!`);
      loadData();
      onDataChanged?.();
    } catch (e: any) {
      toast.error("Failed to undo transfer.");
      console.error(e);
    }
  };

  const handleUndoHarvest = async (harvestEntry: any) => {
    if (!isUndoAvailable(harvestEntry)) {
      toast.error("Undo window has expired (24 hours). This harvest cannot be undone.");
      return;
    }

    if (!harvestEntry.channelId) {
      toast.error("Cannot undo this harvest: missing channel data.");
      return;
    }

    const channel = channels.find((c) => c.id === harvestEntry.channelId);
    if (!channel) {
      toast.error("Channel not found.");
      return;
    }

    const duplicateUndoDescription = `[UNDO HARVEST] Restored ${harvestEntry.currentCount}x ${harvestEntry.cropName} (yield: ${harvestEntry.yieldQty}, waste: ${harvestEntry.wasteQty})`;
    const alreadyUndone = (channel.incidents || []).some((incident) => incident.description === duplicateUndoDescription);
    if (alreadyUndone) {
      setRecentHarvests((prev) => prev.filter((item) => item.id !== harvestEntry.id));
      toast.info("This harvest has already been undone.");
      return;
    }

    if (!confirm(`Undo harvest of ${harvestEntry.currentCount}x ${harvestEntry.cropName} from ${harvestEntry.channelName}?`)) {
      return;
    }

    try {
      // Restore channel to growing status with previous harvest count
      const restoredChannel: NftChannel = {
        ...channel,
        status: "growing",
        currentCount: harvestEntry.currentCount,
        cropName: harvestEntry.cropName,
        crops: harvestEntry.crops || [{ cropName: harvestEntry.cropName, count: harvestEntry.currentCount }],
        harvestedAt: null,
        incidents: [
          ...(channel.incidents || []),
          {
            timestamp: new Date().toISOString(),
            type: "incident",
            description: `[UNDO HARVEST] Restored ${harvestEntry.currentCount}x ${harvestEntry.cropName} (yield: ${harvestEntry.yieldQty}, waste: ${harvestEntry.wasteQty})`,
          },
        ],
      };

      const updatedList = channels.map((c) => (c.id === channel.id ? restoredChannel : c));
      await saveNftChannels(updatedList);
      setSelectedChannelLogs(restoredChannel);
      setRecentHarvests((prev) => prev.filter((item) => item.id !== harvestEntry.id));

      // Remove the harvested record so it no longer appears in recent harvest history and operations log
      const prevHarvestHistory = await fetchHarvestHistory();
      const nextHarvestHistory = prevHarvestHistory.filter((item) => item.id !== harvestEntry.id);
      await saveHarvestHistoryRemote(nextHarvestHistory);

      // Restore plants to source nursery tray if available
      if (harvestEntry.sourceNurseryTrayId) {
        try {
          const nurseryStore = await fetchNurseryStore();
          const sourceTray = nurseryStore.trays.find(t => t.id === harvestEntry.sourceNurseryTrayId);
          if (sourceTray) {
            // Restore capacity - increase germinated count or plugs available
            const restorePlants = harvestEntry.currentCount;
            const updatedTray = {
              ...sourceTray,
              germinated: Math.min(sourceTray.plugs, (sourceTray.germinated || 0) + restorePlants)
            };
            const updatedTrays = nurseryStore.trays.map(t => 
              t.id === harvestEntry.sourceNurseryTrayId ? updatedTray : t
            );
            await saveNurseryStore({ ...nurseryStore, trays: updatedTrays });
            toast.success(`${restorePlants}x plants restored to Nursery Tray "${sourceTray.name}"`);
          }
        } catch (err: any) {
          console.warn("Failed to update nursery tray on undo:", err);
          // Don't fail the undo if nursery sync fails
        }
      }

      await appendCropLifecycleEvent({
        id: `lifecycle-undo-harvest-${Date.now()}`,
        type: "planted",
        timestamp: new Date().toISOString(),
        cropName: harvestEntry.cropName,
        quantity: harvestEntry.currentCount,
        destinationId: channel.id,
        destinationName: channel.name,
        sourceNurseryTrayId: harvestEntry.sourceNurseryTrayId || null,
        location: channelLocation(restoredChannel),
        notes: `Undo harvest: ${harvestEntry.currentCount} plants restored to ${channel.name}`,
      });

      toast.success(`Successfully undone harvest! ${harvestEntry.currentCount}x ${harvestEntry.cropName} restored to ${channel.name}.`);
      loadData();
      onDataChanged?.();
    } catch (e: any) {
      toast.error("Failed to undo harvest.");
      console.error(e);
    }
  };

  const handleReshiftHarvest = async (harvestEntry: any) => {
    if (!harvestEntry.channelId || !reshiftTargetId) {
      toast.error("Please select a target channel.");
      return;
    }

    if (!reshiftNotes.trim()) {
      toast.error("Please add a note explaining the re-shift.");
      return;
    }

    try {
      const sourceChannel = channels.find((c) => c.id === harvestEntry.channelId);
      const targetChannel = channels.find((c) => c.id === reshiftTargetId);

      if (!sourceChannel || !targetChannel) {
        toast.error("Source or target channel not found.");
        return;
      }

      const moveQty = harvestEntry.currentCount;

      // Mark source as empty with undo note
      const updatedSource: NftChannel = {
        ...sourceChannel,
        status: "empty",
        currentCount: 0,
        cropName: "",
        crops: [],
        harvestedAt: sourceChannel.harvestedAt,
        incidents: [
          ...(sourceChannel.incidents || []),
          {
            timestamp: new Date().toISOString(),
            type: "incident",
            description: `[RE-SHIFT] ${moveQty}x ${harvestEntry.cropName} re-shifted to ${targetChannel.name}`,
          },
        ],
      };

      // Add harvested plants to target
      let nextTargetCrops: NftCropEntry[] = [];
      if (targetChannel.status === "growing") {
        const baseCrops = targetChannel.crops && targetChannel.crops.length > 0
          ? targetChannel.crops
          : [{ cropName: targetChannel.cropName || "Unknown", count: targetChannel.currentCount ?? 0 }];
        
        const existingIdx = baseCrops.findIndex((cr) => cr.cropName.toLowerCase() === harvestEntry.cropName.toLowerCase());
        if (existingIdx > -1) {
          nextTargetCrops = baseCrops.map((cr, idx) => 
            idx === existingIdx ? { ...cr, count: cr.count + moveQty } : cr
          );
        } else {
          nextTargetCrops = [...baseCrops, { cropName: harvestEntry.cropName, count: moveQty }];
        }
      } else {
        nextTargetCrops = [{ cropName: harvestEntry.cropName, count: moveQty }];
      }

      const nextTargetCount = (targetChannel.currentCount ?? 0) + moveQty;

      const updatedTarget: NftChannel = {
        ...targetChannel,
        status: "growing",
        currentCount: nextTargetCount,
        crops: nextTargetCrops,
        cropName: nextTargetCrops.map((c) => c.cropName).join(", "),
        plantedAt: targetChannel.plantedAt || new Date().toISOString(),
        incidents: [
          ...(targetChannel.incidents || []),
          {
            timestamp: new Date().toISOString(),
            type: "incident",
            description: `[RE-SHIFT IN] Received ${moveQty}x ${harvestEntry.cropName} from harvested batch in ${sourceChannel.name}`,
          },
        ],
      };

      const updatedList = channels.map((c) => {
        if (c.id === sourceChannel.id) return updatedSource;
        if (c.id === targetChannel.id) return updatedTarget;
        return c;
      });

      await saveNftChannels(updatedList);

      await appendCropLifecycleEvent({
        id: `lifecycle-reshifted-${Date.now()}`,
        type: "transferred",
        timestamp: new Date().toISOString(),
        cropName: harvestEntry.cropName,
        quantity: moveQty,
        sourceId: harvestEntry.channelId,
        sourceName: sourceChannel.name,
        destinationId: reshiftTargetId,
        destinationName: targetChannel.name,
        location: channelLocation(updatedTarget),
        notes: `Re-shift from harvest: ${reshiftNotes}`,
      });

      toast.success(`Successfully re-shifted ${moveQty}x ${harvestEntry.cropName} to ${targetChannel.name}!`);
      setShowReshiftForm(false);
      setReshiftTargetId("");
      setReshiftNotes("");
      setSelectedHarvestToReshifted(null);
      loadData();
    } catch (e: any) {
      toast.error("Failed to re-shift harvest.");
      console.error(e);
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
    setPolyhouse(chan.polyhouse || "PH01");
    setBlock(chan.block || "B01");
    setRow(chan.row || "R01");
    setHoleConfig(chan.holeConfig || "HA01");
    setActionType("edit-channel");
  };

  const handleOpenPlant = (chan: NftChannel) => {
    setActiveChannelId(chan.id);
    // Store original holes if they exist (for hole-range mode)
    if (chan.holes && chan.holes.length > 0) {
      setOriginalHoles(chan.holes);
    } else {
      setOriginalHoles(null);
    }
    if (chan.crops && chan.crops.length > 0) {
      setCropsList(chan.crops);
    } else {
      setCropsList([{ cropName: chan.cropName || "", count: chan.capacity ?? 50 }]);
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
    setSelectedNurseryTrayId(null);
    setCropsList([{ cropName: "", count: 50 }]);
    setStand("");
    setLevel("");
    setChannelIndex(1);
    setPolyhouse("PH01");
    setBlock("B01");
    setRow("R01");
    setHoleConfig("HA01");
    setYieldQty(0);
    setWasteQty(0);
    setAvgWeightGrams(0);
    setHarvestCultivar("");
    setIncidentType("incident");
    setIncidentDesc("");
    setIncidentQty(1);
    setIncidentCultivar("");
    setUsesHoleRanges(false);
    setHoleRanges([]);
    setOriginalHoles(null);
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

  // Dynamic coordinates extraction for filters
  const uniquePolyhouses = Array.from(new Set(channels.map((c) => c.polyhouse).filter(Boolean) as string[])).sort();
  const uniqueBlocks = Array.from(new Set(channels.map((c) => c.block).filter(Boolean) as string[])).sort();
  const uniqueLevels = Array.from(new Set(channels.map((c) => c.level).filter(Boolean) as string[])).sort();

  const resetAllFilters = () => {
    setSearchQuery("");
    setSelectedPolyhouse("all");
    setSelectedBlock("all");
    setSelectedLevel("all");
    setSelectedStatus("all");
  };

  const filteredChannels = channels.filter((c) => {
    // 1. Polyhouse filter
    if (selectedPolyhouse !== "all" && c.polyhouse !== selectedPolyhouse) return false;
    
    // 2. Block filter
    if (selectedBlock !== "all" && c.block !== selectedBlock) return false;
    
    // 3. Level filter
    if (selectedLevel !== "all" && c.level !== selectedLevel) return false;
    
    // 4. Status filter
    if (selectedStatus !== "all" && c.status !== selectedStatus) return false;
    
    // 6. Search query
    if (searchQuery.trim() !== "") {
      const query = searchQuery.toLowerCase();
      const cropsText = c.crops?.map(cr => cr.cropName).join(" ") || "";
      const matches = [
        c.name,
        c.cropName,
        c.notes,
        c.polyhouse,
        c.block,
        c.row,
        c.stand,
        c.level,
        c.channelIndex?.toString(),
        cropsText
      ].some(val => val && val.toLowerCase().includes(query));
      if (!matches) return false;
    }
    
    return true;
  });

  const totalNftHoles = channels.reduce((sum, channel) => sum + (channel.capacity ?? 0), 0);
  const totalNftPlants = channels.reduce((sum, channel) => sum + (channel.currentCount ?? 0), 0);
  const emptyNftHoles = Math.max(0, totalNftHoles - totalNftPlants);

  const groupedLayout: {
    [standName: string]: {
      [levelName: string]: NftChannel[]
    }
  } = {};

  filteredChannels.forEach((chan) => {
    const standName = chan.polyhouse && chan.block && chan.row
      ? `${chan.polyhouse}-${chan.block}-${chan.row}`
      : chan.stand || "Unassigned Racks";
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total channels</span>
          <div className="mt-1 text-2xl font-black text-foreground">{channels.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total holes</span>
          <div className="mt-1 text-2xl font-black text-foreground">{totalNftHoles}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Plants growing</span>
          <div className="mt-1 text-2xl font-black text-emerald-600">{totalNftPlants}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Available holes</span>
          <div className="mt-1 text-2xl font-black text-amber-600">{emptyNftHoles}</div>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-2xs md:flex-row md:items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-50">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name, crop, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9 text-xs bg-background"
          />
        </div>

        {/* Polyhouse Filter */}
        <div className="w-full md:w-36">
          <Select value={selectedPolyhouse} onValueChange={setSelectedPolyhouse}>
            <SelectTrigger className="h-9 text-xs bg-background"><SelectValue placeholder="Polyhouse" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Polyhouses</SelectItem>
              {uniquePolyhouses.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Block Filter */}
        <div className="w-full md:w-36">
          <Select value={selectedBlock} onValueChange={setSelectedBlock}>
            <SelectTrigger className="h-9 text-xs bg-background"><SelectValue placeholder="Block" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Blocks</SelectItem>
              {uniqueBlocks.map(b => <SelectItem key={b} value={b}>Block {b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Level Filter */}
        <div className="w-full md:w-36">
          <Select value={selectedLevel} onValueChange={setSelectedLevel}>
            <SelectTrigger className="h-9 text-xs bg-background"><SelectValue placeholder="Level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              {uniqueLevels.map(l => <SelectItem key={l} value={l}>Level {l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Status Filter */}
        <div className="w-full md:w-36">
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="h-9 text-xs bg-background"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="growing">Growing</SelectItem>
              <SelectItem value="empty">Empty</SelectItem>
              <SelectItem value="harvested">Harvested</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(searchQuery || selectedPolyhouse !== "all" || selectedBlock !== "all" || selectedLevel !== "all" || selectedStatus !== "all") && (
          <Button
            variant="ghost"
            onClick={resetAllFilters}
            className="h-9 px-2.5 text-xs font-bold text-destructive hover:bg-destructive/5 self-end md:self-center"
          >
            Clear Filters
          </Button>
        )}
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
                              const style = getCropStyle(chan.cropName, isGrowing, cropConfigs);

                              return (
                                <Button
                                  key={chan.id}
                                  type="button"
                                  onClick={() => handleOpenLogs(chan)}
                                  variant="outline"
                                  className={`h-auto py-2.5 px-4 rounded-xl flex flex-col items-start gap-1 text-left transition-all ${style.bg} ${style.border} ${style.text}`}
                                >
                                  <div className="flex items-center gap-1.5 font-bold text-xs">
                                    {isGrowing ? (
                                      <Sprout className="h-3.5 w-3.5 text-primary animate-pulse" />
                                    ) : (
                                      <div className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                                    )}
                                    <span>Ch {chan.channelIndex ?? 1}: {chan.name}</span>
                                  </div>
                                  <div className="text-[10px] font-semibold">
                                    {isGrowing ? (
                                      <span className="font-bold flex flex-col gap-0.5">
                                        <span className="flex items-center gap-1">
                                          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                                          {chan.cropName} ({count}/{cap})
                                        </span>
                                        {chan.holeConfig && <span className="text-[9px] text-muted-foreground/80 font-normal">Holes: {chan.holeConfig}</span>}
                                      </span>
                                    ) : (
                                      <span className="flex flex-col gap-0.5">
                                        <span>Vacant ({cap} cap)</span>
                                        {chan.holeConfig && <span className="text-[9px] text-muted-foreground/60">Holes: {chan.holeConfig}</span>}
                                      </span>
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
                                      <span className="max-w-24 text-center text-[10px] text-slate-700 font-mono font-semibold break-all leading-tight">
                                        ID: {chan.id}
                                      </span>
                                      {chan.holeConfig && (
                                        <Badge variant="outline" className="text-[9px] font-bold px-1.5 py-0 mt-0.5 bg-slate-50">
                                          Holes: {chan.holeConfig}
                                        </Badge>
                                      )}
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
                                        <>
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
                                          {chan.holes && chan.holes.length > 0 && (
                                            <Button
                                              onClick={() => {
                                                setActiveChannelId(chan.id);
                                                setActionType("re-shift");
                                              }}
                                              className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-4 py-1.5 h-8 shadow-sm"
                                            >
                                              Re-shift Holes
                                            </Button>
                                          )}
                                        </>
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
                {actionType === "re-shift" && "Re-shift Plants Between Holes"}
              </span>
              <span className="text-xs text-muted-foreground block mt-0.5">
                {actionType === "plant" && "Configure cultivars and counts for this multi-crop batch."}
                {actionType === "harvest" && "Reset channel and log yield database metrics."}
                {actionType === "add-channel" && "Create a new physical NFT re-use location."}
                {actionType === "edit-channel" && "Modify details of this crop channel."}
                {actionType === "incident" && "Record pest/disease problems or log plant removals."}
                {actionType === "logs" && "Historical batch records and event tracking log for this channel location."}
                {actionType === "transfer" && "Deduct crop quantities from this gully and shift them directly to a target gully."}
                {actionType === "re-shift" && "Move empty harvested holes and replant with a new crop and date."}
              </span>
            </div>

            <div className="space-y-3">
              {(actionType === "add-channel" || actionType === "edit-channel") && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="chan-name" className="text-xs font-semibold">Channel Label / Name (Auto-Generated)</Label>
                    <Input
                      id="chan-name"
                      value={polyhouse && block && row && level 
                        ? `${polyhouse.trim().toUpperCase()}-${block.trim().toUpperCase()}-${row.trim().toUpperCase()}-${level.trim().toUpperCase()}${holeConfig ? `-${holeConfig.trim().toUpperCase()}` : ""}-C${String(channelIndex).padStart(2, "0")}`
                        : stand && level
                          ? `${stand}-${level}-Ch ${channelIndex}`
                          : "Unnamed Channel"}
                      disabled
                      className="bg-muted/60 font-mono font-bold text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="chan-polyhouse" className="text-xs font-semibold">Polyhouse</Label>
                      <Input
                        id="chan-polyhouse"
                        placeholder="e.g. PH01"
                        value={polyhouse}
                        onChange={(e) => setPolyhouse(e.target.value.toUpperCase())}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="chan-block" className="text-xs font-semibold">Block</Label>
                      <Input
                        id="chan-block"
                        placeholder="e.g. B01"
                        value={block}
                        onChange={(e) => setBlock(e.target.value.toUpperCase())}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="chan-row" className="text-xs font-semibold">Row</Label>
                      <Input
                        id="chan-row"
                        placeholder="e.g. R01"
                        value={row}
                        onChange={(e) => setRow(e.target.value.toUpperCase())}
                        className="text-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="chan-level" className="text-xs font-semibold">NFT Level</Label>
                      <Input
                        id="chan-level"
                        placeholder="e.g. L01"
                        value={level}
                        onChange={(e) => setLevel(e.target.value.toUpperCase())}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="chan-holeconfig" className="text-xs font-semibold">Hole Config</Label>
                      <Input
                        id="chan-holeconfig"
                        placeholder="e.g. HA01"
                        value={holeConfig}
                        onChange={(e) => setHoleConfig(e.target.value.toUpperCase())}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="chan-index" className="text-xs font-semibold">Channel Index</Label>
                      <Input
                        id="chan-index"
                        type="number"
                        placeholder="1"
                        value={channelIndex}
                        onChange={(e) => { const v = e.target.value; setChannelIndex(v === "" ? "" as any : Number(v)); }}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="chan-capacity" className="text-xs font-semibold">Capacity</Label>
                      <Input
                        id="chan-capacity"
                        type="number"
                        placeholder="50"
                        value={capacity}
                        onChange={(e) => { const v = e.target.value; setCapacity(v === "" ? "" as any : Number(v)); }}
                        className="text-xs"
                      />
                    </div>
                  </div>
                </>
              )}

              {(actionType === "plant" || actionType === "edit-planted-crops") && (
                <>
                  {/* Show hole-range mode toggle in both Plant and Edit Crops */}
                  <div className="flex gap-2 mb-3">
                    <Button
                      onClick={() => {
                        // When switching TO Multi-Crop: convert hole ranges to crops
                        if (usesHoleRanges && holeRanges.length > 0) {
                          setCropsList(convertHoleRangesToMultiCrop());
                        }
                        setUsesHoleRanges(false);
                      }}
                      variant={usesHoleRanges ? "outline" : "default"}
                      size="sm"
                      className="text-[10px] font-bold px-3 h-8 flex-1"
                    >
                      Multi-Crop
                    </Button>
                    <Button
                      onClick={() => {
                        // When switching TO Hole-Range: convert crops to hole ranges (preserves tray info if available)
                        if (!usesHoleRanges && cropsList.length > 0) {
                          setHoleRanges(convertMultiCropToHoleRanges());
                          if (!originalHoles) {
                            console.info("Tray source information not available from multi-crop data");
                          }
                        }
                        setUsesHoleRanges(true);
                      }}
                      variant={usesHoleRanges ? "default" : "outline"}
                      size="sm"
                      className="text-[10px] font-bold px-3 h-8 flex-1"
                    >
                      Hole-Range {originalHoles && originalHoles.length > 0 ? "✓" : ""}
                    </Button>
                  </div>

                  {/* Traditional Multi-Crop Form */}
                  {!usesHoleRanges && (
                    <>
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
                                list="nft-crop-suggestions"
                                placeholder="e.g. Romaine"
                                value={crop.cropName}
                                onChange={(e) => handleCropRowChange(idx, "cropName", e.target.value)}
                                className="h-8 text-xs flex-1"
                              />
                              <datalist id="nft-crop-suggestions">
                                {SUGGESTED_CROPS_LIST.map((c) => (
                                  <option key={c} value={c} />
                                ))}
                              </datalist>
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

                      {nurseryTrays.length > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs font-semibold">Source Nursery Tray (Optional)</Label>
                            <span className="text-[8px] bg-blue-500/20 text-blue-700 px-1.5 py-0.5 rounded">💡 Undo Available</span>
                          </div>
                          <Select 
                            value={selectedNurseryTrayId || "none"} 
                            onValueChange={(val) => setSelectedNurseryTrayId(val === "none" ? null : val)}
                          >
                            <SelectTrigger className="h-9 text-sm">
                              <SelectValue placeholder="No tray" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No tray (Direct seeding - no undo)</SelectItem>
                              {nurseryTrays.map((tray) => (
                                <SelectItem key={tray.id} value={tray.id}>
                                  {tray.name} ({tray.germinated}/{tray.plugs}) ✓ Undo Available
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {selectedNurseryTrayId && (
                            <div className="text-xs text-emerald-700 bg-emerald-500/10 p-2 rounded border border-emerald-500/30">
                              ✓ If planted by mistake, you can <strong>UNDO within 24 hours</strong> and plants return to this tray automatically
                            </div>
                          )}
                          {!selectedNurseryTrayId && (
                            <div className="text-xs text-amber-700 bg-amber-500/10 p-2 rounded border border-amber-500/30">
                              ⚠️ Direct seeding (no nursery tray) - undo will NOT restore plants to tray
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Hole-Range Planting Form */}
                  {usesHoleRanges && (
                    <>
                      <div className="space-y-2 border border-border p-2.5 rounded-lg bg-muted/15">
                        <div className="flex justify-between items-center pb-1.5 border-b">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Hole Ranges</span>
                          <Button onClick={handleAddHoleRange} variant="outline" size="sm" className="h-6 text-[10px] font-bold px-2 py-0">
                            + Add Range
                          </Button>
                        </div>

                        <div className="space-y-2.5 max-h-80 overflow-y-auto pt-1">
                          {holeRanges.map((range, idx) => (
                            <div key={idx} className="space-y-1.5 p-2 bg-background rounded border border-border/50">
                              <div className="flex gap-2 items-end">
                                <div className="flex-1">
                                  <Label className="text-[9px] font-bold text-muted-foreground">Holes</Label>
                                  <div className="flex gap-2">
                                    <Input
                                      type="number"
                                      min={1}
                                      max={99}
                                      placeholder="Start"
                                      value={range.startHole}
                                      onChange={(e) => handleHoleRangeChange(idx, "startHole", e.target.value)}
                                      className="h-7 text-[10px] text-center"
                                    />
                                    <span className="text-[10px] font-bold self-center">→</span>
                                    <Input
                                      type="number"
                                      min={1}
                                      max={99}
                                      placeholder="End"
                                      value={range.endHole}
                                      onChange={(e) => handleHoleRangeChange(idx, "endHole", e.target.value)}
                                      className="h-7 text-[10px] text-center"
                                    />
                                    <Button
                                      onClick={() => handleRemoveHoleRange(idx)}
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10 shrink-0"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <Label className="text-[9px] font-bold text-muted-foreground">Crop Name</Label>
                                <Select
                                  value={range.cropName}
                                  onValueChange={(val) => handleHoleRangeChange(idx, "cropName", val)}
                                >
                                  <SelectTrigger className="h-7 text-[10px]">
                                    <SelectValue placeholder="Select crop..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SUGGESTED_CROPS_LIST.map((crop) => (
                                      <SelectItem key={crop} value={crop}>
                                        {crop}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-[9px] font-bold text-muted-foreground">Plant Date</Label>
                                  <Input
                                    type="date"
                                    value={range.plantDate}
                                    onChange={(e) => handleHoleRangeChange(idx, "plantDate", e.target.value)}
                                    className="h-7 text-[10px]"
                                  />
                                </div>
                                <div>
                                  <Label className="text-[9px] font-bold text-muted-foreground">Expected Harvest</Label>
                                  <Input
                                    type="date"
                                    value={range.expectedHarvestDate}
                                    onChange={(e) => handleHoleRangeChange(idx, "expectedHarvestDate", e.target.value)}
                                    className="h-7 text-[10px]"
                                  />
                                </div>
                              </div>

                              {nurseryTrays.length > 0 && (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Label className="text-[9px] font-bold text-muted-foreground">Source Nursery Tray (Optional)</Label>
                                    <span className="text-[8px] bg-blue-500/20 text-blue-700 px-1.5 py-0.5 rounded">💡 Undo Available</span>
                                  </div>
                                  <Select 
                                    value={range.sourceNurseryTrayId || "none"} 
                                    onValueChange={(val) => handleHoleRangeChange(idx, "sourceNurseryTrayId", val === "none" ? null : val)}
                                  >
                                    <SelectTrigger className="h-7 text-[10px]">
                                      <SelectValue placeholder="No tray" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">No tray (Direct seeding - no undo)</SelectItem>
                                      {nurseryTrays.map((tray) => (
                                        <SelectItem key={tray.id} value={tray.id}>
                                          {tray.name} ({tray.germinated}/{tray.plugs}) ✓ Undo
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {range.sourceNurseryTrayId && (
                                    <div className="text-[8px] text-emerald-700 bg-emerald-500/10 p-1.5 rounded border border-emerald-500/30">
                                      ✓ If planted by mistake, you can <strong>UNDO within 24 hours</strong> and plants return to this tray automatically
                                    </div>
                                  )}
                                  {!range.sourceNurseryTrayId && (
                                    <div className="text-[8px] text-amber-700 bg-amber-500/10 p-1.5 rounded border border-amber-500/30">
                                      ⚠️ Direct seeding (no nursery tray) - undo will NOT restore plants to tray
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="text-[9px] text-muted-foreground font-bold">
                                {range.endHole - range.startHole + 1} holes ({range.cropName || "??"})
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="text-[10px] text-muted-foreground text-right font-bold pt-1.5 border-t">
                          Total: {holeRanges.reduce((sum, r) => sum + (r.endHole - r.startHole + 1), 0)} / {capacity} Plants
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              {actionType === "harvest" && (
                <>
                  {(() => {
                    const activeChan = channels.find((c) => c.id === activeChannelId);
                    
                    // Show hole-range harvest UI if channel has holes
                    if (activeChan?.holes && activeChan.holes.length > 0) {
                      return (
                        <div className="space-y-3">
                          <div className="border border-border p-2.5 rounded-lg bg-muted/15">
                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pb-2 border-b">
                              Hole Ranges Ready to Harvest
                            </div>
                            <div className="space-y-2 mt-2 max-h-48 overflow-y-auto">
                              {activeChan.holes.map((hole) => {
                                const status = getHoleRangeStatus(hole);
                                const isSelected = selectedHolesToHarvest.has(hole.holeId);
                                const daysSince = getDaysSincePlanting(hole.plantedAt);
                                
                                return (
                                  <div
                                    key={hole.holeId}
                                    onClick={() => {
                                      const newSet = new Set(selectedHolesToHarvest);
                                      if (newSet.has(hole.holeId)) {
                                        newSet.delete(hole.holeId);
                                      } else {
                                        newSet.add(hole.holeId);
                                      }
                                      setSelectedHolesToHarvest(newSet);
                                    }}
                                    className={`p-2 rounded border cursor-pointer text-[10px] transition-all ${
                                      isSelected
                                        ? "border-primary bg-primary/10"
                                        : status.status === "ready"
                                          ? "border-green-500/50 bg-green-500/5 hover:bg-green-500/10"
                                          : "border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/10"
                                    }`}
                                  >
                                    <div className="flex justify-between items-center">
                                      <div className="flex-1">
                                        <div className="font-bold">Hole {hole.holeId} - {hole.cropName}</div>
                                        <div className="text-muted-foreground">
                                          Planted {daysSince}d ago
                                          {status.status === "ready" && <span className="text-green-600 ml-2">✓ Ready</span>}
                                          {status.daysRemaining !== null && status.daysRemaining > 0 && (
                                            <span className="text-amber-600 ml-2">{status.daysRemaining} days left</span>
                                          )}
                                        </div>
                                      </div>
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => {}}
                                        className="w-4 h-4 cursor-pointer"
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="text-[9px] text-muted-foreground mt-2 pt-2 border-t">
                              {selectedHolesToHarvest.size} of {activeChan.holes.length} holes selected
                            </div>
                          </div>

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
                        </div>
                      );
                    }

                    // Fallback to traditional harvest UI
                    const crops = activeChan?.crops || [];
                    if (crops.length > 0) {
                      return (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label htmlFor="harvest-cultivar" className="text-xs font-semibold">Select Variety to Harvest</Label>
                            <Select value={harvestCultivar} onValueChange={(val) => setHarvestCultivar(val)}>
                              <SelectTrigger id="harvest-cultivar" className="h-9 text-xs bg-background">
                                <SelectValue placeholder="Select variety" />
                              </SelectTrigger>
                              <SelectContent>
                                {crops.map((c, i) => (
                                  <SelectItem key={i} value={c.cropName}>
                                    {c.cropName} ({c.count} available)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
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
                        </div>
                      );
                    }
                    return null;
                  })()}
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
                        {(() => {
                          const activeChan = channels.find((c) => c.id === activeChannelId);
                          const targetCrop = activeChan?.crops?.find(crop => crop.cropName.toLowerCase() === incidentCultivar.trim().toLowerCase());
                          const maxQty = targetCrop ? targetCrop.count : (activeChan?.cropName?.trim().toLowerCase() === incidentCultivar.trim().toLowerCase() ? (activeChan?.currentCount ?? 0) : 50);
                          return (
                            <Input
                              id="inc-qty"
                              type="number"
                              min={1}
                              max={maxQty}
                              value={incidentQty}
                              onChange={(e) => { const v = e.target.value; setIncidentQty(v === "" ? "" as any : Number(v)); }}
                              className="text-xs"
                            />
                          );
                        })()}
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

                  <div className="space-y-1">
                    <Label htmlFor="transfer-notes" className="text-xs font-semibold">Notes (Optional)</Label>
                    <textarea
                      id="transfer-notes"
                      placeholder="e.g., Moved due to space optimization, excellent growth, ready for nursery..."
                      value={transferNotes}
                      onChange={(e) => setTransferNotes(e.target.value)}
                      className="h-16 text-xs border rounded-md border-input bg-background px-3 py-2 font-sans resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-transparent"
                    />
                  </div>
                </>
              )}

              {actionType === "re-shift" && (
                <>
                  <div className="text-[11px] text-muted-foreground font-semibold mb-2 p-2 bg-amber-500/10 rounded border border-amber-500/30">
                    💡 Re-shift empty harvested holes and replant with new crop/date
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Source Holes (to empty)</Label>
                    <div className="flex gap-2 items-end">
                      <div>
                        <Label className="text-[9px] text-muted-foreground">Start</Label>
                        <Input
                          type="number"
                          min={1}
                          value={reshiftSourceHoles.start}
                          onChange={(e) => setReshiftSourceHoles({ ...reshiftSourceHoles, start: Number(e.target.value) })}
                          className="h-8 text-xs text-center w-16"
                          placeholder="1"
                        />
                      </div>
                      <span className="text-xs font-bold">→</span>
                      <div>
                        <Label className="text-[9px] text-muted-foreground">End</Label>
                        <Input
                          type="number"
                          min={1}
                          value={reshiftSourceHoles.end}
                          onChange={(e) => setReshiftSourceHoles({ ...reshiftSourceHoles, end: Number(e.target.value) })}
                          className="h-8 text-xs text-center w-16"
                          placeholder="5"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Destination Holes (to fill)</Label>
                    <div className="flex gap-2 items-end">
                      <div>
                        <Label className="text-[9px] text-muted-foreground">Start</Label>
                        <Input
                          type="number"
                          min={1}
                          value={reshiftDestHoles.start}
                          onChange={(e) => setReshiftDestHoles({ ...reshiftDestHoles, start: Number(e.target.value) })}
                          className="h-8 text-xs text-center w-16"
                          placeholder="6"
                        />
                      </div>
                      <span className="text-xs font-bold">→</span>
                      <div>
                        <Label className="text-[9px] text-muted-foreground">End</Label>
                        <Input
                          type="number"
                          min={1}
                          value={reshiftDestHoles.end}
                          onChange={(e) => setReshiftDestHoles({ ...reshiftDestHoles, end: Number(e.target.value) })}
                          className="h-8 text-xs text-center w-16"
                          placeholder="10"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="reshift-crop" className="text-xs font-semibold">New Crop Name</Label>
                    <Input
                      id="reshift-crop"
                      list="nft-crop-suggestions"
                      placeholder="e.g. Lettuce"
                      value={reshiftNewCrop}
                      onChange={(e) => setReshiftNewCrop(e.target.value)}
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="reshift-date" className="text-xs font-semibold">Plant Date for New Crop</Label>
                    <Input
                      id="reshift-date"
                      type="date"
                      value={reshiftNewDate}
                      onChange={(e) => setReshiftNewDate(e.target.value)}
                      className="text-xs"
                    />
                  </div>

                  {nurseryTrays.length > 0 && (
                    <div className="space-y-1">
                      <Label htmlFor="reshift-tray" className="text-xs font-semibold">Source Nursery Tray (Optional)</Label>
                      <Select value={reshiftSourceTray || "none"} onValueChange={(val) => setReshiftSourceTray(val === "none" ? "" : val)}>
                        <SelectTrigger id="reshift-tray" className="h-9 text-xs">
                          <SelectValue placeholder="No tray (direct seeding)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No tray (direct seeding)</SelectItem>
                          {nurseryTrays.map((tray) => (
                            <SelectItem key={tray.id} value={tray.id}>
                              {tray.name} ({tray.germinated}/{tray.plugs})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="text-[9px] text-muted-foreground bg-blue-500/10 p-2 rounded">
                    Moving {reshiftDestHoles.end - reshiftDestHoles.start + 1} holes of {reshiftNewCrop || "??"} to this channel
                  </div>
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
                              setPlantedAt(selectedChannelLogs.plantedAt ? selectedChannelLogs.plantedAt.split("T")[0] : "");
                              setExpectedHarvestISO(selectedChannelLogs.expectedHarvestISO ? selectedChannelLogs.expectedHarvestISO.split("T")[0] : "");
                              setCropsList(selectedChannelLogs.crops && selectedChannelLogs.crops.length > 0 ? selectedChannelLogs.crops : [{ cropName: selectedChannelLogs.cropName, count: selectedChannelLogs.currentCount || 20 }]);
                              setCapacity(selectedChannelLogs.capacity || 50);
                              setActionType("edit-planted-crops");
                            }}
                            variant="outline"
                            className="text-foreground border-primary/20 hover:bg-primary/5 font-semibold text-[10px] px-2.5 h-7 py-0.5 rounded shadow-sm"
                          >
                            Edit Crops
                          </Button>
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
                              setTransferNotes("");
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
                    {selectedChannelLogs.incidents && selectedChannelLogs.incidents.filter((inc) => !String(inc.description).includes("[UNDO HARVEST]")).length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {selectedChannelLogs.incidents
                          .filter((inc) => !String(inc.description).includes("[UNDO HARVEST]"))
                          .map((inc, i) => (
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

                  {/* Recent Transfers with Undo */}
                  <div className="space-y-2">
                    <span className="font-bold text-foreground block border-b pb-1">Recent Transfers & Reversals</span>
                    {recentTransfers && recentTransfers.length > 0 ? (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {recentTransfers.map((transfer) => {
                          const isRelevant = transfer.sourceId === selectedChannelLogs?.id || transfer.destinationId === selectedChannelLogs?.id;
                          return (
                            <div
                              key={transfer.id}
                              className={`p-2 rounded-lg border text-[10px] space-y-1 ${
                                transfer.notes?.includes("Undo")
                                  ? "border-blue-500/20 bg-blue-500/5"
                                  : "border-sky-500/20 bg-sky-500/5"
                              } ${isRelevant ? "ring-1 ring-primary/30" : ""}`}
                            >
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex-1">
                                  <p className="font-bold text-foreground">
                                    {transfer.quantity}x {transfer.cropName} → {transfer.destinationName}
                                  </p>
                                  <p className="text-[9px] text-muted-foreground">
                                    From: <span className="font-mono">{transfer.sourceName}</span>
                                  </p>
                                  {transfer.notes && !transfer.notes.includes("Undo") && (
                                    <p className="text-[9px] text-muted-foreground italic mt-0.5">
                                      📝 {transfer.notes}
                                    </p>
                                  )}
                                </div>
                                {!transfer.notes?.includes("Undo") && (
                                  <Button
                                    onClick={() => handleUndoTransfer(transfer)}
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[9px] text-orange-600 hover:text-orange-700 hover:bg-orange-500/10 shrink-0 flex items-center gap-1"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Undo
                                  </Button>
                                )}
                              </div>
                              <span className="text-[8px] text-muted-foreground block font-mono">
                                {new Date(transfer.timestamp).toLocaleString()}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic text-[11px] block">No recent transfers recorded.</span>
                    )}
                  </div>

                  {/* Recent Harvests with Undo/Re-shift */}
                  <div className="space-y-2">
                    <span className="font-bold text-foreground block border-b pb-1">Recent Harvests & Recovery</span>
                    {recentHarvests && recentHarvests.length > 0 ? (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {recentHarvests
                          .filter((harvest) => {
                            const isCurrentChannel = harvest.channelId === selectedChannelLogs?.id || !selectedChannelLogs;
                            return isCurrentChannel && !isUndoHarvestRecord(harvest);
                          })
                          .map((harvest) => {
                          const isRelevant = harvest.channelId === selectedChannelLogs?.id;
                          const showReshiftUI = selectedHarvestToReshifted?.id === harvest.id && showReshiftForm;
                          const canUndoThisHarvest = isUndoAvailable(harvest);
                          return (
                            <div
                              key={harvest.id}
                              className={`p-2 rounded-lg border space-y-2 text-[10px] ${
                                isRelevant
                                  ? "border-green-500/30 bg-green-500/5 ring-1 ring-primary/30"
                                  : "border-green-500/20 bg-green-500/5"
                              }`}
                            >
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex-1">
                                  <p className="font-bold text-foreground">
                                    ✂️ {harvest.currentCount}x {harvest.cropName}
                                  </p>
                                  <p className="text-[9px] text-muted-foreground">
                                    {harvest.channelName} • Yield: {harvest.yieldQty}, Waste: {harvest.wasteQty}
                                  </p>
                                  {harvest.notes && (
                                    <p className="text-[9px] text-muted-foreground italic mt-0.5">
                                      📝 {harvest.notes}
                                    </p>
                                  )}
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  {!isUndoHarvestRecord(harvest) && (
                                    <Button
                                      onClick={() => handleUndoHarvest(harvest)}
                                      variant="ghost"
                                      size="sm"
                                      disabled={!canUndoThisHarvest}
                                      className="h-6 px-2 text-[9px] text-blue-600 hover:text-blue-700 hover:bg-blue-500/10 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                      {canUndoThisHarvest ? "Undo" : "Expired"}
                                    </Button>
                                  )}
                                  {!isUndoHarvestRecord(harvest) && (
                                    <Button
                                      onClick={() => {
                                        setSelectedHarvestToReshifted(harvest);
                                        setShowReshiftForm(!showReshiftForm);
                                        setReshiftTargetId("");
                                        setReshiftNotes("");
                                      }}
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-[9px] text-purple-600 hover:text-purple-700 hover:bg-purple-500/10 flex items-center gap-1"
                                    >
                                      <Sprout className="h-3 w-3" />
                                      Re-shift
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <span className="text-[8px] text-muted-foreground block font-mono">
                                {new Date(harvest.harvestedAt).toLocaleString()}
                              </span>

                              {showReshiftUI && (
                                <div className="border-t pt-2 mt-2 space-y-1.5 bg-purple-500/5 -mx-2 -mb-2 px-2 pb-2 rounded-b">
                                  <p className="text-[9px] font-semibold text-foreground">Re-shift to channel:</p>
                                  <Select value={reshiftTargetId} onValueChange={(val) => setReshiftTargetId(val)}>
                                    <SelectTrigger className="h-7 text-[9px]"><SelectValue placeholder="Select destination..." /></SelectTrigger>
                                    <SelectContent>
                                      {channels.filter((c) => c.id !== harvest.channelId).map((chan) => (
                                        <SelectItem key={chan.id} value={chan.id}>
                                          {chan.name} {chan.status === "growing" ? `(${chan.cropName})` : "(Empty)"}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <input
                                    type="text"
                                    placeholder="Reason for re-shift..."
                                    value={reshiftNotes}
                                    onChange={(e) => setReshiftNotes(e.target.value)}
                                    className="h-7 text-[9px] border rounded-md border-input bg-background px-2 py-1 w-full font-sans focus:outline-none focus:ring-2 focus:ring-primary/50"
                                  />
                                  <div className="flex gap-1">
                                    <Button
                                      onClick={() => handleReshiftHarvest(harvest)}
                                      className="flex-1 h-6 text-[9px] bg-purple-600 hover:bg-purple-700 text-white font-bold px-2 py-0 rounded"
                                    >
                                      Confirm Re-shift
                                    </Button>
                                    <Button
                                      onClick={() => {
                                        setShowReshiftForm(false);
                                        setSelectedHarvestToReshifted(null);
                                      }}
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-[9px]"
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-muted-foreground italic text-[11px] block">No recent harvests recorded.</span>
                    )}
                  </div>

                  {/* Past Harvest History */}
                  <div className="space-y-2">
                    <span className="font-bold text-foreground block border-b pb-1">Completed Yield Harvest Audits</span>
                    {channelHarvestHistory.length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {channelHarvestHistory
                          .filter((item) => !isUndoHarvestRecord(item))
                          .filter((item, index, arr) => arr.findIndex((entry) => getHarvestFingerprint(entry) === getHarvestFingerprint(item)) === index)
                          .map((item) => (
                            <div key={getHarvestFingerprint(item)} className="pl-3 border-l-2 border-green-500 py-0.5 space-y-1">
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

              {actionType !== "add-channel" && actionType !== "incident" && actionType !== "logs" && actionType !== "transfer" && actionType !== "re-shift" && (
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
              {(actionType === "plant" || actionType === "edit-planted-crops") && (
                <Button onClick={handlePlant} className="bg-primary text-primary-foreground font-bold text-xs px-4 h-9">
                  {actionType === "plant" ? "Confirm Seeding" : "Save Crops"}
                </Button>
              )}
              {actionType === "harvest" && (
                <Button 
                  onClick={() => {
                    const activeChan = channels.find(c => c.id === activeChannelId);
                    if (activeChan?.holes && activeChan.holes.length > 0 && selectedHolesToHarvest.size > 0) {
                      handleHarvestHoleRanges();
                    } else {
                      handleHarvest();
                    }
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs px-4 h-9"
                >
                  {(() => {
                    const activeChan = channels.find(c => c.id === activeChannelId);
                    if (activeChan?.holes && activeChan.holes.length > 0) {
                      return `Harvest ${selectedHolesToHarvest.size} Holes`;
                    }
                    return "Log Yield & Harvest";
                  })()}
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
              {actionType === "re-shift" && (
                <Button onClick={handleReshiftPlants} className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-4 h-9">
                  Re-shift Plants
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
