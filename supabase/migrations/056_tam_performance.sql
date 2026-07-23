-- 056: TAM query performance indexes (nursing_tam schema).
--
-- The TAM browser/map/contacts pages filter with `ilike '%term%'` on
-- institution and contact names, which the btree lower(name) index from 019a
-- cannot serve — every search was a sequential scan. Trigram GIN indexes make
-- those ILIKE searches indexable. The map query additionally scans only
-- geocoded institutions, and the contacts page filters + sorts on
-- role_category with no index today.
--
-- NOTE: nursing_tam tables have RLS disabled by design (schema is not exposed
-- through PostgREST; access is server-side only via the pg Pool DAL). This
-- migration is indexes + extension only — no policy changes. See PRD §8.6.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Substring search on institution name (TAM browser, contacts, map filters).
CREATE INDEX IF NOT EXISTS idx_tam_institutions_name_trgm
    ON nursing_tam.institutions USING gin (name gin_trgm_ops);

-- Substring search on contact name.
CREATE INDEX IF NOT EXISTS idx_tam_contacts_name_trgm
    ON nursing_tam.contacts USING gin (name gin_trgm_ops);

-- Contacts page filters by role_category and sorts on it first.
CREATE INDEX IF NOT EXISTS idx_tam_contacts_role_category
    ON nursing_tam.contacts (role_category);

-- Map geo query only ever reads geocoded institutions.
CREATE INDEX IF NOT EXISTS idx_tam_institutions_geocoded
    ON nursing_tam.institutions (lat, lng)
    WHERE lat IS NOT NULL AND lng IS NOT NULL;
