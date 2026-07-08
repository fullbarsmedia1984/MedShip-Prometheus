-- ============================================================
-- Supplier Catalog search v2
-- Ranked full-text search with part-number boosting, rich result
-- rows (vendors, price range, thumbnail), and a vendor facet.
-- Lexical FTS is the right tool for rep queries (part numbers and
-- exact-ish terms); a pgvector hybrid layer can stack on later.
-- ============================================================

-- Expression FTS index; queries must repeat this exact expression.
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_fts
    ON hercules_catalog_items USING gin (
      to_tsvector('english',
        coalesce(description, '') || ' ' ||
        coalesce(brand, '') || ' ' ||
        coalesce(manufacturer_name, '') || ' ' ||
        coalesce(category, '')
      )
    );

-- Vendor-driven browse needs to walk offers by vendor name.
CREATE INDEX IF NOT EXISTS idx_hercules_vendor_offers_vendor_item
    ON hercules_vendor_offers (vendor_name, hercules_catalog_item_id);

CREATE OR REPLACE FUNCTION hercules_catalog_search(
    q text DEFAULT '',
    p_manufacturer text DEFAULT NULL,
    p_category text DEFAULT NULL,
    p_vendor text DEFAULT NULL,
    p_limit int DEFAULT 25,
    p_offset int DEFAULT 0
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
    -- thousands of cold heap pages (tens of seconds). Pagination works on
    -- has_more (fetch limit+1); the only total is the planner estimate for
    -- the unfiltered view. Candidate sets are LIMIT-bounded so every path
    -- is index-driven.
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

        -- Part-number prefix branches and the FTS branch each ride their
        -- own index; ORing them in one WHERE forces a sequential scan.
        SELECT array_agg(id) INTO ids FROM (
            SELECT m.id
            FROM (
                SELECT id, min(boost) AS boost FROM (
                    SELECT i0.id, 0 AS boost FROM hercules_catalog_items i0
                    WHERE i0.manufacturer_part_number ILIKE qn || '%'
                    UNION ALL
                    SELECT vo.hercules_catalog_item_id, 0
                    FROM hercules_offer_uoms u
                    JOIN hercules_vendor_offers vo ON vo.id = u.hercules_vendor_offer_id
                    WHERE u.vendor_part_number ILIKE qn || '%'
                    UNION ALL
                    SELECT i1.id, 1 FROM hercules_catalog_items i1
                    WHERE to_tsvector('english',
                            coalesce(i1.description, '') || ' ' ||
                            coalesce(i1.brand, '') || ' ' ||
                            coalesce(i1.manufacturer_name, '') || ' ' ||
                            coalesce(i1.category, '')) @@ tsq
                    LIMIT 5000
                ) u GROUP BY id
            ) m
            JOIN hercules_catalog_items i ON i.id = m.id
            WHERE (p_manufacturer IS NULL OR i.manufacturer_name = p_manufacturer)
              AND (p_category IS NULL OR i.category = p_category)
              AND (p_vendor IS NULL OR EXISTS (
                    SELECT 1 FROM hercules_vendor_offers vo
                    WHERE vo.vendor_name = p_vendor
                      AND vo.hercules_catalog_item_id = m.id))
            ORDER BY
                m.boost,
                ts_rank(to_tsvector('english',
                    coalesce(i.description, '') || ' ' ||
                    coalesce(i.brand, '') || ' ' ||
                    coalesce(i.manufacturer_name, '') || ' ' ||
                    coalesce(i.category, '')), tsq) DESC,
                i.updated_at DESC
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

-- One result row, shaped for the browser UI.
CREATE OR REPLACE FUNCTION hercules_catalog_row(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT jsonb_build_object(
        'id', i.id,
        'herculesItemId', i.hercules_item_id,
        'msId', i.ms_id,
        'description', i.description,
        'brand', i.brand,
        'manufacturerName', i.manufacturer_name,
        'manufacturerPartNumber', i.manufacturer_part_number,
        'category', i.category,
        'subcategory', i.subcategory,
        'status', i.status,
        'imageUrl', i.image_urls_json ->> 0,
        'updatedAt', i.updated_at,
        'vendors', (
            SELECT coalesce(jsonb_agg(DISTINCT vo.vendor_name), '[]'::jsonb)
            FROM hercules_vendor_offers vo
            WHERE vo.hercules_catalog_item_id = i.id),
        'offerCount', (
            SELECT count(*) FROM hercules_vendor_offers vo
            WHERE vo.hercules_catalog_item_id = i.id),
        'priceMin', (
            SELECT min(u.list_price_amount)
            FROM hercules_vendor_offers vo
            JOIN hercules_offer_uoms u ON u.hercules_vendor_offer_id = vo.id
            WHERE vo.hercules_catalog_item_id = i.id),
        'priceMax', (
            SELECT max(u.list_price_amount)
            FROM hercules_vendor_offers vo
            JOIN hercules_offer_uoms u ON u.hercules_vendor_offer_id = vo.id
            WHERE vo.hercules_catalog_item_id = i.id)
    )
    FROM hercules_catalog_items i WHERE i.id = p_id
$$;

REVOKE ALL ON FUNCTION hercules_catalog_search(text, text, text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION hercules_catalog_search(text, text, text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION hercules_catalog_search(text, text, text, text, int, int) FROM authenticated;
REVOKE ALL ON FUNCTION hercules_catalog_row(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION hercules_catalog_row(uuid) FROM anon;
REVOKE ALL ON FUNCTION hercules_catalog_row(uuid) FROM authenticated;

-- Facets v2: add the vendor facet alongside manufacturers/categories.
CREATE OR REPLACE FUNCTION hercules_catalog_facets()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'manufacturers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', manufacturer_name, 'count', n) ORDER BY n DESC), '[]'::jsonb)
      FROM (
        SELECT manufacturer_name, count(*) AS n
        FROM hercules_catalog_items
        WHERE manufacturer_name IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 100
      ) m
    ),
    'categories', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', category, 'count', n) ORDER BY n DESC), '[]'::jsonb)
      FROM (
        SELECT category, count(*) AS n
        FROM hercules_catalog_items
        WHERE category IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 100
      ) c
    ),
    'vendors', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', vendor_name, 'count', n) ORDER BY n DESC), '[]'::jsonb)
      FROM (
        SELECT vendor_name, count(DISTINCT hercules_catalog_item_id) AS n
        FROM hercules_vendor_offers
        GROUP BY 1 ORDER BY n DESC LIMIT 50
      ) v
    ),
    'itemsWithOffers', (SELECT count(DISTINCT hercules_catalog_item_id) FROM hercules_vendor_offers),
    'vendorOffers', (SELECT count(*) FROM hercules_vendor_offers),
    'suppliers', (SELECT count(*) FROM hercules_suppliers)
  )
$$;

REVOKE ALL ON FUNCTION hercules_catalog_facets() FROM PUBLIC;
REVOKE ALL ON FUNCTION hercules_catalog_facets() FROM anon;
REVOKE ALL ON FUNCTION hercules_catalog_facets() FROM authenticated;
