import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EquipmentScreen } from '@/screens/equipment-screen';

export const metadata: Metadata = { title: 'Equipamentos' };

export default function Page() {
  return (
    <Suspense>
      <EquipmentScreen />
    </Suspense>
  );
}
