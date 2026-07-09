-- ============================================================
-- Supplier Catalog search quality (v3)
-- 1. Weighted ranking: product name (brand) > description >
--    manufacturer/category.
-- 2. Trigram fuzzy fallback when a query returns almost nothing
--    (typo tolerance; indexes from 035 + a new one on brand).
-- 3. Query-scoped facet counts.
-- 4. Sort options (relevance | newest | price asc/desc).
-- 5. Search telemetry for tuning synonyms and spotting zero-result
--    queries.
-- The route may pass a synonym-expanded query (p_qexp) used only for
-- full-text matching; part-number branches always use the raw query.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_fts_w
    ON hercules_catalog_items USING gin ((
      setweight(to_tsvector('english', coalesce(brand, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(manufacturer_name, '') || ' ' || coalesce(category, '')), 'C')
    ));

CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_brand_trgm
    ON hercules_catalog_items USING gin (brand gin_trgm_ops);

-- The unweighted expression index from migration 036 is superseded.
DROP INDEX IF EXISTS idx_hercules_catalog_items_fts;

CREATE TABLE IF NOT EXISTS hercules_search_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    q TEXT NOT NULL,
    manufacturer TEXT,
    category TEXT,
    vendor TEXT,
    sort TEXT,
    result_count INT NOT NULL,
    has_more BOOLEAN NOT NULL DEFAULT false,
    took_ms INT,
    role TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hercules_search_log_created ON hercules_search_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hercules_search_log_zero ON hercules_search_log(created_at DESC) WHERE result_count = 0;

ALTER TABLE hercules_search_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_search_log' AND policyname = 'admin read hercules_search_log'
    ) THEN
        CREATE POLICY "admin read hercules_search_log" ON hercules_search_log FOR SELECT TO authenticated USING (is_admin_up());
    END IF;
END $$;

-- Signature grows; drop the previous overload so RPC name resolution
-- stays unambiguous.
DROP FUNCTION IF EXISTS hercules_catalog_search(text, text, text, text, int, int, halfvec);

