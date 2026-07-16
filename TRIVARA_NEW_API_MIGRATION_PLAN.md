# Trivara New API Migration Plan

## Purpose of this document

This document explains how Toycker should move from the current Trivara Logistics integration to Trivara's new dashboard and API.

The main business requirement is:

> When an admin accepts a Toycker order, the order must first appear in Trivara under **New Order**. It must not be booked with a courier immediately.

This document covers:

- How the current Toycker integration works.
- Why the current integration sends orders directly to Booked.
- How the new Trivara API is different.
- The exact Phase 1 changes needed to create a New Order.
- The Phase 2 changes needed to automate courier booking, AWB, labels, tracking, pickup, and cancellation.
- Database, UI, environment variable, security, and testing changes.
- Which credentials are required and where they should come from.
- Questions that Trivara must answer before production rollout.

The new Trivara Postman documentation is:

<https://documenter.getpostman.com/view/55506770/2sBXwvHnkG#intro>

The new documented base URL is:

```text
https://api-new.trivaralogistics.com
```

---

## Short decision

The required change is classified as **High**.

It is not a complete rewrite of Toycker's logistics feature. Toycker can reuse its order acceptance flow, permissions, database logging pattern, retry behavior, timeline, and Logistics admin pages.

However, the Trivara-specific API code needs a major rewrite because the new platform uses:

- A new API host.
- A new login and Bearer-token authentication system.
- New endpoint paths.
- A different order payload.
- Different order, shipment, and AWB identifiers.
- Separate steps for order creation and shipment booking.

Changing only the URL will not work.

---

## The most important difference

The current Trivara API combines order creation and booking.

```text
Accept Toycker order
        -> Call old create_order API
        -> Courier booking/reference is created
        -> Local Trivara status becomes Booked
```

The new Trivara API separates order creation from shipment booking.

```text
Accept Toycker order
        -> POST /orders
        -> Order appears under New Order
        -> No courier booking yet
        -> No AWB yet
```

Later:

```text
Choose courier
        -> Create or ship the shipment
        -> AWB is generated
        -> Order becomes Booked/Shipped
```

This separation is what Toycker needs.

---

# Current Toycker implementation

## Current order acceptance flow

The Accept Order button calls `acceptOrder()` in:

```text
src/lib/data/admin.ts
```

The current flow is:

1. Check that the user is an admin.
2. Check the admin's order-update permission.
3. Validate partial-payment requirements.
4. Change the Toycker order status to `accepted`.
5. Add an Order Accepted timeline event.
6. Call `requestTrivaraBookingForAcceptedOrder()`.
7. Build the old Trivara booking payload.
8. Call the old `create_order` endpoint.
9. Require a Trivara reference number from the response.
10. Save the local Trivara status as `booked`.

If Trivara fails, the Toycker order remains accepted. Toycker records the error and allows the admin to retry. This behavior is useful and should remain.

## Current Trivara API client

The current provider client is:

```text
src/lib/integrations/trivara.ts
```

It currently calls old endpoints such as:

```text
/api/users/V2/OrderBooking/create_order
/api/users/V2/OrderBooking/track_parcel
/api/users/V2/OrderBooking/print_slip
/api/users/V2/OrderBooking/get_total_orders
/api/users/V2/OrderBooking/cancel_order
/api/users/V2/OrderBooking/get_pickup_location
/api/users/V2/Activity/get_services
```

These endpoints do not appear in the new Postman collection.

## Current payload

The current booking payload contains fields such as:

```text
warehouse_name
service_partner_id
crn_no
orders[]
service
shipment_type
weight
length
width
height
```

It selects a service partner while sending the order. That is one reason the order is treated as a booking instead of only a New Order.

## Current authentication

The current client uses values such as:

```text
TRIVARA_API_KEY
TRIVARA_TRACKING_API_KEY
TRIVARA_MASTER_API_KEY
TRIVARA_CRN_NO
```

It sends an API-key header such as:

```http
Apikey: <old-api-key>
```

The new documented API does not use this authentication method.

## Current database

The current migration is:

```text
supabase/migrations/20260428120000_trivara_order_bookings.sql
```

The table stores one Trivara record for each Toycker order. Its statuses are:

```text
pending
booked
failed
skipped
cancelled
```

There is no status for "successfully created in Trivara but not booked". A new `created` status is required.

## Current fulfillment flow

After a Toycker order is accepted, the order detail page shows Fulfill Items. The admin selects Trivara and manually enters the AWB/tracking number.

