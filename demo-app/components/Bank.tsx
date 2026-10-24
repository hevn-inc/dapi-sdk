'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '@/client/api';

import { Dashboard } from './Dashboard';
import { SignIn } from './SignIn';

export function Bank({ signedIn: initial, appUrl }: { signedIn: boolean; appUrl: string }) {
  const [signedIn, setSignedIn] = useState(initial);

  useEffect(() => api.onSignedOut(() => setSignedIn(false)), []);

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => undefined);
    setSignedIn(false);
  }, []);

  return signedIn ? <Dashboard appUrl={appUrl} onSignOut={signOut} /> : <SignIn appUrl={appUrl} onSignedIn={() => setSignedIn(true)} />;
}
