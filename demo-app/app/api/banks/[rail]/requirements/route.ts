import { Api } from '@/lib/server/api';

export const GET = Api.authed(async ({ client, params }) => client.banks.requirements(Api.rail(params.rail)));
