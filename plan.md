# Supabase Egress Reduction Plan

## Objective

Reduce avoidable Supabase database and Storage egress while preserving the kiosk booking flow, customer lookup, coupon behavior, recommendations, and admin booking queue.

The primary suspected source is the standalone APK bootstrap. Each kiosk launch can currently download complete collections of customers, bookings, booking add-ons, coupons, coupon usage, and sent coupons instead of only the data needed for the current session.

## Scope

### Primary application

- `HeigenKiosk-apk/`
- Direct Supabase PostgREST access in `src/api/standalone-backend.js`
- Native pooler path in `src/api/poolerTransport.js`
- Kiosk and admin screens that trigger reads or refreshes

### Secondary application paths

- Django API and its database access
- Electron admin API usage
- Package/category image and Supabase Storage access

## Success Criteria

- Reduce the kiosk bootstrap response size by at least 90%.
- A new kiosk session does not download all customers or historical bookings.
- Recommendation calls return only the requested top results.
- Admin queue reads have server-side limits and pagination.
- Catalog data is cached locally and reused during a configurable TTL.
- Coupon lookup and validation only read data for the current customer/code.
- Booking creation, customer lookup, coupon validation, status updates, and recommendation behavior remain correct.
- Before/after Supabase egress is measured using comparable traffic volume.

## Current Egress Risks

### 1. Full-table kiosk bootstrap

`fetchKioskBootstrapDataRest` and `fetchKioskBootstrapDataPoolerOneQuery` load:

- All customers
- All bookings
- All booking add-ons
- All sent coupons
- All coupons
- All coupon usage
- Full package and add-on rows

The pooler reduces round trips but does not solve payload size because it returns the same broad data as one JSON document.

### 2. Client-side recommendation aggregation

The following functions download historical booking data and calculate counts on the device:

- `fetchPopularPackage`
- `fetchPopularAddons`
- `fetchRecommendations`
- `fetchPopularRecommendations`

This creates large responses for a result that normally contains only one package or three recommendations.

### 3. Wildcard column selection

`queryTable` defaults to `select=*`, causing internal and unused columns to be transferred.

### 4. Unbounded admin queue reads

`fetchBookingsByStatus` filters by status but does not apply a limit or pagination strategy.

### 5. Repeated forced refreshes

`KioskApp` forces a complete bootstrap reload when a kiosk session is exited or reset. A booking completion should not require reloading every customer, booking, coupon, and usage row.

### 6. Storage/image downloads

Package and category images may contribute separate Storage egress if original-sized files are repeatedly downloaded without thumbnails or client caching.

## Implementation Plan

### Phase 0: Establish a baseline

1. Add temporary or development-only request telemetry for:
   - Table/RPC name
   - Triggering screen or action
   - Row count
   - Response byte size
   - Request frequency
2. Record Supabase database and Storage egress for a fixed observation window.
3. Capture representative usage:
   - Fresh kiosk launch
   - Several booking flows
   - Customer lookup
   - Coupon validation
   - Admin queue open and refresh
   - Recommendation refresh
4. Remove or disable verbose payload logging after measurements are complete.

### Phase 1: Replace the full bootstrap

Create a narrow catalog RPC or view, for example:

```text
get_kiosk_catalog()
```

Return only:

- Active categories
- Active packages and required display fields
- Active add-ons and required display fields
- Loyalty settings
- Small popularity summaries, if needed

Do not include customers, historical bookings, booking add-ons, coupons, coupon usage, or sent-coupon rows.

Update `loadKioskBootstrap` to use the catalog response. Retain the pooler implementation only if it provides a measurable benefit after the payload has been narrowed.

### Phase 2: Move recommendations into PostgreSQL

Implement database views or RPCs:

```text
get_popular_packages(category_name, result_limit)
get_popular_addons(category_name, result_limit)
get_customer_recommendations(customer_id, result_limit)
```

Each operation should:

- Aggregate counts inside PostgreSQL.
- Filter inactive/deleted catalog records.
- Apply the requested limit in the database.
- Return only fields rendered by the client.
- Use suitable indexes on foreign keys, status, category, and timestamps.

Replace client-side historical downloads in the recommendation functions with these calls.

### Phase 3: Use explicit projections

Replace `select=*` in high-traffic reads with explicit column lists.

At minimum, define projections for:

- Categories
- Packages
- Add-ons
- Customers
- Bookings
- Booking add-ons
- Coupons
- Coupon usage

Do not return internal audit fields, unused metadata, large HTML fields, or other fields not required by the current screen or transaction.

### Phase 4: Make customer and coupon reads on-demand

Remove all-customer loading from kiosk startup.

After the customer submits an email:

