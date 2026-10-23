import { randomUUID } from 'node:crypto';

import { Api } from '@/lib/server/api';

export const POST = Api.authed(async ({ client, request }) => {
  const amount = Api.amount(Api.text(await Api.body(request), 'amount'), 0.1);
  return client.sandbox.deposit({ amount, token: 'USDC' }, { idempotencyKey: `neobank-deposit-${randomUUID()}` });
});
