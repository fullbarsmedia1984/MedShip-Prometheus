-- ============================================================
-- Native Workbook Ingestion (Contract Pricing Phase C)
-- In-app upload of distributor pricing workbooks to a private
-- storage bucket, database-managed distributor profiles, and an
-- upload lifecycle that feeds the existing staging/publish flow.
-- Buy-side supplier costs only; customer sell pricing untouched.
-- ============================================================

CREATE TABLE IF NOT EXISTS pricing_distributor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_name TEXT NOT NULL,
    profile_version TEXT NOT NULL DEFAULT '1.0.0',
    distributor_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'review_required'
        CHECK (status IN ('draft', 'review_required', 'approved', 'deprecated')),
    profile_json JSONB NOT NULL,
    source_upload_id UUID,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profile_name, profile_version)
);

CREATE INDEX IF NOT EXISTS idx_pricing_distributor_profiles_distributor
    ON pricing_distributor_profiles(distributor_name);
CREATE INDEX IF NOT EXISTS idx_pricing_distributor_profiles_status
    ON pricing_distributor_profiles(status);

CREATE TABLE IF NOT EXISTS pricing_workbook_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name TEXT NOT NULL,
    file_size BIGINT,
    file_hash TEXT NOT NULL,
    storage_bucket TEXT NOT NULL DEFAULT 'pricing-workbooks',
    storage_path TEXT NOT NULL,
    distributor_name TEXT NOT NULL,
    contract_number TEXT NOT NULL,
    effective_date DATE NOT NULL,
    expiration_date DATE,
    account_number TEXT,
    location_scope TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'discovered', 'dry_run', 'staged', 'failed')),
    discovery_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_dry_run_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    profile_id UUID REFERENCES pricing_distributor_profiles(id) ON DELETE SET NULL,
    staged_batch_id UUID REFERENCES pricing_ingestion_batches(id) ON DELETE SET NULL,
    error_message TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expiration_date IS NULL OR expiration_date >= effective_date)
);

CREATE INDEX IF NOT EXISTS idx_pricing_workbook_uploads_status
    ON pricing_workbook_uploads(status);
CREATE INDEX IF NOT EXISTS idx_pricing_workbook_uploads_distributor
    ON pricing_workbook_uploads(distributor_name);
CREATE INDEX IF NOT EXISTS idx_pricing_workbook_uploads_hash
    ON pricing_workbook_uploads(file_hash);

ALTER TABLE pricing_distributor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_workbook_uploads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_distributor_profiles'
          AND policyname = 'admin read pricing_distributor_profiles'
    ) THEN
        CREATE POLICY "admin read pricing_distributor_profiles"
            ON pricing_distributor_profiles FOR SELECT TO authenticated
            USING (is_admin_up());
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_workbook_uploads'
          AND policyname = 'admin read pricing_workbook_uploads'
    ) THEN
        CREATE POLICY "admin read pricing_workbook_uploads"
            ON pricing_workbook_uploads FOR SELECT TO authenticated
            USING (is_admin_up());
    END IF;
END $$;

-- Private bucket for raw distributor workbooks. No storage.objects
-- policies are added: all access goes through the service-role client,
-- and the default-deny RLS on storage.objects keeps clients out.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'pricing-workbooks',
    'pricing-workbooks',
    false,
    26214400,
    ARRAY[
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel.sheet.macroEnabled.12'
    ]
)
ON CONFLICT (id) DO NOTHING;
