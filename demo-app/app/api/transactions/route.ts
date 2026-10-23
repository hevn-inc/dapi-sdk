import { Api } from '@/lib/server/api';

export const GET = Api.authed(async ({ client }) => client.transactions.list({ limit: 15 }));
