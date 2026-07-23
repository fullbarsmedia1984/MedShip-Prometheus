-- ============================================================
-- Item Enrichment (P16/P17/P18)
-- Competitor catalog crawl (Firecrawl), item matching, competitor
-- price book, and mirrored catalog images in Supabase Storage.
--
-- Competitor pages are scraped into competitor_products (current
-- state) + competitor_price_points (append-only history), linked
-- to hercules_catalog_items via catalog_item_competitor_links.
-- Downloaded images live in the public 'catalog-images' bucket,
-- content-addressed by sha256; catalog_item_images maps items to
-- stored objects. All writes go through the service-role client.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- URL frontier: every URL discovered on a competitor domain and
-- what happened when we scraped it. 'not_product' caps wasted
-- Firecrawl credits at one per non-product URL forever.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitor_crawl_urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor TEXT NOT NULL CHECK (competitor IN ('pocketnurse', 'diamedical')),
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'scraped', 'not_product', 'failed', 'skipped')),
    fail_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_scraped_at TIMESTAMPTZ,
    UNIQUE (competitor, url)
);

CREATE INDEX IF NOT EXISTS idx_competitor_crawl_urls_pending
    ON competitor_crawl_urls(competitor, discovered_at)
    WHERE status = 'pending';

-- ------------------------------------------------------------
-- Current parsed state of a competitor product page.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitor_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor TEXT NOT NULL CHECK (competitor IN ('pocketnurse', 'diamedical')),
    url TEXT NOT NULL,
    title TEXT,
    brand TEXT,
    sku TEXT,
    mpn TEXT,
    gtin TEXT,
    description TEXT,
    list_price_amount NUMERIC(14,4),
    currency TEXT NOT NULL DEFAULT 'USD',
    price_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (price_status IN ('listed', 'quote_only', 'unavailable', 'parse_error', 'unknown')),
    availability TEXT,
    image_urls_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Which extraction strategy produced this row.
    parse_source TEXT
        CHECK (parse_source IN ('json_ld', 'magento_dom', 'suitecommerce_api', 'meta_tags')),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (competitor, url)
);

-- Matching-side expression indexes; the catalog side already has
-- idx_hercules_catalog_items_norm_mpn (migration 047).
CREATE INDEX IF NOT EXISTS idx_competitor_products_norm_mpn
    ON competitor_products (pricing_normalize_identifier(mpn));
CREATE INDEX IF NOT EXISTS idx_competitor_products_norm_sku
    ON competitor_products (pricing_normalize_identifier(sku));
CREATE INDEX IF NOT EXISTS idx_competitor_products_norm_gtin
    ON competitor_products (pricing_normalize_identifier(gtin));
CREATE INDEX IF NOT EXISTS idx_competitor_products_title_trgm
    ON competitor_products USING gin (title gin_trgm_ops);

-- ------------------------------------------------------------
-- Append-only price history: one row on first observation and
-- whenever price or status changes on a re-scrape.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitor_price_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_product_id UUID NOT NULL REFERENCES competitor_products(id) ON DELETE CASCADE,
    list_price_amount NUMERIC(14,4),
    currency TEXT NOT NULL DEFAULT 'USD',
    price_status TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitor_price_points_product
    ON competitor_price_points(competitor_product_id, observed_at DESC);

