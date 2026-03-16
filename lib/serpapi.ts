/**
 * SerpApi Google Flights integration
 * Simplified flight search and booking link generation
 */

function getApiKey(): string {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) {
    throw new Error(
      "SERPAPI_API_KEY is required. Obtain from your SerpApi dashboard."
    );
  }
  return key;
}

export interface FlightSearchParams {
  origin: string;           // IATA code (e.g., "LHR")
  destination: string;      // IATA code (e.g., "JFK")
  departureDate: string;    // YYYY-MM-DD format
  returnDate?: string;      // YYYY-MM-DD format (optional for one-way)
  passengers?: number;      // Default: 1
  cabin?: "economy" | "premium_economy" | "business" | "first"; // Default: economy
}

/**
 * Generate a Google Flights search URL for a specific flight
 * This is used to redirect users to book the flight on Google Flights
 */
export function generateGoogleFlightsUrl(params: FlightSearchParams): string {
  const baseUrl = "https://www.google.com/flights";
  
  const searchParams = new URLSearchParams();
  searchParams.set("flt", params.origin + params.destination);
  searchParams.set("curr", "USD");
  
  // Format departure date
  const depDate = new Date(params.departureDate);
  searchParams.set("qs", depDate.toISOString().split("T")[0]);
  
  // Add return date if provided
  if (params.returnDate) {
    const retDate = new Date(params.returnDate);
    searchParams.set("qe", retDate.toISOString().split("T")[0]);
  }
  
  // Add number of passengers
  if (params.passengers && params.passengers > 1) {
    searchParams.set("pax", String(params.passengers));
  }
  
  // Add cabin class
  if (params.cabin && params.cabin !== "economy") {
    const cabinMap: Record<string, string> = {
      premium_economy: "1",
      business: "2",
      first: "3",
    };
    searchParams.set("cabin", cabinMap[params.cabin] || "0");
  }
  
  return `${baseUrl}?${searchParams.toString()}`;
}

/**
 * Search for flights using SerpApi
 * Returns flight data that can be used for bookability checking
 */
export async function searchFlights(params: FlightSearchParams): Promise<{
  flights: Array<{
    airline: string;
    flightNumber: string;
    departure: string;
    arrival: string;
    duration: string;
    stops: number;
    price: string;
    currency: string;
  }>;
  searchUrl: string;
}> {
  const apiKey = getApiKey();
  
  const queryParams = new URLSearchParams({
    api_key: apiKey,
    engine: "google_flights",
    departure_id: params.origin,
    arrival_id: params.destination,
    outbound_date: params.departureDate,
    type: params.returnDate ? "1" : "0", // 1 = round trip, 0 = one way
    currency: "USD",
  });
  
  if (params.returnDate) {
    queryParams.set("return_date", params.returnDate);
  }
  
  if (params.passengers && params.passengers > 1) {
    queryParams.set("passengers", String(params.passengers));
  }
  
  if (params.cabin && params.cabin !== "economy") {
    queryParams.set("cabin_class", params.cabin);
  }
  
  try {
    const response = await fetch(
      `https://serpapi.com/search?${queryParams.toString()}`
    );
    
    if (!response.ok) {
      throw new Error(`SerpApi returned status ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract flights from the response
    const flights = (data.best_flights || data.other_flights || []).map(
      (flight: any) => ({
        airline: flight.airline || "Unknown",
        flightNumber: flight.flight_number || "N/A",
        departure: flight.departure_time || "",
        arrival: flight.arrival_time || "",
        duration: flight.duration || "",
        stops: flight.stops || 0,
        price: flight.price || "N/A",
        currency: "USD",
      })
    );
    
    const searchUrl = generateGoogleFlightsUrl(params);
    
    return { flights, searchUrl };
  } catch (err) {
    throw new Error(`SerpApi search failed: ${(err as Error).message}`);
  }
}

/**
 * Generate a direct booking link to Google Flights for a specific flight
 * This is simpler than Duffel and redirects users to complete booking on Google
 */
export function generateBookingLink(params: {
  origin: string;
  destination: string;
  departureDate: string;
  flightNumber: string;
  airline: string;
  returnDate?: string;
  passengers?: number;
}): string {
  // Google Flights doesn't have a direct deep link for specific flights,
  // so we generate a search URL that shows the available flights
  return generateGoogleFlightsUrl({
    origin: params.origin,
    destination: params.destination,
    departureDate: params.departureDate,
    returnDate: params.returnDate,
    passengers: params.passengers,
  });
}

export class ApiError extends Error {
  constructor(
    public httpStatus: number,
    public apiMessage: string
  ) {
    super(`SerpApi error ${httpStatus}: ${apiMessage}`);
    this.name = "ApiError";
  }
}
