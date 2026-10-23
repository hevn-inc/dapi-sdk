'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Backend } from './backend';

export interface Resource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => Promise<T | null>;
}

export function useResource<T>(path: string): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await Backend.get<T>(path);
      if (alive.current) {
        setData(fresh);
        setError(null);
      }
      return fresh;
    } catch (failure) {
      if (alive.current) setError(failure);
      return null;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { data, error, loading, reload };
}
