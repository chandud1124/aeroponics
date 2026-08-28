import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CalendarDays, Leaf, PackageCheck, Sprout, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HarvestHistoryEntry, NftChannel } from "@/lib/tower-storage";
import type { CropLifecycleEvent, GrowBag } from "@/lib/tower-shared";

type NurseryTray = {
  id: string;
  name: string;
  crop: string;
  plantedOn: string;
  plugs: number;
  germinated: number;
  status: "empty" | "growing" | "ready";
};

type Props = {
  mode: "channels" | "nursery" | "harvested";
  channels: NftChannel[];
  harvestHistory: HarvestHistoryEntry[];
  nurseryTrays: NurseryTray[];
  nurseryHistory: Array<{ crop: string; germinated: number }>;
  lifecycleEvents?: CropLifecycleEvent[];
  growBags?: GrowBag[];
};

const chartColors = ["#0f766e", "#f59e0b", "#2563eb", "#db2777", "#65a30d", "#7c3aed"];

export function CropOperationsDashboard({
  mode,
  channels,
  harvestHistory,
  nurseryTrays,
  nurseryHistory,
  lifecycleEvents = [],
  growBags = [],
}: Props) {
  const [groupFilter, setGroupFilter] = useState("ALL");
  const [chartGrouping, setChartGrouping] = useState<"crop" | "stand">("crop");
  const [historyRange, setHistoryRange] = useState<"today" | "7" | "30" | "all">("today");
  const [nurseryFilter, setNurseryFilter] = useState("ALL");

  const activeChannels = channels.filter((channel) => channel.status === "growing");
  const groups = useMemo(
    () =>
      Array.from(
        new Set(
          channels.map((channel) =>
            channel.polyhouse && channel.block && channel.row
              ? `${channel.polyhouse}-${channel.block}-${channel.row}`
              : `${channel.stand || "Unassigned"} / ${channel.level || "Unassigned"}`
          ),
        ),
      ).sort(),
    [channels],
  );
  const selectedChannels =
    groupFilter === "ALL"
      ? channels
      : channels.filter((channel) => {
          const displayGroup = channel.polyhouse && channel.block && channel.row
            ? `${channel.polyhouse}-${channel.block}-${channel.row}`
            : `${channel.stand || "Unassigned"} / ${channel.level || "Unassigned"}`;
          return displayGroup === groupFilter;
        });
  const currentOccupancyData = useMemo(() => {
    const channelGroups = new Map<string, { totalHoles: number; plantedNow: number; emptyNow: number }>();
    selectedChannels.forEach((channel) => {
      const capacity = Math.max(0, channel.capacity || 0);
      const occupied = Math.min(capacity, channel.currentCount || 0);
      const standGroup = channel.polyhouse && channel.block && channel.row
        ? `${channel.polyhouse}-${channel.block}-${channel.row}`
        : `${channel.stand || "Unassigned"} / ${channel.level || "Unassigned"}`;
      if (chartGrouping === "stand") {
        const current = channelGroups.get(standGroup) || { totalHoles: 0, plantedNow: 0, emptyNow: 0 };
        current.totalHoles += capacity;
        current.emptyNow += Math.max(0, capacity - occupied);
        current.plantedNow += occupied;
        channelGroups.set(standGroup, current);
        return;
      }

      const entries = channel.crops?.length
        ? channel.crops
        : channel.cropName
          ? [{ cropName: channel.cropName.split(",")[0].split("(")[0].trim(), count: occupied }]
          : [{ cropName: "Unassigned crop", count: 0 }];
      entries.forEach((entry, index) => {
        const group = entry.cropName.trim() || "Unassigned crop";
        const current = channelGroups.get(group) || { totalHoles: 0, plantedNow: 0, emptyNow: 0 };
        current.plantedNow += Math.min(occupied, entry.count || 0);
        if (index === 0) {
          current.totalHoles += capacity;
          current.emptyNow += Math.max(0, capacity - occupied);
        }
        channelGroups.set(group, current);
      });
    });
    return Array.from(channelGroups, ([name, value]) => ({ name, ...value })).sort(
      (a, b) => b.totalHoles - a.totalHoles,
    );
  }, [chartGrouping, selectedChannels]);

  const historicalActivityData = useMemo(() => {
    const cutoff = historyRange === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : historyRange === "all" ? 0 : Date.now() - Number(historyRange) * 24 * 60 * 60 * 1000;
    const totals = new Map<string, { planted: number; harvested: number; removed: number; transferred: number }>();
    const legacyEvents = lifecycleEvents.length === 0
      ? harvestHistory.flatMap((entry) => {
        const channel = channels.find((item) => item.id === entry.channelId);
        const location = channel ? {
          polyhouse: channel.polyhouse,
          block: channel.block,
          row: channel.row,
          stand: channel.stand,
          level: channel.level,
          channelIndex: channel.channelIndex,
          holeConfig: channel.holeConfig,
        } : undefined;
        const events: CropLifecycleEvent[] = [];
        if ((entry.yieldQty || 0) > 0) events.push({ id: `legacy-harvested-${entry.id}`, type: "harvested", timestamp: entry.harvestedAt, cropName: entry.cropName, quantity: entry.yieldQty || 0, sourceId: entry.channelId, sourceName: entry.channelName, location });
        if ((entry.wasteQty || 0) > 0) events.push({ id: `legacy-removed-${entry.id}`, type: "removed", timestamp: entry.harvestedAt, cropName: entry.cropName, quantity: entry.wasteQty || 0, sourceId: entry.channelId, sourceName: entry.channelName, location });
        return events;
      })
      : [];
    const filteredEvents = [...lifecycleEvents, ...legacyEvents].filter((event) => new Date(event.timestamp).getTime() >= cutoff);
    filteredEvents.forEach((event) => {
      const location = event.location || {};
      const group = chartGrouping === "crop"
        ? (event.cropName || "Unknown crop").split("(")[0].trim()
        : location.polyhouse && location.block && location.row
          ? `${location.polyhouse}-${location.block}-${location.row}`
          : `${location.stand || "Unassigned"} / ${location.level || "Unassigned"}`;
      const current = totals.get(group) || { planted: 0, harvested: 0, removed: 0, transferred: 0 };
      current[event.type] += event.quantity;
      totals.set(group, current);
    });
    return Array.from(totals, ([name, value]) => ({ name, ...value })).sort(
      (a, b) => (b.planted + b.harvested + b.removed + b.transferred) - (a.planted + a.harvested + a.removed + a.transferred),
    );
  }, [chartGrouping, channels, harvestHistory, historyRange, lifecycleEvents]);

  const currentTotals = currentOccupancyData.reduce(
    (totals, group) => ({
      totalHoles: totals.totalHoles + group.totalHoles,
      plantedNow: totals.plantedNow + group.plantedNow,
      emptyNow: totals.emptyNow + group.emptyNow,
    }),
    { totalHoles: 0, plantedNow: 0, emptyNow: 0 },
  );

  const historyEvents = lifecycleEvents.length ? lifecycleEvents : harvestHistory.flatMap((entry) => {
    const channel = channels.find((item) => item.id === entry.channelId);
    const location = channel ? {
      polyhouse: channel.polyhouse,
      block: channel.block,
      row: channel.row,
      stand: channel.stand,
      level: channel.level,
      channelIndex: channel.channelIndex,
      holeConfig: channel.holeConfig,
    } : undefined;
    return [
      ...(entry.yieldQty ? [{ id: `legacy-harvested-${entry.id}`, type: "harvested" as const, timestamp: entry.harvestedAt, cropName: entry.cropName, quantity: entry.yieldQty, sourceId: entry.channelId, sourceName: entry.channelName, location }] : []),
      ...(entry.wasteQty ? [{ id: `legacy-removed-${entry.id}`, type: "removed" as const, timestamp: entry.harvestedAt, cropName: entry.cropName, quantity: entry.wasteQty, sourceId: entry.channelId, sourceName: entry.channelName, location }] : []),
    ];
  });

  const nurseryCrops = useMemo(() => {
    const totals = new Map<string, { trays: number; plugs: number; ready: number }>();
    nurseryTrays
      .filter((tray) => nurseryFilter === "ALL" || tray.status === nurseryFilter)
      .forEach((tray) => {
        if (!tray.crop) return;
        const current = totals.get(tray.crop) || { trays: 0, plugs: 0, ready: 0 };
        current.trays += 1;
        current.plugs += tray.germinated;
        current.ready += tray.status === "ready" ? tray.germinated : 0;
        totals.set(tray.crop, current);
      });
    return Array.from(totals, ([name, value]) => ({ name, ...value })).sort(
      (a, b) => b.plugs - a.plugs,
    );
  }, [nurseryFilter, nurseryTrays]);

  const yieldByCrop = useMemo(() => {
    const totals = new Map<string, { yieldQty: number; wasteQty: number; yieldKg: number; wasteKg: number; harvests: number }>();
    const growBagIds = new Set(growBags.map((bag) => bag.id));
    harvestHistory.filter((entry) => growBagIds.has(entry.channelId) || entry.id.startsWith("bag-harv-")).forEach((entry) => {
      const name = entry.cropName || entry.crops?.[0]?.cropName || "Unknown crop";
      const current = totals.get(name) || { yieldQty: 0, wasteQty: 0, yieldKg: 0, wasteKg: 0, harvests: 0 };
      
      const wGrams = entry.avgWeightGrams || 150; // default 150 grams per plant
      const yKg = entry.yieldKg ?? ((entry.yieldQty || 0) * wGrams) / 1000;
      const wKg = ((entry.wasteQty || 0) * wGrams) / 1000;

      current.yieldQty += entry.yieldQty || 0;
      current.wasteQty += entry.wasteQty || 0;
      current.yieldKg += yKg;
      current.wasteKg += wKg;
      current.harvests += 1;
      totals.set(name, current);
    });
    return Array.from(totals, ([name, value]) => ({ name, ...value })).sort(
      (a, b) => b.yieldKg - a.yieldKg,
    );
  }, [growBags, harvestHistory]);

  if (mode === "nursery") {
    const totalPlugs = nurseryTrays.reduce((sum, tray) => sum + tray.plugs, 0);
    const readyPlugs = nurseryTrays.reduce((sum, tray) => sum + tray.germinated, 0);
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric icon={Warehouse} label="Total trays" value={nurseryTrays.length} />
          <Metric
            icon={Sprout}
            label="Growing trays"
            value={nurseryTrays.filter((tray) => tray.status === "growing").length}
          />
          <Metric icon={PackageCheck} label="Ready plugs" value={readyPlugs} />
          <Metric icon={Leaf} label="Plug capacity" value={totalPlugs} />
        </div>
        <Card className="p-5">
          <Toolbar
            title="Nursery overview by crop"
            value={nurseryFilter}
            onChange={setNurseryFilter}
            options={["ALL", "growing", "ready", "empty"]}
          />
          {nurseryCrops.length === 0 ? (
            <EmptyState text="Add crops to nursery trays to see production groups." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {nurseryCrops.map((crop) => (
                <div key={crop.name} className="border rounded-lg p-4">
                  <div className="flex justify-between">
                    <span className="font-semibold">{crop.name}</span>
                    <Badge variant="outline">{crop.trays} trays</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {crop.ready} ready plugs / {crop.plugs} germinated
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold">Transplant history</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {nurseryHistory.length ? (
              nurseryHistory.slice(0, 12).map((entry, index) => (
                <div
                  key={`${entry.crop}-${index}`}
                  className="flex justify-between border-b py-2 text-sm"
                >
                  <span>{entry.crop}</span>
                  <span className="font-mono text-muted-foreground">{entry.germinated} plugs</span>
                </div>
              ))
            ) : (
              <EmptyState text="No transplant records yet." />
            )}
          </div>
        </Card>
      </div>
    );
  }

  if (mode === "channels") {
    const activePlants = activeChannels.reduce(
      (sum, channel) => sum + (channel.currentCount || 0),
      0,
    );
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric icon={Warehouse} label="Channel groups" value={groups.length} />
          <Metric icon={Leaf} label="Active channels" value={activeChannels.length} />
          <Metric icon={Sprout} label="Plants growing" value={activePlants} />
          <Metric
            icon={CalendarDays}
            label="Harvest due"
            value={
              activeChannels.filter(
                (channel) =>
                  channel.expectedHarvestISO && new Date(channel.expectedHarvestISO) <= new Date(),
              ).length
            }
          />
        </div>
        <Card className="p-5">
          <Toolbar
            title="Current production by crop and stand"
            value={groupFilter}
            onChange={setGroupFilter}
            options={["ALL", ...groups]}
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => {
              const rows = channels.filter((channel) => {
                const displayGroup = channel.polyhouse && channel.block && channel.row
                  ? `${channel.polyhouse}-${channel.block}-${channel.row}`
                  : `${channel.stand || "Unassigned"} / ${channel.level || "Unassigned"}`;
                return displayGroup === group;
              });
              return (
                <div key={group} className="border rounded-lg p-4">
                  <div className="flex justify-between">
                    <span className="font-semibold">{group}</span>
                    <Badge>{rows.length} channels</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {rows.filter((channel) => channel.status === "growing").length} active ·{" "}
                    {rows.reduce((sum, channel) => sum + (channel.currentCount || 0), 0)} plants
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {Array.from(
                      new Set(rows.map((channel) => channel.cropName).filter(Boolean)),
                    ).map((crop) => (
                      <Badge key={crop} variant="outline">
                        {crop}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold">Current NFT hole occupancy</h3>
              <p className="mt-1 text-xs text-muted-foreground">Live capacity only. Empty holes are available now, not historical harvests.</p>
            </div>
            <Select value={chartGrouping} onValueChange={(value) => setChartGrouping(value as "crop" | "stand")}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="crop">Group by crop</SelectItem>
                <SelectItem value="stand">Group by stand / row</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Metric icon={Warehouse} label="Total holes" value={currentTotals.totalHoles} />
            <Metric icon={Sprout} label="Planted now" value={currentTotals.plantedNow} />
            <Metric icon={PackageCheck} label="Empty / available now" value={currentTotals.emptyNow} />
          </div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={currentOccupancyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="totalHoles" name="Total holes" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="plantedNow" name="Planted now" fill="#0f766e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="emptyNow" name="Empty / available now" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold">Daily crop movement</h3>
              <p className="mt-1 text-xs text-muted-foreground">Historical activity is separate from current hole occupancy.</p>
            </div>
            <Select value={historyRange} onValueChange={(value) => setHistoryRange(value as "today" | "7" | "30" | "all")}>
              <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="all">All history</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historicalActivityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="planted" name="Planted" fill="#2563eb" />
                <Bar dataKey="harvested" name="Harvested" fill="#f59e0b" />
                <Bar dataKey="removed" name="Removed / waste" fill="#ef4444" />
                <Bar dataKey="transferred" name="Transferred" fill="#7c3aed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <table className="w-full min-w-175 text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Crop</th>
                  <th className="px-3 py-2">Quantity</th>
                  <th className="px-3 py-2">From / to</th>
                  <th className="px-3 py-2">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {historyEvents
                  .filter((event) => {
                    const cutoff = historyRange === "today"
                      ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
                      : historyRange === "all" ? 0 : Date.now() - Number(historyRange) * 24 * 60 * 60 * 1000;
                    return new Date(event.timestamp).getTime() >= cutoff;
                  })
                  .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                  .slice(0, 30)
                  .map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap px-3 py-2">{new Date(event.timestamp).toLocaleString()}</td>
                      <td className="px-3 py-2 capitalize">{event.type}</td>
                      <td className="px-3 py-2">{event.cropName}</td>
                      <td className="px-3 py-2 font-mono">{event.quantity}</td>
                      <td className="px-3 py-2">{event.sourceName || "-"} {"destinationName" in event && event.destinationName ? `→ ${event.destinationName}` : ""}</td>
                      <td className="px-3 py-2">{event.location?.polyhouse || "-"} {event.location?.row || ""} {event.location?.holeConfig || ""}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!historyEvents.length && <EmptyState text="No crop movement events recorded yet." />}
          </div>
        </Card>
      </div>
    );
  }

  const totalYieldKg = yieldByCrop.reduce((sum, crop) => sum + crop.yieldKg, 0);
  const totalWasteKg = yieldByCrop.reduce((sum, crop) => sum + crop.wasteKg, 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={PackageCheck} label="Picking records" value={harvestHistory.filter((entry) => growBags.some((bag) => bag.id === entry.channelId)).length} />
        <Metric icon={Leaf} label="Yield" value={`${totalYieldKg.toFixed(1)} kg`} />
        <Metric icon={BarChart3} label="Waste" value={`${totalWasteKg.toFixed(1)} kg`} />
        <Metric icon={Sprout} label="Plants growing" value={growBags.filter((bag) => bag.status === "growing").reduce((sum, bag) => sum + (bag.currentCount || 0), 0)} />
      </div>
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Current grow-bag plants</h3>
          <Badge variant="outline">{growBags.filter((bag) => bag.status === "growing").length} active bags</Badge>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {growBags.filter((bag) => bag.status === "growing").length ? (
            growBags.filter((bag) => bag.status === "growing").map((bag) => (
              <div key={bag.id} className="border rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <strong>{bag.cropName || "Unnamed crop"}</strong>
                  <Badge variant="secondary">{bag.currentCount || 0} plants</Badge>
                </div>
                <p className="mt-1 text-xs font-semibold text-muted-foreground font-mono">
                  {bag.name}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {bag.plantedAt ? `Planted ${new Date(bag.plantedAt).toLocaleDateString()}` : "Planting date not set"}
                </p>
              </div>
            ))
          ) : (
            <EmptyState text="No grow-bag plants are currently marked as growing." />
          )}
        </div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold">Yield by crop</h3>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yieldByCrop}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="yieldQty" name="Yield kg" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold">Cultivated crop mix</h3>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={yieldByCrop}
                  dataKey="yieldQty"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label
                >
                  {yieldByCrop.map((crop, index) => (
                    <Cell key={crop.name} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <Card className="p-5">
        <h3 className="font-semibold">Harvest register</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {harvestHistory.length ? (
            harvestHistory.slice(0, 20).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between border-b py-2 text-sm"
              >
                <span>
                  <strong>{entry.cropName || "Mixed crop"}</strong>
                  <span className="ml-2 text-muted-foreground">
                    {new Date(entry.harvestedAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="font-mono">{(entry.yieldQty || 0).toFixed(1)} kg</span>
              </div>
            ))
          ) : (
            <EmptyState text="Harvest a channel to begin yield tracking." />
          )}
        </div>
      </Card>
    </div>
  );
}

function Toolbar({
  title,
  value,
  onChange,
  options,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h3 className="font-semibold">{title}</h3>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option === "ALL" ? "All groups" : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Leaf;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="p-4">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-3 text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;
}