This is implemented in:

```text
src/app/admin/orders/[id]/fulfillment-modal.tsx
```

The manual AWB step can remain during Phase 1.

---

# New Trivara authentication

## How the new authentication works

The new Postman collection documents this login request:

```http
POST /auth/login
Content-Type: application/json
```

```json
{
  "email": "merchant@example.com",
  "password": "merchant-password",
  "totp": "123456"
}
```

The Postman collection expects the response to contain values such as:

```text
accessToken
refreshToken
user.id
```

All protected Trivara requests then use:

```http
Authorization: Bearer <accessToken>
```

When the access token expires, Toycker should call:

```http
POST /auth/refresh
```

The refresh endpoint should return a new access token. The exact request body, token lifetime, and token rotation behavior are not clearly documented and must be confirmed with Trivara.

## Is the new authentication compulsory?

Yes, if Toycker uses the new API.

Creating an order with `POST /orders` is a protected merchant operation. The published new collection only shows Bearer-token authentication for protected operations.

The public tracking endpoint may not require merchant authentication:

```text
GET /public-tracking/trivera/:awb
```

Unless Trivara privately provides a server API key, Toycker must implement login, access-token use, and token refresh.

## Recommended token flow

Toycker should have one central server-side authentication helper.

```text
Need to call Trivara
        -> Check stored access token
        -> If still valid, use it
        -> If expired, use the refresh token
        -> Store the new token safely
        -> Send the Trivara request
        -> If Trivara returns 401, refresh and retry once
```

The helper must prevent several simultaneous orders from refreshing the token at the same time.

## TOTP concern

The login request includes `totp`, which normally means a short-lived two-factor authentication code.

A person cannot manually enter a TOTP every time an order is accepted. Trivara must confirm how automatic server-to-server login is intended to work.

The acceptable options are:

1. Trivara gives Toycker a dedicated service account without interactive TOTP.
2. Trivara gives Toycker a client ID and client secret.
3. Trivara gives Toycker a long-lived API token.
4. Trivara gives Toycker a long-lived refresh token after one approved login.
5. Trivara officially permits Toycker to store the TOTP secret and generate the current code on the server.

The preferred solution is a dedicated service credential or API token. Storing a normal dashboard password and TOTP secret should only be used if Trivara officially requires and supports it.

## Token security

- Authentication must run only on the server.
- Tokens must never be sent to browser components.
- Tokens, passwords, and TOTP values must never be written to logs or saved inside request diagnostic payloads.
- Production credentials must be stored in Vercel Environment Variables or another secure secret manager.
- A refresh token stored in Supabase should be encrypted. It must not be stored as plain text in a normal public table.
- A failed `401` retry should happen only once to prevent loops.

---

# Credentials and configuration

## Credentials that must come from Trivara

| Credential or value | Why it is needed | Where it should come from |
| --- | --- | --- |
| Merchant/service email | Used by `POST /auth/login` | Trivara should create or approve a dedicated API/service user. Do not use a personal employee account if a service account is available. |
| Merchant/service password | Used by `POST /auth/login` | Set in the new Trivara dashboard or issued/reset through Trivara support. Store it only in server-side secrets. |
| TOTP setup or exemption | The login body contains a TOTP field | Trivara must explain whether API accounts need TOTP. If required, obtain the TOTP enrollment secret through Trivara's official 2FA setup process. Do not store a changing six-digit code as an environment variable. |
| Service API key, client ID, or client secret, if available | Preferred server-to-server authentication | Request this directly from Trivara API support. The public Postman document does not currently show this option. |
| Pickup address ID | Required by `POST /orders` as `pickupAddressId` | Create/verify the Toycker warehouse in the new Trivara dashboard, then obtain the ID from `GET /pickup-address`. |
| API base URL | Tells Toycker where to send requests | Published in the new Postman collection: `https://api-new.trivaralogistics.com`. Trivara should confirm production and sandbox URLs. |
| Sandbox/test account | Needed for safe testing | Request it from Trivara. The public documentation does not clearly provide a sandbox. |

## Values generated by Trivara during authentication

These values should not be manually copied into `.env` for normal operation:

| Value | How it is obtained |
| --- | --- |
| Access token | Returned by `/auth/login` or `/auth/refresh`. |
| Refresh token | Expected to be returned by `/auth/login` and possibly rotated by `/auth/refresh`. |
| Merchant/user ID | Returned as `user.id` by login. It normally does not need to be an environment variable. |

## Values chosen by Toycker

