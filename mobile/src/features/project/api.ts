import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { KEYS, pKey, projectPath } from '../../api/hooks';
import type {
  Benchmarks,
  Calculation,
  CalculatorDef,
  Category,
  Compare,
  Dashboard,
  Diff,
  Pointers,
  Project,
  Rate,
  Revision,
  RevisionDetail,
  Room,
  Scenario,
} from './types';

/**
 * Data hooks for the estimating screens. Keys: `['projects', status]` for the
 * list (shared with app/index.tsx) and `pKey(id, …)` for everything inside a
 * project, so one invalidation refreshes a whole project.
 */

export type ProjectStatus = 'active' | 'archived' | 'deleted';

export function useProjects(status: ProjectStatus, q = '') {
  return useQuery<{ items: Project[]; limits: { active_projects: number; used: number } | null }, ApiError>({
    queryKey: [...KEYS.projects, status, q],
    queryFn: async () => {
      const env = await api.envelope<Project[]>('/projects', { status, q: q || undefined });
      return { items: env.data ?? [], limits: (env.meta?.limits as { active_projects: number; used: number } | undefined) ?? null };
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery<Project, ApiError>({ queryKey: pKey(id, 'project'), queryFn: () => api.get<Project>(projectPath(id!)), enabled: Boolean(id) });
}

export function useDashboard(id: string | undefined) {
  return useQuery<Dashboard, ApiError>({ queryKey: pKey(id, 'dashboard'), queryFn: () => api.get<Dashboard>(projectPath(id!, 'dashboard')), enabled: Boolean(id) });
}

export function useCategories(id: string | undefined) {
  return useQuery<Category[], ApiError>({ queryKey: pKey(id, 'categories'), queryFn: () => api.get<Category[]>(projectPath(id!, 'categories')), enabled: Boolean(id) });
}

export function useRooms(id: string | undefined) {
  return useQuery<Room[], ApiError>({ queryKey: pKey(id, 'rooms'), queryFn: () => api.get<Room[]>(projectPath(id!, 'rooms')), enabled: Boolean(id) });
}

export function useRevisions(id: string | undefined) {
  return useQuery<{ revisions: Revision[]; pointers: Pointers }, ApiError>({
    queryKey: pKey(id, 'revisions'),
    queryFn: () => api.get(projectPath(id!, 'estimates')),
    enabled: Boolean(id),
  });
}

export function useRevision(id: string | undefined, revisionId: string | null | undefined) {
  return useQuery<RevisionDetail, ApiError>({
    queryKey: pKey(id, 'revision', revisionId),
    queryFn: () => api.get<RevisionDetail>(projectPath(id!, `estimates/${revisionId}`)),
    enabled: Boolean(id && revisionId),
  });
}

export function useDiff(id: string | undefined, from: string | undefined, to: string | undefined) {
  return useQuery<Diff, ApiError>({
    queryKey: pKey(id, 'diff', from, to),
    queryFn: () => api.get<Diff>(projectPath(id!, 'estimate-diff'), { from, to }),
    enabled: Boolean(id && from && to),
  });
}

export function useScenarios(id: string | undefined) {
  return useQuery<Scenario[], ApiError>({ queryKey: pKey(id, 'scenarios'), queryFn: () => api.get<Scenario[]>(projectPath(id!, 'scenarios')), enabled: Boolean(id) });
}

export function useCompare(id: string | undefined, scenarioId: string | undefined, against: 'baseline' | 'current') {
  return useQuery<Compare, ApiError>({
    queryKey: pKey(id, 'compare', scenarioId, against),
    queryFn: () => api.get<Compare>(projectPath(id!, `scenarios/${scenarioId}/compare`), { against }),
    enabled: Boolean(id && scenarioId),
  });
}

export function useCalculations(id: string | undefined) {
  return useQuery<Calculation[], ApiError>({ queryKey: pKey(id, 'calculations'), queryFn: () => api.get<Calculation[]>(projectPath(id!, 'calculations')), enabled: Boolean(id) });
}

export function useCalculators() {
  return useQuery<CalculatorDef[], ApiError>({ queryKey: ['global', 'calculators'], queryFn: () => api.get<CalculatorDef[]>('/calculators'), staleTime: 3600_000 });
}

export function usePrivateRates(category?: string) {
  return useQuery<Rate[], ApiError>({ queryKey: ['global', 'rates', 'private', category ?? ''], queryFn: () => api.get<Rate[]>('/rates/private', { category }) });
}

export function useBenchmarks(country: string | undefined, regionId: string | null | undefined, currency?: string) {
  return useQuery<Benchmarks, ApiError>({
    queryKey: ['global', 'rates', 'benchmarks', country, regionId ?? '', currency ?? ''],
    queryFn: () => api.get<Benchmarks>('/rates/benchmarks', { country, region_id: regionId ?? undefined, currency }),
    enabled: Boolean(country),
  });
}

/** Refresh everything inside one project (and the list's summary figures). */
export function refreshProject(qc: QueryClient, id: string) {
  void qc.invalidateQueries({ queryKey: ['p', id] });
  void qc.invalidateQueries({ queryKey: [...KEYS.projects] });
}

export function useRefreshProject(id: string | undefined) {
  const qc = useQueryClient();
  return () => {
    if (id) refreshProject(qc, id);
  };
}

/**
 * The draft to write into: the existing draft, or a new one forked from the
 * current (or newest saved) revision. Handles DRAFT_EXISTS from a race by
 * using the draft the server names.
 */
export async function ensureDraft(projectId: string): Promise<string> {
  const { revisions, pointers } = await api.get<{ revisions: Revision[]; pointers: Pointers }>(projectPath(projectId, 'estimates'), { kind: 'current' });
  if (pointers.draft_revision_id) return pointers.draft_revision_id;
  const source = pointers.current_revision_id ?? revisions.find((r) => r.kind === 'current' && r.status === 'frozen')?.id;
  if (!source) throw new ApiError('NO_ESTIMATE', 'This project has no estimate yet.', 409);
  try {
    const created = await api.post<Revision>(projectPath(projectId, 'estimates'), { source_revision_id: source });
    return created.id;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'DRAFT_EXISTS') {
      const named = error.fieldMessage('draft_revision_id');
      if (named && /^[0-9a-f-]{36}$/i.test(named)) return named;
      const again = await api.get<{ pointers: Pointers }>(projectPath(projectId, 'estimates'), { kind: 'current' });
      if (again.pointers.draft_revision_id) return again.pointers.draft_revision_id;
    }
    throw error;
  }
}
