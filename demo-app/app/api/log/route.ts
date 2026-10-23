import { Api } from '@/lib/server/api';
import { Journal } from '@/lib/server/journal';

export const GET = Api.authed(async ({ request, session }) => {
  const after = Number(request.nextUrl.searchParams.get('after') ?? 0);
  return { entries: Journal.after(session.sid, Number.isFinite(after) ? after : 0) };
});

export const POST = Api.authed(async ({ request, session }) => {
  const body = await Api.body(request);
  const label = Api.text(body, 'label').slice(0, 60) || 'browser';
  const data = JSON.stringify(body.data ?? null).slice(0, 2000);
  Journal.add(session.sid, {
    source: 'browser',
    method: 'POPUP',
    path: label,
    account: null,
    status: 200,
    durationMs: 0,
    request: null,
    response: Journal.parse(data),
  });
  return { ok: true };
});

export const DELETE = Api.authed(async ({ session }) => {
  Journal.clear(session.sid);
  return { ok: true };
});
