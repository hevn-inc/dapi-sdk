import { Api } from '@/lib/server/api';
import { Onboarding } from '@/lib/server/onboarding';

export const maxDuration = 60;

export const POST = Api.authed(async ({ client }) => (await Onboarding.for(client)).run());
