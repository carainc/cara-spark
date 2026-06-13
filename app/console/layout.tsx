import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

// Server-side auth guard (node runtime → Prisma-safe; no edge middleware needed).
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  return <>{children}</>;
}
