-- Importações OFX pertencem à carteira: só o dono dela vê e concilia.
CREATE FUNCTION app_owns_ofx_import(p_import uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM ofx_imports i JOIN wallets w ON w.id = i.wallet_id
     WHERE i.id = p_import AND w.owner_id = app_current_user())
$$;
--> statement-breakpoint
ALTER TABLE ofx_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ofx_imports_owner ON ofx_imports FOR ALL
  USING (app_owns_wallet(wallet_id))
  WITH CHECK (app_owns_wallet(wallet_id) AND uploaded_by = app_current_user());
--> statement-breakpoint
ALTER TABLE ofx_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ofx_entries_owner ON ofx_entries FOR ALL
  USING (app_owns_ofx_import(import_id)) WITH CHECK (app_owns_ofx_import(import_id));
