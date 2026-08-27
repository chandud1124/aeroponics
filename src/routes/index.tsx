import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { ErrorBoundary } from "@/components/error-boundary";
import { EnhancedStatusCards } from "@/components/tower/EnhancedStatusCards";
import { ScheduleEditor } from "@/components/tower/ScheduleEditor";
import { GpioConfigTab } from "@/components/tower/GpioConfigTab";
import { DashboardCharts } from "@/components/tower/DashboardCharts";
import { NutritionTab } from "@/components/tower/NutritionTab";
import { NftChannelsTab } from "@/components/tower/NftChannelsTab";
import { GrowBagsTab } from "@/components/tower/GrowBagsTab";
import { DeviceRegistryTab } from "@/components/tower/DeviceRegistryTab";
import { CameraQrScanner } from "@/components/tower/CameraQrScanner";
import { ManualReadings } from "@/components/tower/ManualReadings";
import { Documentation } from "@/components/tower/Documentation";
import { PumpStats } from "@/components/tower/PumpStats";
import { AIInsightsCard } from "@/components/tower/AIInsightsCard";
import { VisualAiCameraTab } from "@/components/tower/VisualAiCameraTab";
import {
  defaultSchedule,
  fetchDevices,
  fetchSchedule,
  fetchStatusEnvelope,
  fetchNftChannels,
  fetchHarvestHistory,
  saveNftChannels,
  harvestCropRemote,
  API_BASE_URL,
  type LiveStatus,
  type Schedule,
  type DeviceListEntry,
  type NftChannel,
  type HarvestHistoryEntry,
} from "@/lib/tower-storage";
import {
  FaultAlertBanner,
  FaultHistoryPanel,
  LiveCycleHistoryPanel,
  ManualControlPanel,
  NextCyclePanel,
  PumpStateDisplay,
  RelayStatesCard,
} from "@/components/tower/PumpOperational";
import { HistoryAnalyticsTab } from "@/components/tower/HistoryAnalytics";
import { CropOperationsDashboard } from "@/components/tower/CropOperationsDashboard";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { 
  Sprout, 
  LayoutDashboard, 
  Cpu, 
  Clock, 
  BarChart3, 
  Zap, 
  BookOpen, 
  FileText, 
  Grid, 
  Droplet, 
  FlaskConical, 
  Warehouse, 
  LineChart, 
  Flame, 
  ShieldAlert, 
  QrCode,
  Calendar,
  AlertTriangle,
  History,
  TrendingUp,
  Settings,
  Plus,
  Trash2,
  Camera,
  Package,
  Users,
  Lock,
  User,
  Eye,
  EyeOff,
} from "lucide-react";

type NurseryCell = {
  holeIndex: number;
  crop: string;
  plantedOn: string;
  germinated: boolean;
};

type NurseryTray = {
  id: string;
  name: string;
  crop: string;
  plantedOn: string;
  plugs: number;
  germinated: number;
  status: "empty" | "growing" | "ready";
  cells?: NurseryCell[];
};

type NurseryHistoryEntry = {
  id: string;
  trayId: string;
  trayName: string;
  crop: string;
  plantedOn: string;
  transplantedOn: string;
  plugs: number;
  germinated: number;
  notes: string;
  channelId?: string;
  channelName?: string;
};

const DEFAULT_NURSERY_TRAYS: NurseryTray[] = [
  { id: "tray-1", name: "Tray 1", crop: "", plantedOn: "", plugs: 30, germinated: 0, status: "empty" },
  { id: "tray-2", name: "Tray 2", crop: "", plantedOn: "", plugs: 30, germinated: 0, status: "empty" },
];

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "PolyHouse ERP — IoT Hydroponic Dashboard" },
      {
        name: "description",
        content:
          "Designer-grade ESP32 IoT operations center for commercial and gravity-fed vertical aeroponic systems.",
      },
    ],
    links: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  }),
});

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

