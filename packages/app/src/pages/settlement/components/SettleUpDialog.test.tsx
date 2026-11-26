import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  asMilli,
  SETTLEMENT_PROGRESS_STATUS,
  type Account,
  type SettlementPersonalItem,
} from '@budgero/core/browser';
import { SettleUpDialog } from './SettleUpDialog';

const SAM = 'sam';
const ALEX = 'alex';
const DINING = 30;
const EURO = 'EUR';
const TODAY = '2026-03-02';

const account = (id: number, name: string, currency = EURO) =>
  ({ ID: id, Name: name, Currency: currency, OnBudget: true }) as Account;

const dinner: SettlementPersonalItem = {
  transactionId: 7,
  date: '2026-02-10',
  categoryId: DINING,
  payee: 'Restaurant',
  memo: '',
  paidById: ALEX,
  ownerId: SAM,
  amount: asMilli(50_000),
  status: SETTLEMENT_PROGRESS_STATUS.open,
};

const money = (milli: number) => `€${(milli / 1000).toFixed(2)}`;
const localizer = new Intl.NumberFormat('en-US', { style: 'currency', currency: EURO });

const renderDialog = (overrides: Partial<Parameters<typeof SettleUpDialog>[0]> = {}) => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <SettleUpDialog
      open
      onOpenChange={vi.fn()}
      transfer={{ fromParticipantId: SAM, toParticipantId: ALEX, amount: asMilli(200_000) }}
      names={
        new Map([
          [SAM, 'Sam'],
          [ALEX, 'Alex'],
        ])
      }
      fromAccounts={[account(2, 'Sam Checking')]}
      toAccounts={[account(1, 'Alex Checking')]}
      items={[dinner]}
      categoryName={() => 'Dining out'}
      money={money}
      currency={EURO}
      localizer={localizer}
      today={TODAY}
      busy={false}
      onSubmit={onSubmit}
      {...overrides}
    />
  );
  return { onSubmit };
};

describe('SettleUpDialog', () => {
  // Radix measures its radios and checkboxes (jsdom has no ResizeObserver).
  beforeAll(() => {
    class ResizeObserverStub {
      observe() {}

      unobserve() {}

      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });
  it('records the whole payment as one labelled transfer by default', async () => {
    const { onSubmit } = renderDialog();

    expect(screen.getByText(/Sam pays Alex €200.00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Record 1 transfer' }));

    expect(onSubmit).toHaveBeenCalledWith({
      fromAccount: expect.objectContaining({ ID: 2 }),
      toAccount: expect.objectContaining({ ID: 1 }),
      date: TODAY,
      lines: [{ key: 'all', amount: 200_000, memo: 'Household settlement' }],
      labelled: true,
    });
  });

  it('records one transfer per personal item and one for the rest', async () => {
    const { onSubmit } = renderDialog();

    await userEvent.click(screen.getByRole('radio', { name: /One transfer per item/ }));
    expect(screen.getByText('Settles the open balance')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Household settlement/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Record 2 transfers' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          { key: 'item-7-30', amount: 50_000, memo: expect.stringContaining('Dining out') },
          { key: 'rest', amount: 150_000, memo: 'Shared expenses' },
        ],
        labelled: false,
      })
    );
  });

  it('shows what stays open when a line is removed', async () => {
    renderDialog();

    await userEvent.click(screen.getByRole('radio', { name: /One transfer per item/ }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove transfer' })[1]);

    expect(screen.getByText('Still open afterwards: €150.00')).toBeInTheDocument();
  });

  it('refuses accounts in another currency', () => {
    renderDialog({ toAccounts: [account(1, 'Alex USD', 'USD')] });

    expect(screen.getByText(/in another currency/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record 1 transfer' })).toBeDisabled();
  });

  it('explains a missing personal account', () => {
    renderDialog({ fromAccounts: [] });

    expect(screen.getByText(/Both need a personal account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record 1 transfer' })).toBeDisabled();
  });
});