| Value | Suggested value or source |
| --- | --- |
| Channel name | `Toycker` |
| External order ID | A stable value such as `toycker_<Toycker order UUID>` |
| Default package weight | Business-defined fallback used only when product/package weight is unavailable |
| Default dimensions | Business-defined fallback used only when product/package dimensions are unavailable |

## Proposed Phase 1 environment variables

The exact authentication variable names may change after Trivara confirms the service-login method.

```env
# Enable only after sandbox or controlled testing succeeds.
TRIVARA_ORDER_SYNC_ENABLED=false

# New Trivara API.
TRIVARA_API_BASE_URL=https://api-new.trivaralogistics.com

# Temporary proposal for login-based authentication.
# Prefer a dedicated Trivara service account.
TRIVARA_AUTH_EMAIL=
TRIVARA_AUTH_PASSWORD=

# Store the TOTP enrollment secret only if Trivara officially requires
# server-generated TOTP. Do not store a changing 6-digit code here.
TRIVARA_AUTH_TOTP_SECRET=

# ID returned by GET /pickup-address.
TRIVARA_PICKUP_ADDRESS_ID=

# Value sent as channelName.
TRIVARA_CHANNEL_NAME=Toycker

# Fallback package data.
TRIVARA_DEFAULT_WEIGHT_KG=0.5
TRIVARA_DEFAULT_LENGTH_CM=20
TRIVARA_DEFAULT_WIDTH_CM=15
TRIVARA_DEFAULT_HEIGHT_CM=10
```

If Trivara provides a proper service API key or OAuth-style client credentials, use variables such as:

```env
TRIVARA_CLIENT_ID=
TRIVARA_CLIENT_SECRET=
```

or:

```env
TRIVARA_SERVICE_API_KEY=
```

Do not add all credential types. Use only the authentication method that Trivara officially confirms.

## Old variables

The following old variables should be removed after migration and rollback protection are no longer needed:

```text
TRIVARA_API_KEY
TRIVARA_TRACKING_API_KEY
TRIVARA_MASTER_API_KEY
TRIVARA_CRN_NO
TRIVARA_WAREHOUSE_NAME
TRIVARA_SERVICE
TRIVARA_SHIPMENT_TYPE
TRIVARA_SERVICE_PARTNER_ID
TRIVARA_PRINT_SLIP_API_BASE_URL
TRIVARA_SERVICES_API_BASE_URL
```

During rollout, old variables may temporarily remain available behind a clearly separated legacy adapter. The new and old clients must not be mixed in the same request flow.

---

# Phase 1: Create a New Order only

## Phase 1 goal

When the admin accepts an order in Toycker, create the order in Trivara but do not book a courier or shipment.

## Phase 1 target flow

```text
Customer places Toycker order
        -> Admin clicks Accept Order
        -> Toycker changes status to accepted
        -> Toycker authenticates with Trivara
        -> Toycker calls POST /orders
        -> Trivara returns its order ID
        -> Toycker stores local Trivara status as created
        -> Order appears under New Order in Trivara
        -> Staff continues booking from Trivara dashboard
        -> Staff copies the AWB into Toycker when ready
```

## API calls needed in Phase 1

Required:

```text
POST /auth/login
POST /auth/refresh
GET  /pickup-address
POST /orders
GET  /orders/:id
PATCH /orders/:id/status
```

Useful for reconciliation:

```text
GET /orders
GET /orders/counts
```

Must not be called during acceptance:

```text
POST /orders/:id/ship
POST /orders/bulk-ship
POST /shipments/create
POST /shipments/bulk-create
```

## New order request mapping

The documented new request uses a flat B2C order structure.

Suggested mapping:

| Trivara field | Toycker source |
| --- | --- |
| `customerName` | Shipping first name plus last name |
| `customerPhone` | Shipping phone, normalized for Trivara |
| `customerEmail` | Toycker customer/order email |
| `addressLine1` | Shipping address line 1 |
| `addressLine2` | Shipping address line 2 |
| `pincode` | Shipping postal code |
| `city` | Shipping city |
| `state` | Shipping province/state |
| `country` | Shipping country, normally India |
| `items` | Toycker order items |
| `weightKg` | Calculated package weight or configured fallback |
| `paymentMode` | `COD` or the Trivara-supported prepaid value |
| `codAmount` | Full COD amount or remaining partial-payment balance |
| `pickupAddressId` | `TRIVARA_PICKUP_ADDRESS_ID` |
| `shippingCharges` | Toycker shipping total |
| `discount` | Toycker order-level discount |
| `channelName` | `Toycker` |
| `externalOrderId` | Stable Toycker order reference |

