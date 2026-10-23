import type { NextRequest } from 'next/server';

import { Api } from '@/lib/server/api';
import { Journal } from '@/lib/server/journal';
import { Sessions } from '@/lib/server/sessions';

export async function POST(request: NextRequest) {
  const refused = Api.crossSite(request);
  if (refused) return refused;
  const session = Sessions.read(request.cookies);
  if (session) Journal.clear(session.sid);
  const response = Api.json({ signedIn: false });
  Sessions.end(response);
  Sessions.forget(response);
  return response;
}
