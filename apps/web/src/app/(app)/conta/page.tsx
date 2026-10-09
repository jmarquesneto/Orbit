import type { Metadata } from 'next';
import { AccountScreen } from '@/screens/account-screen';

export const metadata: Metadata = { title: 'Minha conta' };

export default function Page() {
  return <AccountScreen />;
}
