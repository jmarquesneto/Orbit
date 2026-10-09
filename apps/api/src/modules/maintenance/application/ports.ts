import type { IsoDate } from '../../../shared/domain/calendar.js';
import type { EquipmentRecord, Frequency, LogRecord, TaskRecord } from '../domain/maintenance.js';

/** Pessoa com acesso a um orçamento (pode ser responsável por tarefas dele). */
export interface Member {
  id: string;
  name: string | null;
  email: string;
}

/** Tarefa com o contexto que as telas mostram (equipamento, local, orçamento). */
export interface TaskRow extends TaskRecord {
  equipmentName: string;
  equipmentLocation: string;
  budgetId: string;
}

export interface LogRow extends LogRecord {
  equipmentName: string;
  equipmentLocation: string;
  budgetId: string;
  frequency: Frequency;
  assigneeId: string;
  /** Valor da despesa ligada (centavos) — null se não houve custo ou ela foi excluída. */
  costCents: number | null;
}

export interface EquipmentSummaryRow extends EquipmentRecord {
  activeTasks: number;
  nextDueOn: IsoDate | null;
}

/** Tudo roda sob RLS: só aparecem itens de orçamentos que o usuário corrente pode ver. */
export interface MaintenanceRepository {
  createEquipment(data: Omit<EquipmentRecord, 'id' | 'createdAt' | 'archivedAt'>): Promise<EquipmentRecord>;
  findEquipment(id: string): Promise<EquipmentRecord | null>;
  updateEquipment(id: string, patch: Partial<Pick<EquipmentRecord, 'name' | 'location' | 'manualUrl'>>): Promise<void>;
  archiveEquipment(id: string, at: Date): Promise<void>;
  listEquipment(filter: { budgetId?: string }): Promise<EquipmentSummaryRow[]>;

  createTask(data: Omit<TaskRecord, 'id' | 'createdAt' | 'version' | 'active' | 'lastDoneOn'>): Promise<TaskRecord>;
  findTask(id: string): Promise<TaskRecord | null>;
  findTaskForUpdate(id: string): Promise<TaskRecord | null>;
  /** Atualiza só se a versão bater (lock otimista); devolve false se outra pessoa mudou antes. */
  updateTask(
    id: string,
    expectedVersion: number,
    patch: Partial<Pick<TaskRecord, 'name' | 'frequency' | 'assigneeId' | 'nextDueOn' | 'lastDoneOn' | 'active'>>,
  ): Promise<boolean>;
  listActiveTasks(filter: { budgetId?: string; equipmentId?: string; assigneeId?: string }): Promise<TaskRow[]>;

  insertLog(data: Omit<LogRecord, 'id' | 'createdAt'>): Promise<LogRecord>;
  findLogByIdempotencyKey(key: string): Promise<LogRecord | null>;
  listLogs(filter: {
    id?: number;
    budgetId?: string;
    equipmentId?: string;
    assigneeId?: string;
    from?: IsoDate;
    to?: IsoDate;
    limit: number;
  }): Promise<LogRow[]>;

  listMembers(budgetId: string, now: Date): Promise<Member[]>;
}
export const MAINTENANCE_REPOSITORY = Symbol('MAINTENANCE_REPOSITORY');
