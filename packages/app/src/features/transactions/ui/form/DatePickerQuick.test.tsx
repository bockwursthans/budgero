import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { activateLocale } from '@shared/i18n';
import { DatePickerQuick } from './DatePickerQuick';

afterEach(async () => {
  cleanup();
  await activateLocale('en', false);
});

const SEPTEMBER_16 = new Date(2026, 8, 16);
const dayOf = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];

const renderPicker = (props: Partial<Parameters<typeof DatePickerQuick>[0]> = {}) => {
  const onChange = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <form>
      <DatePickerQuick
        value={SEPTEMBER_16}
        open={false}
        onOpenChange={onOpenChange}
        onChange={onChange}
        {...props}
      />
      <button type="button">next field</button>
    </form>
  );
  return { onChange, onOpenChange, input: screen.getByTestId('transaction-date-input') };
};

it('shows the date in the language’s form and follows a language change', async () => {
  await activateLocale('de', false);
  const { onChange, input } = renderPicker();
  expect(input).toHaveValue('16.09.2026');
  expect(screen.getByText('Mittwoch, 16. September 2026')).toBeInTheDocument();

  await act(() => activateLocale('fr', false));
  expect(input).toHaveValue('16/09/2026');
  expect(onChange).not.toHaveBeenCalled();
});

it('takes a typed date on Enter and moves on to the next field', async () => {
  await activateLocale('de', false);
  const { onChange, input } = renderPicker();

  await userEvent.clear(input);
  await userEvent.type(input, '3.10{Enter}');

  expect(dayOf(onChange.mock.calls[0][0])).toEqual([new Date().getFullYear(), 10, 3]);
  expect(screen.getByRole('button', { name: 'next field' })).toHaveFocus();
});

it('explains a date it can’t read and keeps the old one', async () => {
  const { onChange, input } = renderPicker();

  await userEvent.clear(input);
  await userEvent.type(input, '31/31{Enter}');

  expect(onChange).not.toHaveBeenCalled();
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText(/Not a date/)).toBeInTheDocument();
});

it('shifts the date with the arrow and page keys, and opens the calendar with Alt+↓', async () => {
  const { onChange, onOpenChange, input } = renderPicker();
  input.focus();

  await userEvent.keyboard('{ArrowUp}');
  expect(dayOf(onChange.mock.lastCall![0])).toEqual([2026, 9, 17]);
  await userEvent.keyboard('{PageDown}');
  expect(dayOf(onChange.mock.lastCall![0])).toEqual([2026, 8, 16]);
  await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
  expect(onOpenChange).toHaveBeenCalledWith(true);
});

it('keeps the quick buttons out of the tab order', () => {
  renderPicker();
  expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('tabindex', '-1');
  expect(screen.getByRole('button', { name: 'Open calendar' })).toHaveAttribute('tabindex', '-1');
});

it('shows an optional time input only when the caller handles a time', () => {
  const onTimeChange = vi.fn();
  const { unmount } = render(
    <DatePickerQuick value={SEPTEMBER_16} open={false} onOpenChange={vi.fn()} onChange={vi.fn()} />
  );
  expect(screen.queryByLabelText('Time (optional)')).not.toBeInTheDocument();
  unmount();
  render(
    <DatePickerQuick
      value={SEPTEMBER_16}
      open={false}
      onOpenChange={vi.fn()}
      onChange={vi.fn()}
      time=""
      onTimeChange={onTimeChange}
    />
  );
  const input = screen.getByLabelText('Time (optional)');
  expect(input).toHaveValue('');
  fireEvent.change(input, { target: { value: '14:30' } });
  expect(onTimeChange).toHaveBeenCalledWith('14:30');
});