-- ------------------------------------------------------------
-- Item <-> competitor product links. Links are evidence, not
-- canon: bad matches get status 'rejected', never deleted.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_item_competitor_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hercules_catalog_item_id UUID NOT NULL REFERENCES hercules_catalog_items(id) ON DELETE CASCADE,
    competitor_product_id UUID NOT NULL REFERENCES competitor_products(id) ON DELETE CASCADE,
    match_method TEXT NOT NULL
        CHECK (match_method IN ('exact_mpn', 'exact_gtin', 'exact_sku_as_mpn',
                                'fuzzy_title', 'llm_adjudicated', 'manual')),
    match_confidence NUMERIC
        CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (hercules_catalog_item_id, competitor_product_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_item_competitor_links_item
    ON catalog_item_competitor_links(hercules_catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_catalog_item_competitor_links_product
    ON catalog_item_competitor_links(competitor_product_id);

-- ------------------------------------------------------------
-- Mirrored images. storage_path is content-addressed
-- ('<sha256[0:2]>/<sha256>.<ext>' inside catalog-images), so the
-- same physical image shared by many SKUs is stored once and
-- referenced by many rows.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_item_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hercules_catalog_item_id UUID NOT NULL REFERENCES hercules_catalog_items(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source TEXT NOT NULL
        CHECK (source IN ('hercules', 'pocketnurse', 'diamedical', 'web_search')),
    content_hash TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (hercules_catalog_item_id, content_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_item_images_primary
    ON catalog_item_images(hercules_catalog_item_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_catalog_item_images_hash
    ON catalog_item_images(content_hash);
CREATE INDEX IF NOT EXISTS idx_catalog_item_images_source_url
    ON catalog_item_images(source_url);

-- ------------------------------------------------------------
-- Sparse per-item enrichment progress; rows appear on first
-- attempt. Terminal states stop the mirror/sweep from retrying
-- the same item forever.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_item_enrichment_state (
    hercules_catalog_item_id UUID PRIMARY KEY
        REFERENCES hercules_catalog_items(id) ON DELETE CASCADE,
    image_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (image_status IN ('pending', 'mirrored', 'source_failed', 'hotlink_blocked',
                                'no_source', 'search_not_found')),
    image_attempts INT NOT NULL DEFAULT 0,
    last_image_attempt_at TIMESTAMPTZ,
    search_attempts INT NOT NULL DEFAULT 0,
    last_search_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_item_enrichment_state_status
    ON catalog_item_enrichment_state(image_status);

-- ------------------------------------------------------------
-- Resumable run bookkeeping, mirroring hercules_ingestion_runs.
-- cursor_json shape depends on phase (frontier batch position,
-- keyset item id, etc.).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrichment_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phase TEXT NOT NULL CHECK (phase IN ('competitor_crawl', 'image_mirror', 'search_sweep')),
    competitor TEXT CHECK (competitor IN ('pocketnurse', 'diamedical')),
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    cursor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    counters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    credits_used INT NOT NULL DEFAULT 0,
    items_processed INT NOT NULL DEFAULT 0,
    last_error TEXT,
    triggered_by TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active run per phase+competitor; concurrent runs would fight
-- over the cursor and double-spend the credit budget.
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrichment_runs_running
    ON enrichment_runs(phase, COALESCE(competitor, ''))
    WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_enrichment_runs_started
    ON enrichment_runs(started_at DESC);

-- ------------------------------------------------------------
-- Daily Firecrawl credit ledger; the budget gate reads today's
-- row before spending.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrichment_daily_budget (
    day DATE NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('competitor_crawl', 'search_sweep')),
    credits_used INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (day, phase)
);

-- The normalized-identifier expression indexes need a raised
-- statistics target so the planner estimates join selectivity against
-- the 748k-item catalog correctly. Without this it wildly overestimates
-- matched rows, picks a parallel seq scan over the index, and the
-- matching RPC times out. (Diagnosed 2026-07-17: 10s seq scan -> 11ms
-- index scan after raising the target and re-analyzing.) Guarded so the
-- migration is safe if 047's indexes are absent.
DO $$
BEGIN
    IF to_regclass('public.idx_hercules_catalog_items_norm_mpn') IS NOT NULL THEN
        EXECUTE 'ALTER INDEX idx_hercules_catalog_items_norm_mpn ALTER COLUMN 1 SET STATISTICS 1000';
        EXECUTE 'ANALYZE hercules_catalog_items';
    END IF;
    IF to_regclass('public.idx_hercules_offer_uoms_norm_gtin') IS NOT NULL THEN
        EXECUTE 'ALTER INDEX idx_hercules_offer_uoms_norm_gtin ALTER COLUMN 1 SET STATISTICS 1000';
        EXECUTE 'ANALYZE hercules_offer_uoms';
    END IF;
END $$;

-- ------------------------------------------------------------
-- Exact matching passes, idempotent and re-runnable after every
-- crawl. Short identifiers (< 4 chars normalized) collide wildly
-- and are excluded. Confidence scale matches migration 047 (0-1).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enrichment_match_exact()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    n_mpn BIGINT := 0;
    n_gtin BIGINT := 0;
    n_sku BIGINT := 0;
BEGIN
    -- Pass 1: competitor MPN vs catalog manufacturer part number.
    WITH ins AS (
        INSERT INTO catalog_item_competitor_links
            (hercules_catalog_item_id, competitor_product_id, match_method, match_confidence)
        SELECT DISTINCT h.id, cp.id, 'exact_mpn', 1.0
        FROM competitor_products cp
        JOIN hercules_catalog_items h
          ON pricing_normalize_identifier(h.manufacturer_part_number)
             = pricing_normalize_identifier(cp.mpn)
        WHERE cp.mpn IS NOT NULL
          AND length(pricing_normalize_identifier(cp.mpn)) >= 4
        ON CONFLICT (hercules_catalog_item_id, competitor_product_id) DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO n_mpn FROM ins;

    -- Pass 2: competitor GTIN vs offer-UOM GTINs.
    WITH ins AS (
        INSERT INTO catalog_item_competitor_links
            (hercules_catalog_item_id, competitor_product_id, match_method, match_confidence)
        SELECT DISTINCT o.hercules_catalog_item_id, cp.id, 'exact_gtin', 1.0
        FROM competitor_products cp
        JOIN hercules_offer_uoms ou
          ON pricing_normalize_identifier(ou.gtin) = pricing_normalize_identifier(cp.gtin)
        JOIN hercules_vendor_offers o ON o.id = ou.hercules_vendor_offer_id
        WHERE cp.gtin IS NOT NULL
          AND length(pricing_normalize_identifier(cp.gtin)) >= 8
          AND o.hercules_catalog_item_id IS NOT NULL
        ON CONFLICT (hercules_catalog_item_id, competitor_product_id) DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO n_gtin FROM ins;

    -- Pass 3: competitor SKU vs catalog MPN (Pocket Nurse often
    -- uses the manufacturer part number as its own SKU).
    WITH ins AS (
        INSERT INTO catalog_item_competitor_links
            (hercules_catalog_item_id, competitor_product_id, match_method, match_confidence)
        SELECT DISTINCT h.id, cp.id, 'exact_sku_as_mpn', 0.95
        FROM competitor_products cp
        JOIN hercules_catalog_items h
          ON pricing_normalize_identifier(h.manufacturer_part_number)
             = pricing_normalize_identifier(cp.sku)
        WHERE cp.sku IS NOT NULL
          AND length(pricing_normalize_identifier(cp.sku)) >= 4
        ON CONFLICT (hercules_catalog_item_id, competitor_product_id) DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO n_sku FROM ins;

    RETURN jsonb_build_object(
        'exact_mpn', n_mpn,
        'exact_gtin', n_gtin,
        'exact_sku_as_mpn', n_sku,
        'total', n_mpn + n_gtin + n_sku
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION enrichment_match_exact() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enrichment_match_exact() FROM anon;
REVOKE EXECUTE ON FUNCTION enrichment_match_exact() FROM authenticated;

-- Catalog-side trigram index: hercules 'brand' holds the short
-- product name (description is long marketing copy), so fuzzy title
-- matching joins competitor titles against it.
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_brand_trgm
    ON hercules_catalog_items USING gin (brand gin_trgm_ops);

-- ------------------------------------------------------------
-- Fuzzy title matching over competitor products that no exact pass
-- linked. Keyset-batched by competitor_products.id so callers can
-- walk the whole set without starving on permanent no-matches.
-- Inserts fuzzy_title links for similarity >= 0.55 with brand
-- agreement when both sides know a brand.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enrichment_match_fuzzy(
    p_after UUID DEFAULT '00000000-0000-0000-0000-000000000000',
    p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    last_id UUID := NULL;
    examined INT := 0;
    inserted INT := 0;
BEGIN
    -- Widen the % operator enough that the GIN index still prunes,
    -- then filter to the real threshold below.
    PERFORM set_config('pg_trgm.similarity_threshold', '0.4', true);

    CREATE TEMP TABLE tmp_fuzzy_batch ON COMMIT DROP AS
    SELECT cp.id, cp.title, cp.brand
    FROM competitor_products cp
    WHERE cp.id > p_after
      AND cp.title IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM catalog_item_competitor_links l
          WHERE l.competitor_product_id = cp.id
      )
    ORDER BY cp.id
    LIMIT p_limit;

    SELECT count(*) INTO examined FROM tmp_fuzzy_batch;
    SELECT id INTO last_id FROM tmp_fuzzy_batch ORDER BY id DESC LIMIT 1;

    IF examined = 0 THEN
        RETURN jsonb_build_object('examined', 0, 'inserted', 0, 'last_id', NULL);
    END IF;

    WITH candidates AS (
        SELECT DISTINCT ON (b.id)
            b.id AS competitor_product_id,
            h.id AS item_id,
            similarity(h.brand, left(b.title, 40)) AS sim
        FROM tmp_fuzzy_batch b
        -- Match on a 40-char prefix: long titles carry ~60 trigrams and
        -- multiply the GIN scan cost; the prefix keeps recall while
        -- roughly halving per-title latency.
        JOIN hercules_catalog_items h ON h.brand % left(b.title, 40)
        WHERE b.brand IS NULL
           OR h.manufacturer_name IS NULL
           OR pricing_normalize_identifier(h.manufacturer_name)
              = pricing_normalize_identifier(b.brand)
           OR h.manufacturer_name ILIKE '%' || b.brand || '%'
        ORDER BY b.id, sim DESC
    ),
    ins AS (
        INSERT INTO catalog_item_competitor_links
            (hercules_catalog_item_id, competitor_product_id, match_method, match_confidence)
        SELECT item_id, competitor_product_id, 'fuzzy_title', round(sim::numeric, 2)
        FROM candidates
        WHERE sim >= 0.55
        ON CONFLICT (hercules_catalog_item_id, competitor_product_id) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO inserted FROM ins;

    DROP TABLE IF EXISTS tmp_fuzzy_batch;

    RETURN jsonb_build_object('examined', examined, 'inserted', inserted, 'last_id', last_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION enrichment_match_fuzzy(UUID, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enrichment_match_fuzzy(UUID, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION enrichment_match_fuzzy(UUID, INT) FROM authenticated;

-- ------------------------------------------------------------
-- RLS. Competitor intelligence (prices, links, crawl internals)
-- is Class P buy-side data: admin-only read. Images and per-item
-- enrichment state are operational: staff read. No write policies
-- anywhere; writes go through the service-role client.
-- ------------------------------------------------------------
ALTER TABLE competitor_crawl_urls ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_price_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_item_competitor_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_item_enrichment_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_daily_budget ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'competitor_crawl_urls', 'competitor_products', 'competitor_price_points',
        'catalog_item_competitor_links', 'enrichment_runs', 'enrichment_daily_budget'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t
              AND policyname = 'admin read ' || t
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_admin_up())',
                'admin read ' || t, t
            );
        END IF;
    END LOOP;

    FOREACH t IN ARRAY ARRAY[
        'catalog_item_images', 'catalog_item_enrichment_state'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = t
              AND policyname = 'staff read ' || t
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_staff_up())',
                'staff read ' || t, t
            );
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- Public storage bucket for mirrored images. Public read is fine:
-- these are competitor-visible product photos; the sensitive data
-- (prices, links) stays in the admin-tier tables. Writes use the
-- service-role client, which bypasses storage RLS. The P16 Inngest
-- function also runs an idempotent createBucket fallback in case
-- this insert lacks privileges on a given environment.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'catalog-images', 'catalog-images', true, 5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
ON CONFLICT (id) DO NOTHING;

-- Surface the automations in the orchestration dashboard, inserted
-- inactive: ops flips them on after the first supervised runs.
INSERT INTO sync_schedules (automation, cron_expression, is_active, records_processed)
VALUES
    ('P16_COMPETITOR_CRAWL', '0 4 * * 0', false, 0),
    ('P17_CATALOG_IMAGE_MIRROR', '0 5 * * *', false, 0),
    ('P18_IMAGE_SEARCH_SWEEP', '0 7 * * *', false, 0)
ON CONFLICT (automation) DO NOTHING;