Each Trivara item can contain:

```text
name
quantity
price
sku
weight
category
hsnCode
taxRate
lengthCm
widthCm
heightCm
```

Trivara must confirm which fields are compulsory and what unit each weight and dimension field expects.

## Payment mapping

### Prepaid order

```text
paymentMode = prepaid value confirmed by Trivara
codAmount = 0
```

### Full COD order

```text
paymentMode = COD
codAmount = final payable order amount
```

### Partial-payment order with a remaining balance

```text
paymentMode = COD
codAmount = remaining balance only
```

The existing Toycker partial-payment calculation can be reused.

## Accept-order code changes

In `src/lib/data/admin.ts`:

1. Rename `requestTrivaraBookingForAcceptedOrder()` to a name such as `createTrivaraOrderForAcceptedOrder()`.
2. Keep the existing admin and payment checks.
3. Keep the Toycker order update to `accepted`.
4. Build the new order payload.
5. Store a local `pending` row before calling Trivara.
6. Call `POST /orders` through the new authenticated client.
7. Extract the Trivara order ID and remote order status.
8. Save local status `created`, not `booked`.
9. Add a timeline event called `Trivara New Order Created`.
10. Do not require a reference number or AWB at this stage.
11. Do not call a shipment or courier API.
12. Preserve failure logging without rolling back Toycker acceptance.

## Duplicate protection

A network timeout can happen after Trivara creates an order but before Toycker receives the response. Retrying blindly could create a duplicate.

Toycker should:

1. Use a stable `externalOrderId`.
2. Keep the local `order_id` unique.
3. Stop if a Trivara order ID is already stored.
4. Search/reconcile before retrying after an uncertain timeout.
5. Confirm with Trivara whether duplicate `externalOrderId` values are rejected or treated idempotently.

## Phase 1 database changes

Keep the existing table initially to preserve history, but extend it.

Add local `created` status:

```text
pending
created
booked
failed
skipped
cancelled
```

Recommended new columns:

```text
trivara_order_id
external_order_id
remote_order_status
shipment_id
awb_number
courier_name
order_created_at
shipment_created_at
remote_synced_at
```

Keep these existing useful columns:

```text
request_payload
response_payload
error_message
tracking_payload
cancel_payload
created_at
updated_at
```

Keep `trivara_reference_number` for old records during migration. Do not use it as the main ID for new records.

## Phase 1 Logistics UI changes

Add or change filters to:

```text
All
Pending
New / Created
Booked
Failed
Skipped
Cancelled
```

Display separate values for:

- Toycker order number.
- Trivara order ID.
- Trivara order status.
- Shipment ID, when available.
- Courier, when available.
- AWB, when available.
- Local sync status.
- Last sync time.

For a created New Order, the detail page must show that an empty AWB, courier, shipment, and label are normal.

Change `Retry Booking` to `Retry Trivara Order Creation` for failed initial creation.

## Phase 1 fulfillment

Keep the current manual flow:

1. Staff books the shipment in Trivara's new dashboard.
2. Trivara generates an AWB.
3. Staff opens the Toycker order.
4. Staff enters the Trivara AWB in Fulfill Items.
5. Toycker changes the order to shipped.

This limits Phase 1 risk while delivering the required New Order behavior.

## Phase 1 cancellation

If the order has not been booked, use the documented order-status endpoint:

```http
PATCH /orders/:id/status
Content-Type: application/json
```

```json
{
  "status": "CANCELLED"
}
```

Trivara must confirm the accepted status spelling and whether a created order can always be cancelled this way.

## Phase 1 success criteria

- Accepting a Toycker order creates exactly one Trivara order.
- It appears under New Order in the Trivara dashboard.
- No courier is assigned automatically.
- No shipment is created automatically.
- No AWB is generated during acceptance.
- Toycker stores the Trivara order ID.
- Failures do not roll back Toycker acceptance.
- Retry does not create duplicates.
- Prepaid, COD, and partial-payment amounts are correct.
- Old Trivara records remain readable.

---

# Phase 2: Automate booking and shipment operations

## Phase 2 goal

Phase 2 removes most or all manual work after the New Order is created.

Toycker should be able to:

