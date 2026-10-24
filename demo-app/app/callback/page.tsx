'use client';

import { HevnConnect } from '@hevn/dapi-sdk/browser';
import { useEffect, useState } from 'react';

export default function Callback() {
  const [message, setMessage] = useState('Finishing up…');

  useEffect(() => {
    setMessage(HevnConnect.complete() ? 'All done. You can close this window.' : 'There is nothing to finish here.');
  }, []);

  return (
    <main className="callback">
      <span className="wordmark">Acme Pay</span>
      <p>{message}</p>
    </main>
  );
}
