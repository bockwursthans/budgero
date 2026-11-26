import * as React from 'react';

/** Receives the dialog's Escape key; preventDefault keeps the dialog open. */
export type AddTransactionEscapeHandler = (event: KeyboardEvent) => void;

/**
 * For dialogs hosting AddTransactionForm: pass `registerEscapeHandler` to the
 * form and `onEscapeKeyDown` to the DialogContent. Escape then first ends
 * editing the amount, and asks before a started transaction is thrown away.
 */
export function useAddTransactionDialogEscape() {
  const handler = React.useRef<AddTransactionEscapeHandler | null>(null);
  const registerEscapeHandler = React.useCallback((next: AddTransactionEscapeHandler | null) => {
    handler.current = next;
  }, []);
  const onEscapeKeyDown = React.useCallback((event: KeyboardEvent) => handler.current?.(event), []);
  return { registerEscapeHandler, onEscapeKeyDown };
}
