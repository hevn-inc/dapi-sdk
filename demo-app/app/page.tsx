import { cookies } from 'next/headers';

import { Bank } from '@/components/Bank';

import { config } from './api/config';
import { session } from './api/cookies';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const signedIn = session.read(await cookies()) !== null;
  return <Bank signedIn={signedIn} appUrl={config.appUrl} />;
}
