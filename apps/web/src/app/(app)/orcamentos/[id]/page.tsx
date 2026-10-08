import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BudgetDetailScreen } from '@/screens/budget-detail-screen';

export const metadata: Metadata = { title: 'Orçamento' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <BudgetDetailScreen id={id} />;
}
