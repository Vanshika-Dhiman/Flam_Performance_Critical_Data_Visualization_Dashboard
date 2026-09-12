import { NextResponse, type NextRequest } from 'next/server';
import { MAX_WINDOW } from '@/lib/chartConfig';

/**
 * Edge middleware for the data API: rejects out-of-range requests before the route
 * handler spends CPU generating data, and tags responses with a request id for tracing.
 */
export function middleware(request: NextRequest) {
  const points = request.nextUrl.searchParams.get('points');
  if (points !== null) {
    const n = Number(points);
    if (!Number.isFinite(n) || n < 1 || n > MAX_WINDOW) {
      return NextResponse.json({ error: `"points" must be a number between 1 and ${MAX_WINDOW}` }, { status: 400 });
    }
  }
  const format = request.nextUrl.searchParams.get('format');
  if (format !== null && format !== 'json' && format !== 'binary') {
    return NextResponse.json({ error: '"format" must be "json" or "binary"' }, { status: 400 });
  }

  const response = NextResponse.next();
  response.headers.set('X-Request-Id', crypto.randomUUID());
  return response;
}

export const config = {
  matcher: '/api/data',
};
