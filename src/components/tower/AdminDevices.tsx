import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createAdminDevice, deleteAdminDevice, fetchAdminDevices, rotateAdminDeviceSecret, type DeviceCreateDuplicate, type DeviceListEntry } from "@/lib/tower-storage";

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

export function AdminDevices() {
  const [passkey, setPasskey] = useState<string>("");
  const [unlocked, setUnlocked] = useState(false);
  const [devices, setDevices] = useState<DeviceListEntry[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [mac, setMac] = useState("");
  const [ip, setIp] = useState("");
  const [secretShown, setSecretShown] = useState<string | null>(null);
  const [duplicateDevice, setDuplicateDevice] = useState<DeviceCreateDuplicate["existingDevice"] | null>(null);

  async function load(nextPasskey = passkey) {
    try {
      const list = await fetchAdminDevices(nextPasskey);
      setDevices(list);
      setAdminError(null);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isUnauthorized = message.includes("Unauthorized") || message.includes("401");
      if (!isUnauthorized) {
        console.error(err);
      }
      setAdminError(isUnauthorized ? "Wrong admin passkey." : "Unable to load admin devices right now.");
      setDevices([]);
      return false;
    }
  }

  async function handleUnlock() {
    if (!passkey.trim()) {
      alert("Enter the admin passkey first");
      return;
    }

    setBusy(true);
    try {
      const ok = await load(passkey);
      setUnlocked(ok);
    } catch (err) {
      console.error(err);
      alert("Failed to unlock admin panel — check the admin passkey");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (!unlocked) {
      alert("Unlock the admin panel first");
      return;
    }

    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(deviceId: string) {
    if (!confirm(`Delete device ${deviceId}?`)) return;
    setBusy(true);
    try {
      await deleteAdminDevice(passkey, deviceId);
      await load();
    } catch (err) {
      console.error(err);
      alert("Failed to delete device");
    } finally {
      setBusy(false);
    }
  }

  async function handleRotateSecret(deviceId: string) {
    if (!confirm(`Regenerate secret for ${deviceId}? Existing secret will be invalidated.`)) return;
    setBusy(true);
    try {
      const resp = await rotateAdminDeviceSecret(passkey, deviceId);
      setSecretShown(resp.secret);
      await load();
    } catch (err) {
      console.error(err);
      alert("Failed to rotate device secret — check admin passkey");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!unlocked ? (
        <Card className="p-4">
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium">Admin panel locked</div>
              <div className="text-xs text-muted-foreground">
                Enter the admin passkey to view devices, add ESP32 entries, or rotate secrets.
              </div>
            </div>
            <div className="flex max-w-md gap-2">
              <Input
                type="password"
                placeholder="Enter admin passkey"
                value={passkey}
                onChange={(e) => setPasskey((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleUnlock();
                  }
                }}
              />
              <Button onClick={handleUnlock} disabled={busy}>
                {busy ? "Checking" : "Unlock"}
              </Button>
            </div>
            {adminError ? <div className="text-xs text-destructive">{adminError}</div> : null}
          </div>
        </Card>
      ) : null}

      {unlocked ? (
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground">Admin passkey</label>
            <Input type="password" value={passkey} onChange={(e) => setPasskey((e.target as HTMLInputElement).value)} />
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
            <Button onClick={handleCreate} disabled={busy}>Create device</Button>
            <Button onClick={() => load()} variant="outline" disabled={busy}>Refresh</Button>
          </div>
        </div>
        {secretShown ? (
          <div className="mt-4 rounded border border-dashed p-3">
            <div className="text-sm font-medium">Device secret shown once</div>
            <div className="text-xs text-muted-foreground">
              Copy this now. It cannot be retrieved again later; rotate it only if you need a new key.
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <pre className="break-all text-xs">{secretShown}</pre>
              <Button
                onClick={async () => {
                  try {
                    await copyText(secretShown);
                    alert("Copied secret to clipboard");
                  } catch (err) {
                    console.error(err);
                    alert("Copy failed. You can select and copy the secret manually.");
                  }
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
      ) : null}

      {unlocked ? (
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
                  <Button
                    onClick={async () => {
                      try {
                        await copyText(d.deviceId);
                        alert("Copied device ID to clipboard");
                      } catch (err) {
                        console.error(err);
                        alert("Copy failed. You can select and copy the device ID manually.");
                      }
                    }}
                    variant="outline"
                  >
                    Copy ID
                  </Button>
                  <Button onClick={() => handleRotateSecret(d.deviceId)} variant="secondary">Regenerate Secret</Button>
                  <Button onClick={() => handleDelete(d.deviceId)} variant="destructive">Delete</Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
      ) : null}
    </div>
  );
}

export default AdminDevices;
