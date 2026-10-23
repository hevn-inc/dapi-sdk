import { Api } from '@/lib/server/api';

export const GET = Api.authed(async ({ client, params }) => client.payouts.get(Api.payoutId(params.id)));
