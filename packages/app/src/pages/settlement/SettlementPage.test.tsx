import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  SETTLEMENT_PROFILE_FORMAT_VERSION,
  SETTLEMENT_PROFILE_STATUS,
  SETTLEMENT_STRATEGY,
  type SettlementProfile,
  type SettlementProfileStatus,
} from '@budgero/core/browser';
import SettlementPage from './SettlementPage';

const { profileState, settlementState, toast } = vi.hoisted(() => ({
  profileState: {
    profile: null as SettlementProfile | null,
    status: 'unset' as SettlementProfileStatus,
    loaded: true,
    canWrite: true,
    save: vi.fn(),
  },
  settlementState: {
    data: null as unknown,
    isError: false,
    isLoading: false,
  },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast }));
vi.mock('@entities/settlement/api/useSettlement', () => ({
  useSettlementProfile: () => profileState,
  useSettlement: () => settlementState,
}));
vi.mock('./useSettlementOptions', () => ({
  useSettlementOptions: () => ({
    accountGroups: [{ key: 'budget', heading: 'Budget accounts', items: [{ id: 1, name: 'A' }] }],
    categoryGroups: [{ key: 1, heading: 'Home', items: [{ id: 20, name: 'Rent' }] }],
    incomeCategoryIds: [10],
    isLoading: false,
  }),
}));
vi.mock('./components/SettlementSummary', () => ({
  SettlementSummary: () => <div>settlement summary</div>,
}));

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

function showProfile(status: SettlementProfileStatus = SETTLEMENT_PROFILE_STATUS.ready) {
  profileState.profile = profile;
  profileState.status = status;
  profileState.canWrite = status === SETTLEMENT_PROFILE_STATUS.ready;
}

beforeEach(() => {
  profileState.profile = null;
  profileState.status = SETTLEMENT_PROFILE_STATUS.unset;
  profileState.canWrite = true;
  profileState.save.mockReset().mockResolvedValue(true);
  settlementState.data = null;
  settlementState.isError = false;
  settlementState.isLoading = false;
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(cleanup);

describe('SettlementPage', () => {
  it('invites to set up a settlement when there is none', async () => {
    const user = userEvent.setup();
    render(<SettlementPage />);

    await user.click(screen.getByRole('button', { name: 'Set up settlement' }));

    expect(screen.getByRole('dialog', { name: 'Set up household settlement' })).toBeInTheDocument();
  });

  it('shows the settlement and the terms of a profile', () => {
    showProfile();
    settlementState.data = { participants: [] };
    render(<SettlementPage />);

    expect(screen.getByText('settlement summary')).toBeInTheDocument();
    expect(screen.getByText('From the start')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up settlement' })).toBeNull();
  });

  it('saves edited terms and confirms it', async () => {
    showProfile();
    const user = userEvent.setup();
    render(<SettlementPage />);

    await user.click(screen.getByRole('button', { name: 'Edit terms' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(profileState.save).toHaveBeenCalledWith(profile);
    expect(toast.success).toHaveBeenCalledWith('Settlement saved');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open and says so when the save is refused', async () => {
    showProfile();
    profileState.save.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<SettlementPage />);

    await user.click(screen.getByRole('button', { name: 'Edit terms' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(toast.error).toHaveBeenCalledWith('The settlement could not be saved here.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens a dated change from next month', async () => {
    showProfile();
    const user = userEvent.setup();
    render(<SettlementPage />);

    await user.click(screen.getByRole('button', { name: 'Add change' }));

    expect(screen.getByRole('dialog', { name: 'Add a change' })).toBeInTheDocument();
    expect(screen.getByText('Applies from')).toBeInTheDocument();
  });

  it('shows a damaged profile without letting it be changed', () => {
    showProfile(SETTLEMENT_PROFILE_STATUS.unreadable);
    render(<SettlementPage />);

    expect(screen.getByText(/could not be read, so it can't be changed here/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add change' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit terms' })).toBeDisabled();
  });

  it('explains a failed calculation', () => {
    showProfile();
    settlementState.isError = true;
    render(<SettlementPage />);

    expect(screen.getByText(/The settlement could not be calculated/)).toBeInTheDocument();
  });
});
