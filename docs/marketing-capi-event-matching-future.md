# Future Improvement: Meta Purchase Event Matching

## Purpose

This document records a future improvement for Meta Purchase tracking.

The current Toycker integration is working. Meta receives browser events such as `PageView`, `ViewContent`, `AddToCart`, and `InitiateCheckout`. Confirmed purchases are also sent through the browser and through Meta Conversions API.

This improvement is not required to make Purchase tracking work. It can help Meta match a purchase with the correct visitor more reliably.

## Current limitation

The server-side Purchase event currently sends useful information such as:

- Hashed customer email
- Hashed customer phone number
- Product details
- Order value
- Currency
- Order ID

The integration does not yet consistently capture and send these browser and request details:

- `fbp`: Meta's browser identifier cookie
- `fbc`: Meta's advertisement-click identifier
- Customer IP address
- Customer browser user agent

The code can read `fbp` and `fbc` when they already exist in order metadata, but the checkout flow does not currently save these values for every order.

## Why this may help

These values help Meta connect a server-side Purchase event with the visitor's earlier browser activity or advertisement click.

Without them, the Purchase event can still be received and processed. However, Meta may have less information for event matching, attribution, and campaign optimization.

## What to implement later

When this improvement is scheduled, implement it as a small, focused change:

1. Read the `fbp` and `fbc` values during checkout.
2. Save those values with the order or checkout data.
3. Capture the customer's original IP address and browser user agent during checkout.
4. Retain those values for payment-provider callbacks such as PayU or Easebuzz.
5. Add the values to the server-side Meta Purchase `user_data` payload.
6. Keep using the order ID as the browser and server `event_id` so Meta can deduplicate the two Purchase events.
7. Continue hashing email and phone before sending them to Meta.

## Important implementation rule

The IP address and browser user agent must come from the customer's checkout request. They should not be taken from a later payment callback, because that callback comes from the payment provider rather than the customer's browser.

## Privacy and security

Before implementing this improvement:

- Confirm that the privacy policy covers this marketing data processing.
- Send only the data needed by Meta.
- Keep the Meta access token on the server.
- Do not expose the access token in browser code or admin page HTML.
- Do not send raw email or phone values; continue hashing them.
- Review applicable privacy requirements before enabling default tracking in every market.

## Current decision

No immediate code change is required for this item.

The current prototype can proceed with Development and Production Purchase testing. Implement this enhancement later before relying heavily on Meta advertising and conversion optimization.

## Completion checklist for the future

- [ ] `fbp` is captured during checkout.
- [ ] `fbc` is captured during checkout when available.
- [ ] Customer IP address is retained for the Purchase event.
- [ ] Customer user agent is retained for the Purchase event.
- [ ] Meta CAPI receives these values in `user_data`.
- [ ] Browser and server Purchase events still use the same event ID.
- [ ] Duplicate Purchase events are not counted.
- [ ] Existing checkout and payment flows continue to work.
- [ ] Lint, typecheck, tests, and build pass.
- [ ] Development testing is completed before Production deployment.
