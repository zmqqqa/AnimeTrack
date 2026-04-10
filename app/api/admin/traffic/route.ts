import { apiSuccess, requireAdmin } from '@/lib/api-response';
import { getAccessAnalyticsSnapshot } from '@/lib/access-analytics';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { authorized, response } = await requireAdmin();
  if (!authorized) return response;

  const { searchParams } = new URL(request.url);
  const days = Number(searchParams.get('days') ?? '14');
  const data = await getAccessAnalyticsSnapshot(days);
  return apiSuccess(data);
}