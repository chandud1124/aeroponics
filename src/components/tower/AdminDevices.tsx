import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createAdminDevice, deleteAdminDevice, fetchAdminDevices, rotateAdminDeviceSecret, type DeviceCreateDuplicate, type DeviceListEntry } from "@/lib/tower-storage";

export function AdminDevices() {
  const [passkey, setPasskey] = useState<string>("0990");
  const [devices, setDevices] = useState<DeviceListEntry[]>([]);
  const [name, setName] = useState("");
  const [mac, setMac] = useState("");
  const [ip, setIp] = useState("");
  const [secretShown, setSecretShown] = useState<string | null>(null);
  const [duplicateDevice, setDuplicateDevice] = useState<DeviceCreateDuplicate["existingDevice"] | null>(null);

  async function load() {
    try {
      const list = await fetchAdminDevices(passkey);
      setDevices(list);
    } catch (err) {
      console.error(err);
      setDevices([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate() {
    try {
      const result = await createAdminDevice(passkey, name || undefined, mac || undefined, ip || undefined);
      if ("existingDevice" in result) {
        setDuplicateDevice(result.existingDevice);
        setSecretShown(null);
      } else {
        setDuplicateDevice(null);
        setSecretShown(result.secret);
      }
      await load();
    } catch (err) {
      console.error(err);
      alert("Failed to create device — check admin passkey in headers");
    }
  }

  async function handleDelete(deviceId: string) {
    if (!confirm(`Delete device ${deviceId}?`)) return;
    try {
      await deleteAdminDevice(passkey, deviceId);
      await load();
    } catch (err) {
      console.error(err);
      alert("Failed to delete device");
    }
  }

  async function handleRotateSecret(deviceId: string) {
    if (!confirm(`Regenerate secret for ${deviceId}? Existing secret will be invalidated.`)) return;
    try {
      const resp = await rotateAdminDeviceSecret(passkey, deviceId);
      setSecretShown(resp.secret);
      await load();
    } catch (err) {
      console.error(err);
      alert("Failed to rotate device secret — check admin passkey");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground">Admin passkey</label>
            <Input value={passkey} onChange={(e) => setPasskey((e.target as HTMLInputElement).value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">MAC address (optional)</label>
            <Input value={mac} onChange={(e) => setMac((e.target as HTMLInputElement).value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">IP address (optional)</label>
            <Input value={ip} onChange={(e) => setIp((e.target as HTMLInputElement).value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Device name (optional)</label>
            <Input value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleCreate}>Create device</Button>
            <Button onClick={load} variant="outline">Refresh</Button>
          </div>
        </div>
        {secretShown ? (
          <div className="mt-4 rounded border border-dashed p-3">
            <div className="text-sm">Device secret (copy and store now — shown only once):</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <pre className="break-all text-xs">{secretShown}</pre>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(secretShown);
                  alert("Copied secret to clipboard");
                }}
              >
                Copy
              </Button>
            </div>
          </div>
        ) : null}
        {duplicateDevice ? (
          <div className="mt-4 rounded border border-amber-500/50 bg-amber-500/10 p-3">
            <div className="text-sm font-medium">Device already exists</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {duplicateDevice.name ?? "(unnamed)"} • {duplicateDevice.deviceId} • {duplicateDevice.macAddress ?? "no-mac"} • {duplicateDevice.ipAddress ?? "no-ip"}
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-medium">Registered devices</h3>
        <div className="space-y-2">
          {devices.length === 0 ? (
            <div className="text-sm text-muted-foreground">No devices registered</div>
          ) : (
            devices.map((d) => (
              <div key={d.deviceId} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{d.name ?? "(unnamed)"}</div>
                      <div className="text-xs text-muted-foreground">{d.deviceId} • {d.macAddress ?? 'no-mac'} • {new Date(d.createdAt).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => navigator.clipboard.writeText(d.deviceId)} variant="outline">Copy ID</Button>
                  <Button onClick={() => handleRotateSecret(d.deviceId)} variant="secondary">Regenerate Secret</Button>
                  <Button onClick={() => handleDelete(d.deviceId)} variant="destructive">Delete</Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

export default AdminDevices;
