import { NextRequest, NextResponse } from 'next/server';
import { recordAccessLog } from '@/lib/access-analytics';

export const runtime = 'nodejs';

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null;
  }

  const realIp = request.headers.get('x-real-ip');
  return realIp?.trim() || null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const pathname = typeof body?.pathname === 'string' ? body.pathname : '';
    const visitorId = typeof body?.visitorId === 'string' ? body.visitorId : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
    const referrer = typeof body?.referrer === 'string' ? body.referrer : null;

    if (!pathname || !visitorId || !sessionId) {
      return NextResponse.json({ error: '缺少访问日志参数' }, { status: 400 });
    }

    await recordAccessLog({
      pathname,
      visitorId,
      sessionId,
      referrer,
      userAgent: request.headers.get('user-agent'),
      ipAddress: getClientIp(request),
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[traffic] failed to record access log', error);
    return NextResponse.json({ error: '记录访问日志失败' }, { status: 500 });
  }
}