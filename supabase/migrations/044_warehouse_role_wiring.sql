-- Follow-up to 043: recognize 'warehouse' in the signup->profile trigger.
-- Signups still can never arrive as superadmin.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO profiles (id, email, display_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        split_part(NEW.email, '@', 1),
        CASE
            WHEN NEW.raw_app_meta_data ->> 'role' IN ('admin', 'staff', 'sales_rep', 'sales_manager', 'warehouse')
                THEN (NEW.raw_app_meta_data ->> 'role')::app_role
            ELSE 'staff'
        END
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END $$;
