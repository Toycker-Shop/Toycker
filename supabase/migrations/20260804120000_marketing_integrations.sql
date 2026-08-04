-- Marketing integration settings are kept separate from global_settings.
-- global_settings is intentionally public-readable for storefront settings.

CREATE TABLE IF NOT EXISTS public.marketing_integrations (
    provider TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    measurement_id TEXT,
    search_console_verification_token TEXT,
    pixel_id TEXT,
    meta_access_token TEXT,
    meta_test_event_code TEXT,
    last_verified_at TIMESTAMP WITH TIME ZONE,
    last_verification_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT marketing_integrations_provider_check
        CHECK (provider IN ('google_analytics', 'search_console', 'meta', 'merchant_center'))
);

CREATE TABLE IF NOT EXISTS public.marketing_event_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_id TEXT NOT NULL,
    order_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_error TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT marketing_event_deliveries_status_check
        CHECK (status IN ('pending', 'sent', 'failed')),
    CONSTRAINT marketing_event_deliveries_unique_event
        UNIQUE (provider, event_name, event_id)
);

ALTER TABLE public.marketing_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_event_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage marketing integrations" ON public.marketing_integrations;
CREATE POLICY "Admins can manage marketing integrations"
    ON public.marketing_integrations FOR ALL
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Admins can read marketing event deliveries" ON public.marketing_event_deliveries;
CREATE POLICY "Admins can read marketing event deliveries"
    ON public.marketing_event_deliveries FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

CREATE INDEX IF NOT EXISTS idx_marketing_integrations_enabled
    ON public.marketing_integrations (enabled);

CREATE INDEX IF NOT EXISTS idx_marketing_event_deliveries_order_id
    ON public.marketing_event_deliveries (order_id);

COMMENT ON TABLE public.marketing_integrations IS
    'Admin-only marketing provider settings. Never expose meta_access_token to clients.';

COMMENT ON TABLE public.marketing_event_deliveries IS
    'Idempotency records for server-side marketing events.';
