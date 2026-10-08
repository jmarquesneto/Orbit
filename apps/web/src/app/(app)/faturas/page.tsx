import type { Metadata } from 'next';
import { InvoicesScreen } from '@/screens/invoices-screen';

export const metadata: Metadata = { title: 'Faturas' };

export default function Page() {
  return <InvoicesScreen />;
}
