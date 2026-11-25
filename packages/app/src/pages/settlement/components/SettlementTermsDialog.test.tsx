import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SETTLEMENT_STRATEGY, type SettlementTerms } from '@budgero/core/browser';
import { SettlementTermsDialog } from './SettlementTermsDialog';

const accountGroups = [
  {
    key: 'budget',
    heading: 'Budget accounts',
    items: [
      { id: 1, name: 'Kay Checking' },
      { id: 2, name: 'Franzi Checking' },
    ],
  },
];
const categoryGroups = [
  { key: 1, heading: 'Income', items: [{ id: 10, name: 'Salary' }] },
  { key: 2, heading: 'Home', items: [{ id: 20, name: 'Rent' }] },
];

const terms = (overrides: Partial<SettlementTerms> = {}): SettlementTerms => ({
  strategy: SETTLEMENT_STRATEGY.incomeWeighted,
  participants: [
    { id: 'kay', name: '  Kay ', accountIds: [1], customShareBasisPoints: 5_000 },
    { id: 'franzi', name: 'Franzi', accountIds: [2], customShareBasisPoints: 5_000 },
  ],
  incomeCategoryIds: [10],
  expenseCategoryIds: [20],
  ...overrides,
});

function renderDialog(
  initialTerms: SettlementTerms,
  dated = false,
  takenEffectiveDates: string[] = []
) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <SettlementTermsDialog
      open
      onOpenChange={() => {}}
      title="Settlement"
      initialTerms={initialTerms}
      dated={dated}
      takenEffectiveDates={takenEffectiveDates}
      accountGroups={accountGroups}
      categoryGroups={categoryGroups}
      onSave={onSave}
    />
  );
  return { onSave, user: userEvent.setup() };
}

describe('SettlementTermsDialog', () => {
  it('saves valid terms with trimmed names', async () => {
    const { onSave, user } = renderDialog(terms());

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].participants[0].name).toBe('Kay');
    expect(onSave.mock.calls[0][0].effectiveFrom).toBeUndefined();
  });

  it('lists what is missing instead of saving', async () => {
    const { onSave, user } = renderDialog(
      terms({
        participants: terms().participants.map((participant) => ({
          ...participant,
          accountIds: [],
        })),
        expenseCategoryIds: [],
      })
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText('Every participant needs at least one personal account.')
    ).toBeInTheDocument();
    expect(screen.getByText('Choose the categories of shared expenses.')).toBeInTheDocument();
  });

  it('asks for fixed shares that add up to 100 %', async () => {
    const { onSave, user } = renderDialog(terms());

    await user.click(screen.getByRole('radio', { name: /Fixed shares/ }));
    const [kayShare] = screen.getAllByLabelText('Share in %');
    await user.clear(kayShare);
    await user.type(kayShare, '60');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('The fixed shares must add up to 100 %.')).toBeInTheDocument();

    const [, franziShare] = screen.getAllByLabelText('Share in %');
    await user.clear(franziShare);
    await user.type(franziShare, '40');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(
      onSave.mock.calls[0][0].participants.map(
        (participant: { customShareBasisPoints: number }) => participant.customShareBasisPoints
      )
    ).toEqual([6_000, 4_000]);
  });

  it('saves a dated change from the first day of the picked month', async () => {
    const { onSave, user } = renderDialog(terms({ effectiveFrom: '2026-03-01' }), true);

    expect(screen.getByText('Applies from')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave.mock.calls[0][0].effectiveFrom).toBe('2026-03-01');
  });

  it('refuses a month another change already starts in', async () => {
    const { onSave, user } = renderDialog(terms({ effectiveFrom: '2026-03-01' }), true, [
      '2026-03-01',
    ]);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText('Another change already starts in this month. Edit that one instead.')
    ).toBeInTheDocument();
  });

  it('removes hidden characters from names before saving', async () => {
    const { onSave, user } = renderDialog(terms());

    const [kayName] = screen.getAllByPlaceholderText(/Participant \d/);
    await user.clear(kayName);
    await user.type(kayName, 'Ka\u200By');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave.mock.calls[0][0].participants[0].name).toBe('Kay');
  });

  it('accepts a decimal comma in shares', async () => {
    const { onSave, user } = renderDialog(terms({ strategy: SETTLEMENT_STRATEGY.custom }));

    const [kayShare, franziShare] = screen.getAllByLabelText('Share in %');
    await user.clear(kayShare);
    await user.type(kayShare, '62,5');
    await user.clear(franziShare);
    await user.type(franziShare, '37,5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      onSave.mock.calls[0][0].participants.map(
        (participant: { customShareBasisPoints: number }) => participant.customShareBasisPoints
      )
    ).toEqual([6_250, 3_750]);
  });

  it('removes a participant beyond the second', async () => {
    const { onSave, user } = renderDialog(terms());

    await user.click(screen.getByRole('button', { name: 'Add participant' }));
    const removeButtons = screen.getAllByRole('button', { name: 'Remove participant' });
    await user.click(removeButtons[2]);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave.mock.calls[0][0].participants).toHaveLength(2);
  });

  it('adds participants and keeps at least two', async () => {
    const { user } = renderDialog(terms());
    const removeButtons = () => screen.getAllByRole('button', { name: 'Remove participant' });

    expect(removeButtons().every((button) => button.hasAttribute('disabled'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Add participant' }));

    expect(screen.getAllByPlaceholderText(/Participant \d/)).toHaveLength(3);
    expect(removeButtons().some((button) => !button.hasAttribute('disabled'))).toBe(true);
  });
});
