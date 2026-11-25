import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SETTLEMENT_STRATEGY, type SettlementTerms } from '@budgero/core/browser';
import { SettlementTermsList } from './SettlementTermsList';

const participants = [
  { id: 'kay', name: 'Kay', accountIds: [1], customShareBasisPoints: 0 },
  { id: 'franzi', name: 'Franzi', accountIds: [2], customShareBasisPoints: 0 },
];
const initial: SettlementTerms = {
  strategy: SETTLEMENT_STRATEGY.incomeWeighted,
  participants,
  incomeCategoryIds: [10],
  expenseCategoryIds: [20],
};
const change: SettlementTerms = {
  ...initial,
  effectiveFrom: '2026-03-01',
  strategy: SETTLEMENT_STRATEGY.equal,
};

function renderList(canWrite = true) {
  const handlers = { onEdit: vi.fn(), onRemove: vi.fn(), onAddChange: vi.fn() };
  render(<SettlementTermsList terms={[initial, change]} canWrite={canWrite} {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
}

describe('SettlementTermsList', () => {
  it('lists the terms with their start, strategy and participants', () => {
    renderList();

    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('From the start');
    expect(first).toHaveTextContent('By income');
    expect(first).toHaveTextContent('Kay, Franzi');
    expect(second).toHaveTextContent('Equal split');
  });

  it('edits any terms but removes only dated changes', async () => {
    const { user, onEdit, onRemove } = renderList();
    const [first, second] = screen.getAllByRole('listitem');

    expect(within(first).queryByRole('button', { name: 'Remove change' })).toBeNull();
    await user.click(within(first).getByRole('button', { name: 'Edit terms' }));
    await user.click(within(second).getByRole('button', { name: 'Remove change' }));

    expect(onEdit).toHaveBeenCalledWith(initial);
    expect(onRemove).toHaveBeenCalledWith(change);
  });

  it('disables every change when the profile may not be written', () => {
    renderList(false);

    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
});
