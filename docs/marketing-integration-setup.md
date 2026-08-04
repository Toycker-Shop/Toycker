# Toycker Marketing Integration Setup

This guide explains what the marketing team must prepare and what the Toycker admin must enter.

The integrations covered are:

- Google Analytics 4
- Google Search Console
- Meta Pixel and Meta Conversions API
- Google Merchant Center

Google Cloud/GCP credentials are not required for this current prototype.

## Who does what?

The marketing team creates and configures the accounts on Google and Meta. The Toycker admin enters the provided values in the Toycker admin panel.

Open the Toycker admin page here:

```text
/admin/marketing
```

Use the Development website and Development Supabase project for testing first. Do not use Production credentials for Development testing.

## Information to collect from the marketing team

| Platform | Information needed | Where it is entered |
| --- | --- | --- |
| Google Analytics 4 | Measurement ID, such as `G-XXXXXXXXXX` | Google Analytics 4 section |
| Google Search Console | HTML verification token | Google Search Console section |
| Meta | Numeric Pixel ID | Meta section |
| Meta | Conversions API access token | Meta section |
| Meta | Test Event Code, optional | Meta section |
| Merchant Center | Nothing secret; only a Merchant Center account and verified domain are needed | Feed URL is copied from the admin page |

Ask the marketing team to provide these values through a secure channel. Do not put the Meta access token in normal chat, email, screenshots, or source code.

## 1. Google Analytics 4

### Marketing team setup

The marketing team should:

1. Open the company Google Analytics account.
2. Create or select the Toycker GA4 property.
3. Create or select the Toycker website data stream.
4. Copy the Measurement ID.

The ID looks like this:

```text
G-XXXXXXXXXX
```

### Toycker admin setup

1. Open `/admin/marketing`.
2. Open the **Google Analytics 4** section.
3. Paste the Measurement ID.
4. Enable Google Analytics.
5. Click **Save and check**.

### How it works afterward

On storefront visits, Toycker sends these events automatically:

- Product opened: `view_item`
- Product added to cart: `add_to_cart`
- Cart opened: `view_cart`
- Checkout opened: `begin_checkout`
- Confirmed order: `purchase`

The marketing team should confirm the events in Google Analytics Realtime. The admin button checks the ID format, but Realtime confirms that data is actually arriving.

## 2. Google Search Console

### Marketing team setup

The marketing team should:

1. Open Google Search Console.
2. Add the Toycker Development website as a URL-prefix property.
3. Select HTML tag verification.
4. Copy the value inside the `content` attribute.

Example:

```html
<meta name="google-site-verification" content="ABC123" />
```

Only provide this value to Toycker:

```text
ABC123
```

Do not paste the complete HTML tag into the admin field.

### Toycker admin setup

1. Open the **Google Search Console** section.
2. Paste the verification token.
3. Enable **Publish verification tag**.
4. Click **Save and check**.
5. Return to Search Console and click **Verify**.

### How it works afterward

Toycker places the verification tag in the website `<head>` section. Search Console reads the tag and confirms ownership of the website.

## 3. Meta Pixel and Conversions API

### Marketing team setup

The marketing team should:

1. Open Meta Events Manager.
2. Create or select the Toycker Pixel/Dataset.
3. Copy the numeric Pixel ID.
4. Create a Conversions API access token.
5. Optionally create a Test Event Code for Development testing.

The Pixel ID is numeric, for example:

```text
123456789012345
```

The access token is a long secret value. It must be sent securely.

### Toycker admin setup

1. Open the **Meta Pixel and Conversions API** section.
2. Enter the numeric Pixel ID.
3. Enter the Conversions API access token.
4. Enter the Test Event Code if Development testing is required.
5. Enable Meta tracking.
6. Click **Save and check**.

If the access token field is blank later, the existing saved token is kept. A new token replaces the old token only when a new value is entered.

### How it works afterward

On storefront visits, the browser sends:

- PageView
- ViewContent
- AddToCart
- InitiateCheckout
- Purchase

When an order is confirmed, the server also sends a Purchase event through Meta Conversions API.

The browser and server use the same order ID for the Purchase event. This helps Meta identify both events as one conversion instead of counting two purchases.

The access token stays on the server and is never sent to the visitor’s browser.

### Meta testing

1. Open Meta Events Manager Test Events.
2. Keep the Test Event Code ready.
3. Open the Development storefront.
4. Open the product page and continue testing.
5. Open a product.
6. Add it to the cart.
7. Start checkout.
8. Complete a Development test order.
9. Confirm the events in Meta Test Events.

Use a Development test order only. Do not test this flow with a real Production order.

## 4. Google Merchant Center

### Marketing team setup

The marketing team should:

1. Create or select the Toycker Merchant Center account.
2. Verify and claim the Toycker website domain.
3. Configure basic shipping and tax settings in Merchant Center.

No Google credential needs to be entered into Toycker for this prototype.

### Toycker admin setup

1. Open the **Google Merchant Center** section.
2. Click **Save**.
3. Copy the displayed feed URL.

The feed URL will look like this:

```text
https://your-development-domain.com/merchant-feed.xml
```

### Merchant Center setup

1. Open Merchant Center.
2. Go to **Data sources**.
3. Add a product source.
4. Choose file upload using a scheduled fetch.
5. Paste the Toycker feed URL.
6. Choose a fetch schedule.
7. Save the source.
8. Review product diagnostics after the first fetch.

### How it works afterward

Toycker generates the feed from active products. It includes product names, descriptions, links, images, prices, currencies, brands, conditions, and stock availability.

Merchant Center fetches the feed on its schedule. The feed is cached by Toycker for approximately 15 minutes.

## 5. Default tracking behavior

Toycker marketing tracking is enabled by default for storefront visitors. Google and Meta tracking scripts load automatically on storefront pages.

No consent popup is shown. Admin pages remain excluded from storefront marketing tracking.

For testing:

1. Open the Development website.
2. Open a product.
3. Add it to the cart.
4. Start checkout.
5. Complete a Development test order.
6. Check the events in Google Analytics Realtime and Meta Test Events.

## 6. Final checklist
### Marketing team

- [ ] GA4 property and website data stream are ready.
- [ ] GA4 Measurement ID is provided.
- [ ] Search Console property is ready.
- [ ] Search Console HTML verification token is provided.
- [ ] Meta Pixel/Dataset is ready.
- [ ] Meta Pixel ID is provided.
- [ ] Meta Conversions API access token is created.
- [ ] Meta Test Event Code is created for Development testing, if needed.
- [ ] Merchant Center account is ready.
- [ ] Website domain is verified and claimed in Merchant Center.
- [ ] Shipping and tax settings are configured in Merchant Center.

### Toycker admin/developer

- [ ] Current application code is deployed to Development.
- [ ] `NEXT_PUBLIC_BASE_URL` points to the Development website.
- [ ] Values are entered at `/admin/marketing`.
- [ ] Each provider is enabled after its value is entered.
- [ ] Search Console verification is completed.
- [ ] GA4 Realtime events are confirmed.
- [ ] Meta Test Events are confirmed.
- [ ] Merchant feed opens publicly.
- [ ] Merchant Center fetch succeeds.
- [ ] Product and Development order events are tested.

## 7. Production setup later

Development and Production have separate databases and settings.

When Development testing is complete:

1. Back up Production.
2. Apply the migration to Production.
3. Deploy the application to Production.
4. Set the Production `NEXT_PUBLIC_BASE_URL`.
5. Enter the Production provider values in `/admin/marketing`.
6. Repeat the provider verification steps.

Do not assume that Development settings automatically appear in Production.
