import { render, screen } from '@testing-library/react';
import { FOCUS_DIRECTION, focusAdjacentField } from './focus-navigation';

function Form() {
  return (
    <form>
      <input aria-label="first" />
      <div data-testid="group">
        <button type="button">inside</button>
      </div>
      <button type="button" tabIndex={-1}>
        skipped
      </button>
      <button type="button" disabled>
        disabled
      </button>
      <input aria-label="last" />
    </form>
  );
}

describe('focusAdjacentField', () => {
  it('moves like Tab: past what the start contains and what Tab skips', () => {
    render(<Form />);

    expect(focusAdjacentField(screen.getByTestId('group'), FOCUS_DIRECTION.next)).toBe(true);
    expect(screen.getByRole('textbox', { name: 'last' })).toHaveFocus();

    focusAdjacentField(screen.getByTestId('group'), FOCUS_DIRECTION.previous);
    expect(screen.getByRole('textbox', { name: 'first' })).toHaveFocus();
  });

  it('reports when there is no field to move to', () => {
    render(<Form />);
    expect(
      focusAdjacentField(screen.getByRole('textbox', { name: 'last' }), FOCUS_DIRECTION.next)
    ).toBe(false);
  });
});
