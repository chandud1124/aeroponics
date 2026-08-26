import React, { useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

export function CameraQrScanner({
  onScanSuccess,
  onScanError,
  onClose,
}: {
  onScanSuccess: (decodedText: string) => void;
  onScanError?: (errorMessage: string) => void;
  onClose: () => void;
}) {
  const containerId = `camera-qr-scanner-${useId().replaceAll(":", "")}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanSuccessRef = useRef(onScanSuccess);
  const onScanErrorRef = useRef(onScanError);
  const hasScannedRef = useRef(false);
  const stoppingRef = useRef(false);
  const [startupError, setStartupError] = useState<string | null>(null);

  onScanSuccessRef.current = onScanSuccess;
  onScanErrorRef.current = onScanError;

  useEffect(() => {
    const html5QrCode = new Html5Qrcode(containerId);
    scannerRef.current = html5QrCode;
    hasScannedRef.current = false;
    stoppingRef.current = false;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStartupError("Camera scanning requires HTTPS. Open the dashboard using its secure URL.");
      return () => {
        scannerRef.current = null;
      };
    }

    html5QrCode
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 200, height: 200 },
        },
        async (decodedText) => {
          if (hasScannedRef.current || stoppingRef.current) return;
          hasScannedRef.current = true;
          stoppingRef.current = true;
          try {
            if (html5QrCode.isScanning) await html5QrCode.stop();
          } catch {
            // The parent may unmount the scanner while it is stopping.
          }
          onScanSuccessRef.current(decodedText);
        },
        (errorMessage) => {
          if (!hasScannedRef.current) onScanErrorRef.current?.(errorMessage);
        },
      )
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setStartupError(
          message.toLowerCase().includes("permission")
            ? "Camera permission was blocked. Allow camera access in the browser settings and try again."
            : "Unable to start the camera. Use HTTPS and allow camera access in the browser settings.",
        );
      });

    return () => {
      const scanner = scannerRef.current;
      stoppingRef.current = true;
      if (scanner?.isScanning) {
        scanner.stop().catch(() => {
          // The scanner DOM can be removed by React before html5-qrcode finishes.
        });
      }
      scannerRef.current = null;
    };
  }, [containerId]);

  return (
    <div className="fixed inset-0 z-100 flex min-h-screen flex-col bg-black text-white">
      <div className="flex items-center justify-between border-b border-white/15 bg-black/90 px-4 py-4">
        <span className="font-bold text-sm">Scan QR code</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-white/25 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
        >
          Close
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5">
        <div className="w-full max-w-70 overflow-hidden rounded-xl border border-white/25 bg-black shadow-2xl">
          <div id={containerId} className="aspect-square w-full" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold">Align the QR code inside the frame</p>
          <p className="mt-1 text-xs text-white/65">
            Scanning stops automatically after the first successful scan.
          </p>
        </div>
      </div>
      {startupError ? (
        <p role="alert" className="px-5 pb-5 text-center text-sm font-semibold text-red-300">
          {startupError}
        </p>
      ) : null}
    </div>
  );
}
