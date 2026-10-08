import type { Metadata } from 'next';
import { SecurityScreen } from '@/screens/security-screen';

export const metadata: Metadata = { title: 'Segurança' };

export default function Page() {
  return <SecurityScreen />;
}
