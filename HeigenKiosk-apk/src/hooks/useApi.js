// src/hooks/useApi.js
// ─────────────────────────────────────────────────────────────────────────────
// Generic hook for any async API call.
// Usage:
//   const { data, loading, error, refetch } = useApi(fetchPackages, [category])
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';

export function useApi(fetchFn, args = [], options = {}) {
  const { enabled = true, initialData = null } = options;
  const [data, setData]       = useState(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError]     = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const execute = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn(...args);
      if (mountedRef.current) {
        setData(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message || 'An error occurred');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [fetchFn, JSON.stringify(args), enabled]); // eslint-disable-line

  useEffect(() => {
    execute();
  }, [execute]);

  return { data, loading, error, refetch: execute };
}

// ─── Mutation hook for POST/PATCH calls ───────────────────────────────────────
export function useMutation(mutateFn) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const mutate = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutateFn(...args);
      return result;
    } catch (err) {
      const msg = err.message || 'Request failed';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [mutateFn]);

  return { mutate, loading, error };
}
