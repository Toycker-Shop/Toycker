ALTER TABLE public.trivara_order_bookings
  ADD COLUMN IF NOT EXISTS trivara_order_id TEXT,
  ADD COLUMN IF NOT EXISTS trivara_order_status TEXT,
  ADD COLUMN IF NOT EXISTS new_order_created_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.trivara_order_bookings
  DROP CONSTRAINT IF EXISTS trivara_order_bookings_status_check;

ALTER TABLE public.trivara_order_bookings
  ADD CONSTRAINT trivara_order_bookings_status_check
  CHECK (status IN ('pending', 'new_order', 'booked', 'failed', 'skipped', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_trivara_order_bookings_trivara_order_id
  ON public.trivara_order_bookings(trivara_order_id);