1. Call a narrow `find_customer_by_email` RPC or filtered query.
2. Return only the customer ID, display name, contact information, and loyalty balance.
3. Load customer-specific coupons only after the customer is identified.
4. Query usage only for the returned coupon IDs.

Replace multi-query coupon validation with a single `validate_coupon(code, customer_id, subtotal)` RPC where possible. The RPC should return only validity, error text, discount type, discount amount, and coupon identifiers needed for booking creation.

### Phase 5: Add limits and pagination

Apply server-side limits to the admin queue:

- Default limit: 50 active bookings.
- Maximum limit: 100.
- Stable ordering by `created_at` and `id`.
- Cursor or offset pagination for history screens.

Only load older records when a user explicitly requests them. Keep the active queue focused on `Pending` and `Ongoing` records.

### Phase 6: Add persistent catalog caching

Use `AsyncStorage` for non-sensitive catalog data:

- Categories
- Packages
- Add-ons
- Loyalty settings
- Popularity summary, with a shorter TTL if retained

Recommended behavior:

1. Show cached catalog immediately when it is within the TTL.
2. Refresh in the background.
3. Use a 5–15 minute catalog TTL.
4. Force refresh only after an explicit retry or known catalog update.
5. Do not persist customer, coupon, or booking history unless required.

### Phase 7: Remove unnecessary full refreshes

Replace forced `loadKioskBootstrap({ force: true })` calls during session reset with:

- Local state reset
- Catalog cache reuse
- A small popularity invalidation or refresh
- Queue refresh only when entering the admin queue or using pull-to-refresh

After booking creation, update local state or request only the small aggregate data needed for the next session.

### Phase 8: Optimize Storage and image traffic

Measure Storage egress separately from database egress.

Then:

- Generate small thumbnails for kiosk cards.
- Use transformed/resized image URLs.
- Compress uploaded images.
- Avoid base64 image payloads.
- Cache images on the device.
- Do not download original-resolution images for list cards.

### Phase 9: Review other clients

Inspect Django and Electron traffic for duplicate or oversized reads. Apply the same principles:

- Explicit projections
- Server-side pagination
- Aggregate endpoints
- Short-lived caching
- Avoid repeated refreshes

Keep the direct Supabase APK path and Django-backed clients behaviorally consistent, but do not make the kiosk download Django/admin datasets that it does not need.

## Database and API Design Guidelines

### Narrow catalog response

Example response shape:

```json
{
  "categories": [],
  "packages": [],
  "addons": [],
  "loyalty_settings": {},
  "popular_packages": [],
  "popular_addons": []
}
```

### Narrow recommendation response

```json
{
  "recommendations": [
    {
      "package_id": 12,
      "package_name": "Premium Portrait",
      "category": "Portrait",
      "base_price": 1500
    }
  ]
}
```

### Security requirements

- Keep the anon key restricted by existing RLS policies.
- Do not expose service-role credentials in the APK.
- Ensure RPCs enforce the same visibility rules as the existing tables.
- Do not allow arbitrary SQL or arbitrary table selection from the client.
- Avoid returning private customer information in public catalog responses.

## Validation Strategy

### Functional validation

Verify:

- Fresh kiosk launch
- Cached kiosk launch
- Category/package/add-on selection
- New customer booking
- Existing customer booking
- Customer loyalty balance
- Customer-specific coupons
- Coupon validation
- Booking creation
- Confirmation email behavior
- Admin queue loading
- Booking status changes
- Recommendation refresh

### Egress validation

For the same scripted usage volume, compare:

- Total Supabase database egress
- Total Supabase Storage egress
- Number of requests
- Total response bytes
- Rows returned by each operation
- Cold-start versus warm-cache traffic

### Regression checks

- No full-table customer or historical booking response on kiosk startup.
- No recommendation function downloads all historical bookings.
- No high-traffic read depends on `select=*`.
- Active queue requests are bounded.
- Catalog cache does not display deleted or stale records beyond the documented TTL.

## Rollout Order

1. Baseline telemetry and Supabase dashboard measurements.
2. Narrow catalog bootstrap.
3. On-demand customer and coupon reads.
4. Database recommendation RPCs.
5. Explicit projections and queue pagination.
6. Persistent catalog cache.
7. Remove forced full refreshes.
8. Optimize Storage/image delivery.
9. Re-measure and compare against the baseline.

## Expected Impact

The largest reduction should come from removing customers, bookings, booking add-ons, and coupon tables from the bootstrap. Moving recommendations to database-side aggregation should provide the next-largest reduction. Explicit projections, pagination, caching, and thumbnail delivery should further reduce recurring traffic as the dataset and kiosk usage grow.
