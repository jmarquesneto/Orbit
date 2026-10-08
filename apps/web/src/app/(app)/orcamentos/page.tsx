import type { Metadata } from 'next';
import { BudgetsScreen } from '@/screens/budgets-screen';

export const metadata: Metadata = { title: 'Orçamentos' };

export default function BudgetsPage() {
  return <BudgetsScreen />;
}
