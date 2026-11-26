import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  asMilli,
  SETTLEMENT_STRATEGY,
  SETTLEMENT_WARNING,
  type SettlementResult,
} from '@budgero/core/browser';
import { SettlementSummary } from './SettlementSummary';

const money = (milli: number) => `€${(milli / 1000).toFixed(2)}`;
const SALARY = 10;
const RENT = 20;
const CATEGORY_NAMES = new Map([
  [SALARY, 'Salary'],
  [RENT, 'Rent'],
]);

const result = (overrides: Partial<SettlementResult> = {}): SettlementResult => ({
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  totalSharedExpenses: asMilli(1_500_000),
  totalEligibleIncome: asMilli(5_000_000),
  participants: [
    {
      participantId: 'alex',
      name: 'Alex',
      eligibleIncome: asMilli(3_000_000),
      sharedExpensesPaid: asMilli(1_000_000),
      targetContribution: asMilli(900_000),
      paymentsSent: asMilli(0),
      paymentsReceived: asMilli(0),
      paidForOthers: asMilli(0),
      paidByOthers: asMilli(0),
      netSettlement: asMilli(100_000),
      contributionShare: 0.6,
      incomeByCategory: [{ categoryId: SALARY, amount: asMilli(3_000_000) }],
      sharedExpensesByCategory: [{ categoryId: RENT, amount: asMilli(1_000_000) }],
      paidForOthersByCategory: [],
      paidByOthersByCategory: [],
    },
    {
      participantId: 'sam',
      name: 'Sam',
      eligibleIncome: asMilli(2_000_000),
      sharedExpensesPaid: asMilli(500_000),
      targetContribution: asMilli(600_000),
      paymentsSent: asMilli(0),
      paymentsReceived: asMilli(0),
      paidForOthers: asMilli(0),
      paidByOthers: asMilli(0),
      netSettlement: asMilli(-100_000),
      contributionShare: 0.4,
      incomeByCategory: [{ categoryId: SALARY, amount: asMilli(2_000_000) }],
      sharedExpensesByCategory: [{ categoryId: 99, amount: asMilli(500_000) }],
      paidForOthersByCategory: [],
      paidByOthersByCategory: [],
    },
  ],
  transfers: [{ fromParticipantId: 'sam', toParticipantId: 'alex', amount: asMilli(100_000) }],
  segments: [
    {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      strategy: SETTLEMENT_STRATEGY.incomeWeighted,
    },
  ],
  unapprovedSegments: [],
  warnings: [],
  ...overrides,
});

