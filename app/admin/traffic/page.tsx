import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import TrafficAnalyticsClient from './TrafficAnalyticsClient';
import { authOptions } from '@/lib/auth';
import type { SessionUser } from '@/lib/anime-shared';

export default async function TrafficAnalyticsPage() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as SessionUser | undefined)?.role;

  if (role !== 'admin') {
    redirect('/');
  }

  return <TrafficAnalyticsClient />;
}