import type { Metadata } from 'next';
import { InviteScreen } from '@/screens/invite-screen';

export const metadata: Metadata = { title: 'Convite', referrer: 'no-referrer' };

export default function InvitePage() {
  return <InviteScreen />;
}
