import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  INITIAL_SETTLEMENT_TERMS_KEY,
  SETTLEMENT_PROFILE_FORMAT_VERSION,
  SETTLEMENT_PROFILE_STATUS,
  SETTLEMENT_STRATEGY,
  type SettlementProfile,
  type SettlementProfileStatus,
  type SettlementTermsConsent,
} from '@budgero/core/browser';
import type { SettlementMember } from './useSettlementMembers';
import SettlementPage from './SettlementPage';

const ALEX = 'user-alex';
const SAM = 'user-sam';
const SAVED_FINGERPRINT = 'f'.repeat(64);
const OLD_FINGERPRINT = 'a'.repeat(64);

const { profileState, settlementState, consentState, membership, actions, toast } = vi.hoisted(
  () => ({
    profileState: {
      profile: null as SettlementProfile | null,
      status: 'unset' as SettlementProfileStatus,
      loaded: true,
      canWrite: true,
      save: vi.fn(),
    },
    settlementState: { data: null as unknown, isError: false, isLoading: false },
    consentState: {
      byTerms: new Map<string, SettlementTermsConsent>(),
      approvedTermsKeys: [] as string[],
      ready: true,
      isError: false,
    },
    membership: {
      members: [] as SettlementMember[],
      memberIds: new Set<string>(),
      currentUserId: 'user-alex' as string | null,
      isLoading: false,
      isError: false,
    },
    actions: {
      approve: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
      revoke: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    },
    toast: { success: vi.fn(), error: vi.fn() },
  })
);

vi.mock('sonner', () => ({ toast }));
vi.mock('@entities/settlement/api/useSettlement', () => ({
  useSettlementProfile: () => profileState,
  useSettlement: () => settlementState,
}));
vi.mock('@entities/settlement/api/useSettlementConsent', () => ({
  useSettlementConsent: () => consentState,
  useSettlementApprovalActions: () => actions,
  fingerprintOf: () => Promise.resolve('f'.repeat(64)),
}));
vi.mock('./useSettlementMembers', () => ({ useSettlementMembers: () => membership }));
vi.mock('./useSettlementOptions', () => ({
  useSettlementOptions: () => ({
    accountGroups: [
      {
        key: 'budget',
        heading: 'Budget accounts',
        items: [
          { id: 1, name: 'A' },
          { id: 2, name: 'B' },
        ],
      },
    ],
    categoryGroups: [{ key: 1, heading: 'Home', items: [{ id: 20, name: 'Rent' }] }],
    incomeCategoryIds: [10],
    isLoading: false,
  }),
}));
vi.mock('./components/SettlementSummary', () => ({
  SettlementSummary: () => <div>settlement summary</div>,
}));

const members: SettlementMember[] = [
  { id: ALEX, name: 'Alex' },
  { id: SAM, name: 'Sam' },
];

const profile: SettlementProfile = {
  formatVersion: SETTLEMENT_PROFILE_FORMAT_VERSION,
  approvalKey: 'ab'.repeat(32),
  terms: [
    {
      strategy: SETTLEMENT_STRATEGY.equal,
      participants: [
        { id: ALEX, name: 'Alex', accountIds: [1], customShareBasisPoints: 0 },
        { id: SAM, name: 'Sam', accountIds: [2], customShareBasisPoints: 0 },
      ],
      incomeCategoryIds: [],
      expenseCategoryIds: [20],
    },
  ],
};

function showProfile(status: SettlementProfileStatus = SETTLEMENT_PROFILE_STATUS.ready) {
  profileState.profile = profile;
  profileState.status = status;
  profileState.canWrite = status === SETTLEMENT_PROFILE_STATUS.ready;
  consentState.byTerms = new Map([
    [
      INITIAL_SETTLEMENT_TERMS_KEY,
      { fingerprint: OLD_FINGERPRINT, approvedBy: [ALEX], pendingFor: [SAM], approved: false },
    ],
  ]);
}

function renderPage() {
  render(
    <MemoryRouter>
      <SettlementPage />
    </MemoryRouter>
  );
  return userEvent.setup();
}

beforeEach(() => {
  profileState.profile = null;
  profileState.status = SETTLEMENT_PROFILE_STATUS.unset;
  profileState.canWrite = true;
  profileState.save.mockReset().mockResolvedValue(true);
  settlementState.data = null;
  settlementState.isError = false;
  settlementState.isLoading = false;
  consentState.byTerms = new Map();
  consentState.isError = false;
  membership.members = members;
  membership.currentUserId = ALEX;
  for (const action of [actions.approve, actions.revoke]) {
    action.mutate.mockReset();
    action.mutateAsync.mockReset().mockResolvedValue(undefined);
  }
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(cleanup);

describe('SettlementPage', () => {
  it('sets up a settlement with the members of the workspace', async () => {
    const user = renderPage();

    await user.click(screen.getByRole('button', { name: 'Set up settlement' }));

    expect(screen.getByRole('dialog', { name: 'Set up household settlement' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove participant' })).toHaveLength(2);
  });

  it('asks to invite the others first when nobody else is in the workspace', () => {
    membership.members = [members[0]];
    renderPage();

    expect(screen.getByText(/needs their own Budgero login/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up settlement' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Workspaces' })).toHaveAttribute(
      'href',
      '/settings/workspaces'
    );
  });

  it('shows the settlement, the terms and who still has to agree', () => {
    showProfile();
    settlementState.data = {
      participants: [],
      unapprovedSegments: [{ startDate: '2026-01-01', endDate: '2026-01-31' }],
    };
    renderPage();

    expect(screen.getByText('settlement summary')).toBeInTheDocument();
    expect(screen.getByText('From the start')).toBeInTheDocument();
    expect(screen.getByText(/Not everyone has agreed to the terms/)).toBeInTheDocument();
  });

  it('saving terms records the saver’s consent and withdraws it from the old version', async () => {
    showProfile();
    const user = renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit terms' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(profileState.save).toHaveBeenCalledWith(profile);
    expect(actions.approve.mutateAsync).toHaveBeenCalledWith(SAVED_FINGERPRINT);
    expect(actions.revoke.mutateAsync).toHaveBeenCalledWith(OLD_FINGERPRINT);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open and says so when the save is refused', async () => {
    showProfile();
    profileState.save.mockResolvedValue(false);
    const user = renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit terms' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(toast.error).toHaveBeenCalledWith('The settlement could not be saved here.');
    expect(actions.approve.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lets a participant agree from their own login', async () => {
    showProfile();
    membership.currentUserId = SAM;
    const user = renderPage();

    await user.click(screen.getByRole('button', { name: 'I agree to these terms' }));

    expect(actions.approve.mutate).toHaveBeenCalledWith(OLD_FINGERPRINT, expect.anything());
  });

  it('shows a damaged profile without letting it be changed', () => {
    showProfile(SETTLEMENT_PROFILE_STATUS.unreadable);
    renderPage();

    expect(screen.getByText(/could not be read, so it can't be changed here/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add change' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit terms' })).toBeDisabled();
  });

  it('explains a failed calculation and unavailable consents', () => {
    showProfile();
    settlementState.isError = true;
    consentState.isError = true;
    renderPage();

    expect(screen.getByText(/The settlement could not be calculated/)).toBeInTheDocument();
    expect(screen.getByText(/The consents could not be loaded/)).toBeInTheDocument();
  });
});
