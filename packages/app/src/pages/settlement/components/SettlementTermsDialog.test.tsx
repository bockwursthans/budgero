import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SETTLEMENT_STRATEGY, type SettlementTerms } from '@budgero/core/browser';
import type { SettlementMember } from '../useSettlementMembers';
import { SettlementTermsDialog } from './SettlementTermsDialog';

const ALEX = 'user-alex';
const SAM = 'user-sam';
const FLATMATE = 'user-flatmate';

const accountGroups = [
  {
    key: 'budget',
    heading: 'Budget accounts',
    items: [
      { id: 1, name: 'Alex Checking' },
      { id: 2, name: 'Sam Checking' },
      { id: 3, name: 'Flatmate Checking' },
    ],
  },
];
const categoryGroups = [
  { key: 1, heading: 'Income', items: [{ id: 10, name: 'Salary' }] },
  { key: 2, heading: 'Home', items: [{ id: 20, name: 'Rent' }] },
  { key: 3, heading: 'Own', items: [{ id: 30, name: 'Hobby' }] },
];
const twoMembers: SettlementMember[] = [
  { id: ALEX, name: 'Alex' },
  { id: SAM, name: 'Sam' },
];

const terms = (overrides: Partial<SettlementTerms> = {}): SettlementTerms => ({
  strategy: SETTLEMENT_STRATEGY.incomeWeighted,
  participants: [
    { id: ALEX, name: 'Old name', accountIds: [1], customShareBasisPoints: 5_000 },
    { id: SAM, name: 'Sam', accountIds: [2], customShareBasisPoints: 5_000 },
  ],
  incomeCategoryIds: [10],
  expenseCategoryIds: [20],
  ...overrides,
});

function renderDialog(
  initialTerms: SettlementTerms,
  {
    dated = false,
    takenEffectiveDates = [] as string[],
    members = twoMembers,
  }: { dated?: boolean; takenEffectiveDates?: string[]; members?: SettlementMember[] } = {}
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
      members={members}
      accountGroups={accountGroups}
      categoryGroups={categoryGroups}
      onSave={onSave}
    />
  );
  return { onSave, user: userEvent.setup() };
}

const savedTerms = (onSave: ReturnType<typeof vi.fn>): SettlementTerms =>
  onSave.mock.calls[0][0] as SettlementTerms;

// The category pickers are cmdk lists, which measure themselves (jsdom has no ResizeObserver).
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}

    unobserve() {}

    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollIntoView ??= () => {};
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('SettlementTermsDialog', () => {
  it('saves valid terms with the members’ current names', async () => {
    const { onSave, user } = renderDialog(terms());

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(savedTerms(onSave).participants.map((p) => [p.id, p.name])).toEqual([
      [ALEX, 'Alex'],
      [SAM, 'Sam'],
    ]);
    expect(savedTerms(onSave).effectiveFrom).toBeUndefined();
    expect(savedTerms(onSave).participants[0]).not.toHaveProperty('personalCategoryIds');
  });

  /** Each participant's personal-categories picker, in participant order (none chosen yet). */
  const personalPickers = () => screen.getAllByRole('button', { name: 'None selected' });

  it('saves a participant’s personal categories', async () => {
    const { onSave, user } = renderDialog(terms());

    await user.click(personalPickers()[0]);
    await user.click(await screen.findByRole('option', { name: 'Hobby' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const [alex, sam] = savedTerms(onSave).participants;
    expect(alex.personalCategoryIds).toEqual([30]);
    expect(sam).not.toHaveProperty('personalCategoryIds');
  });

  it('refuses a personal category that is also shared', async () => {
    const { onSave, user } = renderDialog(terms());

    await user.click(personalPickers()[1]);
    await user.click(await screen.findByRole('option', { name: 'Rent' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "A personal category belongs to one person only and can't also be shared or count as income."
      )
    ).toBeInTheDocument();
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

  it('refuses someone who is no longer in the workspace', async () => {
    const { onSave, user } = renderDialog(terms(), { members: [twoMembers[0]] });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText('Every participant must be a Budgero user in this workspace.')
    ).toBeInTheDocument();
  });

  it('asks for fixed shares that add up to 100 %, decimal comma included', async () => {
    const { onSave, user } = renderDialog(terms());

    await user.click(screen.getByRole('radio', { name: /Fixed shares/ }));
    const [alexShare, samShare] = screen.getAllByLabelText('Share in %');
    await user.clear(alexShare);
    await user.type(alexShare, '62,5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('The fixed shares must add up to 100 %.')).toBeInTheDocument();

    await user.clear(samShare);
    await user.type(samShare, '37,5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(savedTerms(onSave).participants.map((p) => p.customShareBasisPoints)).toEqual([
      6_250, 3_750,
    ]);
  });

  it('saves a dated change from the first day of the picked month', async () => {
    const { onSave, user } = renderDialog(terms({ effectiveFrom: '2026-03-01' }), { dated: true });

    expect(screen.getByText('Applies from')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(savedTerms(onSave).effectiveFrom).toBe('2026-03-01');
  });

  it('refuses a month another change already starts in', async () => {
    const { onSave, user } = renderDialog(terms({ effectiveFrom: '2026-03-01' }), {
      dated: true,
      takenEffectiveDates: ['2026-03-01'],
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText('Another change already starts in this month. Edit that one instead.')
    ).toBeInTheDocument();
  });

  it('adds only members who are not taking part yet, and keeps at least two', async () => {
    const { user } = renderDialog(terms(), {
      members: [...twoMembers, { id: FLATMATE, name: 'Flatmate' }],
    });
    const removeButtons = () => screen.getAllByRole('button', { name: 'Remove participant' });
    const addButton = () => screen.getByRole('button', { name: 'Add participant' });

    expect(removeButtons().every((button) => button.hasAttribute('disabled'))).toBe(true);
    await user.click(addButton());

    expect(removeButtons()).toHaveLength(3);
    expect(addButton()).toBeDisabled();
    expect(screen.getByText(/Everyone in this workspace takes part/)).toBeInTheDocument();
    expect(removeButtons().some((button) => !button.hasAttribute('disabled'))).toBe(true);
  });
});
