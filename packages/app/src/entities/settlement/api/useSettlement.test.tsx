import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  SETTLEMENT_PROFILE_FORMAT_VERSION,
  SETTLEMENT_PROFILE_KEY,
  SETTLEMENT_PROFILE_STATUS,
  SETTLEMENT_STRATEGY,
  type SettlementProfile,
} from '@budgero/core/browser';
import { setDemoSpaceId } from '@shared/lib/demo-space';
import { useSettlement, useSettlementProfile } from './useSettlement';

const { store, calls, calculate } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  calls: [] as { op: string; payload: Record<string, unknown> }[],
  calculate: vi.fn(),
}));

const runtime = {
  services: () => ({
    syncedState: { get: (scope: string, key: string) => store.get(`${scope}|${key}`) },
    budgets: { getAllBudgets: () => [{ ID: 1 }] },
    accounts: { listAccounts: () => [{ Metadata: '{}' }] },
    settlement: { calculate },
  }),
  getActiveSpaceId: () => 'space-1',
  isInitialized: () => true,
  executeMutation: async (spec: { op: string; payload: Record<string, unknown> }) => {
    calls.push(spec);
    const { scope, key, value } = spec.payload as { scope: string; key: string; value: unknown };
    store.set(`${scope}|${key}`, value);
    await client.invalidateQueries({ queryKey: ['syncedState'] });
    return { result: undefined };
  },
};

vi.mock('@shared/runtime/global', () => ({ getRuntime: () => runtime }));
vi.mock('@shared/runtime/runtime-provider', () => ({
  useRuntime: () => runtime,
  useRuntimeInitialized: () => true,
  useRuntimeState: () => 'Ready',
  useActiveSpaceId: () => 'space-1',
}));

const STORE_KEY = `budget:1|${SETTLEMENT_PROFILE_KEY}`;

const profile: SettlementProfile = {
  formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION,
  terms: [
    {
      strategy: SETTLEMENT_STRATEGY.equal,
      participants: [
        { id: 'kay', name: 'Kay', accountIds: [1], customShareBasisPoints: 0 },
        { id: 'franzi', name: 'Franzi', accountIds: [2], customShareBasisPoints: 0 },
      ],
      incomeCategoryIds: [],
      expenseCategoryIds: [20],
    },
  ],
};

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  localStorage.clear();
  setDemoSpaceId(null);
  store.clear();
  calls.length = 0;
  calculate.mockReset();
});

describe('useSettlementProfile', () => {
  it('reads the budget profile from the synced store', async () => {
    store.set(STORE_KEY, profile);
    const { result } = renderHook(() => useSettlementProfile(1), { wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.profile).toEqual(profile);
    expect(result.current.canWrite).toBe(true);
    expect(calls).toEqual([]);
  });

  it('saves through the synced state op', async () => {
    const { result } = renderHook(() => useSettlementProfile(1), { wrapper });
    await waitFor(() => expect(result.current.canWrite).toBe(true));

    await act(async () => {
      await result.current.save(profile);
    });

    expect(calls).toEqual([
      expect.objectContaining({
        op: 'syncedState.set',
        payload: { scope: 'budget:1', key: SETTLEMENT_PROFILE_KEY, value: profile },
      }),
    ]);
    await waitFor(() => expect(result.current.profile).toEqual(profile));
  });

  it('keeps a profile from a newer build read-only', async () => {
    store.set(STORE_KEY, { formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION + 1, terms: [] });
    const { result } = renderHook(() => useSettlementProfile(1), { wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.profile).toBeNull();
    expect(result.current.status).toBe(SETTLEMENT_PROFILE_STATUS.newerFormat);
    expect(result.current.canWrite).toBe(false);
  });

  it('shows a damaged profile read-only instead of cleaning it up', async () => {
    const damaged = {
      ...profile,
      terms: [
        ...profile.terms,
        { ...profile.terms[0], strategy: 'unknown', effectiveFrom: '2026-02-01' },
      ],
    };
    store.set(STORE_KEY, damaged);
    const { result } = renderHook(() => useSettlementProfile(1), { wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.profile).toEqual(profile);
    expect(result.current.status).toBe(SETTLEMENT_PROFILE_STATUS.unreadable);
    expect(result.current.canWrite).toBe(false);
  });

  it('writes nothing in the demo workspace', async () => {
    setDemoSpaceId('space-1');
    const { result } = renderHook(() => useSettlementProfile(1), { wrapper });

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canWrite).toBe(false);
    await act(async () => {
      expect(await result.current.save(profile)).toBe(false);
    });
    expect(calls).toEqual([]);
  });
});

describe('useSettlement', () => {
  it('settles the range with the profile', async () => {
    calculate.mockReturnValue({ participants: [] });
    const { result } = renderHook(() => useSettlement(1, profile, '2026-01-01', '2026-01-31'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual({ participants: [] }));
    expect(calculate).toHaveBeenCalledWith(1, profile, '2026-01-01', '2026-01-31');
  });

  it('stays idle without a profile or a range', () => {
    renderHook(() => useSettlement(1, null, '2026-01-01', '2026-01-31'), { wrapper });
    renderHook(() => useSettlement(1, profile, '', ''), { wrapper });

    expect(calculate).not.toHaveBeenCalled();
  });
});
