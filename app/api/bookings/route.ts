import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import crypto from "crypto";
import {
  initDb,
  getBookingsWithFlightsByUserId,
  getDb,
  getFlightById,
} from "@/lib/db";
import { generateBookingLink } from "@/lib/serpapi";
import { log, logRequest } from "@/lib/logger";
import { rateLimit } from "@/lib/rateLimit";
import { corsHeaders } from "@/lib/cors";

// ─── Zod schema ──────────────────────────────────────────────────────────────

const PostBookingSchema = z.object({
  flightId: z.string().min(1),
  passengers: z.number().int().min(1).max(9).optional().default(1),
});

// ─── OPTIONS /api/bookings (CORS preflight) ───────────────────────────────────

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders(origin),
  });
}

// ─── POST /api/bookings ───────────────────────────────────────────────────────
// Simplified: Just returns a Google Flights booking link

export async function POST(request: NextRequest) {
  const startMs = Date.now();
  const origin = request.headers.get("origin");

  // 1. Auth check
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const durationMs = Date.now() - startMs;
    logRequest("POST", "/api/bookings", 401, durationMs);
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders(origin) }
    );
  }

  // 2. Rate limiting — 10 requests per 60 s per user
  const rl = rateLimit("bookings_post:" + session.user.id, 10, 60_000);
  if (!rl.allowed) {
    const durationMs = Date.now() - startMs;
    logRequest("POST", "/api/bookings", 429, durationMs, session.user.id);
    return NextResponse.json(
      {
        error: "Too many booking requests. Please wait before trying again.",
        retryAfterMs: rl.retryAfterMs,
      },
      {
        status: 429,
        headers: {
          ...corsHeaders(origin),
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  // 3. Parse + validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const durationMs = Date.now() - startMs;
    logRequest("POST", "/api/bookings", 400, durationMs, session.user.id);
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: corsHeaders(origin) }
    );
  }

  const parsed = PostBookingSchema.safeParse(body);
  if (!parsed.success) {
    const durationMs = Date.now() - startMs;
    logRequest("POST", "/api/bookings", 400, durationMs, session.user.id);
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400, headers: corsHeaders(origin) }
    );
  }

  const { flightId, passengers } = parsed.data;

  initDb();

  // 4. Get flight details
  const flight = getFlightById(flightId);
  if (!flight) {
    const durationMs = Date.now() - startMs;
    logRequest("POST", "/api/bookings", 404, durationMs, session.user.id);
    return NextResponse.json(
      { error: "Flight not found" },
      { status: 404, headers: corsHeaders(origin) }
    );
  }

  // 5. Verify flight belongs to user's monitored airport
  const userAirport = getDb()
    .prepare<[string], { airport_iata: string }>(
      "SELECT airport_iata FROM monitored_airports WHERE user_id = ? AND active = 1 LIMIT 1"
    )
    .get(session.user.id);

  if (!userAirport || userAirport.airport_iata !== flight.departure_airport) {
    const durationMs = Date.now() - startMs;
    logRequest("POST", "/api/bookings", 403, durationMs, session.user.id);
    return NextResponse.json(
      { error: "Flight does not belong to your monitored airport" },
      { status: 403, headers: corsHeaders(origin) }
    );
  }

  // 6. Generate Google Flights booking link
  try {
    const departureDate = new Date(flight.scheduled_departure * 1000)
      .toISOString()
      .split("T")[0];

    const bookingLink = generateBookingLink({
      origin: flight.departure_airport,
      destination: flight.destination_airport,
      departureDate,
      flightNumber: flight.flight_number,
      airline: flight.airline,
      passengers,
    });

    const durationMs = Date.now() - startMs;
    logRequest("POST", "/api/bookings", 200, durationMs, session.user.id);
    return NextResponse.json(
      { bookingUrl: bookingLink, flightNumber: flight.flight_number },
      { headers: corsHeaders(origin) }
    );
  } catch (err) {
    log("error", "bookings", "Failed to generate booking link", {
      err: String(err),
    });
    const durationMs = Date.now() - startMs;
    logRequest("POST", "/api/bookings", 500, durationMs, session.user.id);
    return NextResponse.json(
      { error: "Failed to generate booking link" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}

// ─── GET /api/bookings ────────────────────────────────────────────────────────

export async function GET(request?: NextRequest) {
  const startMs = Date.now();
  const origin = request?.headers?.get("origin") ?? null;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    const durationMs = Date.now() - startMs;
    logRequest("GET", "/api/bookings", 401, durationMs);
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders(origin) }
    );
  }

  try {
    initDb();
    const bookings = getBookingsWithFlightsByUserId(session.user.id);
    const durationMs = Date.now() - startMs;
    logRequest("GET", "/api/bookings", 200, durationMs, session.user.id);
    return NextResponse.json(
      {
        bookings: bookings.map((b) => ({
          ...b,
          total_amount: b.duffel_total ?? null,
          total_currency: b.total_currency ?? null,
          cancellation_pending: b.cancellation_pending ?? 0,
          confirm_fetch_failed: b.confirm_fetch_failed ?? 0,
        })),
      },
      { headers: corsHeaders(origin) }
    );
  } catch (err) {
    const durationMs = Date.now() - startMs;
    logRequest("GET", "/api/bookings", 500, durationMs, session.user.id);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}
