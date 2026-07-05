-- ============================================================
-- Customer Merge Map (Q3 Incentive — entity resolution)
-- ============================================================
-- Maps duplicate business_customer_key values (see
-- normalize_fb_so_business_customer_key in migration 018) to a single
-- canonical key so first-order-date math never mints a false "new
-- customer" from a duplicate Fishbowl customer record.
--
-- The map is flat by construction (no chains): a canonical_key may never
-- appear as a duplicate_key and vice versa, so resolution is one hop.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS customer_merge_map (
    duplicate_key TEXT PRIMARY KEY,
    canonical_key TEXT NOT NULL,
    reason TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (duplicate_key <> canonical_key),
    CHECK (length(trim(duplicate_key)) > 0),
    CHECK (length(trim(canonical_key)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_customer_merge_map_canonical
  ON customer_merge_map(canonical_key);

CREATE OR REPLACE FUNCTION enforce_customer_merge_map_flatness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM customer_merge_map m
    WHERE m.duplicate_key = NEW.canonical_key
  ) THEN
    RAISE EXCEPTION 'canonical_key % is already mapped as a duplicate; merge chains are not allowed', NEW.canonical_key;
  END IF;

  IF EXISTS (
    SELECT 1 FROM customer_merge_map m
    WHERE m.canonical_key = NEW.duplicate_key
      AND m.duplicate_key <> NEW.duplicate_key
  ) THEN
    RAISE EXCEPTION 'duplicate_key % is the canonical target of other mappings; remap those rows first', NEW.duplicate_key;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_merge_map_flatness ON customer_merge_map;

CREATE TRIGGER trg_customer_merge_map_flatness
BEFORE INSERT OR UPDATE ON customer_merge_map
FOR EACH ROW
EXECUTE FUNCTION enforce_customer_merge_map_flatness();

CREATE OR REPLACE FUNCTION resolve_canonical_customer_key(key TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT canonical_key FROM customer_merge_map m WHERE m.duplicate_key = key),
    key
  );
$$;

ALTER TABLE customer_merge_map ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_merge_map'
      AND policyname = 'auth read customer_merge_map'
  ) THEN
    CREATE POLICY "auth read customer_merge_map"
      ON customer_merge_map FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ------------------------------------------------------------
-- Seed: duplicate-institution groups confirmed in the July 2026
-- discovery audit (name-variant groups under distinct Fishbowl
-- customer_ids). Canonical = variant with the most orders / most
-- recent activity. The "Northwest College" group was deliberately
-- NOT seeded (Powell WY college vs a California college chain —
-- likely different institutions; adjudicate in the admin UI).
-- ON CONFLICT DO NOTHING so admin edits are never clobbered.
-- ------------------------------------------------------------

