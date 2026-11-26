import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalculatorCellDecimal } from './CalculatorCell';

const localizer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function setup() {
  const onCommit = vi.fn();
  const onEnter = vi.fn();
  render(
    <CalculatorCellDecimal
      value={0}
      onCommit={onCommit}
      onEnter={onEnter}
      localizer={localizer}
      formatter={(value) => localizer.format(value)}
      placeholder="amount"
      autoFocus
      zeroAsEmpty
    />
  );
  return { onCommit, onEnter };
}

describe('CalculatorCell Enter', () => {
  it('saves what was typed even before the live preview caught up', () => {
    const { onCommit, onEnter } = setup();
    fireEvent.focus(screen.getByRole('button'));
    const input = screen.getByPlaceholderText('amount');

    // No animation frame runs between the last key and Enter.
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith(12.5);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('reads a comma typed for the decimal point as decimals', () => {
    const { onCommit } = setup();
    fireEvent.focus(screen.getByRole('button'));
    const input = screen.getByPlaceholderText('amount');

    fireEvent.change(input, { target: { value: '12,5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith(12.5);
  });
});