function getCropStyle(cropName: string, germinated: boolean) {
  if (!cropName) {
    return {
      bg: "bg-muted/10 hover:bg-muted/20 text-muted-foreground/40",
      border: "border border-dashed border-muted-foreground/30",
      dot: "bg-transparent",
      text: "text-muted-foreground"
    };
  }
  let hash = 0;
  for (let i = 0; i < cropName.length; i++) {
    hash = cropName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % CROP_COLOR_PALETTE.length;
  const color = CROP_COLOR_PALETTE[index];
  return {
    bg: color.bg,
    border: germinated ? `border-2 ${color.border}` : `border border-dashed ${color.border}`,
    dot: color.dot,
    text: color.text
  };
}

function Index() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState("status");
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("tower_auth_token");
      if (!token) {
        setAuthLoading(false);
        return;
      }
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: {
            "Authorization": `Bearer ${token}`,
          }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.authenticated) {
            setUser(data.user);
          } else {
            localStorage.removeItem("tower_auth_token");
          }
        } else {
          localStorage.removeItem("tower_auth_token");
        }
      } catch (e) {
        console.error("Auth validation failed", e);
      } finally {
        setAuthLoading(false);
      }
    };
    checkAuth();
  }, []);

  const handleLogin = async (usernameInput: string, passwordInput: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Invalid credentials");
      }
      const data = await response.json();
      localStorage.setItem("tower_auth_token", data.token);
      setUser(data.user);
      toast.success(`Welcome back, ${data.user.username}!`);
    } catch (e: any) {
      toast.error(e.message || "Failed to log in");
      throw e;
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("tower_auth_token");
    setUser(null);
    toast.success("Logged out successfully");
  };

  const [devices, setDevices] = useState<DeviceListEntry[]>([]);
  const [nftChannels, setNftChannels] = useState<NftChannel[]>([]);
  const [harvestHistory, setHarvestHistory] = useState<HarvestHistoryEntry[]>([]);
  const [loadingCrops, setLoadingCrops] = useState(true);
  const [harvestSearch, setHarvestSearch] = useState("");
  const [harvestStart, setHarvestStart] = useState("");
  const [harvestEnd, setHarvestEnd] = useState("");
  const [harvestCropSelect, setHarvestCropSelect] = useState("all");
  const [harvestPage, setHarvestPage] = useState(0);
  const [nurseryTrays, setNurseryTrays] = useState<NurseryTray[]>(DEFAULT_NURSERY_TRAYS);
  const [nurseryHistory, setNurseryHistory] = useState<NurseryHistoryEntry[]>([]);

  // Nursery-to-NFT Transplant Modal States
  const [activeTrayId, setActiveTrayId] = useState<string | null>(null);
  const [transplantDialogOpen, setTransplantDialogOpen] = useState(false);
  const [targetChannelId, setTargetChannelId] = useState("");
  const [transplantCount, setTransplantCount] = useState<number>(0);
  const [transplantNotes, setTransplantNotes] = useState("");
  const [scanQrInput, setScanQrInput] = useState("");
  const [selectedTrayLogs, setSelectedTrayLogs] = useState<NurseryTray | null>(null);
  const [trayLogsDialogOpen, setTrayLogsDialogOpen] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [globalScanInput, setGlobalScanInput] = useState("");
  const [showGlobalScanner, setShowGlobalScanner] = useState(false);
  const [scannedChannelId, setScannedChannelId] = useState<string | null>(null);
  const [scannedRecord, setScannedRecord] = useState<{ kind: "channel" | "tray" | "not-found"; label: string; detail: string } | null>(null);

  // Nursery Visual Grid and Detailed Hole Planner State
  const [gridModeTrayId, setGridModeTrayId] = useState<string | null>(null);
  const [selectedHoles, setSelectedHoles] = useState<number[]>([]);
  const [cellCrop, setCellCrop] = useState("");
  const [cellPlantedOn, setCellPlantedOn] = useState(new Date().toISOString().split("T")[0]);
  const [cellStatus, setCellStatus] = useState<"germinated" | "planted" | "empty">("planted");

  const ensureTrayCells = (tray: NurseryTray): NurseryCell[] => {
    if (tray.cells && tray.cells.length === tray.plugs) {
      return tray.cells;
    }
    const cells: NurseryCell[] = [];
    for (let i = 0; i < tray.plugs; i++) {
      const isGerminated = i < tray.germinated;
      cells.push({
        holeIndex: i,
        crop: tray.crop || "",
        plantedOn: tray.plantedOn || "",
        germinated: isGerminated,
      });
    }
    return cells;
  };

  const updateNurseryCells = (trayId: string, indices: number[], crop: string, plantedOn: string, status: "germinated" | "planted" | "empty") => {
    setNurseryTrays((trays) => trays.map((tray) => {
      if (tray.id !== trayId) return tray;
      
      const cells = ensureTrayCells(tray).map((cell) => {
        if (indices.includes(cell.holeIndex)) {
          return {
            ...cell,
            crop: status === "empty" ? "" : crop,
            plantedOn: status === "empty" ? "" : plantedOn,
            germinated: status === "germinated",
          };
        }
        return cell;
      });
      
      const germinatedCount = cells.filter(c => c.germinated).length;
      
      // Determine overall crop name representation (comma separated unique crops)
      const activeCrops = Array.from(new Set(cells.map(c => c.crop).filter(Boolean)));
      const cropSummary = activeCrops.join(", ");
      
      // Determine overall plantedOn date (earliest)
      const activeDates = cells.map(c => c.plantedOn).filter(Boolean).sort();
      const plantedSummary = activeDates[0] || "";
      
      let trayStatus: NurseryTray["status"] = "growing";
      const totalFilled = cells.filter(c => c.crop).length;
      if (totalFilled === 0) {
        trayStatus = "empty";
      } else if (germinatedCount >= totalFilled) {
        trayStatus = "ready";
      }
      
      return {
        ...tray,
        cells,
        germinated: germinatedCount,
        crop: cropSummary,
        plantedOn: plantedSummary,
        status: trayStatus,
      };
    }));
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("polyhouse-nursery-trays");
      if (saved) setNurseryTrays(JSON.parse(saved) as NurseryTray[]);
      
      const savedHistory = localStorage.getItem("polyhouse-nursery-history");
      if (savedHistory) setNurseryHistory(JSON.parse(savedHistory) as NurseryHistoryEntry[]);
    } catch {
      // Keep the default trays when local storage is unavailable or invalid.
    }
  }, []);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("polyhouse-nursery-trays", JSON.stringify(nurseryTrays));
    }
  }, [mounted, nurseryTrays]);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("polyhouse-nursery-history", JSON.stringify(nurseryHistory));
    }
  }, [mounted, nurseryHistory]);

  const updateNurseryTray = (id: string, patch: Partial<NurseryTray>) => {
    setNurseryTrays((trays) => trays.map((tray) => {
      if (tray.id !== id) return tray;
      
      const updated = { ...tray, ...patch };
      
      let nextCells = updated.cells ? [...updated.cells] : ensureTrayCells(tray);
      
      if (patch.plugs !== undefined && patch.plugs !== tray.plugs) {
        if (nextCells.length > patch.plugs) {
          nextCells = nextCells.slice(0, patch.plugs);
        } else {
          for (let i = nextCells.length; i < patch.plugs; i++) {
            nextCells.push({
              holeIndex: i,
              crop: updated.crop || "",
              plantedOn: updated.plantedOn || "",
              germinated: i < updated.germinated,
            });
          }
        }
      }
      
      if (patch.crop !== undefined && patch.crop !== tray.crop) {
        nextCells = nextCells.map(c => ({ ...c, crop: patch.crop || "" }));
      }
      
      if (patch.plantedOn !== undefined && patch.plantedOn !== tray.plantedOn) {
        nextCells = nextCells.map(c => ({ ...c, plantedOn: patch.plantedOn || "" }));
      }
      
      if (patch.germinated !== undefined && patch.germinated !== tray.germinated) {
        nextCells = nextCells.map((c, idx) => ({ ...c, germinated: idx < patch.germinated! }));
      }
      
      updated.cells = nextCells;
      return updated;
    }));
  };

  const addNurseryTray = () => {
    const nextNumber = nurseryTrays.length + 1;
    const newId = `tray-${Date.now()}`;
    setNurseryTrays((trays) => [
      ...trays,
      { id: newId, name: `Tray ${nextNumber}`, crop: "", plantedOn: "", plugs: 30, germinated: 0, status: "empty" },
    ]);
  };

  const replantNurseryTray = (trayId: string) => {
    updateNurseryTray(trayId, {
      crop: "",
      plantedOn: "",
      germinated: 0,
      status: "empty",
      cells: [],
    });
    toast.success("Tray reset for a new planting batch. Enter the crop and plug count.");
  };

  const handleGlobalScan = async (value: string) => {
    const scanned = value.trim().toLowerCase();
    if (!scanned) return;
    const freshChannels = await fetchNftChannels();
    const channels = freshChannels.length > 0 ? freshChannels : nftChannels;
    if (freshChannels.length > 0) setNftChannels(freshChannels);
    const channel = channels.find((item) => [item.id, item.qrCode, item.name, `${item.stand || ""}-${item.level || ""}-ch ${item.channelIndex || ""}`].some((match) => match.trim().toLowerCase() === scanned));
    if (channel) {
      setScannedChannelId(channel.id);
      setScannedRecord({ kind: "channel", label: channel.name, detail: `${channel.status} · ${channel.cropName || "No crop planted"} · ${channel.currentCount || 0} plants` });
      setActiveTab("nft");
      setShowGlobalScanner(false);
      return;
    }
    const tray = nurseryTrays.find((item) => [item.id, item.name].some((match) => match.trim().toLowerCase() === scanned));
    if (tray) {
      setScannedChannelId(null);
      setScannedRecord({ kind: "tray", label: tray.name, detail: `${tray.status} · ${tray.crop || "No crop assigned"} · ${tray.germinated}/${tray.plugs} plugs` });
      setActiveTab("nursery");
      setShowGlobalScanner(false);
      return;
    }
    setScannedChannelId(null);
    setScannedRecord({ kind: "not-found", label: "No matching record", detail: `No NFT channel or nursery tray matches "${value.trim()}".` });
    toast.warning(`No nursery tray or NFT channel matches "${value}".`);
  };

  const handleTransplantConfirm = async () => {
    if (!activeTrayId || !targetChannelId) {
      toast.error("Tray and target NFT channel are required");
      return;
    }
    const tray = nurseryTrays.find((t) => t.id === activeTrayId);
    if (!tray) return;

    if (transplantCount <= 0 || transplantCount > tray.germinated) {
      toast.error(`Invalid transplant quantity. Max germinated plugs available: ${tray.germinated}`);
      return;
    }

    try {
      // 1. Update the NFT channel on the server
      const selectedTarget = nftChannels.find((c) => c.id === targetChannelId);
      if (!selectedTarget) {
        toast.error("Target channel not found");
        return;
      }

      const selectedTargetCrops = selectedTarget.crops?.length
        ? selectedTarget.crops
        : selectedTarget.cropName
          ? [{ cropName: selectedTarget.cropName, count: selectedTarget.currentCount ?? 0 }]
          : [];
      const hasDifferentCrop = selectedTarget.status === "growing" && selectedTargetCrops.some(
        (crop) => crop.cropName.trim().toLowerCase() !== tray.crop.trim().toLowerCase()
      );
      let targetChan = selectedTarget;
      if (hasDifferentCrop) {
        const shouldHarvest = window.confirm(
          `${selectedTarget.name} contains ${selectedTarget.currentCount ?? 0} existing plants. Record them as harvested before planting ${tray.crop}?`
        );
        if (!shouldHarvest) return;
        targetChan = await harvestCropRemote(
          selectedTarget.id,
          selectedTarget.currentCount ?? 0,
          0,
          0,
          `Auto-recorded before nursery transplant from ${tray.name}.`,
        );
      }
      if (transplantCount + (targetChan.currentCount ?? 0) > (targetChan.capacity ?? 0)) {
        toast.error(`Destination capacity exceeded. Available space: ${Math.max(0, (targetChan.capacity ?? 0) - (targetChan.currentCount ?? 0))} plants.`);
        return;
      }

      // Identify exact crops transplanted from cells
      const nextCells = ensureTrayCells(tray).map(cell => ({ ...cell }));
      const transplantedCropsMap: { [cropName: string]: number } = {};
      let clearedCount = 0;

      for (let i = 0; i < nextCells.length; i++) {
        if (nextCells[i].germinated && clearedCount < transplantCount) {
          const cName = nextCells[i].crop || tray.crop || "Unknown Crop";
          transplantedCropsMap[cName] = (transplantedCropsMap[cName] || 0) + 1;
          
          nextCells[i].crop = "";
          nextCells[i].plantedOn = "";
          nextCells[i].germinated = false;
          clearedCount++;
        }
      }

      // Fallback if no specific cells were germinated/found (legacy format support)
      if (clearedCount === 0 || Object.keys(transplantedCropsMap).length === 0) {
        const cName = tray.crop || "Unknown Crop";
        transplantedCropsMap[cName] = transplantCount;
      }

      // Add to NFT Channel
      const currentCrops = targetChan.crops?.length
        ? [...targetChan.crops]
        : targetChan.cropName
          ? [{ cropName: targetChan.cropName, count: targetChan.currentCount ?? 0 }]
          : [];

      Object.entries(transplantedCropsMap).forEach(([cropName, count]) => {
        const cropIndex = currentCrops.findIndex((c) => c.cropName.toLowerCase() === cropName.toLowerCase());
        if (cropIndex > -1) {
          currentCrops[cropIndex].count += count;
        } else {
          currentCrops.push({ cropName, count });
        }
      });

      const totalCount = currentCrops.reduce((sum, c) => sum + c.count, 0);
      const firstCropName = currentCrops[0]?.cropName || "";
      const combinedCropName = currentCrops.length > 1
        ? currentCrops.map((c) => `${c.cropName} (${c.count})`).join(", ")
        : firstCropName;

      const updatedChan: NftChannel = {
        ...targetChan,
        status: "growing",
        crops: currentCrops,
        cropName: combinedCropName,
        currentCount: totalCount,
        plantedAt: targetChan.plantedAt || new Date().toISOString(),
        notes: targetChan.notes ? `${targetChan.notes}\nTransplanted ${transplantCount}x ${tray.crop} from ${tray.name}` : `Transplanted ${transplantCount}x ${tray.crop} from ${tray.name}`,
      };

      // Call API to save NFT channels
      const allUpdatedChans = nftChannels.map((c) => c.id === targetChannelId ? updatedChan : c);
      await saveNftChannels(allUpdatedChans);

      // 2. Log in Nursery history
      const newEntry: NurseryHistoryEntry = {
        id: `nurs-harv-${Date.now()}`,
        trayId: tray.id,
        trayName: tray.name,
        crop: tray.crop,
        plantedOn: tray.plantedOn,
        transplantedOn: new Date().toISOString().split("T")[0],
        plugs: tray.plugs,
        germinated: transplantCount,
        notes: transplantNotes || `Shifted to NFT Channel: ${targetChan.name}`,
        channelId: targetChan.id,
        channelName: targetChan.name,
      };
      setNurseryHistory((prev) => [newEntry, ...prev]);

      // 3. Update the Nursery tray counts and cells
      const nextGerminated = Math.max(0, tray.germinated - transplantCount);
      
      const activeCrops = Array.from(new Set(nextCells.map(c => c.crop).filter(Boolean)));
      const nextCrop = activeCrops.join(", ");
      
      const activeDates = nextCells.map(c => c.plantedOn).filter(Boolean).sort();
      const nextPlantedOn = activeDates[0] || "";

      const totalFilled = nextCells.filter(c => c.crop).length;
      let nextStatus: NurseryTray["status"] = "growing";
      if (totalFilled === 0) {
        nextStatus = "empty";
      } else if (nextGerminated >= totalFilled) {
        nextStatus = "ready";
      }

      updateNurseryTray(tray.id, {
        germinated: nextGerminated,
        status: nextStatus,
        crop: nextCrop,
        plantedOn: nextPlantedOn,
        cells: nextCells,
      });

      toast.success(`Successfully transplanted ${transplantCount}x ${tray.crop} to ${targetChan.name}!`);
      setTransplantDialogOpen(false);
      loadCropsData(); // Refresh list from server
    } catch (e: any) {
      toast.error(e.message || "Failed to transplant plants");
    }
  };

  const loadCropsData = () => {
    setLoadingCrops(true);
    Promise.all([
      fetchNftChannels(),
      fetchHarvestHistory()
    ]).then(([chans, hist]) => {
      setNftChannels(chans || []);
      setHarvestHistory(hist || []);
    }).catch(() => {
      // ignore
    }).finally(() => setLoadingCrops(false));
  };

  useEffect(() => {
    if (!user) return;
    if (activeTab === "crops" || activeTab === "history" || activeTab === "nursery" || activeTab === "nft" || activeTab === "grow-bags") {
      loadCropsData();
    }
  }, [activeTab, user]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule);
  const [hasRegisteredDevice, setHasRegisteredDevice] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const savedTab = localStorage.getItem("dashboard-active-tab");
      if (savedTab) {
        setActiveTab(savedTab);
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    if (mounted) {
      try {
        localStorage.setItem("dashboard-active-tab", activeTab);
      } catch (e) {
        // Ignore
      }
    }
  }, [mounted, activeTab]);

  const activeDeviceId = selectedDeviceId.trim() || status?.deviceId || null;
  const backendReachable = status !== null;
  const telemetryFresh = status
    ? Date.now() - (status.telemetryUpdatedAt ?? status.heartbeatUpdatedAt ?? 0) < 300000
    : false;
  const controlsAllowed = hasRegisteredDevice && backendReachable;
  const liveStatus = status;

  // Find active water level sensor configuration calibration
  const currentDevice = devices.find((d) => d.deviceId === activeDeviceId);
  const waterPin = currentDevice?.pins?.find(
    (p) => p.type === "Water Level - Ultrasonic" || p.type === "Water Level - Analog Sensor"
  );
  const tankCapacity = waterPin?.tankCapacityLiters ?? 200;
  const emptyDistance = waterPin?.emptyDistanceCm ?? 50;
  const fullDistance = waterPin?.fullDistanceCm ?? 10;
  const hasWaterReading = (status?.waterDistanceCm ?? 0) > 0 && status?.waterLevelPercent != null;
  const currentVolume = hasWaterReading ? Math.round(status?.waterVolumeLiters ?? 0) : null;

  useEffect(() => {
    if (!mounted || !user) return;
    const requestDeviceId = selectedDeviceId.trim() || "__current__";

    const fetchEnvelope = () => {
      fetchStatusEnvelope(requestDeviceId).then((payload) => {
        setStatus(payload?.status ?? null);
        setHasRegisteredDevice(Boolean(payload?.hasRegisteredDevice));
        if (!selectedDeviceId && payload?.status?.deviceId) {
          setSelectedDeviceId(payload.status.deviceId);
        }
      });
    };

    fetchEnvelope();
    const interval = setInterval(fetchEnvelope, 2000);
    return () => clearInterval(interval);
  }, [mounted, selectedDeviceId, user]);

  useEffect(() => {
    if (!mounted || !user) return;
    fetchDevices().then((d) => d && setDevices(d));
  }, [mounted, activeTab, user]);

  useEffect(() => {
    if (!mounted || !user) return;
    fetchSchedule(activeDeviceId).then((s) => s && setSchedule(s));
  }, [mounted, activeDeviceId, user]);

  const navCategories = [
    {
      title: "Overview & AI",
      items: [
        { id: "status", label: "Dashboard Status", icon: LayoutDashboard },
        { id: "camera", label: "Visual AI Camera", icon: Camera },
        { id: "ai", label: "AI Insights", icon: Zap },
      ]
    },
    {
      title: "Crop Management",
      items: [
        { id: "crops", label: "Crops Manager", icon: Sprout, badge: "3 Active" },
        { id: "nursery", label: "Nursery Trays", icon: Warehouse },
        { id: "nft", label: "NFT Channels", icon: Grid },
        { id: "grow-bags", label: "Grow Bags", icon: Package },
        { id: "history", label: "Channels History", icon: History },
        { id: "harvested", label: "Harvested Log", icon: TrendingUp },
      ]
    },
    {
      title: "Telemetry & Logs",
      items: [
        { id: "analytics", label: "Sensor History", icon: LineChart },
        { id: "stats", label: "Irrigation Stats", icon: BarChart3 },
        { id: "readings", label: "Manual Logs", icon: FileText },
      ]
    },
    {
      title: "Hardware & Control",
      items: [
        { id: "controls", label: "Actuator Controls", icon: Settings },
        { id: "plan", label: "Watering Plan", icon: Clock },
        { id: "nutrition", label: "Nutrition Dosing", icon: FlaskConical },
        { id: "water", label: "Reservoir & Water", icon: Droplet },
        { id: "devices", label: "Hardware Remapper", icon: Cpu, badge: String(devices.length) },
      ]
    },
    ...(user?.role === "admin" ? [{
      title: "Administration",
      items: [
        { id: "users", label: "Team Accounts", icon: Users },
      ]
    }] : [])
  ];

  const navItems = navCategories.flatMap((c) => c.items);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
        <Sprout className="h-10 w-10 text-emerald-500 animate-pulse" />
        <span className="text-xs font-bold text-slate-400 animate-pulse font-mono uppercase tracking-wider">Authenticating Portal Session...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorBoundary>
        <LoginScreen onLogin={handleLogin} />
        <Toaster richColors position="top-center" />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background flex">
        {/* Designer Sidebar */}
        <aside className="w-64 bg-card border-r border-border flex flex-col justify-between shrink-0 hidden md:flex sticky top-0 h-screen z-10">
          <div className="p-5 space-y-6 overflow-y-auto flex-1">
            {/* Branding Header */}
            <div className="flex items-center gap-3 border-b border-border/40 pb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shrink-0">
                <Sprout className="h-5 w-5 text-emerald-300 animate-pulse" />
              </div>
              <div>
                <h1 className="text-sm font-bold tracking-tight text-foreground">PolyHouse ERP</h1>
                <span className="text-[10px] text-muted-foreground block font-semibold">IoT Operations Center</span>
              </div>
            </div>

            {/* Nav Categories */}
            <div className="space-y-5">
              {navCategories.map((category) => (
                <div key={category.title} className="space-y-1.5">
                  <span className="text-[9px] font-bold text-muted-foreground/80 uppercase tracking-wider px-2 block">
                    {category.title}
                  </span>
                  <nav className="space-y-0.5">
                    {category.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          activeTab === item.id
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <item.icon className="h-3.5 w-3.5 shrink-0" />
                          <span>{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                            activeTab === item.id ? "bg-white/20 text-white" : "bg-primary/10 text-primary"
                          }`}>
                            {item.badge}
                          </span>
                        )}
                      </button>
                    ))}
                  </nav>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar Footer / User Session */}
          <div className="p-4 border-t border-border/60 bg-muted/25 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-foreground truncate">{user?.username}</span>
                <span className="text-[9px] font-semibold text-muted-foreground uppercase">{user?.role}</span>
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleLogout}
                className="text-red-500 hover:text-red-600 hover:bg-red-500/5 font-bold h-7 px-2.5"
              >
                Log out
              </Button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Mobile Bar */}
          <header className="border-b border-border bg-card md:hidden p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sprout className="h-5 w-5 text-primary animate-pulse" />
              <span className="text-sm font-bold">PolyHouse ERP</span>
            </div>
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="Module..." />
              </SelectTrigger>
              <SelectContent>
                {navItems.map((item) => (
                  <SelectItem key={item.id} value={item.id} className="text-xs">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </header>

          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col space-y-5 overflow-visible p-4 sm:p-6 md:space-y-6 md:p-8">
            <Card className="border-primary/20 bg-primary/5 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-primary" />
                  <div>
                    <h2 className="text-sm font-bold">Scan farm QR code</h2>
                    <p className="text-[11px] text-muted-foreground">Find an NFT channel or nursery tray and open its details.</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    aria-label="Scan nursery tray or NFT channel QR code"
                    placeholder="Scan or enter QR value"
                    value={globalScanInput}
                    onChange={(event) => setGlobalScanInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleGlobalScan(globalScanInput);
                    }}
                    className="h-9 w-full bg-background text-xs sm:w-64"
                  />
                  <Button type="button" variant="outline" className="h-9 text-xs" onClick={() => handleGlobalScan(globalScanInput)}>
                    <QrCode className="mr-2 h-4 w-4" /> Find details
                  </Button>
                  <Button type="button" className="h-9 text-xs" onClick={() => setShowGlobalScanner((open) => !open)}>
                    <Camera className="mr-2 h-4 w-4" /> {showGlobalScanner ? "Close scanner" : "Scan with camera"}
                  </Button>
                </div>
              </div>
              {showGlobalScanner && (
                <div className="mt-3 max-w-sm">
                  <CameraQrScanner
                    onScanSuccess={(value) => {
                      setGlobalScanInput(value);
                      setShowGlobalScanner(false);
                      handleGlobalScan(value);
                    }}
                    onClose={() => setShowGlobalScanner(false)}
                  />
                </div>
              )}
              {scannedRecord && (
                <div className={`mt-3 flex flex-col gap-2 rounded-lg border p-3 text-xs sm:flex-row sm:items-center sm:justify-between ${scannedRecord.kind === "not-found" ? "border-red-500/30 bg-red-500/5" : "border-primary/20 bg-background"}`}>
                  <span><Badge variant="outline" className="mr-2">{scannedRecord.kind === "channel" ? "NFT channel" : scannedRecord.kind === "tray" ? "Nursery tray" : "Not found"}</Badge><strong>{scannedRecord.label}</strong></span>
                  <span className="text-muted-foreground">{scannedRecord.detail}</span>
                  {scannedRecord.kind !== "not-found" && (
                    <Button type="button" variant="outline" className="h-7 shrink-0 text-[11px]" onClick={() => setActiveTab(scannedRecord.kind === "channel" ? "history" : "nursery")}>
                      {scannedRecord.kind === "channel" ? "View history" : "View tray"}
                    </Button>
                  )}
                </div>
              )}
            </Card>
            
            {/* Dashboard tab */}
            {activeTab === "status" && (
              <div className="space-y-6">
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Operational Overview</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Real-time status envelope and automated irrigation logs.</p>
                  </div>
                  <Badge variant={backendReachable ? "default" : "destructive"}>
                    {backendReachable ? "System Connected" : "API Offline"}
                  </Badge>
                </div>

                {status && (
                  <Card className={`border p-4 ${status.fault && status.fault !== "OK" && status.fault !== "NONE" ? "border-destructive/30 bg-destructive/5" : !telemetryFresh ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/25 bg-emerald-500/5"}`}>
                    <div className="flex items-start gap-3">
                      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${status.fault && status.fault !== "OK" && status.fault !== "NONE" ? "text-destructive" : !telemetryFresh ? "text-amber-500" : "text-emerald-500"}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground">
                          {status.fault && status.fault !== "OK" && status.fault !== "NONE" ? `Attention needed: ${status.fault}` : !telemetryFresh ? "Controller is not sending recent readings" : status.waterLevel === "LOW" ? "Reservoir water is low" : status.ph != null && (status.ph < 5.5 || status.ph > 6.5) ? "pH needs attention" : status.ec != null && (status.ec < 0.8 || status.ec > 1.6) ? "EC needs attention" : "Farm is running normally"}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {status.fault && status.fault !== "OK" && status.fault !== "NONE" ? "Check the pump, water line, and controller before resuming automatic watering." : !telemetryFresh ? "Check the ESP32 connection. The last values remain visible below." : status.waterLevel === "LOW" ? "Refill the reservoir before the next irrigation cycle." : "No immediate action is required."}
                        </p>
                      </div>
                    </div>
                  </Card>
                )}

                {!backendReachable ? (
                  <div className="space-y-4">
                    <Card className="border-dashed p-6 text-center text-muted-foreground">
                      <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2 animate-bounce" />
                      <span className="font-semibold block text-sm">Local Server API Offline</span>
                      <span className="text-xs block mt-1">Please start the node backend or check system network configuration.</span>
                    </Card>
                  </div>
                ) : (
                  <>
                    {!telemetryFresh ? (
                      <Card className="border-dashed p-4 border-amber-500/25 bg-amber-500/5 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">Microcontroller Telemetry Interrupted</div>
                          <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                            The ESP32 is not posting diagnostics right now. Relay overrides remain available.
                          </div>
                        </div>
                        <Badge variant="destructive">OFFLINE</Badge>
                      </Card>
                    ) : (
                      <FaultAlertBanner status={status!} />
                    )}

                    <NextCyclePanel status={status!} schedule={schedule} online={telemetryFresh} />

                    <DashboardCharts deviceId={activeDeviceId} status={liveStatus} onViewHistory={() => setActiveTab("analytics")} />
                    <EnhancedStatusCards status={status!} />

                    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
                      <div className="space-y-6">
                        <PumpStateDisplay status={status!} online={telemetryFresh} />
                        <LiveCycleHistoryPanel deviceId={activeDeviceId} />
                      </div>
                      <div className="space-y-6">
                        <FaultHistoryPanel deviceId={activeDeviceId} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === "controls" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Manual Controls</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Override automatic watering and dosing only when the selected hardware node is ready.</p>
                </div>
                <ManualControlPanel
                  status={liveStatus}
                  deviceId={activeDeviceId}
                  online={backendReachable}
                  controlsAllowed={controlsAllowed}
                  devices={devices}
                />
                <RelayStatesCard
                  status={liveStatus}
                  online={telemetryFresh}
                  deviceId={activeDeviceId}
                  controlsAllowed={controlsAllowed}
                />
              </div>
            )}

            {/* High-Fidelity Crops Tab */}
            {activeTab === "crops" && (() => {
              // 1. Calculate active variety counts growing in NFT + Nursery
              const activeCropsCountMap: { [name: string]: { nft: number; nursery: number } } = {};
              nftChannels.forEach((chan) => {
                if (chan.status === "growing") {
                  if (chan.crops && chan.crops.length > 0) {
                    chan.crops.forEach((cr) => {
                      const key = cr.cropName.trim() || "Unknown";
                      activeCropsCountMap[key] = activeCropsCountMap[key] || { nft: 0, nursery: 0 };
                      activeCropsCountMap[key].nft += cr.count;
                    });
                  } else if (chan.cropName) {
                    const key = chan.cropName.trim() || "Unknown";
                    activeCropsCountMap[key] = activeCropsCountMap[key] || { nft: 0, nursery: 0 };
                    activeCropsCountMap[key].nft += chan.currentCount ?? 0;
                  }
                }
              });
              nurseryTrays.forEach((tr) => {
                if (tr.cells && tr.cells.length > 0) {
                  tr.cells.forEach((cell) => {
                    if (cell.crop && cell.germinated) {
                      const key = cell.crop.trim() || "Unknown";
                      activeCropsCountMap[key] = activeCropsCountMap[key] || { nft: 0, nursery: 0 };
                      activeCropsCountMap[key].nursery += 1;
                    }
                  });
                } else if (tr.crop && tr.germinated > 0) {
                  const key = tr.crop.trim() || "Unknown";
                  activeCropsCountMap[key] = activeCropsCountMap[key] || { nft: 0, nursery: 0 };
                  activeCropsCountMap[key].nursery += tr.germinated;
                }
              });

              const activeCropsData = Object.entries(activeCropsCountMap).map(([name, value]) => ({
                name,
                NFT: value.nft,
                Nursery: value.nursery,
              })).sort((a, b) => (b.NFT + b.Nursery) - (a.NFT + a.Nursery));
              const activeNftPlants = nftChannels
                .filter((channel) => channel.status === "growing")
                .reduce((sum, channel) => sum + (channel.currentCount || 0), 0);
              const activeNurseryPlugs = nurseryTrays
                .filter((tray) => tray.status !== "empty")
                .reduce((sum, tray) => sum + tray.germinated, 0);

              // Filter completed harvest history list
              const filteredHarvestHistory = harvestHistory.filter((item) => {
                if (harvestSearch.trim() !== "") {
                  const query = harvestSearch.toLowerCase();
                  const match = 
                    item.cropName.toLowerCase().includes(query) ||
                    (item.notes || "").toLowerCase().includes(query) ||
                    (item.channelName || "").toLowerCase().includes(query);
                  if (!match) return false;
                }

                if (harvestCropSelect !== "all") {
                  const key = item.cropName.split("(")[0].trim().toLowerCase();
                  if (key !== harvestCropSelect.toLowerCase()) return false;
                }

                if (harvestStart) {
                  const itemDate = item.harvestedAt.split("T")[0];
                  if (itemDate < harvestStart) return false;
                }
                if (harvestEnd) {
                  const itemDate = item.harvestedAt.split("T")[0];
                  if (itemDate > harvestEnd) return false;
                }

                return true;
              });

              // 2. Calculate completed harvest yields usable vs waste
              const historicalYieldMap: { [name: string]: { yield: number; waste: number } } = {};
              filteredHarvestHistory.forEach((item) => {
                const key = item.cropName.split("(")[0].trim() || "Unknown";
                if (!historicalYieldMap[key]) {
                  historicalYieldMap[key] = { yield: 0, waste: 0 };
                }
                historicalYieldMap[key].yield += item.yieldQty ?? item.currentCount ?? 0;
                historicalYieldMap[key].waste += item.wasteQty ?? 0;
              });

              const historicalYieldData = Object.entries(historicalYieldMap).map(([name, stats]) => ({
                name,
                "Usable Yield": stats.yield,
                "Waste / Defect": stats.waste,
              })).sort((a, b) => (b["Usable Yield"] + b["Waste / Defect"]) - (a["Usable Yield"] + a["Waste / Defect"]));

              const HARVEST_PAGE_SIZE = 5;
              const totalHarvestPages = Math.ceil(filteredHarvestHistory.length / HARVEST_PAGE_SIZE);
              const paginatedHarvestHistory = filteredHarvestHistory.slice(harvestPage * HARVEST_PAGE_SIZE, (harvestPage + 1) * HARVEST_PAGE_SIZE);

              return (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <Sprout className="h-5 w-5 text-primary" />
                        Crops Management Console
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">Track growth logs, varieties seeding, and crop yields.</p>
                    </div>
                    <Button onClick={loadCropsData} variant="outline" size="sm" className="text-xs font-semibold">
                      Refresh Records
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="p-4 flex items-center justify-between border-border/80 bg-card">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-bold block">Active NFT Crops</span>
                        <span className="text-2xl font-extrabold block text-foreground">
                          {nftChannels.filter((c) => c.status === "growing").length} Batches
                        </span>
                      </div>
                      <Sprout className="h-8 w-8 text-green-500 opacity-80" />
                    </Card>
                    <Card className="p-4 flex items-center justify-between border-border/80 bg-card">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-bold block">Total Mapped Plants</span>
                        <span className="text-2xl font-extrabold block text-foreground">
                          {activeNftPlants} Plants
                        </span>
                      </div>
                      <Grid className="h-8 w-8 text-primary opacity-80" />
                    </Card>
                    <Card className="p-4 flex items-center justify-between border-border/80 bg-card">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-bold block">Active Nursery Plugs</span>
                        <span className="text-2xl font-extrabold block text-foreground">
                          {activeNurseryPlugs} Plugs
                        </span>
                      </div>
                      <Warehouse className="h-8 w-8 text-amber-500 opacity-80" />
                    </Card>
                    <Card className="p-4 flex items-center justify-between border-border/80 bg-card">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase font-bold block">Completed Harvests</span>
                        <span className="text-2xl font-extrabold block text-foreground">
                          {harvestHistory.length} Batches
                        </span>
                      </div>
                      <TrendingUp className="h-8 w-8 text-yellow-500 opacity-80" />
                    </Card>
                  </div>

                  {/* Analytics Charts Panel */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Active Crops Bar Chart */}
                    <Card className="p-5 border-border/80 bg-card shadow-sm space-y-4">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <Sprout className="h-4 w-4 text-emerald-500" />
                          Current Cultivated Varieties: NFT vs Nursery
                        </span>
                        <p className="text-[10px] text-muted-foreground">Separate counts show established NFT plants and nursery plugs awaiting transplant.</p>
                      </div>
                      {activeCropsData.length === 0 ? (
                        <div className="h-64 flex items-center justify-center text-xs text-muted-foreground italic">No crops currently in system.</div>
                      ) : (
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={activeCropsData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                              <XAxis type="number" />
                              <YAxis dataKey="name" type="category" width={80} style={{ fontSize: 10 }} />
                              <Tooltip />
                              <Bar dataKey="NFT" fill="#10b981" radius={[0, 4, 4, 0]} />
                              <Bar dataKey="Nursery" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </Card>

                    {/* Historical Yield Chart */}
                    <Card className="p-5 border-border/80 bg-card shadow-sm space-y-4">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <TrendingUp className="h-4 w-4 text-amber-500" />
                          Yield Output vs. Waste by Variety
                        </span>
                        <p className="text-[10px] text-muted-foreground">Cumulative totals of usable yields and wasted plants across history.</p>
                      </div>
                      {historicalYieldData.length === 0 ? (
                        <div className="h-64 flex items-center justify-center text-xs text-muted-foreground italic">No historical harvest data yet.</div>
                      ) : (
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={historicalYieldData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="name" style={{ fontSize: 10 }} />
                              <YAxis />
                              <Tooltip />
                              <Legend style={{ fontSize: 10 }} />
                              <Bar dataKey="Usable Yield" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                              <Bar dataKey="Waste / Defect" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </Card>
                  </div>

                  {/* Harvest History Log */}
                   <Card className="p-5 border-border/80 bg-card">
                    <div className="border-b pb-3 mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-bold flex items-center gap-2">
                          <History className="h-4 w-4 text-amber-500" />
                          Completed Harvest History Database
                        </h3>
                        <p className="text-[11px] text-muted-foreground">Audit logs of completed crop batches and yields.</p>
                      </div>

                      {/* Pagination Controls */}
                      {totalHarvestPages > 1 && (
                        <div className="flex items-center gap-1.5 self-end">
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={harvestPage === 0}
                            onClick={() => setHarvestPage((p) => p - 1)}
                            className="h-6 w-14 text-[10px]"
                          >
                            Prev
                          </Button>
                          <span className="text-[10px] font-bold text-muted-foreground font-mono">
                            {harvestPage + 1} / {totalHarvestPages}
                          </span>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={harvestPage >= totalHarvestPages - 1}
                            onClick={() => setHarvestPage((p) => p + 1)}
                            className="h-6 w-14 text-[10px]"
                          >
                            Next
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Filter Inputs block */}
                    <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/20 p-3 mb-4 md:flex-row md:items-center text-xs">
                      {/* Search */}
                      <div className="relative flex-1 min-w-[150px]">
                        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Search batch..."
                          value={harvestSearch}
                          onChange={(e) => {
                            setHarvestSearch(e.target.value);
                            setHarvestPage(0);
                          }}
                          className="pl-7 h-7.5 text-xs bg-background"
                        />
                      </div>

                      {/* Crop select */}
                      <div className="w-full md:w-36">
                        <Select
                          value={harvestCropSelect}
                          onValueChange={(val) => {
                            setHarvestCropSelect(val);
                            setHarvestPage(0);
                          }}
                        >
                          <SelectTrigger className="h-7.5 text-xs bg-background">
                            <SelectValue placeholder="Variety" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Varieties</SelectItem>
                            {(() => {
                              const uniqueCrops = Array.from(
                                new Set(
                                  harvestHistory
                                    .map((h) => h.cropName.split("(")[0].trim())
                                    .filter(Boolean)
                                )
                              ).sort();
                              return uniqueCrops.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ));
                            })()}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Date bounds */}
                      <div className="flex items-center gap-1.5 bg-background px-2 py-0.5 rounded border">
                        <span className="text-[9px] text-muted-foreground font-bold uppercase">From</span>
                        <input
                          type="date"
                          value={harvestStart}
                          onChange={(e) => {
                            setHarvestStart(e.target.value);
                            setHarvestPage(0);
                          }}
                          className="bg-transparent text-[11px] font-mono font-semibold focus:outline-none w-26"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 bg-background px-2 py-0.5 rounded border">
                        <span className="text-[9px] text-muted-foreground font-bold uppercase">To</span>
                        <input
                          type="date"
                          value={harvestEnd}
                          onChange={(e) => {
                            setHarvestEnd(e.target.value);
                            setHarvestPage(0);
                          }}
                          className="bg-transparent text-[11px] font-mono font-semibold focus:outline-none w-26"
                        />
                      </div>

                      {(harvestSearch || harvestStart || harvestEnd || harvestCropSelect !== "all") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setHarvestSearch("");
                            setHarvestStart("");
                            setHarvestEnd("");
                            setHarvestCropSelect("all");
                            setHarvestPage(0);
                          }}
                          className="h-7 px-2 text-[10px] text-destructive hover:bg-destructive/5 font-semibold"
                        >
                          Reset
                        </Button>
                      )}
                    </div>

                    {loadingCrops ? (
                      <div className="text-center py-6 text-xs text-muted-foreground">Loading harvest log...</div>
                    ) : paginatedHarvestHistory.length === 0 ? (
                      <div className="text-center py-6 text-xs text-muted-foreground italic">No completed crops harvested matching the filters.</div>
                    ) : (
                      <div className="space-y-3 font-mono text-xs">
                        {paginatedHarvestHistory.map((item) => {
                          const ageDays = item.plantedAt 
                            ? Math.max(1, Math.round((new Date(item.harvestedAt).getTime() - new Date(item.plantedAt).getTime()) / (24 * 60 * 60 * 1000)))
                            : null;
                          
                          return (
                            <div key={item.id} className="p-3.5 rounded-lg border bg-muted/30 flex flex-col sm:flex-row justify-between gap-3">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-foreground text-xs">{item.cropName}</span>
                                  <div className="flex gap-1 flex-wrap">
                                    <Badge variant="outline" className="text-[9px] font-bold bg-green-500/5 text-green-600 border-green-500/20">
                                      Yield: {item.yieldQty ?? item.currentCount ?? 0}
                                    </Badge>
                                    {item.wasteQty !== undefined && item.wasteQty > 0 && (
                                      <Badge variant="outline" className="text-[9px] font-bold bg-red-500/5 text-red-600 border-red-500/20">
                                        Waste: {item.wasteQty}
                                      </Badge>
                                    )}
                                    {item.avgWeightGrams !== undefined && item.avgWeightGrams > 0 && (
                                      <Badge variant="outline" className="text-[9px] font-bold bg-blue-500/5 text-blue-600 border-blue-500/20">
                                        Avg: {item.avgWeightGrams}g
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <span className="text-[10px] text-muted-foreground block">Origin: {item.channelName} (Cap {item.capacity || 50})</span>
                                {item.notes && <p className="text-[10px] text-slate-500 italic mt-1 bg-background p-1.5 rounded">Notes: {item.notes}</p>}
                              </div>
                              <div className="text-left sm:text-right text-[10px] space-y-1 self-start sm:self-center">
                                <div className="text-foreground">Harvested: {new Date(item.harvestedAt).toLocaleDateString()}</div>
                                {ageDays && <div className="text-muted-foreground font-semibold">Total Age: {ageDays} days</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>

                  {/* Nursery History Log */}
                  <Card className="p-5 border-border/80 bg-card">
                    <div className="border-b pb-3 mb-4">
                      <h3 className="text-sm font-bold flex items-center gap-2">
                        <Grid className="h-4 w-4 text-green-500" />
                        Nursery Seedling Transplant Logs
                      </h3>
                      <p className="text-[11px] text-muted-foreground">Historical records of propagated trays and transplanted plugs.</p>
                    </div>

                    {nurseryHistory.length === 0 ? (
                      <div className="text-center py-6 text-xs text-muted-foreground italic">No nursery trays transplanted yet.</div>
                    ) : (
                      <div className="space-y-3 font-mono text-xs">
                        {nurseryHistory.map((item) => {
                          const ageDays = item.plantedOn
                            ? Math.max(1, Math.round((new Date(item.transplantedOn).getTime() - new Date(item.plantedOn).getTime()) / (24 * 60 * 60 * 1000)))
                            : null;

                          return (
                            <div key={item.id} className="p-3.5 rounded-lg border bg-muted/30 flex flex-col sm:flex-row justify-between gap-3">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-foreground text-xs">{item.crop}</span>
                                  <Badge variant="outline" className="text-[9px] font-bold bg-primary/5 text-primary border-primary/20">
                                    Transplanted: {item.germinated} / {item.plugs} Plugs
                                  </Badge>
                                </div>
                                <span className="text-[10px] text-muted-foreground block">Origin: {item.trayName}</span>
                                {item.notes && <p className="text-[10px] text-slate-500 italic mt-1 bg-background p-1.5 rounded">Notes: {item.notes}</p>}
                              </div>
                              <div className="text-left sm:text-right text-[10px] space-y-1 self-start sm:self-center">
                                <div className="text-foreground">Transplanted: {new Date(item.transplantedOn).toLocaleDateString()}</div>
                                {ageDays && <div className="text-muted-foreground font-semibold">Propagated Age: {ageDays} days</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                </div>
              );
            })()}

            {/* NFT channels */}
            {activeTab === "history" && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                    <History className="h-5 w-5 text-primary" />
                    Channels History & Production
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Review current production by stand and row, with crop populations and upcoming harvests.</p>
                </div>
                <CropOperationsDashboard mode="channels" channels={nftChannels} harvestHistory={harvestHistory} nurseryTrays={nurseryTrays} nurseryHistory={nurseryHistory} />
              </div>
            )}

            {activeTab === "nft" && <NftChannelsTab initialChannelId={scannedChannelId} />}
            {activeTab === "grow-bags" && <GrowBagsTab />}

            {/* High-Fidelity Nursery Trays */}
            {activeTab === "nursery" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                    <Grid className="h-5 w-5 text-primary" />
                    Germination & Nursery Console
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Control seedling trays, propagation heat, and germination timers.</p>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Your trays</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Add a tray, record what was planted, and update germination as seedlings grow.</p>
                  </div>
                  <Button onClick={addNurseryTray} className="w-full sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" /> Add tray
                  </Button>
                </div>

                <CropOperationsDashboard mode="nursery" channels={nftChannels} harvestHistory={harvestHistory} nurseryTrays={nurseryTrays} nurseryHistory={nurseryHistory} />

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {nurseryTrays.map((tray) => {
                    const germination = tray.plugs > 0 ? Math.min(100, Math.round((tray.germinated / tray.plugs) * 100)) : 0;
                    return (
                      <Card key={tray.id} className="min-w-0 space-y-4 border-border/80 p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <Input aria-label="Tray name" value={tray.name} onChange={(e) => updateNurseryTray(tray.id, { name: e.target.value })} className="h-8 text-sm font-bold" />
                            <p className="mt-1 text-[11px] text-muted-foreground">{tray.crop || "No crop assigned yet"}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" title="View tray seeding & transplant history" onClick={() => {
                              setSelectedTrayLogs(tray);
                              setTrayLogsDialogOpen(true);
                            }}>
                              <History className="h-4 w-4 text-blue-500" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Remove tray" onClick={() => setNurseryTrays((trays) => trays.filter((item) => item.id !== tray.id))}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor={`${tray.id}-crop`} className="text-xs">Crop or variety</Label>
                            <Input id={`${tray.id}-crop`} placeholder="e.g. Romaine lettuce" value={tray.crop} onChange={(e) => updateNurseryTray(tray.id, { crop: e.target.value, status: e.target.value ? "growing" : "empty" })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`${tray.id}-date`} className="text-xs">Planted on</Label>
                            <Input id={`${tray.id}-date`} type="date" value={tray.plantedOn} onChange={(e) => updateNurseryTray(tray.id, { plantedOn: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`${tray.id}-plugs`} className="text-xs">Total plugs</Label>
                            <Input id={`${tray.id}-plugs`} type="number" min={1} value={tray.plugs} onChange={(e) => updateNurseryTray(tray.id, { plugs: Math.max(1, Number(e.target.value)) })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`${tray.id}-germinated`} className="text-xs">Germinated plugs</Label>
                            <Input id={`${tray.id}-germinated`} type="number" min={0} max={tray.plugs} value={tray.germinated} onChange={(e) => updateNurseryTray(tray.id, { germinated: Math.min(tray.plugs, Math.max(0, Number(e.target.value))), status: Number(e.target.value) >= tray.plugs ? "ready" : "growing" })} />
                          </div>
                        </div>

                        <div className="space-y-2 border-t border-border/60 pt-3">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-semibold">Germination progress</span>
                            <span className="font-bold text-primary">{germination}%</span>
                          </div>
                          <Progress value={germination} className="h-2" />
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span>{tray.germinated} of {tray.plugs} plugs ready</span>
                            <Select value={tray.status} onValueChange={(value: NurseryTray["status"]) => updateNurseryTray(tray.id, { status: value })}>
                              <SelectTrigger className="h-7 w-28 text-[11px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="empty">Empty</SelectItem>
                                <SelectItem value="growing">Growing</SelectItem>
                                <SelectItem value="ready">Ready</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {/* Visual Grid Toggle */}
                          <div className="pt-2 border-t border-border/40">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (gridModeTrayId === tray.id) {
                                  setGridModeTrayId(null);
                                  setSelectedHoles([]);
                                } else {
                                  setGridModeTrayId(tray.id);
                                  setSelectedHoles([]);
                                }
                              }}
                              className="w-full text-xs font-bold border-indigo-500/20 text-indigo-600 hover:bg-indigo-50/50 hover:text-indigo-700"
                            >
                              <Grid className="mr-1.5 h-3.5 w-3.5" />
                              {gridModeTrayId === tray.id ? "Hide Plug Grid Planner" : "Open Visual Grid Planner"}
                            </Button>
                          </div>

                          {gridModeTrayId === tray.id && (() => {
                            const cells = ensureTrayCells(tray);
                            
                            const getGridCols = (plugsCount: number): number => {
                              if (plugsCount === 10) return 5;
                              if (plugsCount === 12) return 4;
                              if (plugsCount === 15) return 5;
                              if (plugsCount === 20) return 5;
                              if (plugsCount === 30) return 6;
                              if (plugsCount === 50) return 10;
                              if (plugsCount === 72) return 12;
                              if (plugsCount === 104) return 13;
                              for (let cols = Math.ceil(Math.sqrt(plugsCount * 1.5)); cols >= 1; cols--) {
                                if (plugsCount % cols === 0) return cols;
                              }
                              return Math.ceil(Math.sqrt(plugsCount));
                            };
                            
                            const cols = getGridCols(tray.plugs);
                            
                            // Compute summary stats of crops in the tray
                            const cropSummaryMap: { [cropName: string]: { total: number; germinated: number } } = {};
                            let emptyPlugsCount = 0;
                            cells.forEach((cell) => {
                              if (cell.crop) {
                                const key = cell.crop.trim();
                                if (!cropSummaryMap[key]) {
                                  cropSummaryMap[key] = { total: 0, germinated: 0 };
                                }
                                cropSummaryMap[key].total += 1;
                                if (cell.germinated) {
                                  cropSummaryMap[key].germinated += 1;
                                }
                              } else {
                                emptyPlugsCount += 1;
                              }
                            });

                            const suggestedCrops = Array.from(new Set([
                              ...nurseryTrays.flatMap(t => (t.cells || []).map(c => c.crop)),
                              ...nftChannels.flatMap(c => c.crops?.map(cr => cr.cropName) || [c.cropName]),
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
                            ].filter(Boolean) as string[])).sort();

                            return (
                              <div className="space-y-4 rounded-xl border border-indigo-500/10 bg-indigo-50/20 p-4 transition-all duration-200">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Visual Plugs Layout ({tray.plugs} Holes)</div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setSelectedHoles(cells.map(c => c.holeIndex))}
                                      className="h-5 px-1.5 text-[9px] font-bold text-indigo-600 hover:bg-indigo-100"
                                    >
                                      Select All
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setSelectedHoles([])}
                                      className="h-5 px-1.5 text-[9px] font-bold text-indigo-600 hover:bg-indigo-100"
                                    >
                                      Clear
                                    </Button>
                                  </div>
                                </div>

                                {/* Crops Summary list */}
                                <div className="flex flex-wrap gap-2 rounded-lg border border-indigo-200/40 bg-background/60 p-2.5 shadow-sm">
                                  <div className="w-full text-[9px] font-extrabold uppercase tracking-wider text-indigo-700/80 mb-1">Tray Contents Summary</div>
                                  {Object.entries(cropSummaryMap).map(([cropName, stats]) => {
                                    const style = getCropStyle(cropName, true);
                                    return (
                                      <Badge 
                                        key={cropName} 
                                        variant="outline" 
                                        className={`flex items-center gap-1.5 py-0.5 px-2 rounded-md text-[10px] font-bold ${style.bg} ${style.border} ${style.text}`}
                                      >
                                        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                                        <span>{cropName}: <strong>{stats.total}</strong> Plugs ({stats.germinated} Sprouted)</span>
                                      </Badge>
                                    );
                                  })}
                                  {emptyPlugsCount > 0 && (
                                    <Badge 
                                      variant="outline" 
                                      className="flex items-center gap-1.5 py-0.5 px-2 rounded-md text-[10px] font-bold bg-muted/20 border-dashed border-muted-foreground/30 text-muted-foreground"
                                    >
                                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                                      <span>Empty: <strong>{emptyPlugsCount}</strong> Plugs</span>
                                    </Badge>
                                  )}
                                </div>

                                {/* Legend */}
                                <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <span className="h-2 w-2 rounded-full bg-indigo-600/25 border border-indigo-500" /> Planted
                                  </span>
                                  <span className="flex items-center gap-1 font-semibold text-emerald-600">
                                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Germinated Sprout
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <span className="h-2 w-2 rounded-full border border-dashed border-muted-foreground/50 bg-transparent" /> Empty
                                  </span>
                                  {selectedHoles.length > 0 && (
                                    <span className="ml-auto text-indigo-700 font-bold font-mono">
                                      {selectedHoles.length} Selected
                                    </span>
                                  )}
                                </div>

                                {/* Visual Grid */}
                                <div 
                                  className="grid gap-2 border border-indigo-200/50 rounded-lg p-2.5 bg-background shadow-inner max-h-[220px] overflow-y-auto"
                                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                                >
                                  {cells.map((cell) => {
                                    const isSelected = selectedHoles.includes(cell.holeIndex);
                                    const style = getCropStyle(cell.crop, cell.germinated);
                                    const selectBorder = isSelected 
                                      ? "ring-2 ring-indigo-600 ring-offset-1 scale-105 z-10" 
                                      : "hover:scale-105";

                                    return (
                                      <button
                                        key={cell.holeIndex}
                                        type="button"
                                        title={`${cell.crop ? `${cell.crop} (Planted: ${cell.plantedOn || "N/A"})` : "Hole Empty"} (${cell.germinated ? "Germinated" : "Planted"})`}
                                        onClick={() => {
                                          if (isSelected) {
                                            setSelectedHoles(prev => prev.filter(idx => idx !== cell.holeIndex));
                                          } else {
                                            setSelectedHoles(prev => [...prev, cell.holeIndex]);
                                            if (selectedHoles.length === 0) {
                                              setCellCrop(cell.crop || "");
                                              setCellPlantedOn(cell.plantedOn || new Date().toISOString().split("T")[0]);
                                              setCellStatus(cell.crop ? (cell.germinated ? "germinated" : "planted") : "planted");
                                            }
                                          }
                                        }}
                                        className={`relative aspect-square flex items-center justify-center rounded-full text-[9px] font-bold font-mono cursor-pointer transition-all duration-150 ${style.bg} ${style.border} ${style.text} ${selectBorder}`}
                                      >
                                        {cell.holeIndex + 1}
                                        {cell.crop && (
                                          <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background ${style.dot}`} />
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>

                                {/* Hole Details Editor */}
                                {selectedHoles.length > 0 && (
                                  <div className="border border-indigo-200/50 rounded-lg p-3 bg-indigo-50/50 space-y-3">
                                    <div className="text-2xs font-extrabold text-indigo-700">Edit selected plugs ({selectedHoles.length})</div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <Label className="text-[10px] font-semibold">Crop Variety</Label>
                                        <Input
                                          list="crop-list-suggestions"
                                          placeholder="Lettuce/Basil"
                                          value={cellCrop}
                                          onChange={(e) => setCellCrop(e.target.value)}
                                          className="h-7 text-xs bg-background"
                                        />
                                        <datalist id="crop-list-suggestions">
                                          {suggestedCrops.map((crop) => (
                                            <option key={crop} value={crop} />
                                          ))}
                                        </datalist>
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-[10px] font-semibold">Planted Date</Label>
                                        <Input
                                          type="date"
                                          value={cellPlantedOn}
                                          onChange={(e) => setCellPlantedOn(e.target.value)}
                                          className="h-7 text-xs bg-background"
                                        />
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <Label className="text-[10px] font-semibold">Hole Status</Label>
                                      <Select value={cellStatus} onValueChange={(val: any) => setCellStatus(val)}>
                                        <SelectTrigger className="h-7 text-xs bg-background"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="planted">Seeded / Planted</SelectItem>
                                          <SelectItem value="germinated">Germinated (Sprout)</SelectItem>
                                          <SelectItem value="empty">Empty / Available</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="flex gap-2 justify-end pt-1">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setSelectedHoles([])}
                                        className="h-7 text-xs"
                                      >
                                        Cancel
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => {
                                          updateNurseryCells(tray.id, selectedHoles, cellCrop, cellPlantedOn, cellStatus);
                                          setSelectedHoles([]);
                                          toast.success(`Updated ${selectedHoles.length} plugs successfully!`);
                                        }}
                                        className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                                      >
                                        Apply to Plugs
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {tray.status === "empty" && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => replantNurseryTray(tray.id)}
                              className="w-full text-xs font-semibold"
                            >
                              <Sprout className="mr-2 h-4 w-4" /> Replant new batch
                            </Button>
                          )}
                          {tray.crop && tray.germinated > 0 && (
                            <Button
                              onClick={() => {
                                setActiveTrayId(tray.id);
                                setTransplantCount(tray.germinated);
                                setTargetChannelId(nftChannels[0]?.id || "");
                                setTransplantNotes("");
                                setScanQrInput("");
                                setTransplantDialogOpen(true);
                              }}
                              className="w-full bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-1.5 h-8 mt-2 flex items-center gap-1.5 shadow-sm"
                            >
                              <Sprout className="h-4 w-4" /> Shift to NFT Channel
                            </Button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>

                {/* Nursery-to-NFT Transplant Dialog */}
                {transplantDialogOpen && activeTrayId && (
                  <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4 max-h-[90vh] overflow-y-auto">
                      <div>
                        <span className="font-bold text-base text-foreground block">Transplant to NFT Channel</span>
                        <span className="text-xs text-muted-foreground block mt-0.5">
                          Shift propagated plugs directly to your vertical gullies.
                        </span>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <Label htmlFor="scan-target-qr" className="text-xs font-semibold">Scan / Enter Target Channel QR</Label>
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
                                  setScanQrInput(val);
                                  const matched = nftChannels.find((c) => 
                                    c.id.toLowerCase() === val.trim().toLowerCase() ||
                                    (c.qrCode && c.qrCode.toLowerCase() === val.trim().toLowerCase()) ||
                                    c.name.toLowerCase() === val.trim().toLowerCase() ||
                                    (c.stand && c.level && `${c.stand}-${c.level}-Ch ${c.channelIndex}`.toLowerCase() === val.trim().toLowerCase())
                                  );
                                  if (matched) {
                                    setTargetChannelId(matched.id);
                                    toast.success(`Matched Target Channel: ${matched.name}!`);
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
                            id="scan-target-qr"
                            placeholder="Scan QR or type Stand A-Level 1-Ch 2"
                            value={scanQrInput}
                            onChange={(e) => {
                              const val = e.target.value;
                              setScanQrInput(val);
                              // Match logic
                              const matched = nftChannels.find((c) => 
                                c.id.toLowerCase() === val.trim().toLowerCase() ||
                                (c.qrCode && c.qrCode.toLowerCase() === val.trim().toLowerCase()) ||
                                c.name.toLowerCase() === val.trim().toLowerCase() ||
                                (c.stand && c.level && `${c.stand}-${c.level}-Ch ${c.channelIndex}`.toLowerCase() === val.trim().toLowerCase())
                              );
                              if (matched) {
                                setTargetChannelId(matched.id);
                                toast.success(`Auto-matched target channel: ${matched.name}!`);
                              }
                            }}
                            className="text-xs font-mono"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="trans-channel" className="text-xs font-semibold">Target NFT Channel</Label>
                          <Select value={targetChannelId} onValueChange={(val) => setTargetChannelId(val)}>
                            <SelectTrigger id="trans-channel" className="h-9 text-xs"><SelectValue placeholder="Select target gully..." /></SelectTrigger>
                            <SelectContent>
                              {nftChannels.map((chan) => (
                                <SelectItem key={chan.id} value={chan.id}>
                                  {chan.name} {chan.stand ? `(📍 ${chan.stand}-${chan.level})` : ""} - {chan.status === "growing" ? `Active: ${chan.cropName}` : "Empty"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="trans-count" className="text-xs font-semibold">Quantity of Plugs to Transplant</Label>
                          <Input
                            id="trans-count"
                            type="number"
                            min={1}
                            max={nurseryTrays.find((t) => t.id === activeTrayId)?.germinated || 100}
                            value={transplantCount}
                            onChange={(e) => { const v = e.target.value; setTransplantCount(v === "" ? "" as any : Number(v)); }}
                            className="text-xs"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label htmlFor="trans-notes" className="text-xs font-semibold">Transplant Notes (optional)</Label>
                          <Input
                            id="trans-notes"
                            placeholder="e.g. Transplanted row 3-4 plugs"
                            value={transplantNotes}
                            onChange={(e) => setTransplantNotes(e.target.value)}
                            className="text-xs"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                        <Button onClick={() => setTransplantDialogOpen(false)} variant="outline" className="text-xs font-semibold px-4 h-9">
                          Cancel
                        </Button>
                        <Button onClick={handleTransplantConfirm} className="bg-green-600 hover:bg-green-700 text-white font-bold text-xs px-4 h-9">
                          Confirm Transplant
                        </Button>
                      </div>
                    </Card>
                  </div>
                )}

                {/* Nursery Tray Batch History Modal */}
                {trayLogsDialogOpen && selectedTrayLogs && (() => {
                  const filteredHistory = nurseryHistory.filter((h) => h.trayId === selectedTrayLogs.id);
                  return (
                    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4 max-h-[90vh] overflow-y-auto">
                        <div>
                          <span className="font-bold text-base text-foreground flex items-center gap-2">
                            <History className="h-5 w-5 text-primary" />
                            Tray: {selectedTrayLogs.name}
                          </span>
                          <span className="text-xs text-muted-foreground block mt-0.5">
                            Propagation age timeline and transplant tracking log.
                          </span>
                        </div>

                        <div className="space-y-4 font-sans text-xs">
                          {/* Current Status */}
                          <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                            <span className="font-bold text-foreground block border-b pb-1">Current Propagation State</span>
                            {selectedTrayLogs.crop ? (
                              <div className="space-y-1">
                                <div className="flex justify-between font-semibold">
                                  <span>Cultivar:</span>
                                  <span>{selectedTrayLogs.crop}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Seeded On:</span>
                                  <span>{selectedTrayLogs.plantedOn ? new Date(selectedTrayLogs.plantedOn).toLocaleDateString() : "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Germination:</span>
                                  <span>{selectedTrayLogs.germinated} / {selectedTrayLogs.plugs} Plugs ({selectedTrayLogs.plugs > 0 ? Math.round((selectedTrayLogs.germinated / selectedTrayLogs.plugs) * 100) : 0}%)</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Tray Status:</span>
                                  <Badge className="text-[9px] px-1 py-0 h-4 capitalize">{selectedTrayLogs.status}</Badge>
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic block">Tray is currently unseeded.</span>
                            )}
                          </div>

                          {/* Historical Transplants */}
                          <div className="space-y-2">
                            <span className="font-bold text-foreground block border-b pb-1">Historical Shifting Logs</span>
                            {filteredHistory.length > 0 ? (
                              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {filteredHistory.map((item) => {
                                  const ageDays = item.plantedOn
                                    ? Math.max(1, Math.round((new Date(item.transplantedOn).getTime() - new Date(item.plantedOn).getTime()) / (24 * 60 * 60 * 1000)))
                                    : null;
                                  return (
                                    <div key={item.id} className="pl-3 border-l-2 border-primary py-0.5 space-y-1">
                                      <div className="flex justify-between items-center text-[10px] font-bold text-foreground">
                                        <span>Shifted to Gully: {item.channelName || "Unknown Channel"}</span>
                                        <span className="text-primary font-bold">Qty: {item.germinated}</span>
                                      </div>
                                      <div className="text-[9px] text-muted-foreground flex justify-between">
                                        <span>On: {new Date(item.transplantedOn).toLocaleDateString()}</span>
                                        {ageDays && <span>Propagated age: {ageDays} days</span>}
                                      </div>
                                      {item.notes && <p className="text-[9px] text-slate-500 italic">Notes: {item.notes}</p>}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic text-[11px] block">No historical transplant events logged.</span>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-end pt-2 border-t border-border/60">
                          <Button onClick={() => setTrayLogsDialogOpen(false)} variant="outline" className="text-xs font-semibold px-4 h-9">
                            Close
                          </Button>
                        </div>
                      </Card>
                    </div>
                  );
                })()}
              </div>
            )}

            {activeTab === "harvested" && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Harvested Crops & Yield
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Track harvested status, yield performance, waste, and cultivated crop mix.</p>
                </div>
                <CropOperationsDashboard mode="harvested" channels={nftChannels} harvestHistory={harvestHistory} nurseryTrays={nurseryTrays} nurseryHistory={nurseryHistory} />
              </div>
            )}

            {/* High-Fidelity Reservoir Water */}
            {activeTab === "water" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                    <Droplet className="h-5 w-5 text-primary" />
                    Reservoir Water & Quality Metrics
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Water level monitoring, tank diagnostics, and inflow audit logs.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Tank diagram */}
                  <Card className="p-5 border-border/80 md:col-span-2 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">Main Reservoir Visualization</span>
                      <div className="flex items-center gap-6 mt-6">
                        {/* Visual level glass */}
                        <div className="w-24 h-48 bg-muted rounded-2xl border-2 border-border relative overflow-hidden shrink-0 flex items-end">
                          <div className="w-full bg-blue-500/80 animate-pulse transition-all" style={{ height: `${status?.waterLevelPercent ?? 0}%` }} />
                          <div className="absolute inset-0 flex items-center justify-center font-bold font-mono text-sm text-foreground">
                            {hasWaterReading ? `${Math.round(status?.waterLevelPercent ?? 0)}%` : "--"}
                          </div>
                        </div>
                        <div className="space-y-3 text-xs flex-1">
                          <div className="flex justify-between border-b pb-1.5">
                            <span className="text-muted-foreground">Total Capacity:</span>
                            <span className="font-bold">{tankCapacity} Liters</span>
                          </div>
                          <div className="flex justify-between border-b pb-1.5">
                            <span className="text-muted-foreground">Current Volume:</span>
                            <span className="font-bold">{currentVolume != null ? `${currentVolume} Liters (Calibrated)` : "No reading"}</span>
                          </div>
                          <div className="flex justify-between border-b pb-1.5">
                            <span className="text-muted-foreground">Ultrasonic Distance:</span>
                            <span className="font-bold">{hasWaterReading ? `${status!.waterDistanceCm!.toFixed(1)} cm` : "No reading"}</span>
                          </div>
                          <div className="flex justify-between border-b pb-1.5">
                            <span className="text-muted-foreground">Inflow Source:</span>
                            <span className="font-bold text-emerald-500">Filtered RO Well</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Refill Status:</span>
                            <span className="font-semibold text-slate-500">{hasWaterReading ? "Idle (Refill Threshold 30%)" : "Waiting for sensor"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Water parameters */}
                  <Card className="p-5 border-border/80 flex flex-col justify-between">
                    <div className="space-y-4">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground block">Diagnostics</span>
                      
                      <div className="space-y-3 text-xs">
                        <div className="p-2 rounded bg-muted/30 border">
                          <span className="text-[10px] text-muted-foreground block">Water Temperature:</span>
                          <span className="font-extrabold text-foreground text-sm">{status?.reservoirTempC != null ? `${status.reservoirTempC.toFixed(1)}°C` : "24.5°C"}</span>
                        </div>
                        <div className="p-2 rounded bg-muted/30 border">
                          <span className="text-[10px] text-muted-foreground block">Float Switch State:</span>
                          <span className="font-extrabold text-foreground text-sm">LEVEL {status?.waterLevel ?? "FULL"}</span>
                        </div>
                        {waterPin && (
                          <div className="p-2 rounded bg-primary/5 border border-primary/20 space-y-1">
                            <span className="text-[10px] text-muted-foreground font-bold block">Water Sensor Calibration:</span>
                            <span className="text-[11px] text-foreground font-semibold block">{waterPin.name} ({waterPin.type})</span>
                            {waterPin.type === "Water Level - Ultrasonic" && (
                              <span className="text-[10px] text-slate-500 font-mono block">
                                ECHO: GPIO {waterPin.pin} · TRIG: GPIO {waterPin.txPin ?? 18}
                              </span>
                            )}
                            <span className="text-[10px] text-slate-500 font-mono block">
                              Range: {emptyDistance}cm (Empty) - {fullDistance}cm (Full)
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              Capacity: {tankCapacity} L ({waterPin.tankWidthCm ?? 50} × {waterPin.tankLengthCm ?? 50} × {waterPin.tankHeightCm ?? 80} cm)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* Nutrition Dosing */}
            {activeTab === "nutrition" && (
              <NutritionTab status={liveStatus} schedule={schedule} onScheduleChange={setSchedule} deviceId={activeDeviceId} controlsAllowed={controlsAllowed} />
            )}

            {/* Sensor Analytics Tab */}
            {activeTab === "analytics" && (
              <HistoryAnalyticsTab deviceId={activeDeviceId} />
            )}

            {/* Hardware registry tab */}
            {activeTab === "devices" && <DeviceRegistryTab />}

            {/* Watering Plan */}
            {activeTab === "plan" && <ScheduleEditor />}

            {/* Pump Stats */}
            {activeTab === "stats" && <PumpStats deviceId={activeDeviceId} />}

            {/* AI insights */}
            {activeTab === "ai" && <AIInsightsCard deviceId={activeDeviceId} />}

            {/* Visual AI Camera */}
            {activeTab === "camera" && <VisualAiCameraTab activeDeviceId={activeDeviceId} />}

            {/* Manual logs */}
            {activeTab === "readings" && <ManualReadings />}

            {/* Team Accounts Management */}
            {activeTab === "users" && user?.role === "admin" && (
              <TeamManagementTab />
            )}
          </main>
        </div>
      </div>
      <Toaster richColors position="top-center" />
    </ErrorBoundary>
  );
}

import { UserPlus } from "lucide-react";

function TeamManagementTab() {
  const [usersList, setUsersList] = useState<{ username: string; role: string }[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "operator">("operator");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("tower_auth_token");
      const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUsersList(data.users || []);
      } else {
        toast.error("Failed to load user accounts");
      }
    } catch (e) {
      console.error("Failed to load users", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) {
      toast.error("Username and password are required");
      return;
    }
    setSubmitting(true);
    try {
      const token = localStorage.getItem("tower_auth_token");
      const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole
        })
      });
      if (response.ok) {
        toast.success("User account created successfully");
        setNewUsername("");
        setNewPassword("");
        setNewRole("operator");
        loadUsers();
      } else {
        const data = await response.json().catch(() => ({}));
        toast.error(data.error || "Failed to create user");
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (usernameToDelete: string) => {
    if (!confirm(`Are you sure you want to delete user account "${usernameToDelete}"?`)) {
      return;
    }
    try {
      const token = localStorage.getItem("tower_auth_token");
      const response = await fetch(`${API_BASE_URL}/api/admin/users/${encodeURIComponent(usernameToDelete)}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (response.ok) {
        toast.success(`User "${usernameToDelete}" deleted`);
        loadUsers();
      } else {
        toast.error("Failed to delete user account");
      }
    } catch (e) {
      toast.error("Error deleting user");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Team Accounts & Portal Security
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage system operators, access credentials, and user authorization levels.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User creation card */}
        <Card className="p-5 border-border bg-card h-fit">
          <div className="border-b pb-3 mb-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-emerald-500" />
              Create Team Account
            </h3>
            <p className="text-[11px] text-muted-foreground">Provision new operator or administrator credentials.</p>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="create-username" className="text-xs font-semibold">Username</Label>
              <Input
                id="create-username"
                placeholder="e.g. jason_operator"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="text-xs h-8.5 rounded"
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="create-password" className="text-xs font-semibold">Password</Label>
              <Input
                id="create-password"
                type="password"
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="text-xs h-8.5 rounded"
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="create-role" className="text-xs font-semibold">Access Level Role</Label>
              <Select
                value={newRole}
                onValueChange={(val: any) => setNewRole(val)}
                disabled={submitting}
              >
                <SelectTrigger className="h-8.5 text-xs rounded bg-background">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">Operator (View & Control)</SelectItem>
                  <SelectItem value="admin">Administrator (Full Access)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary text-primary-foreground font-bold text-xs h-9.5 mt-2 rounded shadow-sm"
            >
              {submitting ? "Creating Account..." : "Create Account"}
            </Button>
          </form>
        </Card>

        {/* Existing Users List */}
        <Card className="p-5 lg:col-span-2 border-border bg-card">
          <div className="border-b pb-3 mb-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-500" />
              Active System Users
            </h3>
            <p className="text-[11px] text-muted-foreground">List of credentialed team members with system access.</p>
          </div>

          {loading ? (
            <div className="text-center py-8 text-xs text-muted-foreground font-mono animate-pulse">Loading accounts registry...</div>
          ) : usersList.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground italic">No operator accounts created yet. Default admin env credential is active.</div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/80">
              <table className="w-full text-xs font-mono">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr className="font-bold text-2xs uppercase tracking-wider text-left">
                    <th className="px-4 py-2.5">Username</th>
                    <th className="px-4 py-2.5">Authorization Role</th>
                    <th className="px-4 py-2.5 text-right">Operations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {usersList.map((usr) => (
                    <tr key={usr.username} className="hover:bg-muted/15 transition-colors">
                      <td className="px-4 py-2.5 font-bold text-foreground">{usr.username}</td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                            usr.role === "admin"
                              ? "bg-emerald-500/5 text-emerald-600 border-emerald-500/20"
                              : "bg-blue-500/5 text-blue-600 border-blue-500/20"
                          }`}
                        >
                          {usr.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleDeleteUser(usr.username)}
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/5 h-7 w-7 p-0 rounded-full"
                          title="Delete User"
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
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (u: string, p: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    try {
      await onLogin(username, password);
    } catch (err) {
      // toast already shown in onLogin
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 select-none">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
      <Card className="w-full max-w-md p-8 border-border bg-card relative overflow-hidden shadow-xl rounded-2xl">
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
            <Sprout className="h-6 w-6 text-primary animate-pulse" />
          </div>
          <h2 className="text-xl font-extrabold tracking-tight text-foreground font-sans">Smart Tower Garden</h2>
          <p className="text-xs text-muted-foreground mt-1 font-semibold">PolyHouse Operations Control Center</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="login-username" className="text-xs font-bold text-foreground">Username</Label>
            <div className="relative">
              <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="login-username"
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="pl-10 text-xs bg-background border-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary h-9.5 rounded-lg"
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="login-password" className="text-xs font-bold text-foreground">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="login-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 text-xs bg-background border-input text-foreground placeholder-muted-foreground focus:border-primary focus:ring-primary h-9.5 rounded-lg"
                disabled={loading}
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/95 text-primary-foreground font-bold text-xs h-10 mt-3 shadow-md hover:shadow-primary/15 transition-all rounded-lg flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Sprout className="h-4 w-4 text-primary-foreground animate-spin" />
                Logging in...
              </>
            ) : (
              "Sign In"
            )}
          </Button>
        </form>

        <div className="mt-6 border-t border-border pt-4 text-center">
          <span className="text-[10px] text-muted-foreground font-mono font-bold">
            Default Admin: admin / admin123
          </span>
        </div>
      </Card>
    </div>
  );
}
