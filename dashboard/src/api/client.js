const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export async function apiFetch(path, params = {}) {
  const url = new URL(BASE + path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export async function apiPut(path, body) {
  const url = new URL(BASE + path, window.location.origin);
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export function sinceFromFilter(filter) {
  const today = new Date();
  if (filter === '7d') {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }
  if (filter === '30d') {
    return new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString().slice(0, 10);
  }
  if (filter === '90d') {
    const d = new Date(today);
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }
  return null; // 'All'
}
