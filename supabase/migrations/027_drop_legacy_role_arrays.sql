-- Phase 2 cleanup — DO NOT APPLY until the five-role build (Phase 1 branch)
-- is deployed to Railway.
--
-- Migration 025 kept a legacy "roles" array in app_metadata so the build
-- deployed at that time (which authorized admins by finding 'admin' in the
-- array) kept working for the superadmin. The five-role build reads only
-- profiles.role / app_metadata.role, so once it is live the array is dead
-- weight and one more place a role could drift.

UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data - 'roles'
WHERE raw_app_meta_data ? 'roles';
