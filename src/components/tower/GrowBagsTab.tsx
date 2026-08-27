import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { QrCode, Sprout, ShoppingBag, Plus, Sparkles, Clipboard, Trash2, Edit3, Calendar, FileText, BarChart3, AlertTriangle, AlertCircle, History, Search } from "lucide-react";
import { CameraQrScanner } from "@/components/tower/CameraQrScanner";

export type GrowBagCropEntry = {
  cropName: string;
  count: number;
};

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

export type GrowBag = {
  id: string;
  name: string;
  qrCode: string;
  cropName: string;
  crops?: GrowBagCropEntry[];
  plantedAt: string | null;
  harvestedAt: string | null;
  notes: string;
  status: "empty" | "growing" | "harvested";
  capacity?: number;
  currentCount?: number;
  expectedHarvestISO?: string | null;
  polyhouse?: string;
  block?: string;
  bagIndex?: string;
};

export function GrowBagsTab() {
  const [bags, setBags] = useState<GrowBag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBlockFilter, setSelectedBlockFilter] = useState("All Blocks");
  const [viewMode, setViewMode] = useState<"grid" | "cards">("grid");

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPolyhouse, setSelectedPolyhouse] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  // Forms states
  const [activeBagId, setActiveBagId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"plant" | "harvest" | "add-bag" | "edit-bag" | "logs" | null>(null);

  const [bagIndexInput, setBagIndexInput] = useState("");
  const [cropName, setCropName] = useState("");
  const [capacity, setCapacity] = useState<number>(10);
  const [currentCount, setCurrentCount] = useState<number>(8);
  const [plantedAt, setPlantedAt] = useState("");
  const [expectedHarvestISO, setExpectedHarvestISO] = useState("");
  const [notes, setNotes] = useState("");

  // Coordinate locations
  const [polyhouse, setPolyhouse] = useState("PH01");
  const [block, setBlock] = useState("B01");

  // Multi-cultivar tracking (similar to NFT crops)
  const [cropsList, setCropsList] = useState<GrowBagCropEntry[]>([]);
  const [harvestHistory, setHarvestHistory] = useState<any[]>([]);

  // Harvest measurements
  const [yieldQty, setYieldQty] = useState<number>(0);
  const [wasteQty, setWasteQty] = useState<number>(0);
  const [avgWeightGrams, setAvgWeightGrams] = useState<number>(0);
  const [bagHarvestHistory, setBagHarvestHistory] = useState<any[]>([]);

  const loadData = () => {
    setLoading(true);
    try {
      const savedBags = localStorage.getItem("polyhouse-grow-bags");
      if (savedBags) {
        setBags(JSON.parse(savedBags) as GrowBag[]);
      } else {
        // Seed default grow bags if none exist
        const defaults: GrowBag[] = [
          { id: "PH01-B01-Bag 1", name: "PH01-B01-Bag 1", qrCode: "PH01-B01-Bag 1", cropName: "Cherry Tomatoes", status: "growing", capacity: 8, currentCount: 6, plantedAt: new Date().toISOString(), polyhouse: "PH01", block: "B01", bagIndex: "1", notes: "Healthy growth" },
          { id: "PH01-B01-Bag 2", name: "PH01-B01-Bag 2", qrCode: "PH01-B01-Bag 2", cropName: "", status: "empty", capacity: 8, currentCount: 0, polyhouse: "PH01", block: "B01", bagIndex: "2", notes: "" },
        ];
        setBags(defaults);
        localStorage.setItem("polyhouse-grow-bags", JSON.stringify(defaults));
      }

      const savedHist = localStorage.getItem("polyhouse-harvest-history");
      if (savedHist) {
        setHarvestHistory(JSON.parse(savedHist));
      }
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const saveBagsList = async (updatedList: GrowBag[]) => {
    setBags(updatedList);
    localStorage.setItem("polyhouse-grow-bags", JSON.stringify(updatedList));
  };

  const closeForm = () => {
    setActionType(null);
    setActiveBagId(null);
    setCropName("");
    setPlantedAt("");
    setExpectedHarvestISO("");
    setNotes("");
    setBagIndexInput("");
    setCropsList([]);
    setYieldQty(0);
    setWasteQty(0);
    setAvgWeightGrams(0);
  };

  const openPlantForm = (bag: GrowBag) => {
    setActiveBagId(bag.id);
    setActionType("plant");
    setCropName(bag.cropName || "");
    setPlantedAt(bag.plantedAt ? new Date(bag.plantedAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]);
    setExpectedHarvestISO(bag.expectedHarvestISO ? new Date(bag.expectedHarvestISO).toISOString().split("T")[0] : "");
    setNotes(bag.notes || "");
    setCropsList(bag.crops?.length ? bag.crops : [{ cropName: bag.cropName || "", count: bag.currentCount || bag.capacity || 10 }]);
  };

  const openHarvestForm = (bag: GrowBag) => {
    setActiveBagId(bag.id);
    setActionType("harvest");
    setYieldQty(bag.currentCount || 0);
    setWasteQty(0);
    setAvgWeightGrams(0);
    setNotes("");
  };

  const openEditForm = (bag: GrowBag) => {
    setActiveBagId(bag.id);
    setActionType("edit-bag");
    setPolyhouse(bag.polyhouse || "PH01");
    setBlock(bag.block || "B01");
    setBagIndexInput(bag.bagIndex || "");
    setCapacity(bag.capacity || 10);
    setCropsList(bag.crops?.length ? bag.crops : [{ cropName: bag.cropName || "", count: bag.currentCount || 0 }]);
  };

  const openLogsForm = (bag: GrowBag) => {
    setActiveBagId(bag.id);
    setActionType("logs");
    const filtered = harvestHistory.filter((h) => h.channelId === bag.id);
    setBagHarvestHistory(filtered);
  };

  const handlePlantConfirm = async () => {
    if (!activeBagId) return;
    if (!cropName.trim()) {
      toast.error("Please enter or select a crop variety.");
      return;
    }
    const bag = bags.find((b) => b.id === activeBagId);
    if (!bag) return;

    const updatedList = bags.map((b) => {
      if (b.id === activeBagId) {
        return {
          ...b,
          status: "growing" as const,
          cropName: cropName.trim(),
          crops: [{ cropName: cropName.trim(), count: 1 }],
          currentCount: 1,
          capacity: 1, // Enforce capacity = 1
          plantedAt: plantedAt ? new Date(plantedAt).toISOString() : new Date().toISOString(),
          expectedHarvestISO: expectedHarvestISO ? new Date(expectedHarvestISO).toISOString() : null,
          notes,
        };
      }
      return b;
    });

    await saveBagsList(updatedList);
    toast.success("Grow bag planted successfully!");
    closeForm();
  };

  const handleHarvestConfirm = async () => {
    if (!activeBagId) return;
    const bag = bags.find((b) => b.id === activeBagId);
    if (!bag) return;

    try {
      // Record in harvest logs localstorage
      const newLog = {
        id: `bag-harv-${Date.now()}`,
        channelId: bag.id,
        channelName: bag.name,
        cropName: bag.cropName,
        plantedAt: bag.plantedAt,
        harvestedAt: new Date().toISOString(),
        currentCount: bag.currentCount,
        yieldQty,
        wasteQty,
        avgWeightGrams,
        notes: notes || "Harvested from Grow Bag",
        capacity: bag.capacity,
      };

      const updatedHistory = [newLog, ...harvestHistory];
      localStorage.setItem("polyhouse-harvest-history", JSON.stringify(updatedHistory));
      setHarvestHistory(updatedHistory);

      // Reset the bag status to empty
      const updatedList = bags.map((b) => {
        if (b.id === activeBagId) {
          return {
            ...b,
            status: "empty" as const,
            cropName: "",
            crops: [],
            currentCount: 0,
            plantedAt: null,
            expectedHarvestISO: null,
            notes: "",
          };
        }
        return b;
      });

      await saveBagsList(updatedList);
      toast.success("Grow bag harvested!");
      closeForm();
    } catch {
      toast.error("Failed to harvest grow bag");
    }
  };

  const handleAddBag = async () => {
    if (!polyhouse.trim() || !block.trim() || !bagIndexInput.trim()) {
      toast.error("All coordinate values (Polyhouse, Block, Bag ID) must be entered.");
      return;
    }

    const generatedName = `${polyhouse.trim().toUpperCase()}-${block.trim().toUpperCase()}-Bag ${bagIndexInput.trim().toUpperCase()}`;
    const newId = generatedName;

    if (bags.some((b) => b.id === newId)) {
      toast.error(`A grow bag with location ID "${newId}" already exists!`);
      return;
    }

    const newBag: GrowBag = {
      id: newId,
      name: generatedName,
      qrCode: generatedName,
      cropName: "",
      plantedAt: null,
      harvestedAt: null,
      notes: "",
      status: "empty",
      capacity: 1,
      currentCount: 0,
      expectedHarvestISO: null,
      polyhouse: polyhouse.trim(),
      block: block.trim(),
      bagIndex: bagIndexInput.trim(),
    };

    const updatedList = [...bags, newBag];
    await saveBagsList(updatedList);
    toast.success("New Grow Bag added!");
    closeForm();
  };

  const handleSaveEdit = async () => {
    if (!activeBagId) return;
    if (!polyhouse.trim() || !block.trim() || !bagIndexInput.trim()) {
      toast.error("All coordinate values (Polyhouse, Block, Bag ID) must be entered.");
      return;
    }

    const locationTag = `${polyhouse.trim().toUpperCase()}-${block.trim().toUpperCase()}-Bag ${bagIndexInput.trim().toUpperCase()}`;

    if (bags.some((b) => b.id === locationTag && b.id !== activeBagId)) {
      toast.error(`A grow bag with location ID "${locationTag}" already exists!`);
      return;
    }

    const updatedList = bags.map((b) => {
      if (b.id === activeBagId) {
        return {
          ...b,
          id: locationTag,
          name: locationTag,
          capacity: 1,
          currentCount: b.status === "growing" ? 1 : 0,
          cropName: b.status === "growing" ? b.cropName : "",
          crops: b.status === "growing" ? b.crops : [],
          notes,
          polyhouse: polyhouse.trim(),
          block: block.trim(),
          bagIndex: bagIndexInput.trim(),
          qrCode: locationTag,
        };
      }
      return b;
    });

    await saveBagsList(updatedList);
    toast.success("Grow bag updated!");
    closeForm();
  };

  const handleDeleteBag = async (id: string) => {
    if (!window.confirm("Are you sure you want to remove this grow bag?")) return;
    const updatedList = bags.filter((b) => b.id !== id);
    await saveBagsList(updatedList);
    toast.success("Grow bag removed.");
  };

  // Dynamic filter values
  const uniquePolyhouses = Array.from(new Set(bags.map((b) => b.polyhouse).filter(Boolean) as string[])).sort();
  const uniqueBlocks = Array.from(new Set(bags.map((b) => b.block).filter(Boolean) as string[])).sort();

  const resetAllFilters = () => {
    setSearchQuery("");
    setSelectedPolyhouse("all");
    setSelectedStatus("all");
    setSelectedBlockFilter("All Blocks");
  };

  const filteredBags = bags.filter((b) => {
    if (selectedBlockFilter !== "All Blocks" && b.block !== selectedBlockFilter) return false;
    if (selectedPolyhouse !== "all" && b.polyhouse !== selectedPolyhouse) return false;
    if (selectedStatus !== "all" && b.status !== selectedStatus) return false;

    if (searchQuery.trim() !== "") {
      const query = searchQuery.toLowerCase();
      const cropsText = b.crops?.map(cr => cr.cropName).join(" ") || "";
      return [
        b.name,
        b.cropName,
        b.notes,
        b.polyhouse,
        b.block,
        b.bagIndex,
        cropsText
      ].some((val) => val && val.toLowerCase().includes(query));
    }
    return true;
  });

  // Grouping layout (simply Polyhouse -> Block -> Bag List)
  const groupedLayout: {
    [polyhouseName: string]: {
      [blockName: string]: GrowBag[]
    }
  } = {};

  filteredBags.forEach((bag) => {
    const polyName = bag.polyhouse || "Unassigned Polyhouse";
    const blockName = bag.block || "Unassigned Block";

    if (!groupedLayout[polyName]) {
      groupedLayout[polyName] = {};
    }
    if (!groupedLayout[polyName][blockName]) {
      groupedLayout[polyName][blockName] = [];
    }
    groupedLayout[polyName][blockName].push(bag);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            Commercial Grow Bags System
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Track organic soil grow bags, seedling transplants, crop varieties, and harvest yields by bag index.
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
          <Button onClick={() => { setPolyhouse("PH01"); setBlock("B01"); setBagIndexInput(""); setCapacity(10); setActionType("add-bag"); }} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold flex items-center gap-2 text-xs py-2 h-9">
            <Plus className="h-4 w-4" />
            Add Grow Bag
          </Button>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-2xs md:flex-row md:items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name, crop variety, bag id..."
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

        {/* Block Filter Dropdown */}
        <div className="w-full md:w-36">
          <Select value={selectedBlockFilter} onValueChange={setSelectedBlockFilter}>
            <SelectTrigger className="h-9 text-xs bg-background"><SelectValue placeholder="Block" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All Blocks">All Blocks</SelectItem>
              {uniqueBlocks.map(b => <SelectItem key={b} value={b}>Block {b}</SelectItem>)}
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

        {(searchQuery || selectedPolyhouse !== "all" || selectedBlockFilter !== "All Blocks" || selectedStatus !== "all") && (
          <Button
            variant="ghost"
            onClick={resetAllFilters}
            className="h-9 px-2.5 text-xs font-bold text-destructive hover:bg-destructive/5 self-end md:self-center"
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Main Grid View */}
      {loading ? (
        <div className="text-center py-10 text-xs text-muted-foreground">Loading grow bags...</div>
      ) : bags.length === 0 ? (
        <Card className="p-8 text-center border-border/80">
          <Sprout className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <span className="text-xs font-semibold text-muted-foreground block">No Grow Bags Registered</span>
          <Button onClick={() => setActionType("add-bag")} variant="outline" className="mt-4 text-xs font-semibold">
            Add Your First Grow Bag
          </Button>
        </Card>
      ) : (
        <div className="space-y-8">
          {Object.keys(groupedLayout).sort().map((polyName) => (
            <div key={polyName} className="space-y-6">
              <div className="flex items-center gap-3">
                <span className="text-sm font-extrabold uppercase tracking-wider text-muted-foreground">{polyName}</span>
                <div className="h-px flex-1 bg-border/60" />
              </div>

              {Object.keys(groupedLayout[polyName]).sort().map((blockName) => {
                const bagsList = groupedLayout[polyName][blockName];
                
                return (
                  <div key={blockName} className="space-y-3 pl-2 border-l-2 border-primary/20">
                    <div className="text-xs font-bold text-foreground/80">Block: {blockName}</div>
                    
                    {viewMode === "grid" ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                        {bagsList.map((bag) => {
                          const isGrowing = bag.status === "growing";
                          return (
                            <Card 
                              key={bag.id}
                              className={`p-3 relative overflow-hidden transition-all duration-200 border-border/80 hover:border-primary/50 shadow-sm flex flex-col justify-between aspect-square select-none ${
                                isGrowing ? "bg-emerald-50/5 dark:bg-emerald-500/5 border-emerald-500/25" : "bg-card/45"
                              }`}
                            >
                              <div className="flex justify-between items-start">
                                <span className="font-mono text-2xs font-extrabold text-foreground truncate w-full" title={bag.id}>
                                  Bag {bag.bagIndex}
                                </span>
                                <Badge className={`h-4.5 text-[9px] uppercase font-bold py-0 ${
                                  isGrowing ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
                                }`}>
                                  {bag.status}
                                </Badge>
                              </div>

                              <div className="my-1.5 min-w-0 flex-1 flex flex-col justify-center">
                                {isGrowing ? (
                                  <>
                                    <div className="text-2xs font-bold text-foreground truncate">{bag.cropName}</div>
                                    <div className="text-[10px] text-muted-foreground mt-0.5 font-semibold">1 Plant Capacity</div>
                                  </>
                                ) : (
                                  <div className="text-2xs text-muted-foreground/60 italic font-medium">Vacant</div>
                                )}
                              </div>

                              <div className="flex gap-1 border-t border-border/40 pt-1.5 justify-end">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => isGrowing ? openHarvestForm(bag) : openPlantForm(bag)}
                                  title={isGrowing ? "Harvest crop" : "Plant crop"}
                                  className="h-6 w-6 text-primary hover:bg-primary/5"
                                >
                                  <Sprout className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => openEditForm(bag)}
                                  title="Edit details"
                                  className="h-6 w-6 hover:bg-muted"
                                >
                                  <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => openLogsForm(bag)}
                                  title="View audit logs"
                                  className="h-6 w-6 hover:bg-muted"
                                >
                                  <History className="h-3.5 w-3.5 text-blue-500" />
                                </Button>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    ) : (
                      /* Card List View */
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {bagsList.map((bag) => {
                          const isGrowing = bag.status === "growing";
                          return (
                            <Card key={bag.id} className="p-5 border-border bg-card shadow-sm space-y-3 hover:border-primary/45 transition-colors">
                              <div className="flex justify-between items-center">
                                <div className="space-y-0.5">
                                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">ID: {bag.id}</span>
                                  <span className="text-sm font-extrabold text-foreground block">Bag ID: {bag.bagIndex}</span>
                                </div>
                                <Badge className={`text-2xs font-extrabold uppercase ${
                                  isGrowing ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
                                }`}>
                                  {bag.status}
                                </Badge>
                              </div>

                              <div className="space-y-1.5 border-y border-border/50 py-3 text-xs">
                                <div className="flex justify-between text-muted-foreground font-medium">
                                  <span>Planted Crop:</span>
                                  <span className="font-bold text-foreground">{bag.cropName || "—"}</span>
                                </div>
                                <div className="flex justify-between text-muted-foreground font-medium">
                                  <span>Plant Count:</span>
                                  <span className="font-bold text-foreground">{bag.currentCount || 0} / 1 Plant</span>
                                </div>
                                {bag.plantedAt && (
                                  <div className="flex justify-between text-muted-foreground font-medium">
                                    <span>Seeded Date:</span>
                                    <span className="font-semibold">{new Date(bag.plantedAt).toLocaleDateString()}</span>
                                  </div>
                                )}
                                {bag.notes && (
                                  <div className="text-[11px] text-slate-500 italic mt-1 bg-muted/40 p-1.5 rounded w-full">
                                    Notes: {bag.notes}
                                  </div>
                                )}
                              </div>

                              <div className="flex gap-2 justify-end pt-1">
                                {isGrowing ? (
                                  <Button onClick={() => openHarvestForm(bag)} size="sm" className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-2xs h-7.5 flex items-center gap-1">
                                    <ShoppingBag className="h-3 w-3" /> Harvest
                                  </Button>
                                ) : (
                                  <Button onClick={() => openPlantForm(bag)} size="sm" className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold text-2xs h-7.5 flex items-center gap-1">
                                    <Sprout className="h-3 w-3" /> Plant Variety
                                  </Button>
                                )}
                                <Button onClick={() => openEditForm(bag)} size="sm" variant="outline" className="text-2xs h-7.5 px-2.5">
                                  <Edit3 className="h-3 w-3 mr-1" /> Edit
                                </Button>
                                <Button onClick={() => openLogsForm(bag)} size="sm" variant="ghost" className="text-2xs h-7.5 text-blue-500 hover:bg-blue-50/50">
                                  <History className="h-3.5 w-3.5" />
                                </Button>
                                <Button onClick={() => handleDeleteBag(bag.id)} size="sm" variant="ghost" className="text-2xs h-7.5 text-destructive hover:bg-destructive/5 hover:text-destructive">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
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
          ))}
        </div>
      )}

      {/* Forms Overlay Dialogs */}
      {actionType && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          {/* Add / Edit Bag Dialog */}
          {(actionType === "add-bag" || actionType === "edit-bag") && (
            <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4 max-h-[95vh] overflow-y-auto">
              <div>
                <span className="font-bold text-base text-foreground block">{actionType === "add-bag" ? "Add Grow Bag" : "Edit Grow Bag"}</span>
                <span className="text-xs text-muted-foreground block mt-0.5">Define bag coordinate parameters.</span>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Polyhouse ID</Label>
                    <Input value={polyhouse} onChange={(e) => setPolyhouse(e.target.value)} placeholder="e.g. PH01" className="text-xs h-9 bg-background" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Block ID</Label>
                    <Input value={block} onChange={(e) => setBlock(e.target.value)} placeholder="e.g. B01" className="text-xs h-9 bg-background" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bag ID (Index)</Label>
                  <Input value={bagIndexInput} onChange={(e) => setBagIndexInput(e.target.value)} placeholder="e.g. 1 or A" className="text-xs h-9 bg-background" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Location Tag Preview</Label>
                  <Input readOnly disabled value={`${polyhouse.trim().toUpperCase()}-${block.trim().toUpperCase()}-Bag ${bagIndexInput.trim().toUpperCase()}`} className="text-xs font-mono h-9 bg-muted/50" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                <Button onClick={closeForm} variant="outline" className="text-xs font-semibold px-4 h-9">Cancel</Button>
                <Button onClick={actionType === "add-bag" ? handleAddBag : handleSaveEdit} className="bg-primary text-primary-foreground font-bold text-xs px-4 h-9">Save Bag</Button>
              </div>
            </Card>
          )}

          {/* Plant Dialog */}
          {actionType === "plant" && (
            <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4 max-h-[95vh] overflow-y-auto">
              <div>
                <span className="font-bold text-base text-foreground block">Plant Variety in Grow Bag</span>
                <span className="text-xs text-muted-foreground block mt-0.5">Select crops, plant count, and details.</span>
              </div>
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label className="text-xs">Crop Variety</Label>
                  <Input
                    list="grow-bag-crop-suggestions"
                    placeholder="e.g. Cherry Tomato Red"
                    value={cropName}
                    onChange={(e) => setCropName(e.target.value)}
                    className="h-9 text-xs bg-background"
                  />
                  <datalist id="grow-bag-crop-suggestions">
                    {SUGGESTED_CROPS_LIST.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Planted Date</Label>
                    <Input type="date" value={plantedAt} onChange={(e) => setPlantedAt(e.target.value)} className="h-9 text-xs bg-background" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Expected Harvest</Label>
                    <Input type="date" value={expectedHarvestISO} onChange={(e) => setExpectedHarvestISO(e.target.value)} className="h-9 text-xs bg-background" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes / Details</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Healthy seedlings" className="h-9 text-xs bg-background" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                <Button onClick={closeForm} variant="outline" className="text-xs font-semibold px-4 h-9">Cancel</Button>
                <Button onClick={handlePlantConfirm} className="bg-primary text-primary-foreground font-bold text-xs px-4 h-9">Plant Bag</Button>
              </div>
            </Card>
          )}

          {/* Harvest Dialog */}
          {actionType === "harvest" && (
            <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4 max-h-[95vh] overflow-y-auto">
              <div>
                <span className="font-bold text-base text-foreground block">Harvest Grow Bag</span>
                <span className="text-xs text-muted-foreground block mt-0.5">Log crop yields and weight statistics.</span>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Usable Yield (Qty)</Label>
                    <Input type="number" min={0} value={yieldQty} onChange={(e) => setYieldQty(Number(e.target.value))} className="h-9 text-xs bg-background text-center font-bold" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Waste / Defects (Qty)</Label>
                    <Input type="number" min={0} value={wasteQty} onChange={(e) => setWasteQty(Number(e.target.value))} className="h-9 text-xs bg-background text-center" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Avg Plant Weight (grams)</Label>
                  <Input type="number" min={0} value={avgWeightGrams} onChange={(e) => setAvgWeightGrams(Number(e.target.value))} className="h-9 text-xs bg-background" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Operation Notes</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Excellent soil yields" className="h-9 text-xs bg-background" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
                <Button onClick={closeForm} variant="outline" className="text-xs font-semibold px-4 h-9">Cancel</Button>
                <Button onClick={handleHarvestConfirm} className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-4 h-9">Complete Harvest</Button>
              </div>
            </Card>
          )}

          {/* Audit Logs Dialog */}
          {actionType === "logs" && (
            <Card className="p-6 max-w-sm w-full border-border/80 shadow-lg space-y-4 max-h-[90vh] overflow-y-auto">
              <div>
                <span className="font-bold text-base text-foreground block">Grow Bag Audit History</span>
                <span className="text-xs text-muted-foreground block mt-0.5">Tabular logs of crop harvests.</span>
              </div>
              <div className="space-y-3 font-mono text-xs max-h-[280px] overflow-y-auto border rounded-lg p-2.5 bg-muted/10">
                {bagHarvestHistory.length === 0 ? (
                  <div className="text-center py-6 text-xs text-muted-foreground italic">No harvests logged yet.</div>
                ) : (
                  bagHarvestHistory.map((item) => (
                    <div key={item.id} className="p-2 border bg-background rounded-md text-[10px] space-y-1.5">
                      <div className="flex justify-between items-center font-bold">
                        <span>{item.cropName}</span>
                        <Badge className="h-4 py-0 text-[8px] bg-emerald-500 text-white">Yield: {item.yieldQty}</Badge>
                      </div>
                      <div className="text-muted-foreground">Harvested: {new Date(item.harvestedAt).toLocaleDateString()}</div>
                      {item.notes && <div className="text-slate-500 italic mt-0.5">Notes: {item.notes}</div>}
                    </div>
                  ))
                )}
              </div>
              <div className="flex justify-end pt-2 border-t border-border/60">
                <Button onClick={closeForm} className="text-xs font-semibold px-4 h-9">Close</Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
