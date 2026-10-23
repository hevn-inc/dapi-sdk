'use client';

import { useCallback, useEffect, useState } from 'react';

import { Backend } from '@/lib/client/backend';

import { Dashboard } from './Dashboard';
import { SignIn } from './SignIn';

export function Bank({ signedIn: initial, appUrl }: { signedIn: boolean; appUrl: string }) {
  const [signedIn, setSignedIn] = useState(initial);

  useEffect(() => {
    const out = () => setSignedIn(false);
    window.addEventListener(Backend.SIGNED_OUT, out);
    return () => window.removeEventListener(Backend.SIGNED_OUT, out);
  }, []);

  const signOut = useCallback(async () => {
    await Backend.post('/api/auth/logout').catch(() => undefined);
    setSignedIn(false);
  }, []);

  return signedIn ? <Dashboard appUrl={appUrl} onSignOut={signOut} /> : <SignIn appUrl={appUrl} onSignedIn={() => setSignedIn(true)} />;
}
