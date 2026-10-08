import type { Metadata } from 'next';
import { TransactionsScreen } from '@/screens/transactions-screen';

export const metadata: Metadata = { title: 'Lançamentos' };

export default function TransactionsPage() {
  return <TransactionsScreen />;
}
