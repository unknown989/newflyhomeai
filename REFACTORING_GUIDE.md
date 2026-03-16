# Refactoring Guide: Timer Logic, Scanning UI, and SerpApi Integration

This document outlines the major changes made to the newflyhomeai codebase to fix timer logic, improve the scanning UI, simplify code structure, and replace Duffel with SerpApi Google Flights.

## 1. Timer Logic Fixes

### Problem
The timer was correctly using tier-based intervals from `tierIntervals.ts`, but the scanning UI wasn't clearly distinguishing between "timer counting down" and "server actively scanning".

### Solution
**File: `contexts/ScanContext.tsx`**
- Added `isScanning` boolean to the context value
- `isScanning` is `true` when `nextScanAt <= now` (server is actively scanning)
- `isScanning` is `false` when `nextScanAt > now` (timer is counting down)
- Timer logic remains unchanged and respects tier intervals

**Key Changes:**
```typescript
// Old: Only had remaining time
export interface ScanContextValue {
  nextScanAt: number | null;
  remaining: number | null;
  airportIata: string | null;
  scanIntervalSeconds: number;
}

// New: Added isScanning flag
export interface ScanContextValue {
  nextScanAt: number | null;
  remaining: number | null;
  isScanning: boolean;  // NEW: True when server is actively scanning
  airportIata: string | null;
  scanIntervalSeconds: number;
}
```

## 2. Scanning UI Improvements

### Problem
The "Next scan in" section showed "Scanning..." whenever `nextScanAt` was null or <= 0, which didn't clearly indicate whether the server was actually scanning or just the timer was running.

### Solution
**File: `components/dashboard/ScanCountdown.tsx`**
- Removed dependency on `nextScanAt` prop (now uses context directly)
- Only shows "Scanning..." when `isScanning === true`
- Shows countdown timer (MM:SS) when timer is running (`remaining > 0`)
- Simplified component logic by using context values directly

**Behavior:**
- **Timer running (0-30min remaining):** Shows countdown in MM:SS format
- **Server scanning:** Shows "Scanning ..." with pulsing indicator
- **Between scans:** Shows countdown to next scan

## 3. Code Simplification

### Problem
Debugging required jumping between multiple files:
- `ScanContext.tsx` for timer state
- `ScanCountdown.tsx` for display logic
- `NavScanCountdown.tsx` for navbar display
- Multiple API routes for flight data

### Solution
**Consolidated timer logic:**
- All timer state now lives in `ScanContext.tsx`
- Both `ScanCountdown` and `NavScanCountdown` read from context
- Single source of truth for scan timing

**Simplified API routes:**
- `/api/bookings` now directly generates Google Flights links (no Duffel complexity)
- Removed complex offer fetching and 3DS authentication flow
- Reduced from ~800 lines of booking logic to ~150 lines

## 4. Duffel → SerpApi Google Flights Migration

### Problem
Duffel API integration was complex:
- Required multiple API calls (offer requests, order creation, link generation)
- Complex state management for 3D Secure authentication
- Tight coupling between booking flow and payment processing
- Difficult to debug due to distributed logic

### Solution
**New Files:**
- `lib/serpapi.ts` - Simplified SerpApi integration with two main functions:
  - `generateGoogleFlightsUrl()` - Creates search URL for flights
  - `generateBookingLink()` - Creates direct booking link for a specific flight
  - `searchFlights()` - Optional: Search for available flights

**Simplified Booking Flow:**
1. User clicks "Book" on a flight
2. Modal shows flight details and passenger count
3. User clicks "Book on Google Flights"
4. Direct redirect to Google Flights for that specific flight
5. User completes booking on Google Flights

**Changes to `/api/bookings`:**
- POST now just generates a Google Flights link
- No pending booking creation
- No Duffel Links or order management
- Response: `{ bookingUrl: string, flightNumber: string }`

**Changes to `BookingModal.tsx`:**
- Removed Duffel component client key fetching
- Removed offer selection UI
- Removed passenger details form (not needed for Google Flights redirect)
- Simplified to just passenger count selection
- Direct redirect to Google Flights URL

### Migration Checklist

