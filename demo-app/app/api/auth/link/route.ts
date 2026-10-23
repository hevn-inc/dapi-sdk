import type { Client } from '@hevn/dapi-sdk';
import type { NextRequest } from 'next/server';

import { Api } from '@/lib/server/api';
import { Partner } from '@/lib/server/hevn';
import { Journal } from '@/lib/server/journal';
import { Sessions } from '@/lib/server/sessions';

export async function POST(request: NextRequest) {
  const refused = Api.crossSite(request);
  if (refused) return refused;
  const attempt = Sessions.readLink(request.cookies);
  if (!attempt) return Api.refuse(400, 'sign_in_expired', 'This sign-in has expired. Start again.');
  const body = await Api.body(request);
  const code = Api.text(body, 'code');
  if (!Sessions.sameState(attempt.state, body.state)) {
    const response = Api.refuse(400, 'state_mismatch', 'This sign-in was not started in this browser. Start again.');
    Sessions.forget(response);
    return response;
  }
  if (!code) return Api.refuse(400, 'missing_code', 'The HEVN window returned no sign-in code.');
  return Journal.run(attempt.sid, async () => {
    try {
      const client = await Partner.hevn.clients.link<Client>(code);
      if (!Sessions.CLIENT_ID.test(client.id)) return Api.refuse(502, 'invalid_client', 'HEVN answered without an account id.');
      const response = Api.json({ signedIn: true });
      Sessions.forget(response);
      Sessions.start(response, client.id, attempt.sid);
      return response;
    } catch (error) {
      const response = Api.failure(error);
      Sessions.forget(response);
      return response;
    }
  });
}
