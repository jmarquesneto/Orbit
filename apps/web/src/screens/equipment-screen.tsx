'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { type CompleteResult, CompleteTaskDialog, TaskFormDialog } from '@/components/maintenance';
import { Empty, ErrorAlert, Loading, PageHeader, SuccessAlert } from '@/components/ui';
import { api, del, errorMessage, patch, post } from '@/lib/api';
import { isoToBr, money } from '@/lib/format';
import { dueLabel, shortDate } from '@/lib/maintenance';
import { useBudgets } from '@/lib/queries';
import type { EquipmentDetail, EquipmentSummary, MaintenanceTask } from '@/lib/types';

const HTTPS = /^https:\/\/[^\s]+\.[^\s]+/;

function urlProblem(url: string): string | null {
  return url.trim() === '' || HTTPS.test(url.trim()) ? null : 'Use um endereço que comece com https://';
}

/** Formulário de equipamento (novo ou edição). */
function EquipmentForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: EquipmentDetail['equipment'];
  onCancel: () => void;
  onSaved: (id: string, message: string) => void;
}) {
  const budgets = useBudgets();
  const writable = (budgets.data ?? []).filter((b) => b.role === 'owner' || b.role === 'create');
  const [name, setName] = useState(initial?.name ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [url, setUrl] = useState(initial?.manualUrl ?? '');
  const [budgetId, setBudgetId] = useState(initial?.budgetId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!budgetId && writable[0]) setBudgetId(writable[0].id);
  }, [writable, budgetId]);

  const problem = urlProblem(url);
  const canSave = name.trim().length >= 2 && location.trim().length >= 2 && !problem && Boolean(budgetId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return setError('Preencha nome e localização (2 letras ou mais).');
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), location: location.trim(), manualUrl: url.trim() || null };
    try {
      if (initial) {
        await patch(`/maintenance/equipment/${initial.id}`, body);
        onSaved(initial.id, 'Equipamento atualizado.');
      } else {
        const r = await post<{ equipment: { id: string } }>('/maintenance/equipment', { ...body, budgetId });
        onSaved(r.equipment.id, `“${body.name}” cadastrado. Agora adicione as tarefas de manutenção.`);
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="card" style={{ borderColor: 'var(--accent)', gap: 12 }} onSubmit={onSubmit} noValidate>
      <h2 style={{ fontSize: 16 }}>{initial ? 'Editar equipamento' : 'Novo equipamento'}</h2>
      <ErrorAlert error={error} />
      <label className="field">
        Nome
        <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Lava-louças" autoFocus />
      </label>
      <label className="field">
        Localização
        <input className="input" value={location} maxLength={60} onChange={(e) => setLocation(e.target.value)} placeholder="Ex.: Cozinha" />
      </label>
      <label className="field">
        Link do manual ou vídeo (opcional)
        <input
          className="input mono"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          aria-invalid={Boolean(problem)}
          aria-describedby="eq-url-help"
          style={{ fontSize: 14 }}
        />
        <span id="eq-url-help" className="xsmall" style={{ color: problem ? 'var(--danger)' : 'var(--muted)' }}>
          {problem ?? 'Só links https. Abre em nova aba, sem repassar dados da sessão.'}
        </span>
      </label>
      {!initial && (
        <label className="field">
          Orçamento (define quem vê e onde caem os custos)
          <select className="select" value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
            {writable.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn primary" disabled={busy || !canSave}>
          Salvar
        </button>
      </div>
    </form>
  );
}

/** Tela "Equipamentos & histórico" do design. */
export function EquipmentScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const budgets = useBudgets();
  const [adding, setAdding] = useState(params.get('novo') === '1');
  const [editing, setEditing] = useState(false);
  const [taskForm, setTaskForm] = useState<{ task: MaintenanceTask | null } | null>(null);
  const [completing, setCompleting] = useState<MaintenanceTask | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['maintenance-equipment', 'all'],
    queryFn: () => api<{ equipment: EquipmentSummary[] }>('/maintenance/equipment').then((r) => r.equipment),
  });
  const selectedId = params.get('id') ?? list.data?.[0]?.id ?? '';
  const detail = useQuery({
    queryKey: ['maintenance-equipment-detail', selectedId],
    queryFn: () => api<EquipmentDetail>(`/maintenance/equipment/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const select = (id: string) => {
    setEditing(false);
    setAdding(false);
    setMessage(null);
    router.replace(`/equipamentos?id=${id}`);
  };
  const refresh = () => void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('maintenance') });

  async function archive() {
    const eq = detail.data?.equipment;
    if (!eq || !window.confirm(`Arquivar “${eq.name}”? Ele e as tarefas saem do painel; o histórico continua guardado.`)) return;
    try {
      await del(`/maintenance/equipment/${eq.id}`);
      setMessage(`“${eq.name}” arquivado.`);
      router.replace('/equipamentos');
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function onCompleted(result: CompleteResult, task: MaintenanceTask) {
    setCompleting(null);
    setMessage(
      `“${task.name}” concluída. ${result.nextDueOn ? `Próxima: ${isoToBr(result.nextDueOn)}.` : 'Tarefa única encerrada.'}${
        result.log.costCents ? ` Despesa de ${money(result.log.costCents)} lançada.` : ''
      }`,
    );
    refresh();
    void queryClient.invalidateQueries({ queryKey: ['wallets'] });
  }

  const canCreate = (budgets.data ?? []).some((b) => b.role === 'owner' || b.role === 'create');
  const d = detail.data;
  const budgetName = d ? budgets.data?.find((b) => b.id === d.equipment.budgetId)?.name : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/manutencao" className="muted">
              Manutenção
            </Link>{' '}
            / Equipamentos
          </>
        }
        title="Equipamentos"
      >
        {canCreate && (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setAdding(true);
              setEditing(false);
            }}
          >
            <Icon name="plus" size={16} />
            Novo equipamento
          </button>
        )}
      </PageHeader>
      <SuccessAlert message={message} />
      <ErrorAlert error={error} />

      {list.isLoading ? (
        <Loading />
      ) : !list.data?.length && !adding ? (
        <Empty title="Nenhum equipamento cadastrado">
          <span className="small">Comece pelo que precisa de cuidado periódico: máquina de lavar, ar-condicionado, purificador de água…</span>
          {canCreate ? (
            <button type="button" className="btn primary" onClick={() => setAdding(true)}>
              Cadastrar equipamento
            </button>
          ) : (
            budgets.data && (
              <>
                <span className="small">Cada equipamento pertence a um orçamento, que define quem vê e onde caem os custos.</span>
                <Link className="btn primary" href="/orcamentos">
                  Criar orçamento primeiro
                </Link>
              </>
            )
          )}
        </Empty>
      ) : (
        <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
          <section aria-label="Lista de equipamentos" className="stack-sm" style={{ flex: '1 1 320px', minWidth: 0, gap: 8 }}>
            {adding && (
              <EquipmentForm
                onCancel={() => setAdding(false)}
                onSaved={(id, msg) => {
                  setAdding(false);
                  refresh();
                  select(id);
                  setMessage(msg);
                }}
              />
            )}
            {(list.data ?? []).map((e) => {
              const tone = e.nextState ?? 'none';
              const nextText = !e.nextDueOn
                ? 'Sem tarefas'
                : tone === 'overdue'
                  ? `Atrasada · ${shortDate(e.nextDueOn)}`
                  : tone === 'week'
                    ? `Esta semana · ${shortDate(e.nextDueOn)}`
                    : isoToBr(e.nextDueOn);
              return (
                <button key={e.id} type="button" className="eq-item" aria-pressed={e.id === selectedId} onClick={() => select(e.id)}>
                  <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{e.name}</span>
                    <span className="small muted">
                      {e.location} · {e.activeTasks === 1 ? '1 tarefa' : `${e.activeTasks} tarefas`}
                    </span>
                  </span>
                  <span className={`row xsmall due-${tone}`} style={{ gap: 6, flex: 'none' }}>
                    <span className="dot" />
                    {nextText}
                  </span>
                </button>
              );
            })}
          </section>

          <section aria-labelledby="eq-title" className="stack" style={{ flex: '2 1 560px', minWidth: 0, gap: 20 }}>
            {!d ? (
              selectedId && <Loading />
            ) : editing ? (
              <EquipmentForm
                initial={d.equipment}
                onCancel={() => setEditing(false)}
                onSaved={(_id, msg) => {
                  setEditing(false);
                  setMessage(msg);
                  refresh();
                }}
              />
            ) : (
              <>
                <div className="card" style={{ gap: 14 }}>
                  <div className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div className="stack-sm" style={{ gap: 4 }}>
                      <h2 id="eq-title" style={{ fontSize: 24 }}>{d.equipment.name}</h2>
                      <span className="small text-2">
                        {d.equipment.location}
                        {budgetName ? ` · orçamento ${budgetName}` : ''}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      {d.permissions.update && (
                        <button type="button" className="btn small" onClick={() => setEditing(true)}>
                          Editar
                        </button>
                      )}
                      {d.permissions.delete && (
                        <button type="button" className="btn small danger" onClick={archive}>
                          Arquivar
                        </button>
                      )}
                    </div>
                  </div>
                  {d.equipment.manualUrl ? (
                    <a
                      className="btn small"
                      style={{ alignSelf: 'flex-start' }}
                      href={d.equipment.manualUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      <Icon name="link" size={16} />
                      Manual ou vídeo
                    </a>
                  ) : (
                    <span className="small muted">Sem link de manual ou vídeo.</span>
                  )}
                  <div className="row" style={{ gap: 24, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    <div className="stack-sm" style={{ gap: 0 }}>
                      <span className="xsmall muted">Tarefas ativas</span>
                      <span className="mono" style={{ fontSize: 18 }}>{d.totals.activeTasks}</span>
                    </div>
                    <div className="stack-sm" style={{ gap: 0 }}>
                      <span className="xsmall muted">Conclusões registradas</span>
                      <span className="mono" style={{ fontSize: 18 }}>{d.totals.logCount}</span>
                    </div>
                    <div className="stack-sm" style={{ gap: 0 }}>
                      <span className="xsmall muted">Gasto total com o item</span>
                      <span className="mono" style={{ fontSize: 18, color: 'var(--warn-fg)' }}>{money(d.totals.costCents)}</span>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ gap: 4 }}>
                  <div className="between" style={{ marginBottom: 8 }}>
                    <h3 style={{ fontSize: 17 }}>Tarefas de manutenção</h3>
                    {d.permissions.create && (
                      <button type="button" className="btn small" onClick={() => setTaskForm({ task: null })}>
                        + Tarefa
                      </button>
                    )}
                  </div>
                  {!d.tasks.length && (
                    <p className="small muted" style={{ margin: 0, padding: '12px 0' }}>
                      Nenhuma tarefa ainda. Adicione a primeira, como “Limpeza do filtro”.
                    </p>
                  )}
                  {d.tasks.map((t) => {
                    const due = dueLabel(t.nextDueOn, t.daysUntil);
                    return (
                      <div key={t.id} className="between" style={{ flexWrap: 'wrap', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border-row)' }}>
                        <div className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
                          <span style={{ fontWeight: 500 }}>{t.name}</span>
                          <span className="small muted">
                            {t.frequencyLabel} · responsável: {t.assignee.name}
                          </span>
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                          <span className={`small due-${due.tone}`} style={{ fontWeight: 500 }}>
                            {due.text}
                          </span>
                          {t.canEdit && (
                            <button type="button" className="btn small" onClick={() => setTaskForm({ task: t })}>
                              Editar
                            </button>
                          )}
                          {t.canComplete && (
                            <button type="button" className="btn small" onClick={() => setCompleting(t)}>
                              Concluir
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="card" style={{ gap: 12 }}>
                  <div className="between" style={{ flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: 17 }}>Histórico de manutenções</h3>
                    <span className="row xsmall muted" style={{ gap: 6 }}>
                      <Icon name="lock" size={14} />
                      Registros permanentes: não podem ser editados nem apagados
                    </span>
                  </div>
                  {!d.logs.length ? (
                    <p className="small muted" style={{ margin: 0 }}>Nenhuma conclusão registrada ainda.</p>
                  ) : (
                    <>
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th scope="col">Concluída em</th>
                              <th scope="col">Tarefa</th>
                              <th scope="col">Por</th>
                              <th scope="col">Vencia em</th>
                              <th scope="col" className="num">Custo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.logs.map((l) => {
                              const late = l.dueOn ? Math.round((Date.parse(l.completedOn) - Date.parse(l.dueOn)) / 86_400_000) : 0;
                              return (
                                <tr key={l.id}>
                                  <td className="mono">{isoToBr(l.completedOn)}</td>
                                  <td>
                                    {l.taskName}
                                    {l.note && <span className="xsmall muted" style={{ display: 'block' }}>{l.note}</span>}
                                  </td>
                                  <td className="text-2">{l.completedBy.name}</td>
                                  <td className="mono" style={{ color: late > 0 ? 'var(--warn-fg)' : undefined }}>
                                    {l.dueOn ? `${isoToBr(l.dueOn)}${late > 0 ? ` (+${late}d)` : ''}` : '—'}
                                  </td>
                                  <td className="num mono" style={{ color: l.costCents ? 'var(--warn-fg)' : 'var(--muted)' }}>
                                    {l.costCents ? money(l.costCents) : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <span className="xsmall muted">Custos aparecem como despesas da categoria Manutenção no orçamento, ligadas a cada registro.</span>
                    </>
                  )}
                </div>

                <TaskFormDialog
                  open={Boolean(taskForm)}
                  task={taskForm?.task ?? null}
                  equipment={d.equipment}
                  today={d.today}
                  onClose={() => setTaskForm(null)}
                  onSaved={(msg) => {
                    setTaskForm(null);
                    setMessage(msg);
                    refresh();
                  }}
                />
                <CompleteTaskDialog task={completing} today={d.today} onClose={() => setCompleting(null)} onDone={onCompleted} />
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
