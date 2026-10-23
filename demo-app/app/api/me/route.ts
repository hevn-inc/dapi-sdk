import type { Client } from '@hevn/dapi-sdk';

import { Api } from '@/lib/server/api';

export const GET = Api.authed(async ({ client }) => {
  const me = await client.clients.current<Client>();
  return { id: me.id, email: me.email ?? null, name: me.name ?? null, status: me.status, environment: client.environment.name };
});
