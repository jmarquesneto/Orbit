import type { Metadata } from 'next';
import { SetupScreen } from '@/screens/setup-screen';

export const metadata: Metadata = { title: 'Primeiro acesso' };

export default function Page() {
  return <SetupScreen />;
}
