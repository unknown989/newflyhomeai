"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
} from "react";
import useSWR, { useSWRConfig } from "swr";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScanContextValue {
  /** Unix seconds timestamp of the next scheduled scan, or null if unknown. */
  nextScanAt: number | null;
  /** Seconds until the next scan, computed from nextScanAt. Null before first poll. */
  remaining: number | null;
  /** True if the server is currently scanning (nextScanAt is 0 or in the past). */
  isScanning: boolean;
  airportIata: string | null;
  scanIntervalSeconds: number;
}

interface ScanStatusResponse {
  airportIata: string | null;
  scanIntervalSeconds: number;
  lastScanAt: number | null;
  nextScanAt: number | null;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ScanContext = createContext<ScanContextValue>({
  nextScanAt: null,
  remaining: null,
  isScanning: false,
  airportIata: null,
  scanIntervalSeconds: 1800,
});

export function useScan(): ScanContextValue {
  return useContext(ScanContext);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const jsonFetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

// ─── Provider ────────────────────────────────────────────────────────────────

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const { mutate: globalMutate } = useSWRConfig();
  const globalMutateRef = useRef(globalMutate);
  globalMutateRef.current = globalMutate;

  const scanFiredRef = useRef(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // Tracks whether nextScanAt was ever in the future during this mount.
  // Used to distinguish "page loaded while next_scan_at = 0" (should NOT re-trigger)
  // from "monitor just finished an immediate scan and set next_scan_at = 0" (SHOULD trigger).
  const hadFutureNextScanAtRef = useRef(false);

  // Single scan-status poll shared by all pages.
  const { data: statusData } = useSWR<ScanStatusResponse>(
    "/api/scan-status",
    jsonFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false }
  );

  const airportIata = statusData?.airportIata ?? null;
  const scanIntervalSeconds = statusData?.scanIntervalSeconds ?? 1800;
  const nextScanAt = statusData?.nextScanAt ?? null;

  // ── Countdown timer driven by server-provided nextScanAt ──────────────────
  // This is the ONLY setInterval driving the scan-boundary trigger.
  // GET /api/flights is fired when the countdown actively transitions to 0;
  // it is NOT fired merely because next_scan_at is already 0 on mount (which
  // would re-trigger on every page reload, logout, or multi-device login).
  useEffect(() => {
    if (!airportIata) return;

    const now = Math.floor(Date.now() / 1000);

    // One-way ratchet: once nextScanAt has been in the future during this mount,
    // we know any subsequent 0/past value is a genuine scan completion event.
    if (nextScanAt !== null && nextScanAt > now) {
      hadFutureNextScanAtRef.current = true;
    }

    // Pre-seed scanFiredRef:
    // If next_scan_at is already past AND we've never seen a future value this
    // mount, treat this as a stale timestamp from a previous session — do NOT
    // re-fire the scan trigger (covers page reload, fresh login, new tab).
    const isAlreadyPast = nextScanAt !== null && nextScanAt <= now;
    if (isAlreadyPast && !hadFutureNextScanAtRef.current) {
      scanFiredRef.current = true;
    } else {
      scanFiredRef.current = false;
    }

    const tick = () => {
      const now2 = Math.floor(Date.now() / 1000);
      let next: number | null = null;
      let scanning = false;

      if (nextScanAt !== null) {
        const diff = nextScanAt - now2;
        next = diff > 0 ? diff : 0;
        // Server is scanning if nextScanAt is 0 or in the past
        scanning = diff <= 0;
      }

      setRemaining(next);
      setIsScanning(scanning);

      if (next === 0 && !scanFiredRef.current) {
        scanFiredRef.current = true;
        globalMutateRef.current(`/api/flights?airport=${airportIata}`);
        // Immediately refresh scan-status so nextScanAt updates without
        // waiting for the 60-second SWR poll cycle.
        globalMutateRef.current("/api/scan-status");
      } else if (next !== null && next !== 0) {
        scanFiredRef.current = false;
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [airportIata, nextScanAt]);

  return (
    <ScanContext.Provider
      value={{ nextScanAt, remaining, isScanning, airportIata, scanIntervalSeconds }}
    >
      {children}
    </ScanContext.Provider>
  );
}
