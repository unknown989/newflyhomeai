// SIMPLIFIED: Replaced Duffel with SerpApi Google Flights
"use client";

import { useState, useEffect, useRef } from "react";
import type { DbFlight } from "@/lib/db";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface BookingModalProps {
  flight: DbFlight | null;
  onClose: () => void;
}

type ModalState = "details" | "redirecting" | "error";

export default function BookingModal({ flight, onClose }: BookingModalProps) {
  const [modalState, setModalState] = useState<ModalState>("details");
  const [passengers, setPassengers] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  // Body scroll lock
  useEffect(() => {
    if (flight) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [flight]);

  // Escape key closes modal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modalState !== "redirecting") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, modalState]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (flight) {
      setModalState("details");
      setPassengers(1);
      setError(null);
      setLoading(false);
      submittingRef.current = false;
    }
  }, [flight]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || !flight) return;

    submittingRef.current = true;
    setLoading(true);
    setError(null);
    setModalState("redirecting");

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flightId: flight.id,
          passengers,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Failed to generate booking link"
        );
      }

      const data = await res.json();
      // Redirect to Google Flights booking page
      window.location.href = data.bookingUrl;
    } catch (err) {
      setError((err as Error).message);
      setModalState("error");
      submittingRef.current = false;
      setLoading(false);
    }
  };

  if (!flight) return null;

  const departureTime = formatTime(flight.scheduled_departure);
  const duration = flight.scheduled_departure && flight.estimated_departure 
    ? formatDuration(flight.estimated_departure - flight.scheduled_departure)
    : "N/A";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-navy-800 p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {flight.airline} {flight.flight_number}
            </h2>
            <p className="text-sm text-slate-400">
              {flight.departure_airport} → {flight.destination_airport}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-slate-400 hover:text-white disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Flight Details */}
        <div className="mb-6 space-y-2 rounded-lg bg-navy-700 p-4">
          <div className="flex justify-between">
            <span className="text-sm text-slate-400">Departure</span>
            <span className="text-sm font-medium text-white">{departureTime}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-slate-400">Duration</span>
            <span className="text-sm font-medium text-white">{duration}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-slate-400">Stops</span>
            <span className="text-sm font-medium text-white">
              {flight.status === "scheduled" ? "On time" : flight.status}
            </span>
          </div>
          {flight.lowest_price_cents && flight.price_currency && (
            <div className="flex justify-between pt-2 border-t border-navy-600">
              <span className="text-sm text-slate-400">Price</span>
              <span className="text-sm font-semibold text-accent">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: flight.price_currency,
                }).format(flight.lowest_price_cents / 100)}
              </span>
            </div>
          )}
        </div>

        {/* Error State */}
        {modalState === "error" && error && (
          <div className="mb-4 rounded-lg bg-red-900/20 border border-red-500/50 p-3">
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={() => {
                setModalState("details");
                setError(null);
                submittingRef.current = false;
              }}
              className="mt-2 text-sm text-red-400 hover:text-red-300"
            >
              Try again
            </button>
          </div>
        )}

        {/* Form */}
        {modalState !== "error" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Passengers */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Number of Passengers
              </label>
              <select
                value={passengers}
                onChange={(e) => setPassengers(parseInt(e.target.value))}
                disabled={loading}
                className="w-full rounded-lg border border-border bg-navy-700 px-3 py-2 text-white disabled:opacity-50"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <option key={num} value={num}>
                    {num} {num === 1 ? "Passenger" : "Passengers"}
                  </option>
                ))}
              </select>
            </div>

            {/* Info */}
            <div className="rounded-lg bg-blue-900/20 border border-blue-500/50 p-3">
              <p className="text-xs text-blue-300">
                You'll be redirected to Google Flights to complete your booking.
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-navy transition-colors hover:bg-accent-dark disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-navy border-t-transparent" />
                    Redirecting…
                  </>
                ) : (
                  "Book on Google Flights"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
