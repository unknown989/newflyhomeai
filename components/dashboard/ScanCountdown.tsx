"use client";

import { useState, useEffect } from "react";
import { useScan } from "@/contexts/ScanContext";

/**
 * Server-anchored scan countdown.
 * Receives nextScanAt (Unix seconds) from the server and counts down to it.
 * Only shows "Scanning ..." when the server is actively scanning (isScanning = true).
 * When the timer is running, shows the countdown in MM:SS format.
 *
 * SSR renders "Scanning …" as the initial value to prevent hydration mismatch.
 * The container uses fixed tabular-nums monospace font to prevent layout shift
 * when digits change (e.g. "09:59" → "10:00").
 */
function gmtOffsetLabel(): string {
  const offsetMins = -new Date().getTimezoneOffset();
  const h = Math.floor(Math.abs(offsetMins) / 60);
  const m = Math.abs(offsetMins) % 60;
  const sign = offsetMins >= 0 ? "+" : "-";
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

export default function ScanCountdown() {
  const { remaining, isScanning } = useScan();
  
  // null = not yet hydrated (SSR state) — renders "Scanning …" to match server
  const [display, setDisplay] = useState<string | null>(null);
  // Empty string on SSR; set on client to avoid hydration mismatch
  const [gmtOffset, setGmtOffset] = useState<string>("");

  useEffect(() => {
    setGmtOffset(gmtOffsetLabel());
  }, []);

  useEffect(() => {
    const tick = () => {
      if (isScanning) {
        setDisplay("scanning");
      } else if (remaining !== null && remaining > 0) {
        const mm = Math.floor(remaining / 60);
        const ss = remaining % 60;
        setDisplay(
          `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
        );
      } else {
        // Not scanning and no remaining time — show scanning
        setDisplay("scanning");
      }
    };

    // Use setTimeout(tick, 0) for the initial tick so the SSR-rendered
    // "Scanning …" state is visible before the first timer fires.
    const initId = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(initId);
      clearInterval(id);
    };
  }, [isScanning, remaining]);

  const showScanning = display === null || display === "scanning";

  return (
    <div className="rounded-xl border border-border bg-navy-700 p-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
        Next scan in
        {gmtOffset && (
          <span className="ml-1.5 font-mono normal-case font-normal text-slate-600">
            {gmtOffset}
          </span>
        )}
      </p>
      {showScanning ? (
        <span className="flex items-center gap-2 font-mono text-3xl font-bold text-accent">
          <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
          Scanning&nbsp;…
        </span>
      ) : (
        <span
          className="font-mono text-3xl font-bold text-accent tabular-nums"
          style={{ minWidth: "5ch", display: "inline-block" }}
        >
          {display}
        </span>
      )}
    </div>
  );
}
