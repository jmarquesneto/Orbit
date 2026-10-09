'use client';

import { useQuery } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { api, del, errorMessage, patch, post } from '@/lib/api';
import { isoToBr, money, parseMoneyInput } from '@/lib/format';
import { FREQUENCY_OPTIONS, initials, nextDueDate, shiftDate } from '@/lib/maintenance';
import { useBudgets, useWallets } from '@/lib/queries';
import type { EquipmentSummary, Frequency, MaintenanceLog, MaintenanceTask, Person } from '@/lib/types';
import { useMe } from './app-shell';
import { Icon } from './icons';
import { ErrorAlert } from './ui';

/** Diálogo nativo (<dialog>): foco preso dentro, Esc fecha, leitor de tela anuncia. */
function Modal({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal wide"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

export function Avatar({ person }: { person: Person }) {
  return (
    <span className="avatar" title={person.name} aria-label={person.name}>
      {initials(person.name)}
    </span>
  );
}

const walletLabel = (w: { name: string; last4: string | null; type: string }) =>
  `${w.name}${w.last4 ? ` ••${w.last4}` : ''}${w.type === 'credit' ? ' (cartão)' : ''}`;

export interface CompleteResult {
  log: MaintenanceLog;
  nextDueOn: string | null;
}

/**
 * "Concluir tarefa" (design: Dashboard de manutenção). A próxima data é calculada a partir
 * da data REAL de conclusão; com custo, vira uma despesa paga na categoria Manutenção.
 */
export function CompleteTaskDialog({
  task,
  today,
  onClose,
  onDone,
}: {
  task: MaintenanceTask | null;
  today: string;
  onClose: () => void;
  onDone: (result: CompleteResult, task: MaintenanceTask) => void;
}) {
  return (
    <Modal open={Boolean(task)} onClose={onClose} labelledBy="complete-title">
      {task && <CompleteForm key={task.id} task={task} today={today} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function CompleteForm({
  task,
  today,
  onClose,
  onDone,
}: {
  task: MaintenanceTask;
  today: string;
  onClose: () => void;
  onDone: (result: CompleteResult, task: MaintenanceTask) => void;
}) {
  const budgets = useBudgets();
  const wallets = useWallets();
  const writable = (budgets.data ?? []).filter((b) => b.role === 'owner' || b.role === 'create');
  const [doneOn, setDoneOn] = useState(today);
  const [costYes, setCostYes] = useState(false);
  const [costText, setCostText] = useState('');
  const [budgetId, setBudgetId] = useState('');
  const [walletId, setWalletId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Uma chave por abertura: clique duplo ou reenvio não registram (nem cobram) duas vezes.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (!budgetId && writable.length) setBudgetId((writable.find((b) => b.id === task.budgetId) ?? writable[0]!).id);
  }, [writable, budgetId, task.budgetId]);
  useEffect(() => {
    const list = wallets.data ?? [];
    if (!walletId && list.length) setWalletId((list.find((w) => w.type !== 'credit') ?? list[0]!).id);
  }, [wallets.data, walletId]);

  const cents = parseMoneyInput(costText);
  const next = nextDueDate(doneOn, task.frequency);
  const dates = [
    { v: today, label: `Hoje · ${isoToBr(today).slice(0, 5)}` },
    { v: shiftDate(today, -1), label: `Ontem · ${isoToBr(shiftDate(today, -1)).slice(0, 5)}` },
    { v: shiftDate(today, -2), label: isoToBr(shiftDate(today, -2)).slice(0, 5) },
  ];
  const custom = !dates.some((d) => d.v === doneOn);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (costYes && !cents) return setError('Informe o valor, por exemplo 120,00.');
    if (costYes && (!budgetId || !walletId)) return setError('Escolha o orçamento e a conta de origem.');
    setBusy(true);
    setError(null);
    try {
      const result = await post<CompleteResult>(`/maintenance/tasks/${task.id}/complete`, {
        completedOn: doneOn,
        version: task.version,
        idempotencyKey,
        note: note.trim() || null,
        cost: costYes ? { amountCents: cents, walletId, budgetId } : null,
      });
      onDone(result, task);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="xsmall muted overline">Concluir tarefa</span>
          <h2 id="complete-title" style={{ fontSize: 20 }}>{task.name}</h2>
          <span className="small text-2">
            {task.equipment.name} · {task.equipment.location} · {task.frequencyLabel}
          </span>
        </div>
        <button type="button" className="btn icon" aria-label="Fechar" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>

      <div role="group" aria-label="Data da conclusão" className="stack-sm">
        <span className="small text-2">Concluída em</span>
        <div className="row" style={{ gap: 8 }}>
          {dates.map((d) => (
            <button key={d.v} type="button" className="pill" aria-pressed={doneOn === d.v} onClick={() => setDoneOn(d.v)}>
              {d.label}
            </button>
          ))}
          <label className="row small text-2" style={{ gap: 6 }}>
            <span className="sr-only">Outra data</span>
            <input
              className="input"
              type="date"
              max={today}
              value={doneOn}
              aria-label="Outra data de conclusão"
              onChange={(e) => e.target.value && setDoneOn(e.target.value)}
              style={{ width: 'auto', borderColor: custom ? 'var(--accent)' : undefined }}
            />
          </label>
        </div>
      </div>

      <div className="note-box" role="note">
        <Icon name="check" size={16} />
        <span>
          {next
            ? `${task.nextDueOn ? `Vencia em ${isoToBr(task.nextDueOn)}, concluída` : 'Concluída'} em ${isoToBr(doneOn)}. Próximo vencimento: ${isoToBr(next)} (${task.frequencyLabel.toLowerCase()}, contado a partir da conclusão).`
            : 'Tarefa única: depois de concluída, sai do quadro e fica só no histórico.'}
        </span>
      </div>

      <div role="group" aria-label="Houve algum custo?" className="stack-sm">
        <span style={{ fontWeight: 600 }}>Houve algum custo?</span>
        <div className="grid" style={{ ['--min' as string]: '160px', gap: 8 }}>
          <button type="button" className="choice center" aria-pressed={!costYes} onClick={() => setCostYes(false)}>
            Não
          </button>
          <button type="button" className="choice center warn" aria-pressed={costYes} onClick={() => setCostYes(true)}>
            Sim, lançar despesa
          </button>
        </div>
      </div>

      {costYes && (
        <div className="cost-box stack-sm">
          <div className="form-grid" style={{ ['--min' as string]: '170px' }}>
            <label className="field">
              Valor (R$)
              <input
                className="input mono"
                inputMode="decimal"
                placeholder="0,00"
                value={costText}
                autoFocus
                onChange={(e) => setCostText(e.target.value)}
                aria-invalid={costText !== '' && !cents}
              />
            </label>
            <label className="field">
              Orçamento
              <select className="select" value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
                {writable.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Conta de origem
              <select className="select" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                {(wallets.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {walletLabel(w)}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              Categoria
              <span className="input" style={{ display: 'flex', alignItems: 'center' }}>Manutenção</span>
            </div>
          </div>
          <span className="xsmall" style={{ color: 'var(--warn-fg)' }}>
            Vira uma despesa paga em {isoToBr(doneOn)}, ligada a este registro do histórico. No cartão, entra na fatura como qualquer compra.
          </span>
        </div>
      )}

      <label className="field">
        Observação (opcional)
        <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: filtro estava muito sujo" />
      </label>

      <ErrorAlert error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Salvando…' : costYes && cents ? `Concluir e lançar ${money(cents)}` : 'Concluir'}
        </button>
      </div>
    </form>
  );
}

/**
 * Nova tarefa ou edição. O responsável só pode ser alguém com acesso ao orçamento do
 * equipamento (a lista vem do servidor, que confere de novo ao salvar).
 */
export function TaskFormDialog({
  open,
  task,
  equipment,
  equipmentOptions,
  today,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Presente: edição. */
  task?: MaintenanceTask | null;
  /** Equipamento fixo (tela de equipamentos). */
  equipment?: { id: string; budgetId: string; name: string } | null;
  /** Sem equipamento fixo: a pessoa escolhe (painel). */
  equipmentOptions?: EquipmentSummary[];
  today: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="task-title">
      {open && (
        <TaskForm
          key={task?.id ?? 'new'}
          task={task ?? null}
          equipment={equipment ?? null}
          equipmentOptions={equipmentOptions ?? []}
          today={today}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function TaskForm({
  task,
  equipment,
  equipmentOptions,
  today,
  onClose,
  onSaved,
}: {
  task: MaintenanceTask | null;
  equipment: { id: string; budgetId: string; name: string } | null;
  equipmentOptions: EquipmentSummary[];
  today: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const me = useMe();
  const [equipmentId, setEquipmentId] = useState(task?.equipment.id ?? equipment?.id ?? equipmentOptions[0]?.id ?? '');
  const [name, setName] = useState(task?.name ?? '');
  const [frequency, setFrequency] = useState<Frequency>(task?.frequency ?? 'monthly');
  const [assigneeId, setAssigneeId] = useState(task?.assignee.id ?? me.id);
  const [dueOn, setDueOn] = useState(task?.nextDueOn ?? today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const budgetId =
    task?.budgetId ?? equipment?.budgetId ?? equipmentOptions.find((e) => e.id === equipmentId)?.budgetId ?? '';
  const members = useQuery({
    queryKey: ['maintenance-members', budgetId],
    queryFn: () => api<{ members: Person[] }>(`/maintenance/members?budgetId=${budgetId}`).then((r) => r.members),
    enabled: Boolean(budgetId),
  });
  useEffect(() => {
    const list = members.data ?? [];
    if (list.length && !list.some((m) => m.id === assigneeId)) setAssigneeId(list[0]!.id);
  }, [members.data, assigneeId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Dê um nome à tarefa, como “Limpeza do filtro”.');
    if (!equipmentId) return setError('Escolha o equipamento.');
    setBusy(true);
    setError(null);
    try {
      if (task) {
        await patch(`/maintenance/tasks/${task.id}`, { version: task.version, name: name.trim(), frequency, assigneeId, nextDueOn: dueOn });
        onSaved(`Tarefa “${name.trim()}” atualizada.`);
      } else {
        await post(`/maintenance/equipment/${equipmentId}/tasks`, { name: name.trim(), frequency, assigneeId, firstDueOn: dueOn });
        onSaved(`Tarefa “${name.trim()}” criada.`);
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!task || !window.confirm(`Desativar “${task.name}”? Ela sai do quadro; o histórico continua guardado.`)) return;
    setBusy(true);
    try {
      await del(`/maintenance/tasks/${task.id}?version=${task.version}`);
      onSaved(`Tarefa “${task.name}” desativada.`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="between" style={{ alignItems: 'flex-start' }}>
        <div className="stack-sm" style={{ gap: 2 }}>
          <span className="xsmall muted overline">{task ? 'Editar tarefa' : 'Nova tarefa'}</span>
          <h2 id="task-title" style={{ fontSize: 20 }}>{task ? task.name : equipment ? equipment.name : 'Tarefa de manutenção'}</h2>
        </div>
        <button type="button" className="btn icon" aria-label="Fechar" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>

      {!task && !equipment && (
        <label className="field">
          Equipamento
          <select className="select" value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} required>
            {equipmentOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.location}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        Tarefa
        <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Limpeza do filtro" autoFocus />
      </label>
      <div className="form-grid" style={{ ['--min' as string]: '170px' }}>
        <label className="field">
          Frequência
          <select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {FREQUENCY_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Responsável
          <select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === me.id ? `${m.name} (você)` : m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {task ? 'Próximo vencimento' : 'Primeiro vencimento'}
          <input className="input" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </label>
      </div>
      <span className="xsmall muted">
        Depois de cada conclusão, a próxima data é a data real da conclusão + o intervalo. Só quem tem acesso ao orçamento do
        equipamento pode ser responsável.
      </span>

      <ErrorAlert error={error} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          {task && (
            <button type="button" className="btn danger" onClick={deactivate} disabled={busy}>
              Desativar
            </button>
          )}
        </span>
        <span className="row">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={busy || !equipmentId}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </span>
      </div>
    </form>
  );
}
