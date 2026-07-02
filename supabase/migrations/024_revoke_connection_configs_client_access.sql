-- Phase 0 hardening (PRD §12 / risk register item 1).
-- connection_configs stores raw external-system credentials in its config
-- JSONB. The API layer redacts them, but the flat RLS read policy from
-- 001_initial_schema.sql let any authenticated user read the raw rows
-- directly via PostgREST with the public anon key. The app only ever touches
-- this table through the service-role admin client, so client roles need no
-- access at all.

DROP POLICY IF EXISTS "Authenticated users can read configs" ON connection_configs;

REVOKE ALL ON connection_configs FROM anon, authenticated;