describe('SettlementSummary', () => {
  it('shows each participant with share, paid, fair share and balance', () => {
    render(<SettlementSummary result={result()} money={money} categoryNames={CATEGORY_NAMES} />);

    const alex = screen.getByRole('row', { name: /Alex/ });
    expect(within(alex).getByText('€3000.00')).toBeInTheDocument();
    expect(within(alex).getByText('60.0%')).toBeInTheDocument();
    expect(within(alex).getByText('€900.00')).toBeInTheDocument();
    expect(within(alex).getByText('€100.00')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Sam/ })).getByText('€-100.00')
    ).toBeInTheDocument();
    expect(screen.getByText('€1500.00')).toBeInTheDocument();
  });

  it('marks the signed-in member', () => {
    render(
      <SettlementSummary
        result={result()}
        money={money}
        categoryNames={CATEGORY_NAMES}
        currentUserId="sam"
      />
    );

    expect(within(screen.getByRole('row', { name: /Sam/ })).getByText('(you)')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Alex/ })).queryByText('(you)')).toBeNull();
  });

  it('opens what a participant paid and earned, category by category', async () => {
    const user = userEvent.setup();
    render(<SettlementSummary result={result()} money={money} categoryNames={CATEGORY_NAMES} />);

    const samToggle = screen.getByRole('button', { name: 'Sam' });
    expect(samToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(samToggle);

    expect(samToggle).toHaveAttribute('aria-expanded', 'true');
    const details = document.getElementById(samToggle.getAttribute('aria-controls')!)!;
    expect(within(details).getByText('Deleted category')).toBeInTheDocument();
    expect(within(details).getByText('Salary')).toBeInTheDocument();
    expect(within(details).getByText('€2000.00')).toBeInTheDocument();
    expect(screen.queryByText('Rent')).toBeNull();
  });

  it('says who pays whom', () => {
    render(<SettlementSummary result={result()} money={money} categoryNames={CATEGORY_NAMES} />);

    const transfer = screen.getByRole('listitem');
    expect(transfer).toHaveTextContent('Sam');
    expect(transfer).toHaveTextContent('pays');
    expect(transfer).toHaveTextContent('Alex');
    expect(transfer).toHaveTextContent('€100.00');
  });

  it('says when there is nothing to settle', () => {
    render(
      <SettlementSummary
        result={result({ transfers: [] })}
        money={money}
        categoryNames={CATEGORY_NAMES}
      />
    );

    expect(
      screen.getByText('Everyone has paid their share. Nothing to settle.')
    ).toBeInTheDocument();
  });

  it('does not call it even while nothing is agreed yet', () => {
    render(
      <SettlementSummary
        result={result({
          transfers: [],
          segments: [],
          unapprovedSegments: [{ startDate: '2026-01-01', endDate: '2026-01-31' }],
        })}
        money={money}
        categoryNames={CATEGORY_NAMES}
      />
    );

    expect(
      screen.getByText('Nothing to settle until everyone taking part has agreed to the terms.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Everyone has paid their share. Nothing to settle.')).toBeNull();
  });

  it('shows what was paid for each other only when someone did', async () => {
    const user = userEvent.setup();
    const HOBBY = 30;
    const base = result();
    const [alex, sam] = base.participants;
    const { rerender } = render(
      <SettlementSummary result={base} money={money} categoryNames={CATEGORY_NAMES} />
    );
    expect(screen.queryByText('Paid for each other')).toBeNull();

    rerender(
      <SettlementSummary
        result={{
          ...base,
          participants: [
            {
              ...alex,
              paidByOthers: asMilli(40_000),
              paidByOthersByCategory: [{ categoryId: HOBBY, amount: asMilli(40_000) }],
            },
            {
              ...sam,
              paidForOthers: asMilli(40_000),
              paidForOthersByCategory: [{ categoryId: HOBBY, amount: asMilli(40_000) }],
            },
          ],
        }}
        money={money}
        categoryNames={new Map([...CATEGORY_NAMES, [HOBBY, 'Hobby (Alex)']])}
      />
    );

    expect(screen.getByText('Paid for each other')).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Alex/ })).getByText('€-40.00')
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('row', { name: /Sam/ })).getByText('€40.00')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sam' }));
    expect(screen.getByText('Paid for others (back in full)')).toBeInTheDocument();
    expect(screen.getByText('Hobby (Alex)')).toBeInTheDocument();
  });

  it('explains an equal split for lack of income', () => {
    render(
      <SettlementSummary
        result={result({ warnings: [SETTLEMENT_WARNING.noIncomeSplitEqually] })}
        money={money}
        categoryNames={CATEGORY_NAMES}
      />
    );

    expect(screen.getByText(/so the shared expenses there are split equally/)).toBeInTheDocument();
  });

  it('offers to record each suggested payment only when it can be recorded', async () => {
    const onSettleUp = vi.fn();
    const { rerender } = render(
      <SettlementSummary result={result()} money={money} categoryNames={CATEGORY_NAMES} />
    );
    expect(screen.queryByRole('button', { name: 'Settle up' })).not.toBeInTheDocument();

    rerender(
      <SettlementSummary
        result={result()}
        money={money}
        categoryNames={CATEGORY_NAMES}
        onSettleUp={onSettleUp}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Settle up' }));

    expect(onSettleUp).toHaveBeenCalledWith(result().transfers[0]);
  });
});
