import type { Metadata } from 'next';
import { MaintenanceScreen } from '@/screens/maintenance-screen';

export const metadata: Metadata = { title: 'Manutenção' };

export default function Page() {
  return <MaintenanceScreen />;
}
