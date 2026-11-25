import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  INITIAL_SETTLEMENT_TERMS_KEY,
  SETTLEMENT_STRATEGY,
  type SettlementTerms,
  type SettlementTermsConsent,
} from '@budgero/core/browser';
import { SettlementTermsList } from './SettlementTermsList';

const ALEX = 'user-alex';
const SAM = 'user-sam';
const CHANGE_DATE = '2026-03-01';

const participants = [
  { id: ALEX, name: 'Alex (saved)', accountIds: [1], customShareBasisPoints: 0 },
  { id: SAM, name: 'Sam', accountIds: [2], customShareBasisPoints: 0 },
];
const initial: SettlementTerms = {
  strategy: SETTLEMENT_STRATEGY.incomeWeighted,
  participants,
  incomeCategoryIds: [10],
  expenseCategoryIds: [20],
};
const change: SettlementTerms = {
  ...initial,
  effectiveFrom: CHANGE_DATE,
  strategy: SETTLEMENT_STRATEGY.equal,
};
const consentOf = (approvedBy: string[], fingerprint: string): SettlementTermsConsent => ({
  fingerprint,
  approvedBy,
  pendingFor: participants.map((p) => p.id).filter((id) => !approvedBy.includes(id)),
  approved: approvedBy.length === participants.length,
});
const consent = new Map([
  [INITIAL_SETTLEMENT_TERMS_KEY, consentOf([ALEX, SAM], 'a'.repeat(64))],
  [CHANGE_DATE, consentOf([SAM], 'b'.repeat(64))],
]);

function renderList({ canWrite = true, currentUserId = ALEX } = {}) {
  const handlers = {
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onAddChange: vi.fn(),
    onApprove: vi.fn(),
    onRevoke: vi.fn(),
  };
  render(
    <SettlementTermsList
      terms={[initial, change]}
      canWrite={canWrite}
      consent={consent}
      currentUserId={currentUserId}
      memberNames={new Map([[ALEX, 'Alex']])}
      approvalBusy={false}
      {...handlers}
    />
  );
  const [first, second] = screen
    .getAllByRole('listitem')
    .filter((item) => item.parentElement?.getAttribute('aria-label') !== 'Consent');
  return { ...handlers, first, second, user: userEvent.setup() };
}

describe('SettlementTermsList', () => {
  it('lists the terms with their start, strategy and who agreed', () => {
    const { first, second } = renderList();

    expect(first).toHaveTextContent('From the start');
    expect(first).toHaveTextContent('By income');
    expect(within(first).getByText('Alex')).toBeInTheDocument();
    expect(within(second).getByText('Equal split')).toBeInTheDocument();
    expect(within(second).getByText('Alex').nextElementSibling).toHaveTextContent(
      'has not agreed yet'
    );
    expect(within(second).getByText('Sam').nextElementSibling).toHaveTextContent('has agreed');
  });

  it('lets the signed-in participant agree or withdraw their own consent', async () => {
    const { first, second, user, onApprove, onRevoke } = renderList();

    await user.click(within(second).getByRole('button', { name: 'I agree to these terms' }));
    await user.click(within(first).getByRole('button', { name: 'Withdraw my consent' }));

    expect(onApprove).toHaveBeenCalledWith(consent.get(CHANGE_DATE));
    expect(onRevoke).toHaveBeenCalledWith(consent.get(INITIAL_SETTLEMENT_TERMS_KEY));
  });

  it('offers no consent buttons to members who do not take part', () => {
    renderList({ currentUserId: 'user-other' });

    expect(screen.queryByRole('button', { name: 'I agree to these terms' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Withdraw my consent' })).toBeNull();
  });

  it('edits any terms but removes only dated changes', async () => {
    const { first, second, user, onEdit, onRemove } = renderList();

    expect(within(first).queryByRole('button', { name: 'Remove change' })).toBeNull();
    await user.click(within(first).getByRole('button', { name: 'Edit terms' }));
    await user.click(within(second).getByRole('button', { name: 'Remove change' }));

    expect(onEdit).toHaveBeenCalledWith(initial);
    expect(onRemove).toHaveBeenCalledWith(change);
  });

  it('disables changes when the profile may not be written', () => {
    renderList({ canWrite: false });

    expect(screen.getByRole('button', { name: 'Add change' })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Edit terms' })) {
      expect(button).toBeDisabled();
    }
  });
});
