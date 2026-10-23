import { Api } from '@/lib/server/api';

export const GET = Api.authed(async ({ client }) => client.clients.balance());
