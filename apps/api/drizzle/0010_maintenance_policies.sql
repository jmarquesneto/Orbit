-- =====================================================================================
-- Manutenção residencial: o equipamento herda o acesso do orçamento (nenhum modelo de
-- permissão novo). Leitura vê tarefas e histórico; Edição conclui e edita tarefas;
-- Criação cadastra equipamentos e tarefas. O histórico é só inserção.
-- =====================================================================================

-- Orçamento dono de um equipamento (SECURITY DEFINER: as políticas consultam a tabela
-- equipment sem depender do RLS dela).
CREATE FUNCTION app_equipment_budget(p_equipment uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT budget_id FROM equipment WHERE id = p_equipment
$$;
--> statement-breakpoint

ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY equipment_select ON equipment FOR SELECT USING (app_has_access('budget', budget_id, 'read'));
--> statement-breakpoint
CREATE POLICY equipment_insert ON equipment FOR INSERT
  WITH CHECK (app_has_access('budget', budget_id, 'create') AND created_by = app_current_user());
--> statement-breakpoint
CREATE POLICY equipment_update ON equipment FOR UPDATE
  USING (app_has_access('budget', budget_id, 'update'))
  WITH CHECK (app_has_access('budget', budget_id, 'update'));
--> statement-breakpoint

ALTER TABLE maintenance_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY maintenance_tasks_select ON maintenance_tasks FOR SELECT
  USING (app_has_access('budget', app_equipment_budget(equipment_id), 'read'));
--> statement-breakpoint
CREATE POLICY maintenance_tasks_insert ON maintenance_tasks FOR INSERT
  WITH CHECK (app_has_access('budget', app_equipment_budget(equipment_id), 'create')
              AND created_by = app_current_user());
--> statement-breakpoint
CREATE POLICY maintenance_tasks_update ON maintenance_tasks FOR UPDATE
  USING (app_has_access('budget', app_equipment_budget(equipment_id), 'update'))
  WITH CHECK (app_has_access('budget', app_equipment_budget(equipment_id), 'update'));
--> statement-breakpoint

ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY maintenance_logs_select ON maintenance_logs FOR SELECT
  USING (app_has_access('budget', app_equipment_budget(equipment_id), 'read'));
--> statement-breakpoint
CREATE POLICY maintenance_logs_insert ON maintenance_logs FOR INSERT
  WITH CHECK (app_has_access('budget', app_equipment_budget(equipment_id), 'update')
              AND completed_by = app_current_user());
--> statement-breakpoint

-- Histórico imutável. A única alteração aceita é a do próprio banco quando a despesa
-- ligada é excluída (ON DELETE SET NULL em transaction_id).
CREATE FUNCTION maintenance_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.transaction_id IS NULL AND OLD.transaction_id IS NOT NULL
     AND (to_jsonb(NEW) - 'transaction_id') = (to_jsonb(OLD) - 'transaction_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'maintenance_logs é somente inserção (% bloqueado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER maintenance_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON maintenance_logs
  FOR EACH ROW EXECUTE FUNCTION maintenance_logs_append_only();
--> statement-breakpoint
CREATE TRIGGER maintenance_logs_no_truncate
  BEFORE TRUNCATE ON maintenance_logs
  FOR EACH STATEMENT EXECUTE FUNCTION maintenance_logs_append_only();
