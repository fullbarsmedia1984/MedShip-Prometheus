-- ============================================================
-- Pricing dashboard rollups (server-side aggregation)
--
-- 1. pricing_readiness_sku_match_counts(): the readiness report used to
--    fetchAll() EVERY sf_products.product_code and EVERY
--    inventory_snapshot.part_number into Node and cross-match them with JS
--    Sets on each request. This function computes the same match count in
--    one SQL pass.
-- 2. pricing_ingestion_exception_summary(uuid): the exception queue UI only
--    needs per-code counts and the open count, not every exception row —
--    aggregate them here so the API can bound its row list.
--
-- Both are read-only rollups called through the service-role client from
-- role-checked API routes; the app keeps a JS fallback until this migration
-- is applied.
-- ============================================================

-- Replicates src/lib/pricing/normalization.ts (normalizeSku) for the
-- readiness cross-match. In JS each SKU's matchKeys are {normalized, compact}
-- where compact = NFKC-normalize → toUpperCase → strip every non-[A-Z0-9]
-- character. compact() is idempotent over both keys, so two SKUs share a
-- match key if and only if their compact forms are equal and non-blank —
-- which is exactly the predicate below (blank-compact part numbers are
-- excluded, matching the JS isBlank guard). The separator/prefix rules in
-- normalizeSku only affect the `normalized` key and are therefore irrelevant
-- to the match outcome. Known negligible deviation: locale-dependent
-- uppercasing of exotic letters (e.g. Eszett) may differ between JS and the
-- database collation; SKUs are ASCII in practice.
CREATE OR REPLACE FUNCTION pricing_readiness_sku_match_counts()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
    matches bigint;
BEGIN
    WITH product_keys AS (
        SELECT DISTINCT
            regexp_replace(upper(normalize(p.product_code, NFKC)), '[^A-Z0-9]', '', 'g') AS compact
        FROM sf_products p
        WHERE p.product_code IS NOT NULL
    )
    SELECT count(*) INTO matches
    FROM inventory_snapshot i
    JOIN product_keys pk
      ON pk.compact = regexp_replace(upper(normalize(i.part_number, NFKC)), '[^A-Z0-9]', '', 'g')
    WHERE i.part_number IS NOT NULL
      AND pk.compact <> '';

    RETURN jsonb_build_object('direct_sku_matches', matches);
END;
$$;

-- Exception-queue rollup: total/open counts plus the top exception codes for
-- one ingestion batch (the UI shows the top 5; 20 leaves headroom).
CREATE OR REPLACE FUNCTION pricing_ingestion_exception_summary(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
    RETURN jsonb_build_object(
        'total', (
            SELECT count(*) FROM pricing_ingestion_exceptions
            WHERE batch_id = p_batch_id
        ),
        'open', (
            SELECT count(*) FROM pricing_ingestion_exceptions
            WHERE batch_id = p_batch_id AND status = 'open'
        ),
        'codes', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object('code', top.exception_code, 'count', top.cnt)
                ORDER BY top.cnt DESC, top.exception_code
            )
            FROM (
                SELECT exception_code, count(*) AS cnt
                FROM pricing_ingestion_exceptions
                WHERE batch_id = p_batch_id
                GROUP BY exception_code
                ORDER BY cnt DESC, exception_code
                LIMIT 20
            ) top
        ), '[]'::jsonb)
    );
END;
$$;

-- Service-role only: these run via the admin client, never from browsers.
GRANT EXECUTE ON FUNCTION pricing_readiness_sku_match_counts() TO service_role;
REVOKE EXECUTE ON FUNCTION pricing_readiness_sku_match_counts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pricing_readiness_sku_match_counts() FROM anon;
REVOKE EXECUTE ON FUNCTION pricing_readiness_sku_match_counts() FROM authenticated;
GRANT EXECUTE ON FUNCTION pricing_ingestion_exception_summary(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION pricing_ingestion_exception_summary(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pricing_ingestion_exception_summary(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION pricing_ingestion_exception_summary(uuid) FROM authenticated;
