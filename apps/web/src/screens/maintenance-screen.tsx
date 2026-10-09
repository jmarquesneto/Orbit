'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useMe } from '@/components/app-shell';
import { Icon } from '@/components/icons';
import { Avatar, type CompleteResult, CompleteTaskDialog, TaskFormDialog } from '@/components/maintenance';
import { Empty, ErrorAlert, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { isoToBr, longDate, money, monthLabel } from '@/lib/format';
import { dueLabel, shortDate } from '@/lib/maintenance';
import { useBudgets } from '@/lib/queries';
import type { EquipmentSummary, MaintenanceLog, MaintenanceOverview, MaintenanceTask } from '@/lib/types';

const COLUMNS = [
  { key: 'overdue', title: 'Atrasadas', color: '#FF8A78', empty: 'Nada atrasado.' },
  { key: 'week', title: 'Próximos 7 dias', color: '#F6B467', empty: 'Nada para esta semana.' },
  { key: 'later', title: 'Mais adiante', color: '#7AA7FF', empty: 'Sem tarefas futuras.' },
] as const;

function TaskCard({ task, onComplete }: { task: MaintenanceTask; onComplete: (t: MaintenanceTask) => void }) {
  const due = dueLabel(task.nextDueOn, task.daysUntil);
  const urgent = task.state === 'overdue' || task.daysUntil === 0;
  return (
    <article className="task-card">
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <h3>{task.name}</h3>
        <Avatar person={task.assignee} />
      </div>
      <Link href={`/equipamentos?id=${task.equipment.id}`} className="small text-2" style={{ textDecoration: 'none' }}>
        {task.equipment.name} · {task.equipment.location}
      </Link>
      <div className="row" style={{ gap: 6 }}>
        <span className="badge">{task.frequencyLabel}</span>
        <span className={`small due-${due.tone}`} style={{ fontWeight: 500 }}>
          {due.text}
        </span>
      </div>
      {task.canComplete && (
        <button type="button" className={`btn${urgent ? ' primary' : ''}`} onClick={() => onComplete(task)}>
          <Icon name="check" size={16} />
          Concluir rápido
        </button>
      )}
    </article>
  );
}

function DoneCard({ log }: { log: MaintenanceLog }) {
  return (
    <article className="task-card">
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <h3>{log.taskName}</h3>
        <Avatar person={log.completedBy} />
      </div>
      <Link href={`/equipamentos?id=${log.equipment.id}`} className="small text-2" style={{ textDecoration: 'none' }}>
        {log.equipment.name} · {log.equipment.location}
      </Link>
      <div className="row" style={{ gap: 6 }}>
        <span className="badge">{log.frequencyLabel}</span>
        <span className="small" style={{ color: 'var(--ok-fg)', fontWeight: 500 }}>
          Concluída {shortDate(log.completedOn)}
        </span>
      </div>
      <div className="stack-sm xsmall muted" style={{ gap: 2, paddingTop: 8, borderTop: '1px solid var(--border-row)' }}>
        <span>
          Por {log.completedBy.name} em {isoToBr(log.completedOn)}
        </span>
        <span className="text-2">{log.nextDueOn ? `Próxima: ${isoToBr(log.nextDueOn)}` : 'Tarefa única · encerrada'}</span>
        <span style={{ color: log.costCents ? 'var(--warn-fg)' : undefined }}>
          {log.costCents ? `${money(log.costCents)} lançado como despesa` : 'Sem custo'}
        </span>
      </div>
    </article>
  );
}

/** Tela "Dashboard de manutenção" do design. */
export function MaintenanceScreen() {
  const me = useMe();
  const queryClient = useQueryClient();
  const budgets = useBudgets();
  const [assignee, setAssignee] = useState<string>('all');
  const [budgetId, setBudgetId] = useState('');
  const [completing, setCompleting] = useState<MaintenanceTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (assignee !== 'all') params.set('assignee', assignee);
  if (budgetId) params.set('budgetId', budgetId);
  const overview = useQuery({
    queryKey: ['maintenance-overview', assignee, budgetId],
    queryFn: () => api<MaintenanceOverview>(`/maintenance/overview?${params.toString()}`),
  });
  const equipment = useQuery({
    queryKey: ['maintenance-equipment', budgetId],
    queryFn: () =>
      api<{ equipment: EquipmentSummary[] }>(`/maintenance/equipment${budgetId ? `?budgetId=${budgetId}` : ''}`).then((r) => r.equipment),
  });

  const refresh = () => void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('maintenance') });

  function onCompleted(result: CompleteResult, task: MaintenanceTask) {
    setCompleting(null);
    const parts = [`“${task.name}” concluída.`, result.nextDueOn ? `Próxima: ${isoToBr(result.nextDueOn)}.` : 'Tarefa única encerrada.'];
    if (result.log.costCents) parts.push(`Despesa de ${money(result.log.costCents)} lançada na categoria Manutenção.`);
    setToast(parts.join(' '));
    refresh();
    void queryClient.invalidateQueries({ queryKey: ['wallets'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }

  const data = overview.data;
  const canCreate = (budgets.data ?? []).some((b) => b.role === 'owner' || b.role === 'create');
  const budgetName = budgetId ? budgets.data?.find((b) => b.id === budgetId)?.name : null;

  return (
    <>
      <PageHeader eyebrow={`${longDate()}${budgetName ? ` · orçamento ${budgetName}` : ''}`} title="Manutenção da casa">
        {(budgets.data?.length ?? 0) > 1 && (
          <select className="select" style={{ width: 'auto' }} aria-label="Orçamento" value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
            <option value="">Todos os orçamentos</option>
            {budgets.data!.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <Link className="btn" href="/equipamentos">
          Equipamentos e histórico
        </Link>
        {canCreate && (
          <button type="button" className="btn primary" onClick={() => setCreating(true)} disabled={!equipment.data?.length}>
            <Icon name="plus" size={16} />
            Nova tarefa
          </button>
        )}
      </PageHeader>

      {overview.error && <ErrorAlert error={errorMessage(overview.error)} />}
      {!data ? (
        !overview.error && <Loading />
      ) : (
        <>
          <section aria-label="Indicadores" className="grid" style={{ ['--min' as string]: '200px' }}>
            <div className="kpi danger">
              <span className="small">Atrasadas</span>
              <span className="kpi-value">{data.kpis.overdue}</span>
              <span className="small">
                {data.kpis.overdue ? `a mais antiga há ${data.kpis.oldestOverdueDays} ${data.kpis.oldestOverdueDays === 1 ? 'dia' : 'dias'}` : 'tudo em dia'}
              </span>
            </div>
            <div className="kpi warn">
              <span className="small">Próximos 7 dias</span>
              <span className="kpi-value">{data.kpis.next7}</span>
              <span className="small">até {shortDate(data.kpis.next7Until)}</span>
            </div>
            <div className="kpi">
              <span className="small muted">Concluídas em {monthLabel(data.today.slice(0, 7)).replace(/ \d{4}$/, '').toLowerCase()}</span>
              <span className="kpi-value">{data.kpis.doneThisMonth}</span>
              <span className="small muted">registradas no histórico</span>
            </div>
            <div className="kpi">
              <span className="small muted">Gasto com manutenção</span>
              <span className="kpi-value">{money(data.kpis.costThisMonthCents)}</span>
              <span className="small muted">{monthLabel(data.today.slice(0, 7)).replace(/ \d{4}$/, '').toLowerCase()} · categoria Manutenção</span>
            </div>
          </section>

          {toast && (
            <div className="alert ok between" role="status">
              <span className="row" style={{ gap: 10 }}>
                <Icon name="check" size={16} />
                {toast}
              </span>
              <button type="button" className="btn small" onClick={() => setToast(null)}>
                Fechar
              </button>
            </div>
          )}

          <div className="between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div role="group" aria-label="Filtrar por responsável" className="row" style={{ gap: 8 }}>
              <span className="small muted">Responsável</span>
              {[{ id: 'all', name: 'Todos' }, ...data.assignees].map((p) => (
                <button key={p.id} type="button" className="pill" aria-pressed={assignee === p.id} onClick={() => setAssignee(p.id)}>
                  {p.id === me.id ? `${p.name.split(' ')[0]} (você)` : p.name.split(' ')[0]}
                </button>
              ))}
            </div>
            <span className="small muted">Próxima data = data real de conclusão + intervalo</span>
          </div>

          {!data.tasks.length && !data.recentDone.length && !equipment.data?.length ? (
            <Empty title="Nenhum equipamento cadastrado">
              <span className="small">Cadastre a máquina de lavar, o ar-condicionado, o purificador… e as tarefas de cada um.</span>
              <Link className="btn primary" href="/equipamentos?novo=1">
                Cadastrar equipamento
              </Link>
            </Empty>
          ) : (
            <section aria-label="Quadro de tarefas" className="board">
              {COLUMNS.map((c) => {
                const items = data.tasks.filter((t) => t.state === c.key);
                return (
                  <div key={c.key} className="board-col" style={{ ['--col' as string]: c.color }}>
                    <div className="between">
                      <h2 style={{ fontSize: 15 }}>{c.title}</h2>
                      <span className="mono small muted">{items.length}</span>
                    </div>
                    {!items.length && <p className="small muted" style={{ margin: 0, padding: '16px 8px', textAlign: 'center' }}>{c.empty}</p>}
                    {items.map((t) => (
                      <TaskCard key={t.id} task={t} onComplete={setCompleting} />
                    ))}
                  </div>
                );
              })}
              <div className="board-col" style={{ ['--col' as string]: 'var(--accent)' }}>
                <div className="between">
                  <h2 style={{ fontSize: 15 }}>Concluídas · 7 dias</h2>
                  <span className="mono small muted">{data.recentDone.length}</span>
                </div>
                {!data.recentDone.length && (
                  <p className="small muted" style={{ margin: 0, padding: '16px 8px', textAlign: 'center' }}>
                    Nenhuma conclusão recente.
                  </p>
                )}
                {data.recentDone.map((l) => (
                  <DoneCard key={l.id} log={l} />
                ))}
              </div>
            </section>
          )}

          <CompleteTaskDialog task={completing} today={data.today} onClose={() => setCompleting(null)} onDone={onCompleted} />
          <TaskFormDialog
            open={creating}
            equipmentOptions={equipment.data ?? []}
            today={data.today}
            onClose={() => setCreating(false)}
            onSaved={(msg) => {
              setCreating(false);
              setToast(msg);
              refresh();
            }}
          />
        </>
      )}
    </>
  );
}