INSERT INTO customer_merge_map (duplicate_key, canonical_key, reason, created_by)
SELECT *, 'discovery audit 2026-07 (duplicate-customer-groups.xlsx)'
FROM (
  VALUES
    ('id:2842',  'id:590',   'Baker College - Clinton Township name variants'),
    ('id:883',   'id:902',   'B.D.B punctuation variants'),
    ('id:3779',  'id:237',   'California State University San Marcos variants'),
    ('id:474',   'id:3840',  'Casper College spacing variants'),
    ('id:70451', 'id:70469', 'De Leon High School spacing variants'),
    ('id:70418', 'id:2372',  'D''Youville College punctuation variants'),
    ('id:27633', 'id:27632', 'Echelon Distribution spacing variants'),
    ('id:2854',  'id:2434',  'Emory University School of Nursing variants'),
    ('id:2407',  'id:1289',  'Harrison College Fort Wayne spacing variants'),
    ('id:3483',  'id:3847',  'Hawaii Community College apostrophe variants'),
    ('id:483',   'id:84',    'James B Conant High School punctuation variants'),
    ('name:james b. conant high school', 'id:84', 'Legacy no-customer-id orders for James B. Conant HS'),
    ('id:74899', 'id:74913', 'Karina Morales-Herrera hyphen variants'),
    ('id:74265', 'id:3190',  'La Salle University spacing variants'),
    ('id:3062',  'id:1410',  'Mid Michigan Community College hyphen variants'),
    ('name:mid michigan community college', 'id:1410', 'Legacy no-customer-id order for Mid Michigan CC'),
    ('id:3740',  'id:2786',  'Mt San Jacinto College punctuation variants'),
    ('id:74828', 'id:74914', 'Nikola Kovilic punctuation variants'),
    ('id:3868',  'id:3302',  'Paradise Valley Community College trailing-dots variant'),
    ('id:70377', 'id:70303', 'Samantha Barrett spacing variants'),
    ('id:70286', 'id:4142',  'St Francis College punctuation variants'),
    ('name:st. francis college', 'id:4142', 'Legacy no-customer-id orders for St. Francis College'),
    ('id:27972', 'id:27971', 'Teodora Lazarevic punctuation variants'),
    ('id:4063',  'id:70186', 'Tri-County Technical College hyphen variants'),
    ('id:2545',  'id:70186', 'Tri County Technical College spacing variants'),
    ('id:2274',  'id:2224',  'University of Central Florida Nursing variants')
) AS seed(duplicate_key, canonical_key, reason)
ON CONFLICT (duplicate_key) DO NOTHING;

-- ------------------------------------------------------------
-- Similarity report: candidate duplicate pairs not yet in the map.
-- Blocked join (identical alphanumeric-normalized name, or shared
-- ZIP5 with fuzzy name match) — avoids a full cross product.
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW v_customer_merge_candidates
WITH (security_invoker = true) AS
WITH customers AS (
  SELECT
    resolve_canonical_customer_key(business_customer_key) AS ckey,
    MAX(customer_name) AS customer_name,
    LOWER(REGEXP_REPLACE(MAX(customer_name), '[^a-zA-Z0-9]', '', 'g')) AS norm_name,
    MODE() WITHIN GROUP (ORDER BY LEFT(NULLIF(BTRIM(ship_to_postal_code), ''), 5)) AS zip5,
    MODE() WITHIN GROUP (ORDER BY NULLIF(BTRIM(ship_to_street), '')) AS street,
    COUNT(*) FILTER (WHERE canonical_state = 'order') AS order_count,
    MAX(sales_order_metric_at) FILTER (WHERE canonical_state = 'order') AS last_order_at
  FROM fb_sales_orders
  WHERE business_customer_key IS NOT NULL
  GROUP BY 1
),
pairs AS (
  SELECT a.ckey AS key_a, b.ckey AS key_b,
         a.customer_name AS name_a, b.customer_name AS name_b,
         a.order_count AS orders_a, b.order_count AS orders_b,
         a.last_order_at AS last_order_a, b.last_order_at AS last_order_b,
         similarity(LOWER(a.customer_name), LOWER(b.customer_name)) AS name_similarity,
         CASE WHEN a.street IS NOT NULL AND b.street IS NOT NULL
              THEN similarity(LOWER(a.street), LOWER(b.street)) END AS street_similarity,
         (a.norm_name = b.norm_name) AS exact_normalized_match
  FROM customers a
  JOIN customers b
    ON a.ckey < b.ckey
   AND (
         (a.norm_name <> '' AND a.norm_name = b.norm_name)
      OR (a.zip5 IS NOT NULL AND a.zip5 = b.zip5
          AND similarity(LOWER(a.customer_name), LOWER(b.customer_name)) >= 0.5)
       )
)
SELECT p.*
FROM pairs p
WHERE NOT EXISTS (
  SELECT 1 FROM customer_merge_map m
  WHERE (m.duplicate_key = p.key_a AND m.canonical_key = p.key_b)
     OR (m.duplicate_key = p.key_b AND m.canonical_key = p.key_a)
)
ORDER BY p.exact_normalized_match DESC, p.name_similarity DESC;
