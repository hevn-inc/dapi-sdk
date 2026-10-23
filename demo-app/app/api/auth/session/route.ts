import type { NextRequest } from 'next/server';

import { Api } from '@/lib/server/api';
import { Config } from '@/lib/server/config';
import { Partner } from '@/lib/server/hevn';
import { Journal } from '@/lib/server/journal';
import { Sessions } from '@/lib/server/sessions';

export async function POST(request: NextRequest) {
  const refused = Api.crossSite(request);
  if (refused) return refused;
  const sid = Sessions.read(request.cookies)?.sid ?? Sessions.newSid();
  return Journal.run(sid, async () => {
    try {
      const session = await Partner.hevn.connect.sessions.create({ action: 'link', redirectUri: Config.redirectUri });
      const response = Api.json({ url: session.url });
      Sessions.remember(response, session.state, sid);
      return response;
    } catch (error) {
      return Api.failure(error);
    }
  });
}
