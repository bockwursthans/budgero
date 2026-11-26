import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  asMilli,
  SETTLEMENT_PROGRESS_STATUS,
  type SettlementProgress,
} from '@budgero/core/browser';
import { SettlementProgressCard } from './SettlementProgressCard';

const { settled, partly, open } = SETTLEMENT_PROGRESS_STATUS;
const names = new Map([
  ['alex', 'Alex'],
  ['sam', 'Sam'],
]);
const money = (milli: number) => `€${(milli / 1000).toFixed(2)}`;

const progress = (overrides: Partial<SettlementProgress> = {}): SettlementProgress => ({
  months: [
    { month: '2026-01', status: settled },
    { month: '2026-02', status: partly },
    { month: '2026-03', status: open },
  ],
  settledThrough: '2026-01',
  personalItems: [],
  ...overrides,
});

const renderCard = (value: SettlementProgress) =>
  render(
    <SettlementProgressCard
      progress={value}
      names={names}
      categoryName={() => 'Dining out'}
      money={money}
    />
  );

describe('SettlementProgressCard', () => {
  it('says how far the payments reach and lists the months on request', async () => {
    renderCard(progress());

    expect(screen.getByText(/Settled through January 2026; February 2026 partly/)).toBeVisible();
    expect(screen.queryByText('March 2026')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Months' }));

    const march = screen.getByText('March 2026').closest('li')!;
    expect(within(march).getByText('Open')).toBeInTheDocument();
  });

  it('tells when everything or nothing is settled', () => {
    const { unmount } = renderCard(
      progress({
        months: [{ month: '2026-01', status: settled }],
      })
    );
    expect(screen.getByText('Everything is settled.')).toBeInTheDocument();
    unmount();

    renderCard(
      progress({ months: [{ month: '2026-01', status: open }], settledThrough: undefined })
    );
    expect(screen.getByText('Nothing settled yet.')).toBeInTheDocument();
  });

  it('lists what was paid for each other with its status', () => {
    renderCard(
      progress({
        personalItems: [
          {
            transactionId: 7,
            date: '2026-02-10',
            categoryId: 30,
            payee: 'Restaurant',
            memo: 'Birthday',
            paidById: 'alex',
            ownerId: 'sam',
            amount: asMilli(50_000),
            status: partly,
          },
        ],
      })
    );

    const row = screen.getByRole('row', { name: /Dining out/ });
    expect(within(row).getByText('Restaurant · Birthday')).toBeInTheDocument();
    expect(within(row).getByText('€50.00')).toBeInTheDocument();
    expect(within(row).getByText('Partly settled')).toBeInTheDocument();
    expect(row).toHaveTextContent(/Alex\s*for\s*Sam/);
  });
});