1. Read the current Trivara order status.
2. Get available courier rates.
3. Let an admin select a courier or apply an approved automatic rule.
4. Create/book the shipment.
5. Store the shipment ID, courier, shipping charge, and AWB.
6. Download or open the shipping label.
7. Mark the Toycker order as shipped at the correct time.
8. Track the shipment.
9. Cancel the correct Trivara resource.
10. Optionally manage pickup manifests, NDR, returns, COD remittance, weight disputes, and reports.

Phase 2 should start only after Phase 1 has run safely and Trivara supplies the missing shipment request and response schemas.

## Phase 2 target flow

```text
Trivara New Order exists
        -> Toycker syncs order status
        -> Toycker requests courier rates
        -> Admin selects a courier
           OR approved auto-selection rule selects one
        -> Toycker books the shipment
        -> Trivara returns shipment ID and AWB
        -> Toycker stores shipment details
        -> Toycker retrieves label data
        -> Pickup/manifest is created when required
        -> Toycker tracks shipment until delivery
```

## Phase 2A: Status synchronization

Use:

```text
GET /orders/:id
GET /orders
GET /orders/counts
GET /orders/shipment-counts
```

Toycker should store both:

- A local integration status, such as `created`, `booked`, or `failed`.
- The exact status returned by Trivara in `remote_order_status`.

These are different concepts and should not be stored in one field.

The public collection does not document webhooks. Until Trivara confirms a webhook service, Toycker will need one of these methods:

1. Manual Sync Status button.
2. Scheduled background polling for active orders.
3. Status refresh when an admin opens the Logistics page.

Scheduled polling should only query active orders and use sensible intervals to avoid unnecessary API usage.

## Phase 2B: Courier rates

Possible endpoints:

```text
GET  /orders/:id/rates
POST /rate-engine/calculate
```

The rate engine documents values such as:

```text
pickupPincode
deliveryPincode
weightKg
paymentType
length
width
height
codValue
deliveryState
deliveryCity
orderValue
pickupAddressId
channelName
items
flowType
```

Toycker should show rates with useful information such as:

- Courier name.
- Shipping price.
- Estimated delivery time.
- Service type.
- COD support.
- Pickup availability.

The exact rate response is not documented and must be confirmed with Trivara.

## Phase 2C: Courier selection

The safest first Phase 2 implementation is manual courier selection from Toycker Admin.

An admin should:

1. Open the Logistics detail page.
2. Click Get Rates.
3. Review available couriers and prices.
4. Select one courier.
5. Confirm Book Shipment.

Automatic selection can be added later with a clear business rule, for example:

- Cheapest service under a delivery-time limit.
- Preferred courier when serviceable.
- Cheapest courier for prepaid orders.
- Courier with COD support for COD orders.
- Avoid couriers temporarily disabled by operations.

Automatic selection should not be implemented until Toycker has real shipment performance data and the business approves the rule.

## Phase 2D: Shipment booking and AWB

The new collection includes:

```text
POST /orders/:id/ship
POST /shipments/create
POST /shipments/bulk-create
GET  /shipments/:id
PATCH /shipments/:id/edit
```

These endpoints appear to create and manage booked shipments.

Important: the public collection does not show the request body for the main shipment endpoints. Toycker must not guess it.

Before implementation, Trivara must provide:

- Required shipment request fields.
- Courier/rate identifier fields.
- Exact success response.
- Shipment ID field.
- AWB field.
- Shipping charge field.
- Duplicate booking behavior.
- Rules for editing before dispatch.
- Difference between `/orders/:id/ship` and `/shipments/create`.

After a successful booking, Toycker should save:

```text
shipment_id
awb_number
courier_name
shipping_charge
shipment_created_at
remote_order_status
```

Only then should the local logistics record become `booked`.

Toycker should decide separately when its own order becomes `shipped`. Creating an AWB may mean Booked/Ready to Ship, while actual courier handover may be the correct point for Shipped.

## Phase 2E: Labels and invoices

Documented endpoints:

```text
GET  /orders/:id/label-data
POST /invoice/:orderId/generate
GET  /invoice/:orderId
```

Toycker can add:

- Open/Download Label.
- Generate Invoice.
- Open/Download Invoice.

The response examples are empty in the public collection. Trivara must confirm whether these endpoints return JSON data, HTML, a PDF URL, or a PDF file.

The UI should not assume a direct PDF until a real response is tested.

## Phase 2F: Pickup and manifests

Documented endpoints:

```text
GET   /pickups
POST  /pickups
POST  /pickups/schedule
GET   /pickups/:id
PATCH /pickups/:id/status
POST  /pickups/:id/recalculate
```

Possible flow:

