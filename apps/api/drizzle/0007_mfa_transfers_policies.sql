-- Transferências: só entre carteiras do próprio usuário, nas duas pontas.
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transfers_owner ON transfers FOR ALL
  USING (app_owns_wallet(from_wallet_id) AND app_owns_wallet(to_wallet_id))
  WITH CHECK (
    app_owns_wallet(from_wallet_id) AND app_owns_wallet(to_wallet_id)
    AND created_by = app_current_user()
  );
--> statement-breakpoint
-- MFA obrigatório para todos (design: "TOTP obrigatório"). O admin pode desligar no painel.
INSERT INTO system_settings (key, value, is_public) VALUES
  ('security.mfa_required', 'true'::jsonb, false)
ON CONFLICT (key) DO NOTHING;
