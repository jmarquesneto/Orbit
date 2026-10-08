'use client';

import type { Budget } from '@/lib/types';
import { ROLE_LABEL } from '@/lib/types';

export function BudgetPicker({
  budgets,
  value,
  onChange,
  label = 'Orçamento',
  onlyWritable = false,
}: {
  budgets: Budget[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  onlyWritable?: boolean;
}) {
  const list = onlyWritable ? budgets.filter((b) => b.role === 'owner' || b.role === 'create') : budgets;
  return (
    <label className="field">
      {label}
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.role === 'owner' ? '' : ` (${ROLE_LABEL[b.role]})`}
          </option>
        ))}
      </select>
    </label>
  );
}