1. Select booked orders.
2. Generate a manifest.
3. Schedule pickup.
4. Print manifest details.
5. Update or sync pickup status.

The documented pickup statuses include examples such as:

```text
Scheduled
Out for Pickup
Completed
```

Toycker should store the manifest/pickup ID if it manages pickup operations.

## Phase 2G: Tracking

Documented public tracking endpoint:

```text
GET /public-tracking/trivera/:awb
```

The path is published with the spelling `trivera`. Confirm this exact spelling with Trivara.

Toycker should:

1. Require an AWB before tracking.
2. Call the public tracking endpoint.
3. Store the raw response and normalized current status.
4. Store tracking events.
5. Update `tracking_synced_at`.
6. Show the timeline in Admin Logistics.
7. Optionally show tracking on the customer order page after it is stable.

Do not automatically change Toycker to Delivered until Trivara confirms the exact delivered status values and the business approves automatic fulfillment updates.

## Phase 2H: Cancellation and de-allocation

Cancellation depends on the current stage.

### Created but not booked

Use the order status endpoint:

```text
PATCH /orders/:id/status
```

### Booked shipment

The collection includes:

```text
POST /shipments/bulk-cancel
```

Its body is not documented. Obtain the exact schema from Trivara.

### Courier allocated but shipment should return to Created

The collection includes:

```text
POST /orders/bulk-deallocate
```

Toycker must store enough remote identifiers to call the correct operation and must not mark a local cancellation successful unless Trivara confirms it.

## Phase 2I: NDR operations

Documented endpoints:

```text
GET  /ndr
POST /ndr/:id/action
POST /orders/bulk-ndr
```

NDR means that a delivery attempt failed or needs merchant action.

Possible Toycker features:

- Show active NDR cases.
- Display the reason and attempt details.
- Ask the customer to confirm an address or delivery date.
- Submit reattempt or return instructions.

The action request body is not documented and must be supplied by Trivara.

## Phase 2J: COD remittance

Documented endpoints:

```text
GET /cod-remittance
GET /cod-remittance/summary
GET /cod-remittance/future
GET /cod-remittance/:id
```

These APIs can be used for finance reconciliation:

- Total COD collected.
- Amount pending remittance.
- Upcoming remittance batches.
- Paid batches.
- Orders included in a remittance.

This is useful but not required for initial booking automation.

## Phase 2K: Returns and reverse pickup

Documented endpoints:

```text
GET  /returns
POST /returns
POST /returns/bulk
POST /shipments/create-return
```

The return request supports customer details, products, pickup address, package dimensions, courier, reason, comments, original order ID, and quality-check options.

This should be implemented only after Toycker defines its return approval and refund process. Creating a reverse shipment must not automatically issue a refund.

## Phase 2L: Weight disputes

Documented endpoints:

```text
GET  /weight-disputes
POST /weight-disputes/:id/accept
POST /weight-disputes/:id/dispute
```

Possible Toycker features:

- List courier weight differences.
- Show expected versus charged weight.
- Accept a valid extra charge.
- Raise a dispute with evidence.

The dispute request body and evidence upload method are not documented.

## Phase 2M: Reports

Documented endpoints:

```text
GET  /reports
POST /reports
GET  /reports/filter-options
GET  /reports/:id/download
```

The documented creation example is:

```json
{
  "reportType": "Order Details",
  "filters": {}
}
```

Reports can be added to Toycker Admin later. They are not needed for the New Order or shipment booking flow.

## Phase 2 database changes

Phase 2 should add or fully use fields such as:

```text
shipment_id
awb_number
courier_id
courier_name
shipping_charge
label_payload
invoice_payload
manifest_id
pickup_status
remote_order_status
remote_shipment_status
last_tracking_status
remote_synced_at
```

Raw responses should remain available for troubleshooting, but important fields should also have dedicated columns. The UI should not repeatedly search large JSON payloads to find IDs and statuses.

## Phase 2 UI changes

Suggested actions on the Logistics detail page:

### Created order

```text
Sync Status
Get Rates
Cancel Trivara Order
```

### Courier selected but not booked

```text
Change Courier
Book Shipment
Cancel
```

### Booked shipment

```text
Sync Shipment
Open Label
Track
Cancel Shipment
```

### Pickup stage

```text
Generate Manifest
Schedule Pickup
Open Manifest
Sync Pickup
```

Actions must be shown only when they make sense for the current remote status.

## Phase 2 success criteria

