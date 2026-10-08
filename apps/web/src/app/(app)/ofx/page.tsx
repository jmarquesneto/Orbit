import type { Metadata } from 'next';
import { OfxScreen } from '@/screens/ofx-screen';

export const metadata: Metadata = { title: 'Conciliação OFX' };

export default function OfxPage() {
  return <OfxScreen />;
}
