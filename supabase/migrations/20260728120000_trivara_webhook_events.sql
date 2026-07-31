CREATE TABLE IF NOT EXISTS public.trivara_webhook_events (
  id TEXT PRIMARY KEY DEFAULT ('twe_' || uuid_generate_v4()),
  event_name TEXT,
  merchant_id TEXT,
  extracted_external_order_id TEXT,
  extracted_toycker_order_id TEXT,
  extracted_trivara_order_id TEXT,
  extracted_trivara_api_order_id TEXT,
  matched_order_id TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  response_status INTEGER,
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.trivara_webhook_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.trivara_webhook_events TO authenticated;

DROP POLICY IF EXISTS "Admins can view trivara_webhook_events"
  ON public.trivara_webhook_events;

CREATE POLICY "Admins can view trivara_webhook_events"
  ON public.trivara_webhook_events
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

CREATE INDEX IF NOT EXISTS idx_trivara_webhook_events_created_at
  ON public.trivara_webhook_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trivara_webhook_events_status
  ON public.trivara_webhook_events(status);

CREATE INDEX IF NOT EXISTS idx_trivara_webhook_events_matched_order_id
  ON public.trivara_webhook_events(matched_order_id);