**Before deploying:**
1. ✅ Set `SERPAPI_API_KEY` environment variable
2. ✅ Remove `DUFFEL_API_KEY` from environment (optional, won't hurt)
3. ✅ Update tests to use new booking API
4. ✅ Remove old Duffel-related database columns (optional, can migrate later):
   - `duffel_order_id`
   - `duffel_offer_id`
   - `duffel_link_id`
   - `duffel_total`
   - `duffel_cancellation_id`

**Optional: Database cleanup**
```sql
-- Keep for backward compatibility, but no longer used
-- ALTER TABLE bookings DROP COLUMN duffel_order_id;
-- ALTER TABLE bookings DROP COLUMN duffel_offer_id;
-- etc.
```

## 5. File-by-File Changes

### Modified Files
| File | Changes |
|------|---------|
| `contexts/ScanContext.tsx` | Added `isScanning` boolean, improved timer logic |
| `components/dashboard/ScanCountdown.tsx` | Simplified to use `isScanning`, removed prop |
| `app/api/bookings/route.ts` | Replaced Duffel with SerpApi, simplified to 150 lines |
| `components/flights/BookingModal.tsx` | Removed Duffel UI, simplified to passenger selection |

### New Files
| File | Purpose |
|------|---------|
| `lib/serpapi.ts` | SerpApi integration library |

### Removed/Deprecated
| File | Status |
|------|--------|
| `lib/duffel.ts` | Still present but no longer used (can be removed) |
| `app/api/bookings/offers` | No longer needed (can be removed) |
| `app/api/bookings/client-key` | No longer needed (can be removed) |

## 6. Testing the Changes

### Test Timer Logic
1. Set user to different tiers (free, standard, pro, ultimate)
2. Verify scan interval changes correctly
3. Check that "Next scan in" shows countdown, not "Scanning..."
4. Wait for scan to complete, verify "Scanning..." appears briefly

### Test Booking Flow
1. Click "Book" on a flight
2. Select number of passengers
3. Click "Book on Google Flights"
4. Verify redirect to Google Flights with correct flight
5. Verify flight details are pre-filled in Google Flights

### Test Scanning UI
1. Monitor the "Next scan in" section during a full scan cycle
2. Verify countdown shows MM:SS format
3. Verify "Scanning..." appears when scan is active
4. Verify countdown resumes after scan completes

## 7. Debugging Guide

### Common Issues

**Timer always shows "Scanning..."**
- Check `isScanning` value in React DevTools
- Verify `nextScanAt` is being updated correctly
- Check `/api/scan-status` response in Network tab

**Booking redirects to wrong flight**
- Verify flight ID is correct in POST request
- Check `generateBookingLink()` parameters
- Verify Google Flights URL format in browser

**Countdown timer doesn't update**
- Check ScanContext is mounted
- Verify `setInterval` is running (check console)
- Check for React StrictMode double-mounting in development

### Quick Debug Commands

```typescript
// In browser console, check scan context
const context = document.querySelector('[data-testid="scan-context"]');

// Check current scan status
fetch('/api/scan-status').then(r => r.json()).then(console.log);

// Manually trigger a scan
fetch('/api/flights?airport=LHR').then(r => r.json()).then(console.log);
```

## 8. Performance Improvements

- **Reduced API calls:** No more offer requests, only scan-status poll
- **Simpler state management:** Single `isScanning` boolean instead of complex state
- **Faster booking flow:** Direct redirect vs. multi-step Duffel flow
- **Smaller bundle:** Removed Duffel client library dependency

## 9. Future Enhancements

1. **Add SerpApi flight search:** Use `searchFlights()` to show available flights
2. **Implement booking history:** Track bookings made via Google Flights
3. **Add price tracking:** Use SerpApi to monitor price changes
4. **Implement alerts:** Notify users when prices drop below threshold

## 10. Rollback Plan

If issues arise:

1. Revert `contexts/ScanContext.tsx` to previous version
2. Revert `components/dashboard/ScanCountdown.tsx` to previous version
3. Revert `app/api/bookings/route.ts` to previous version
4. Revert `components/flights/BookingModal.tsx` to previous version
5. Keep `lib/serpapi.ts` (won't hurt if not used)

All changes are backward compatible with existing database schema.
