import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OverviewScreen } from '@/screens/overview-screen';

export const metadata: Metadata = { title: 'Visão geral' };

export default function OverviewPage() {
  return (
    <Suspense>
      <OverviewScreen />
    </Suspense>
  );
}