- Toycker can read a Trivara New Order reliably.
- Available courier rates are shown correctly.
- A courier is selected only with admin confirmation or an approved rule.
- Booking creates only one shipment.
- Shipment ID and AWB are stored separately from Trivara order ID.
- Labels and invoices can be opened safely.
- Tracking is saved and displayed.
- Cancellation calls the correct order or shipment operation.
- Failed calls can be retried without duplicate shipments.
- Background synchronization does not overload the API.
- All important actions have audit/timeline events.

---

# File-level change list

## `src/lib/integrations/trivara.ts`

High change.

- Replace old URL constants and endpoints.
- Add login and refresh types.
- Add Bearer-token request helper.
- Add token refresh and one-time `401` retry.
- Replace old booking types with new order types.
- Replace the payload mapper.
- Add new order, status, tracking, label, pickup, rate, and shipment functions as each phase requires.
- Keep reusable safe-response and error-parsing logic where possible.

## `src/lib/data/admin.ts`

Medium change.

- Replace automatic booking with New Order creation.
- Save `created` instead of `booked`.
- Save Trivara order ID.
- Change retry and recovery logic.
- Add duplicate protection.
- Update timeline messages.
- Update cancellation routing.

## `src/lib/data/trivara-logistics.ts`

High change.

- Replace old sync actions.
- Replace tracking and label actions.
- Add remote order status sync.
- Add Phase 2 rate and shipment actions.
- Store explicit order, shipment, courier, and AWB fields.
- Keep permission and revalidation patterns.

## `src/app/admin/logistics/page.tsx`

Medium change.

- Add New/Created filter.
- Show Trivara order ID separately from AWB.
- Show remote order and shipment statuses.
- Replace old summary sync cards.

## `src/app/admin/logistics/[orderId]/page.tsx`

High change.

- Separate order details from shipment details.
- Change diagnostics to the new payload.
- Add phase-aware actions.
- Stop treating a reference number as both order ID and AWB.

## `src/app/admin/logistics/[orderId]/logistics-detail-actions.tsx`

Medium to high change.

- Add Sync Status.
- Change tracking to the new endpoint.
- Change label action.
- Add Get Rates and Book Shipment in Phase 2.

## `src/app/admin/logistics/logistics-sync-actions.tsx`

High change or removal.

- Old Pickup Locations, Services, and Total Orders syncs use old contracts.
- Replace them with new pickup addresses, order counts, and other useful new summaries.

## `src/app/admin/orders/[id]/fulfillment-modal.tsx`

Low change in Phase 1.

- Keep manual AWB entry.
- Improve wording to explain that the order must first be booked in Trivara.

Medium/high change in Phase 2.

- Automatically use the stored Trivara AWB.
- Avoid asking the admin to type it again.

## Supabase types

Medium change.

- Add new status values and columns to generated/manual types.
- Add new Trivara request/response types.

## Database migration

Medium change.

- Extend the status constraint.
- Add new order and shipment fields.
- Preserve existing legacy data.
- Add indexes for Trivara order ID, external order ID, AWB, and remote status where useful.

## `.env.example`

Medium change.

- Add new authentication and pickup variables.
- Mark old variables as legacy during rollout.
- Remove old variables after migration is complete.

## `TRIVARA_LOGISTICS_INTEGRATION.md`

High documentation change.

- It currently describes an older API generation.
- Replace it or mark it clearly as legacy.
- Link to this migration plan.

---

# Testing plan

## Unit tests

Add tests for:

- New order payload mapping.
- Address and phone formatting.
- Item mapping.
- Weight conversion.
- Prepaid payment mapping.
- COD amount mapping.
- Partial-payment remaining balance.
- Missing required data.
- Response ID extraction.
- Token-expiry handling.
- Refresh and one-time retry.
- Duplicate prevention.
- Local status transitions.

## Integration tests

Test with a Trivara sandbox or approved test account:

1. Login.
2. Refresh token.
3. Read pickup addresses.
4. Create one New Order.
5. Confirm it appears under New Order.
6. Read it by ID.
7. Cancel an unbooked test order.
8. Confirm a retry does not duplicate it.

Phase 2 tests:

1. Get courier rates.
2. Book a controlled test shipment.
3. Confirm shipment ID and AWB.
4. Get label data.
5. Track the AWB.
6. Cancel/de-allocate an approved test shipment.
7. Test pickup/manifest operations only with Trivara approval.

## End-to-end Toycker tests