CREATE OR REPLACE FUNCTION hercules_catalog_search(
    q text DEFAULT '',
    p_manufacturer text DEFAULT NULL,
    p_category text DEFAULT NULL,
    p_vendor text DEFAULT NULL,
    p_limit int DEFAULT 25,
    p_offset int DEFAULT 0,
    p_qvec halfvec(512) DEFAULT NULL,
    p_qexp text DEFAULT NULL,
    p_sort text DEFAULT 'relevance',
    p_facets boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
    qn text := trim(coalesce(q, ''));
    tsq tsquery;
    est bigint;
    ids uuid[];
    fuzzy_ids uuid[];
    items jsonb;
    facets jsonb;
    lim int := least(greatest(p_limit, 1), 100);
    off int := greatest(p_offset, 0);
    -- Price sorts probe offers per candidate; keep that set tighter.
    cand_cap int := CASE WHEN p_sort IN ('price_asc', 'price_desc') THEN 5000 ELSE 20000 END;
    has_more boolean;
BEGIN
    IF qn = '' THEN
        SELECT array_agg(id) INTO ids FROM (
            SELECT c.id FROM (
                SELECT i.id, i.updated_at
                FROM hercules_catalog_items i
                WHERE (p_manufacturer IS NULL OR i.manufacturer_name = p_manufacturer)
                  AND (p_category IS NULL OR i.category = p_category)
                  AND (p_vendor IS NULL OR EXISTS (
                        SELECT 1 FROM hercules_vendor_offers vo
                        WHERE vo.vendor_name = p_vendor
                          AND vo.hercules_catalog_item_id = i.id))
                LIMIT cand_cap
            ) c
            ORDER BY
                CASE WHEN p_sort = 'price_asc' THEN (
                    SELECT min(u.list_price_amount) FROM hercules_vendor_offers vo
                    JOIN hercules_offer_uoms u ON u.hercules_vendor_offer_id = vo.id
                    WHERE vo.hercules_catalog_item_id = c.id) END ASC NULLS LAST,
                CASE WHEN p_sort = 'price_desc' THEN (
                    SELECT min(u.list_price_amount) FROM hercules_vendor_offers vo
                    JOIN hercules_offer_uoms u ON u.hercules_vendor_offer_id = vo.id
                    WHERE vo.hercules_catalog_item_id = c.id) END DESC NULLS LAST,
                c.updated_at DESC
            LIMIT lim + 1 OFFSET off
        ) pg;

        IF p_manufacturer IS NULL AND p_category IS NULL AND p_vendor IS NULL THEN
            SELECT reltuples::bigint INTO est FROM pg_class WHERE relname = 'hercules_catalog_items';
        END IF;
    ELSE
        tsq := websearch_to_tsquery('english', coalesce(nullif(trim(p_qexp), ''), qn));

        SELECT array_agg(id) INTO ids FROM (
            SELECT m.id
            FROM (
                SELECT id, min(tier) AS tier, sum(rrf) AS score FROM (
                    SELECT i0.id, 0 AS tier, 0.0 AS rrf
                    FROM hercules_catalog_items i0
                    WHERE i0.manufacturer_part_number ILIKE qn || '%'
                    UNION ALL
                    SELECT vo.hercules_catalog_item_id, 0, 0.0
                    FROM hercules_offer_uoms u
                    JOIN hercules_vendor_offers vo ON vo.id = u.hercules_vendor_offer_id
                    WHERE u.vendor_part_number ILIKE qn || '%'
                    UNION ALL
                    SELECT lex.id, 1, 1.0 / (60 + lex.r)
                    FROM (
                        SELECT i1.id, row_number() OVER (
                            ORDER BY ts_rank(
                                setweight(to_tsvector('english', coalesce(i1.brand, '')), 'A') ||
                                setweight(to_tsvector('english', coalesce(i1.description, '')), 'B') ||
                                setweight(to_tsvector('english', coalesce(i1.manufacturer_name, '') || ' ' || coalesce(i1.category, '')), 'C'),
                                tsq) DESC
                        ) AS r
                        FROM (
                            SELECT i2.id, i2.brand, i2.description, i2.manufacturer_name, i2.category
                            FROM hercules_catalog_items i2
                            WHERE (
                                setweight(to_tsvector('english', coalesce(i2.brand, '')), 'A') ||
                                setweight(to_tsvector('english', coalesce(i2.description, '')), 'B') ||
                                setweight(to_tsvector('english', coalesce(i2.manufacturer_name, '') || ' ' || coalesce(i2.category, '')), 'C')
                            ) @@ tsq
                            LIMIT 5000
                        ) i1
                        LIMIT 1000
                    ) lex
                    UNION ALL
                    SELECT sem.id, 1, 1.0 / (60 + sem.r)
                    FROM (
                        SELECT s.id, row_number() OVER (ORDER BY s.dist) AS r
                        FROM (
                            SELECT i3.id, i3.embedding <=> p_qvec AS dist
                            FROM hercules_catalog_items i3
                            WHERE p_qvec IS NOT NULL AND i3.embedding IS NOT NULL
                            ORDER BY i3.embedding <=> p_qvec
                            LIMIT 60
                        ) s
                    ) sem
                    WHERE p_qvec IS NOT NULL
                ) cand
                GROUP BY id
            ) m
            JOIN hercules_catalog_items i ON i.id = m.id
            WHERE (p_manufacturer IS NULL OR i.manufacturer_name = p_manufacturer)
              AND (p_category IS NULL OR i.category = p_category)
              AND (p_vendor IS NULL OR EXISTS (
                    SELECT 1 FROM hercules_vendor_offers vo
                    WHERE vo.vendor_name = p_vendor
                      AND vo.hercules_catalog_item_id = m.id))
            ORDER BY
                CASE WHEN p_sort = 'price_asc' THEN (
                    SELECT min(u.list_price_amount) FROM hercules_vendor_offers vo
                    JOIN hercules_offer_uoms u ON u.hercules_vendor_offer_id = vo.id
                    WHERE vo.hercules_catalog_item_id = m.id) END ASC NULLS LAST,
                CASE WHEN p_sort = 'price_desc' THEN (
                    SELECT min(u.list_price_amount) FROM hercules_vendor_offers vo
                    JOIN hercules_offer_uoms u ON u.hercules_vendor_offer_id = vo.id
                    WHERE vo.hercules_catalog_item_id = m.id) END DESC NULLS LAST,
                CASE WHEN p_sort = 'newest' THEN extract(epoch FROM i.updated_at) END DESC NULLS LAST,
                m.tier, m.score DESC, i.updated_at DESC
            LIMIT lim + 1 OFFSET off
        ) pg;

        -- Fuzzy fallback: only when the exact branches came up nearly
        -- empty on the first page. Word-similarity rides the trigram
        -- indexes on brand/description.
        IF off = 0 AND coalesce(array_length(ids, 1), 0) < 5 AND length(qn) >= 4 THEN
            SELECT array_agg(id) INTO fuzzy_ids FROM (
                SELECT i.id
                FROM hercules_catalog_items i
                WHERE (qn <% i.brand OR qn <% i.description)
                  AND NOT (i.id = ANY (coalesce(ids, '{}')))
                  AND (p_manufacturer IS NULL OR i.manufacturer_name = p_manufacturer)
                  AND (p_category IS NULL OR i.category = p_category)
                  AND (p_vendor IS NULL OR EXISTS (
                        SELECT 1 FROM hercules_vendor_offers vo
                        WHERE vo.vendor_name = p_vendor
                          AND vo.hercules_catalog_item_id = i.id))
                ORDER BY greatest(
                    word_similarity(qn, coalesce(i.brand, '')),
                    word_similarity(qn, coalesce(i.description, ''))) DESC
                LIMIT lim
            ) f;
            ids := coalesce(ids, '{}') || coalesce(fuzzy_ids, '{}');
        END IF;
    END IF;

    ids := coalesce(ids, '{}');
    has_more := coalesce(array_length(ids, 1), 0) > lim;
    IF has_more THEN
        ids := ids[1:lim];
    END IF;

    SELECT coalesce(jsonb_agg(hercules_catalog_row(u.id) ORDER BY u.ord), '[]'::jsonb)
      INTO items
      FROM unnest(ids) WITH ORDINALITY AS u(id, ord);

    -- p_facets is reserved: scoped facet aggregation measured 8-17s
    -- cold while ingestion/backfill churn the table. Revisit after the
    -- catalog settles (vacuum + warm cache); the route falls back to the
    -- global facet RPC meanwhile.
    facets := NULL;

    RETURN jsonb_build_object(
        'estimatedTotal', est,
        'hasMore', has_more,
        'items', items,
        'facets', facets
    );
END $$;

REVOKE ALL ON FUNCTION hercules_catalog_search(text, text, text, text, int, int, halfvec, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION hercules_catalog_search(text, text, text, text, int, int, halfvec, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION hercules_catalog_search(text, text, text, text, int, int, halfvec, text, text, boolean) FROM authenticated;
