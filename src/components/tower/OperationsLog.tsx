import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CropLifecycleEvent, HarvestHistoryEntry } from "@/lib/tower-shared";
import {
  Leaf,
  RotateCcw,
  RotateCw,
  TrendingUp,
  Trash2,
  Clock,
  MapPin,
  Search,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type OperationLogEntry = {
  id: string;
  timestamp: number;
  type: "planted" | "harvested" | "transferred" | "undo-harvest" | "re-shift" | "removed";
  cropName: string;
  quantity?: number;
  location?: string;
  notes?: string;
  sourceLocation?: string;
  targetLocation?: string;
};

interface OperationsLogProps {
  lifecycleEvents: CropLifecycleEvent[];
  harvestHistory: HarvestHistoryEntry[];
  nftChannels?: Array<{ id: string; name: string; stand?: string; level?: string; channelIndex?: number }>;
}

export function OperationsLog({ lifecycleEvents, harvestHistory, nftChannels = [] }: OperationsLogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterCrop, setFilterCrop] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all">("all");

  const channelMap = useMemo(
    () => new Map(nftChannels.map((ch) => [ch.id, ch.name || `${ch.stand}/${ch.level} Ch${ch.channelIndex}`])),
    [nftChannels]
  );

  const allOperations = useMemo(() => {
    const operations: OperationLogEntry[] = [];

    // Add lifecycle events
    lifecycleEvents.forEach((event) => {
      const location = event.sourceName || (event.sourceId ? channelMap.get(event.sourceId) : undefined);
      let eventType: "planted" | "harvested" | "transferred" | "undo-harvest" | "re-shift" | "removed" = "planted";

      if (event.notes?.includes("[UNDO HARVEST]")) {
        eventType = "undo-harvest";
      } else if (event.notes?.includes("[RE-SHIFT]")) {
        eventType = "re-shift";
      } else if (event.type === "harvested") {
        eventType = "harvested";
      } else if (event.type === "transferred") {
        eventType = "transferred";
      } else if (event.type === "removed") {
        eventType = "removed";
      }

      operations.push({
        id: event.id,
        timestamp: new Date(event.timestamp).getTime(),
        type: eventType,
        cropName: event.cropName,
        quantity: event.quantity,
        location,
        notes: event.notes,
        sourceLocation: event.sourceName,
        targetLocation: event.targetName,
      });
    });

    // Add harvest history entries as legacy planted/harvested events
    harvestHistory.forEach((entry) => {
      if (!lifecycleEvents.some((e) => e.id === `legacy-harvested-${entry.id}`)) {
        if ((entry.yieldQty || 0) > 0) {
          operations.push({
            id: `legacy-harvested-${entry.id}`,
            timestamp: new Date(entry.harvestedAt).getTime(),
            type: "harvested",
            cropName: entry.cropName,
            quantity: entry.yieldQty,
            location: entry.channelName,
            notes: `Yield: ${entry.yieldQty}pc, Waste: ${entry.wasteQty}pc`,
          });
        }
        if ((entry.wasteQty || 0) > 0) {
          operations.push({
            id: `legacy-removed-${entry.id}`,
            timestamp: new Date(entry.harvestedAt).getTime(),
            type: "removed",
            cropName: entry.cropName,
            quantity: entry.wasteQty,
            location: entry.channelName,
            notes: "Waste removed",
          });
        }
      }
    });

    return operations.sort((a, b) => b.timestamp - a.timestamp);
  }, [lifecycleEvents, harvestHistory, channelMap]);

  const filteredOperations = useMemo(() => {
    const now = Date.now();
    const cutoff = dateRange === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : dateRange === "week"
        ? now - 7 * 24 * 60 * 60 * 1000
        : dateRange === "month"
          ? now - 30 * 24 * 60 * 60 * 1000
          : 0;

    return allOperations.filter((op) => {
      const matchesSearch =
        op.cropName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        op.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        op.notes?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = filterType === "all" || op.type === filterType;
      const matchesCrop = filterCrop === "all" || op.cropName === filterCrop;
      const matchesDate = op.timestamp >= cutoff;

      return matchesSearch && matchesType && matchesCrop && matchesDate;
    });
  }, [allOperations, searchTerm, filterType, filterCrop, dateRange]);

  const uniqueCrops = useMemo(
    () => Array.from(new Set(allOperations.map((op) => op.cropName))).sort(),
    [allOperations]
  );

  const operationStats = useMemo(() => {
    const stats = {
      total: filteredOperations.length,
      planted: filteredOperations.filter((op) => op.type === "planted").length,
      harvested: filteredOperations.filter((op) => op.type === "harvested").length,
      transferred: filteredOperations.filter((op) => op.type === "transferred").length,
      undone: filteredOperations.filter((op) => op.type === "undo-harvest").length,
      reshifted: filteredOperations.filter((op) => op.type === "re-shift").length,
      removed: filteredOperations.filter((op) => op.type === "removed").length,
    };
    return stats;
  }, [filteredOperations]);

  const getOperationIcon = (type: OperationLogEntry["type"]) => {
    switch (type) {
      case "planted":
        return <Leaf className="h-4 w-4 text-emerald-500" />;
      case "harvested":
        return <TrendingUp className="h-4 w-4 text-amber-500" />;
      case "transferred":
        return <RotateCw className="h-4 w-4 text-blue-500" />;
      case "undo-harvest":
        return <RotateCcw className="h-4 w-4 text-purple-500" />;
      case "re-shift":
        return <RotateCcw className="h-4 w-4 text-indigo-500" />;
      case "removed":
        return <Trash2 className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getOperationLabel = (type: OperationLogEntry["type"]) => {
    switch (type) {
      case "planted":
        return "Planted";
      case "harvested":
        return "Harvested";
      case "transferred":
        return "Transferred";
      case "undo-harvest":
        return "Undo Harvest";
      case "re-shift":
        return "Re-shift";
      case "removed":
        return "Removed";
      default:
        return "Unknown";
    }
  };

  const getOperationColor = (type: OperationLogEntry["type"]) => {
    switch (type) {
      case "planted":
        return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200/50 dark:border-emerald-500/30";
      case "harvested":
        return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200/50 dark:border-amber-500/30";
      case "transferred":
        return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200/50 dark:border-blue-500/30";
      case "undo-harvest":
        return "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200/50 dark:border-purple-500/30";
      case "re-shift":
        return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200/50 dark:border-indigo-500/30";
      case "removed":
        return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-200/50 dark:border-red-500/30";
      default:
        return "bg-muted/10 text-muted-foreground border-muted/50";
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Operations Log</h2>
        <p className="text-sm text-muted-foreground">
          Complete history of all crop operations: planting, harvesting, transfers, and recoveries.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 xs:grid-cols-3 sm:gap-4 md:grid-cols-7">
        <Card className="p-3 sm:p-4 bg-muted/30 border-border/80">
          <div className="text-[10px] xs:text-xs font-semibold text-muted-foreground uppercase mb-1.5">
            Total Ops
          </div>
          <div className="text-lg xs:text-2xl font-bold">{operationStats.total}</div>
        </Card>
        <Card className="p-3 sm:p-4 bg-emerald-500/5 border-emerald-200/50 dark:border-emerald-500/30">
          <div className="text-[10px] xs:text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase mb-1.5">
            Planted
          </div>
          <div className="text-lg xs:text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {operationStats.planted}
          </div>
        </Card>
        <Card className="p-3 sm:p-4 bg-amber-500/5 border-amber-200/50 dark:border-amber-500/30">
          <div className="text-[10px] xs:text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase mb-1.5">
            Harvested
          </div>
          <div className="text-lg xs:text-2xl font-bold text-amber-600 dark:text-amber-400">
            {operationStats.harvested}
          </div>
        </Card>
        <Card className="p-3 sm:p-4 bg-blue-500/5 border-blue-200/50 dark:border-blue-500/30">
          <div className="text-[10px] xs:text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase mb-1.5">
            Transfers
          </div>
          <div className="text-lg xs:text-2xl font-bold text-blue-600 dark:text-blue-400">
            {operationStats.transferred}
          </div>
        </Card>
        <Card className="p-3 sm:p-4 bg-purple-500/5 border-purple-200/50 dark:border-purple-500/30">
          <div className="text-[10px] xs:text-xs font-semibold text-purple-700 dark:text-purple-400 uppercase mb-1.5">
            Undone
          </div>
          <div className="text-lg xs:text-2xl font-bold text-purple-600 dark:text-purple-400">
            {operationStats.undone}
          </div>
        </Card>
        <Card className="p-3 sm:p-4 bg-indigo-500/5 border-indigo-200/50 dark:border-indigo-500/30">
          <div className="text-[10px] xs:text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase mb-1.5">
            Re-shifts
          </div>
          <div className="text-lg xs:text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {operationStats.reshifted}
          </div>
        </Card>
        <Card className="p-3 sm:p-4 bg-red-500/5 border-red-200/50 dark:border-red-500/30">
          <div className="text-[10px] xs:text-xs font-semibold text-red-700 dark:text-red-400 uppercase mb-1.5">
            Removed
          </div>
          <div className="text-lg xs:text-2xl font-bold text-red-600 dark:text-red-400">
            {operationStats.removed}
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4 border-border/80 bg-card/50 space-y-3">
        <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by crop, location..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Operation Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="planted">Planted</SelectItem>
              <SelectItem value="harvested">Harvested</SelectItem>
              <SelectItem value="transferred">Transferred</SelectItem>
              <SelectItem value="undo-harvest">Undo Harvest</SelectItem>
              <SelectItem value="re-shift">Re-shift</SelectItem>
              <SelectItem value="removed">Removed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterCrop} onValueChange={setFilterCrop}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Crop Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Crops</SelectItem>
              {uniqueCrops.map((crop) => (
                <SelectItem key={crop} value={crop}>
                  {crop}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateRange} onValueChange={(val) => setDateRange(val as any)}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Past 7 Days</SelectItem>
              <SelectItem value="month">Past 30 Days</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={() => {
              setSearchTerm("");
              setFilterType("all");
              setFilterCrop("all");
              setDateRange("all");
            }}
          >
            Reset Filters
          </Button>
        </div>
      </Card>

      {/* Operations Timeline */}
      {filteredOperations.length === 0 ? (
        <Card className="p-8 text-center border-border/80">
          <Clock className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
          <p className="text-sm font-semibold text-foreground">No operations found</p>
          <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters or date range</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredOperations.map((op) => (
            <div key={op.id}>
              <Card
                className={`p-3 sm:p-4 border-l-4 cursor-pointer transition-colors hover:bg-muted/50 ${getOperationColor(
                  op.type
                )}`}
                onClick={() => setExpandedId(expandedId === op.id ? null : op.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {getOperationIcon(op.type)}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{op.cropName}</span>
                        <Badge variant="secondary" className="text-[10px] font-bold">
                          {getOperationLabel(op.type)}
                        </Badge>
                        {op.quantity && (
                          <span className="text-xs font-mono text-muted-foreground">
                            {op.quantity} pc
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                        {op.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {op.location}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(op.timestamp).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mt-0.5">
                    {expandedId === op.id ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {expandedId === op.id && (
                  <div className="mt-3 pt-3 border-t border-current/20 space-y-2 text-xs">
                    {op.sourceLocation && (
                      <div>
                        <span className="font-semibold text-muted-foreground">From: </span>
                        <span className="font-mono">{op.sourceLocation}</span>
                      </div>
                    )}
                    {op.targetLocation && (
                      <div>
                        <span className="font-semibold text-muted-foreground">To: </span>
                        <span className="font-mono">{op.targetLocation}</span>
                      </div>
                    )}
                    {op.notes && (
                      <div>
                        <span className="font-semibold text-muted-foreground">Notes: </span>
                        <span>{op.notes}</span>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
