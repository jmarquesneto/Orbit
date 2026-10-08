-- Subcategorias: a categoria-pai precisa pertencer ao mesmo orçamento (checado na aplicação).
ALTER TABLE categories ADD CONSTRAINT categories_parent_fk
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE;
--> statement-breakpoint

-- Papéis de compartilhamento (MER: share_roles · seed). Só o dono compartilha e exclui.
INSERT INTO share_roles (code, label, can_read, can_update, can_create, can_delete, can_share) VALUES
  ('read',   'Leitura',                      true, false, false, false, false),
  ('edit',   'Leitura e edição',             true, true,  false, false, false),
  ('create', 'Edição e criação de itens',    true, true,  true,  false, false)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- =====================================================================================
-- Row-Level Security (MER: "cada consulta roda com app.user_id; a política libera a linha
-- ao dono ou a um resource_share ativo").
--
-- A API abre cada transação de negócio com  set_config('app.user_id', <id>, true).
-- Sem essa variável, app_current_user() é NULL e NENHUMA linha financeira é visível.
-- As funções abaixo são SECURITY DEFINER (rodam como o dono do schema, que não está
-- sujeito a RLS) para que as políticas consultem outras tabelas sem recursão.
-- =====================================================================================

CREATE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint

CREATE FUNCTION app_has_access(p_type share_resource_type, p_id uuid, p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_current_user() IS NOT NULL AND (
    (p_type = 'budget' AND EXISTS (
       SELECT 1 FROM budgets b WHERE b.id = p_id AND b.owner_id = app_current_user()))
    OR (p_type = 'goal' AND EXISTS (
       SELECT 1 FROM goals g WHERE g.id = p_id AND g.owner_id = app_current_user()))
    OR EXISTS (
       SELECT 1
         FROM resource_shares s
         JOIN share_roles r ON r.code = s.role_code
        WHERE s.resource_type = p_type
          AND s.resource_id = p_id
          AND s.grantee_id = app_current_user()
          AND s.revoked_at IS NULL
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND CASE p_perm
                WHEN 'read'   THEN r.can_read
                WHEN 'update' THEN r.can_update
                WHEN 'create' THEN r.can_create
                WHEN 'delete' THEN r.can_delete
                WHEN 'share'  THEN r.can_share
                ELSE false
              END)
  )
$$;
--> statement-breakpoint

CREATE FUNCTION app_owns_wallet(p_wallet uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wallets w WHERE w.id = p_wallet AND w.owner_id = app_current_user())
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------- Orçamentos
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- owner_id direto: no INSERT ... RETURNING a linha nova ainda não é visível para a função.
CREATE POLICY budgets_select ON budgets FOR SELECT
  USING (owner_id = app_current_user() OR app_has_access('budget', id, 'read'));
--> statement-breakpoint
CREATE POLICY budgets_insert ON budgets FOR INSERT WITH CHECK (owner_id = app_current_user());
--> statement-breakpoint
CREATE POLICY budgets_update ON budgets FOR UPDATE
  USING (app_has_access('budget', id, 'update'))
  WITH CHECK (app_has_access('budget', id, 'update'));
--> statement-breakpoint
CREATE POLICY budgets_delete ON budgets FOR DELETE USING (owner_id = app_current_user());
--> statement-breakpoint

-- Categorias e lançamentos herdam o acesso do orçamento.
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY categories_select ON categories FOR SELECT USING (app_has_access('budget', budget_id, 'read'));
--> statement-breakpoint
CREATE POLICY categories_insert ON categories FOR INSERT WITH CHECK (app_has_access('budget', budget_id, 'create'));
--> statement-breakpoint
CREATE POLICY categories_update ON categories FOR UPDATE
  USING (app_has_access('budget', budget_id, 'update'))
  WITH CHECK (app_has_access('budget', budget_id, 'update'));
--> statement-breakpoint
CREATE POLICY categories_delete ON categories FOR DELETE USING (app_has_access('budget', budget_id, 'delete'));
--> statement-breakpoint

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transactions_select ON transactions FOR SELECT USING (app_has_access('budget', budget_id, 'read'));
--> statement-breakpoint
-- Quem lança precisa poder criar no orçamento E ser dono da carteira usada.
CREATE POLICY transactions_insert ON transactions FOR INSERT
  WITH CHECK (app_has_access('budget', budget_id, 'create') AND app_owns_wallet(wallet_id));
--> statement-breakpoint
CREATE POLICY transactions_update ON transactions FOR UPDATE
  USING (app_has_access('budget', budget_id, 'update'))
  WITH CHECK (app_has_access('budget', budget_id, 'update'));
--> statement-breakpoint
CREATE POLICY transactions_delete ON transactions FOR DELETE USING (app_has_access('budget', budget_id, 'delete'));
--> statement-breakpoint

-- ------------------------------------------- Carteiras, cartões e faturas (só o dono)
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY wallets_owner ON wallets FOR ALL
  USING (owner_id = app_current_user()) WITH CHECK (owner_id = app_current_user());
--> statement-breakpoint
ALTER TABLE credit_cards ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY credit_cards_owner ON credit_cards FOR ALL
  USING (app_owns_wallet(wallet_id)) WITH CHECK (app_owns_wallet(wallet_id));
--> statement-breakpoint
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoices_owner ON invoices FOR ALL
  USING (app_owns_wallet(card_id)) WITH CHECK (app_owns_wallet(card_id));
--> statement-breakpoint
ALTER TABLE installment_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY installment_plans_owner ON installment_plans FOR ALL
  USING (app_owns_wallet(card_id)) WITH CHECK (app_owns_wallet(card_id));
--> statement-breakpoint

-- ---------------------------------------------------------------- Caixinhas
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY goals_select ON goals FOR SELECT
  USING (owner_id = app_current_user() OR app_has_access('goal', id, 'read'));
--> statement-breakpoint
CREATE POLICY goals_insert ON goals FOR INSERT WITH CHECK (owner_id = app_current_user());
--> statement-breakpoint
CREATE POLICY goals_update ON goals FOR UPDATE
  USING (app_has_access('goal', id, 'update'))
  WITH CHECK (app_has_access('goal', id, 'update'));
--> statement-breakpoint
CREATE POLICY goals_delete ON goals FOR DELETE USING (owner_id = app_current_user());
--> statement-breakpoint
ALTER TABLE goal_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY goal_movements_select ON goal_movements FOR SELECT USING (app_has_access('goal', goal_id, 'read'));
--> statement-breakpoint
-- Movimentar exige permissão de criação na caixinha E ser dono da carteira de origem/destino.
CREATE POLICY goal_movements_insert ON goal_movements FOR INSERT
  WITH CHECK (app_has_access('goal', goal_id, 'create') AND app_owns_wallet(wallet_id));
--> statement-breakpoint

-- ------------------------------------------------------------ Compartilhamentos
ALTER TABLE resource_shares ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY resource_shares_select ON resource_shares FOR SELECT
  USING (grantee_id = app_current_user() OR app_has_access(resource_type, resource_id, 'share')
         OR app_has_access(resource_type, resource_id, 'read'));
--> statement-breakpoint
CREATE POLICY resource_shares_write ON resource_shares FOR INSERT
  WITH CHECK (app_has_access(resource_type, resource_id, 'share') AND granted_by = app_current_user());
--> statement-breakpoint
CREATE POLICY resource_shares_update ON resource_shares FOR UPDATE
  USING (app_has_access(resource_type, resource_id, 'share'))
  WITH CHECK (app_has_access(resource_type, resource_id, 'share'));
--> statement-breakpoint
-- O convidado pode SAIR (revogar o próprio acesso), mas a linha resultante precisa estar
-- revogada: não há como usar esta política para trocar o próprio papel e continuar ativo.
CREATE POLICY resource_shares_leave ON resource_shares FOR UPDATE
  USING (grantee_id = app_current_user())
  WITH CHECK (grantee_id = app_current_user() AND revoked_at IS NOT NULL);
