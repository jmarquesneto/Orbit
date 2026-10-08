import type { Metadata } from 'next';
import { GoalsScreen } from '@/screens/goals-screen';

export const metadata: Metadata = { title: 'Caixinhas' };

export default function Page() {
  return <GoalsScreen />;
}
