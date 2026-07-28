-- Enable realtime refresh for admin logistics pages when Trivara webhook sync updates bookings.
-- Admin-only RLS keeps these rows hidden from normal storefront users.

GRANT SELECT ON public.trivara_order_bookings TO authenticated;

DROP POLICY IF EXISTS "Admins can view trivara_order_bookings" ON public.trivara_order_bookings;

CREATE POLICY "Admins can view trivara_order_bookings"
  ON public.trivara_order_bookings
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'trivara_order_bookings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trivara_order_bookings;
  END IF;
END $$;
