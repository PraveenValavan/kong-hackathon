import { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiPut, sinceFromFilter } from './client';

function useQuery(path, params, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(path, params)
      .then(d => { if (!cancelled) { setData(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

export function useDashboard(timeFilter, department) {
  const since = sinceFromFilter(timeFilter);
  return useQuery('/usage/dashboard', { since, department }, [since, department]);
}

export function useEvents(timeFilter, provider, limit = 100) {
  const since = sinceFromFilter(timeFilter);
  return useQuery('/usage/events', { since, limit, provider }, [since, provider, limit]);
}

export function useSummary(timeFilter, groupBy = 'user_id') {
  const since = sinceFromFilter(timeFilter);
  return useQuery('/usage/summary', { since, group_by: groupBy }, [since, groupBy]);
}

export function useDeptCost(timeFilter) {
  const since = sinceFromFilter(timeFilter);
  return useQuery('/usage/cost/by-department', { since }, [since]);
}

export function useForecast(department) {
  return useQuery('/forecast', { department: department || undefined }, [department]);
}

export function useTeamConfigs() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/config/teams')
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (teamId, updates) => {
    const updated = await apiPut(`/config/teams/${teamId}`, updates);
    setData(prev => prev.map(t => t.team_id === teamId ? updated : t));
    return updated;
  }, []);

  return { data, loading, error, reload: load, save };
}

export function useModels() {
  return useQuery('/config/models', {}, []);
}