- Accept Order creates a Trivara New Order.
- Toycker remains accepted if Trivara fails.
- Failed creation is visible in Logistics.
- Retry succeeds safely.
- New Order has no AWB and is not shown as Booked.
- Phase 1 manual AWB fulfillment still works.
- Phase 2 automatic AWB fulfillment works when enabled.
- Permissions prevent unauthorized logistics actions.

---

# Rollout plan

## Step 1: Get Trivara answers and credentials

- Confirm service authentication.
- Obtain a test/sandbox account.
- Confirm pickup address ID.
- Confirm required order fields and units.
- Confirm New Order status behavior.
- Confirm response schemas and idempotency.

## Step 2: Build Phase 1 behind a feature flag

Keep:

```env
TRIVARA_ORDER_SYNC_ENABLED=false
```

until controlled testing is ready.

## Step 3: Test one approved order

- Use a clearly identifiable test order.
- Confirm it appears under New Order.
- Confirm it is not booked.
- Confirm no live pickup is created.
- Cancel it safely after testing if required.

## Step 4: Enable Phase 1 gradually

- Monitor failures and duplicates.
- Compare Toycker and Trivara order counts.
- Keep manual AWB fulfillment.
- Keep old data readable.

## Step 5: Build Phase 2 in smaller parts

Recommended Phase 2 order:

1. Status synchronization.
2. Courier rates.
3. Manual courier selection in Toycker.
4. Shipment booking and AWB storage.
5. Labels and invoices.
6. Tracking.
7. Cancellation/de-allocation.
8. Pickup and manifests.
9. Optional NDR, COD remittance, returns, disputes, and reports.

Do not implement every new dashboard API at once.

---

# Questions to send to Trivara

## Authentication

1. Do you provide a dedicated server-to-server API account?
2. Is TOTP compulsory for API login?
3. Can you provide a service API key, client ID/client secret, or OAuth-style flow?
4. What is the access-token lifetime?
5. What is the refresh-token lifetime?
6. What must be sent to `/auth/refresh`?
7. Are refresh tokens rotated?
8. Can one refresh token be used safely from several server instances?

## Environment

1. Is `https://api-new.trivaralogistics.com` the production base URL?
2. Is there a sandbox or staging URL?
3. Can you provide a test merchant account and test pickup address?
4. Can test shipments be created without a real courier pickup?

## New Order

1. Does `POST /orders` always place the order in the New Order tab?
2. Which request fields are compulsory?
3. What are the exact accepted values for `paymentMode`?
4. Are weights in kilograms?
5. Are item dimensions in centimetres?
6. Is `externalOrderId` unique per merchant?
7. Is retrying the same `externalOrderId` idempotent?
8. What is the exact success response?
9. Which field is the Trivara order ID?
10. What status is returned immediately after creation?

## Booking and shipment

1. What is the difference between `/orders/:id/ship` and `/shipments/create`?
2. What are the required request bodies for both endpoints?
3. Which endpoint should Toycker use for a normal single B2C shipment?
4. Which response fields contain shipment ID, courier, AWB, and charge?
5. Is shipment creation idempotent?
6. When is an order considered Booked versus Shipped?
7. How should a shipment be cancelled?

## Labels, tracking, and status

1. What does `/orders/:id/label-data` return?
2. Does it return a PDF, PDF URL, HTML, or JSON?
3. Is `/public-tracking/trivera/:awb` the correct spelling and final production path?
4. What are all possible order, shipment, tracking, pickup, NDR, and cancellation statuses?
5. Do you provide webhooks for order, AWB, tracking, cancellation, NDR, and remittance updates?
6. What are the API rate limits?

## Support and errors

1. What is the standard error response format?
2. Which error codes are safe to retry?
3. Do you provide a request/correlation ID for support?
4. Who should Toycker contact for production API incidents?

---

# Final implementation recommendation

Implement the migration in two controlled phases.

## Phase 1

Create a Trivara New Order only.

- Implement the new authentication.
- Call `POST /orders` during acceptance.
- Store the Trivara order ID.
- Use local status `created`.
- Do not book a courier.
- Keep manual AWB fulfillment.

This phase directly solves the current business requirement.

## Phase 2

Automate operations after New Order creation.

- Sync status.
- Fetch courier rates.
- Select a courier.
- Book the shipment.
- Store shipment ID and AWB.
- Retrieve labels and invoices.
- Track and cancel shipments.
- Add pickup, manifest, NDR, returns, COD remittance, disputes, and reports only when the business needs them.

The overall Toycker logistics module does not need to be rebuilt. The Trivara provider layer, authentication, payload mapping, and state handling do need major changes.

