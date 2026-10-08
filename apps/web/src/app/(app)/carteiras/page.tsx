import type { Metadata } from 'next';
import { WalletsScreen } from '@/screens/wallets-screen';

export const metadata: Metadata = { title: 'Carteiras' };

export default function Page() {
  return <WalletsScreen />;
}
