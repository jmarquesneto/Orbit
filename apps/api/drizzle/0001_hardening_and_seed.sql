-- audit_logs é append-only: nenhum papel (nem o da API) consegue alterar ou apagar linhas.
-- Combinado com a cadeia de hashes (prev_hash → row_hash), qualquer adulteração fica visível.
CREATE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é somente inserção (% bloqueado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
--> statement-breakpoint
-- Garantias de integridade que o código também valida, mas que o banco não deixa furar.
ALTER TABLE users ADD CONSTRAINT users_failed_logins_non_negative CHECK (failed_logins >= 0);
--> statement-breakpoint
ALTER TABLE invitations ADD CONSTRAINT invitations_used_consistent
  CHECK ((used_at IS NULL) = (used_by IS NULL));
--> statement-breakpoint
ALTER TABLE invitations ADD CONSTRAINT invitations_expiry_after_creation
  CHECK (expires_at > created_at);
--> statement-breakpoint
-- Configurações padrão (MER: system_settings · linhas padrão). O nome do sistema mora AQUI,
-- nunca no código da interface.
INSERT INTO system_settings (key, value, is_public) VALUES
  ('app.name',         '"Orbit"'::jsonb,   true),
  ('app.accent',       '"#3DD6C3"'::jsonb, true),
  ('app.logo_url',     'null'::jsonb,      true),
  ('invite.ttl_hours', '72'::jsonb,        false)
ON CONFLICT (key) DO NOTHING;
