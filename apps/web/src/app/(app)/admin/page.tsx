import type { Metadata } from 'next';
import { AdminScreen } from '@/screens/admin-screen';

export const metadata: Metadata = { title: 'Administração' };

export default function AdminPage() {
  return <AdminScreen />;
}
