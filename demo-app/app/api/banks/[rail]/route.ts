import { Api } from '@/lib/server/api';

export const GET = Api.authed(async ({ client, params }) => client.banks.get(Api.rail(params.rail)));

export const POST = Api.authed(async ({ client, params, session }) => {
  const rail = Api.rail(params.rail);
  await client.banks.open({ rail }, { idempotencyKey: `neobank-rail-${session.clientId}-${rail}` });
  return client.banks.get(rail);
});
