-- Phase 1 identity foundation (PRD §5, §7.4).
-- profiles is the source of truth for role and lifecycle, 1:1 with
-- auth.users. app_metadata.role is kept as a mirror so the JWT carries the
-- role for RLS policies (auth.jwt() -> 'app_metadata' ->> 'role') without a
-- custom access token hook.

CREATE TYPE app_role AS ENUM ('superadmin', 'admin', 'staff', 'sales_rep', 'sales_manager');

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    display_name TEXT,
    role app_role NOT NULL DEFAULT 'staff',
    is_active BOOLEAN NOT NULL DEFAULT true,
    fishbowl_user_id TEXT,                        -- canonical rep identity (decision 2)
    sf_user_id TEXT,
    can_view_contract_price BOOLEAN NOT NULL DEFAULT true,  -- revocable grant (decision 5)
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ,
    onboarded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID
);

CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_fishbowl_user ON profiles(fishbowl_user_id)
    WHERE fishbowl_user_id IS NOT NULL;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users read their own profile; admins read all. No client write policies:
-- every write goes through the service-role admin client.
CREATE POLICY "read own profile" ON profiles
    FOR SELECT TO authenticated
    USING (id = (SELECT auth.uid()));

CREATE POLICY "admins read all profiles" ON profiles
    FOR SELECT TO authenticated
    USING ((auth.jwt() -> 'app_metadata' ->> 'role') IN ('superadmin', 'admin'));

CREATE OR REPLACE FUNCTION set_profiles_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION set_profiles_updated_at();

-- Superadmin invariants (PRD §7.4): exactly one superadmin, who cannot be
-- demoted, deactivated, or deleted -- enforced at the database layer so not
-- even service-role code paths can bypass it.
CREATE OR REPLACE FUNCTION protect_superadmin_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.role = 'superadmin' THEN
            RAISE EXCEPTION 'The superadmin profile cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.role = 'superadmin' THEN
        IF NEW.role <> 'superadmin' THEN
            RAISE EXCEPTION 'The superadmin cannot be demoted';
        END IF;
        IF NOT NEW.is_active THEN
            RAISE EXCEPTION 'The superadmin cannot be deactivated';
        END IF;
    END IF;

    IF NEW.role = 'superadmin' AND EXISTS (
        SELECT 1 FROM profiles WHERE role = 'superadmin' AND id <> NEW.id
    ) THEN
        RAISE EXCEPTION 'Only one superadmin account is allowed';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_protect_superadmin
    BEFORE INSERT OR UPDATE OR DELETE ON profiles
    FOR EACH ROW EXECUTE FUNCTION protect_superadmin_profile();

-- Auto-create a profile for every new auth user (Phase 3 invite flow relies
-- on this). Signups can never arrive as superadmin.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO profiles (id, email, display_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        split_part(NEW.email, '@', 1),
        CASE
            WHEN NEW.raw_app_meta_data ->> 'role' IN ('admin', 'staff', 'sales_rep', 'sales_manager')
                THEN (NEW.raw_app_meta_data ->> 'role')::app_role
            ELSE 'staff'
        END
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Backfill the two existing users (decisions 1 and 11).
INSERT INTO profiles (id, email, display_name, role)
SELECT
    id,
    email,
    split_part(email, '@', 1),
    CASE email
        WHEN 'steven@fullbarsmedia.com' THEN 'superadmin'::app_role
        ELSE 'admin'::app_role
    END
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Mirror roles into app_metadata for JWT claims. The legacy "roles" array
-- keeps the currently deployed build (which checks for 'admin') authorized
-- until this branch ships; drop the array in Phase 2.
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data
    || '{"role": "superadmin", "roles": ["superadmin", "admin"]}'::jsonb
WHERE email = 'steven@fullbarsmedia.com';

UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data
    || '{"role": "admin", "roles": ["admin"]}'::jsonb
WHERE email = 'dan@medicalshipment.com';
