import { cookies } from 'next/headers';

import { Bank } from '@/components/Bank';
import { Config } from '@/lib/server/config';
import { Sessions } from '@/lib/server/sessions';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const signedIn = Sessions.read(await cookies()) !== null;
  return <Bank signedIn={signedIn} appUrl={Config.appUrl} />;
}
