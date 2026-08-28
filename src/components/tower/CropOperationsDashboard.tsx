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
};

const chartColors = ["#0f766e", "#f59e0b", "#2563eb", "#db2777", "#65a30d", "#7c3aed"];

export function CropOperationsDashboard({
  mode,
  channels,
  harvestHistory,
  nurseryTrays,
  nurseryHistory,
}: Props) {
  const [groupFilter, setGroupFilter] = useState("ALL");
  const [chartGrouping, setChartGrouping] = useState<"crop" | "stand">("crop");
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
  const holeStatusData = useMemo(() => {
    const channelGroups = new Map<string, { empty: number; growing: number }>();
    selectedChannels.forEach((channel) => {
      const group = chartGrouping === "crop"
        ? (channel.cropName || channel.crops?.[0]?.cropName || "Unassigned crop")
        : (channel.polyhouse && channel.block && channel.row
          ? `${channel.polyhouse}-${channel.block}-${channel.row}`
          : `${channel.stand || "Unassigned"} / ${channel.level || "Unassigned"}`);
      const current = channelGroups.get(group) || { empty: 0, growing: 0 };
      const capacity = channel.capacity || 0;
      const occupied = Math.min(capacity, channel.currentCount || 0);
      current.empty += Math.max(0, capacity - occupied);
      current.growing += occupied;
      channelGroups.set(group, current);
    });

    const harvestedByGroup = new Map<string, number>();
    harvestHistory.forEach((entry) => {
      const channel = channels.find((item) => item.id === entry.channelId);
      const group = chartGrouping === "crop"
        ? (entry.cropName || "Unknown crop").split("(")[0].trim()
        : channel?.polyhouse && channel.block && channel.row
          ? `${channel.polyhouse}-${channel.block}-${channel.row}`
          : `${channel?.stand || "Unassigned"} / ${channel?.level || "Unassigned"}`;
      harvestedByGroup.set(group, (harvestedByGroup.get(group) || 0) + (entry.yieldQty || 0) + (entry.wasteQty || 0));
    });

    const groups = new Set([...channelGroups.keys(), ...harvestedByGroup.keys()]);
    return Array.from(groups, (name) => ({
      name,
      empty: channelGroups.get(name)?.empty || 0,
      growing: channelGroups.get(name)?.growing || 0,
      harvested: harvestedByGroup.get(name) || 0,
    })).sort((a, b) => (b.empty + b.growing + b.harvested) - (a.empty + a.growing + a.harvested));
  }, [chartGrouping, channels, harvestHistory, selectedChannels]);

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
    harvestHistory.forEach((entry) => {
      const name = entry.cropName || entry.crops?.[0]?.cropName || "Unknown crop";
      const current = totals.get(name) || { yieldQty: 0, wasteQty: 0, yieldKg: 0, wasteKg: 0, harvests: 0 };
      
      const wGrams = entry.avgWeightGrams || 150; // default 150 grams per plant
      const yKg = ((entry.yieldQty || 0) * wGrams) / 1000;
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
  }, [harvestHistory]);

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
              <h3 className="font-semibold">Hole status and harvest volume</h3>
              <p className="mt-1 text-xs text-muted-foreground">Compare empty holes, growing plants, and harvested plants.</p>
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
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={holeStatusData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="empty" name="Empty holes" stackId="holes" fill="#94a3b8" />
                <Bar dataKey="growing" name="Growing plants" stackId="holes" fill="#0f766e" />
                <Bar dataKey="harvested" name="Harvested plants" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
        <Metric icon={PackageCheck} label="Harvest records" value={harvestHistory.length} />
        <Metric icon={Leaf} label="Yield" value={`${totalYieldKg.toFixed(1)} kg`} />
        <Metric icon={BarChart3} label="Waste" value={`${totalWasteKg.toFixed(1)} kg`} />
        <Metric icon={Sprout} label="Growing now" value={activeChannels.length} />
      </div>
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Current crop status</h3>
          <Badge variant="outline">{activeChannels.length} active channels</Badge>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {activeChannels.length ? (
            activeChannels.map((channel) => (
              <div key={channel.id} className="border rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <strong>{channel.cropName || "Unnamed crop"}</strong>
                  <Badge variant="secondary">{channel.currentCount || 0} plants</Badge>
                </div>
                <p className="mt-1 text-xs font-semibold text-muted-foreground font-mono">
                  {channel.name}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {channel.expectedHarvestISO
                    ? `Expected ${new Date(channel.expectedHarvestISO).toLocaleDateString()}`
                    : "Harvest date not set"}
                </p>
              </div>
            ))
          ) : (
            <EmptyState text="No crops are currently marked as growing." />
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
