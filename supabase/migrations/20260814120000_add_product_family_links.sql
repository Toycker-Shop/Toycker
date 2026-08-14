-- Store direct Product Family relationships separately from Frequently Bought Together links.
CREATE TABLE IF NOT EXISTS public.product_family_links (
    id TEXT PRIMARY KEY DEFAULT ('family_link_' || uuid_generate_v4()),
    product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    family_product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT product_family_links_no_self_link CHECK (product_id <> family_product_id),
    CONSTRAINT product_family_links_unique_pair UNIQUE (product_id, family_product_id)
);

CREATE INDEX IF NOT EXISTS product_family_links_family_product_id_idx
    ON public.product_family_links (family_product_id);

ALTER TABLE public.product_family_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read product family links"
    ON public.product_family_links
    FOR SELECT
    TO public
    USING (true);

CREATE POLICY "Admins can insert product family links"
    ON public.product_family_links
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins can update product family links"
    ON public.product_family_links
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Admins can delete product family links"
    ON public.product_family_links
    FOR DELETE
    TO authenticated
    USING ((SELECT public.is_admin()));

COMMENT ON TABLE public.product_family_links IS
    'Stores direct Product Family relationships between products.';
