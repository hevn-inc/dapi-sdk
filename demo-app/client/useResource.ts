'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => Promise<T | null>;
}

/** Loads on mount and on `reload()`. Pass a stable function, such as one from `api`. */
export function useResource<T>(load: () => Promise<T>): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await load();
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
  }, [load]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { data, error, loading, reload };
}
