import { redirect } from 'next/navigation';

/** Endereço antigo: a verificação em duas etapas agora fica em "Minha conta". */
export default function Page() {
  redirect('/conta');
}
