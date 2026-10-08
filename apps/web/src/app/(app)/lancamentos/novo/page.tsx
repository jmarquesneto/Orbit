import type { Metadata } from 'next';
import { NewTransactionScreen } from '@/screens/new-transaction-screen';

export const metadata: Metadata = { title: 'Novo lançamento' };

export default function NewTransactionPage() {
  return <NewTransactionScreen />;
}
