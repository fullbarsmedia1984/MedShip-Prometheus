-- ============================================================
-- Supplier Catalog semantic search (pgvector hybrid layer)
-- text-embedding-3-small @ 512 dims stored as halfvec: near-parity
-- retrieval quality with a third of the storage, and a fast HNSW
-- build. Query-time fusion is reciprocal-rank (RRF) with the lexical
-- search from migration 036; part-number prefix hits always outrank
-- both.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE hercules_catalog_items
    ADD COLUMN IF NOT EXISTS embedding halfvec(512),
    ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

-- Re-embed sweeps look for missing/stale embeddings.
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_unembedded
    ON hercules_catalog_items (id)
    WHERE embedding IS NULL;

-- The ANN index is built CONCURRENTLY *after* the backfill populates
-- embeddings (building it on an empty column wastes a rebuild):
--   CREATE INDEX CONCURRENTLY idx_hercules_catalog_items_embedding
--       ON hercules_catalog_items USING hnsw (embedding halfvec_cosine_ops);

CREATE OR REPLACE FUNCTION hercules_catalog_search(
    q text DEFAULT '',
    p_manufacturer text DEFAULT NULL,
    p_category text DEFAULT NULL,
    p_vendor text DEFAULT NULL,
    p_limit int DEFAULT 25,
    p_offset int DEFAULT 0,
    p_qvec halfvec(512) DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
    qn text := trim(coalesce(q, ''));
    tsq tsquery;
    est bigint;
    ids uuid[];
    items jsonb;
    lim int := least(greatest(p_limit, 1), 100);
    off int := greatest(p_offset, 0);
    has_more boolean;
BEGIN
    -- No exact counts: under ingestion churn even a capped count visits
    -- thousands of cold heap pages. Pagination works on has_more; the only
    -- total is the planner estimate for the unfiltered view.
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
                LIMIT 20000
            ) c
            ORDER BY c.updated_at DESC
            LIMIT lim + 1 OFFSET off
        ) pg;

        IF p_manufacturer IS NULL AND p_category IS NULL AND p_vendor IS NULL THEN
            SELECT reltuples::bigint INTO est FROM pg_class WHERE relname = 'hercules_catalog_items';
        END IF;
    ELSE
        tsq := websearch_to_tsquery('english', qn);

        -- Hybrid retrieval:
        --   tier 0: part-number prefix hits (MPN or vendor part number)
        --   tier 1: RRF fusion of full-text rank and semantic ANN rank
        -- Each source rides its own index; ORing predicates in one WHERE
        -- forces a sequential scan over the catalog.
        SELECT array_agg(id) INTO ids FROM (
            SELECT fused.id
            FROM (
                SELECT
                    cand.id,
                    min(cand.tier) AS tier,
                    sum(cand.rrf) AS score
                FROM (
                    -- part-number prefix branches
                    SELECT i0.id, 0 AS tier, 0.0 AS rrf
                    FROM hercules_catalog_items i0
                    WHERE i0.manufacturer_part_number ILIKE qn || '%'
                    UNION ALL
                    SELECT vo.hercules_catalog_item_id, 0, 0.0
                    FROM hercules_offer_uoms u
                    JOIN hercules_vendor_offers vo ON vo.id = u.hercules_vendor_offer_id
                    WHERE u.vendor_part_number ILIKE qn || '%'
                    UNION ALL
                    -- lexical rank list
                    SELECT lex.id, 1, 1.0 / (60 + lex.r)
                    FROM (
                        SELECT i1.id, row_number() OVER (
                            ORDER BY ts_rank(to_tsvector('english',
                                coalesce(i1.description, '') || ' ' ||
                                coalesce(i1.brand, '') || ' ' ||
                                coalesce(i1.manufacturer_name, '') || ' ' ||
                                coalesce(i1.category, '')), tsq) DESC
                        ) AS r
                        FROM (
                            SELECT i2.id, i2.description, i2.brand, i2.manufacturer_name, i2.category
                            FROM hercules_catalog_items i2
                            WHERE to_tsvector('english',
                                    coalesce(i2.description, '') || ' ' ||
                                    coalesce(i2.brand, '') || ' ' ||
                                    coalesce(i2.manufacturer_name, '') || ' ' ||
                                    coalesce(i2.category, '')) @@ tsq
                            LIMIT 5000
                        ) i1
                        LIMIT 1000
                    ) lex
                    UNION ALL
                    -- semantic rank list (skipped until an embedding is passed)
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
                GROUP BY cand.id
            ) fused
            JOIN hercules_catalog_items i ON i.id = fused.id
            WHERE (p_manufacturer IS NULL OR i.manufacturer_name = p_manufacturer)
              AND (p_category IS NULL OR i.category = p_category)
              AND (p_vendor IS NULL OR EXISTS (
                    SELECT 1 FROM hercules_vendor_offers vo
                    WHERE vo.vendor_name = p_vendor
                      AND vo.hercules_catalog_item_id = fused.id))
            ORDER BY fused.tier, fused.score DESC, i.updated_at DESC
            LIMIT lim + 1 OFFSET off
        ) pg;
    END IF;

    ids := coalesce(ids, '{}');
    has_more := coalesce(array_length(ids, 1), 0) > lim;
    IF has_more THEN
        ids := ids[1:lim];
    END IF;

    SELECT coalesce(jsonb_agg(hercules_catalog_row(u.id) ORDER BY u.ord), '[]'::jsonb)
      INTO items
      FROM unnest(ids) WITH ORDINALITY AS u(id, ord);

    RETURN jsonb_build_object('estimatedTotal', est, 'hasMore', has_more, 'items', items);
END $$;

REVOKE ALL ON FUNCTION hercules_catalog_search(text, text, text, text, int, int, halfvec) FROM PUBLIC;
REVOKE ALL ON FUNCTION hercules_catalog_search(text, text, text, text, int, int, halfvec) FROM anon;
REVOKE ALL ON FUNCTION hercules_catalog_search(text, text, text, text, int, int, halfvec) FROM authenticated;

-- The 6-arg lexical-only signature from migration 036 is superseded.
DROP FUNCTION IF EXISTS hercules_catalog_search(text, text, text, text, int, int);
