import * as React from 'react';
import {
  FOCUS_DIRECTION,
  focusAdjacentField,
  type FocusDirection,
} from '@shared/lib/focus-navigation';

/** The entry cmdk highlights (what Enter would pick). */
const HIGHLIGHTED_ITEM = '[cmdk-item][data-selected="true"]:not([data-disabled="true"])';
const COMMAND_ROOT = '[cmdk-root]';
const SEARCH_INPUT = '[cmdk-input]';

export interface ComboboxKeyboardEntryOptions {
  /** Off: the picker keeps its usual behaviour (it is used in many places). */
  enabled: boolean;
  /** The picker's trigger: focus moves on from it. */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** Opens the picker with its search set to `search`. */
  openWithSearch: (search: string) => void;
  close: () => void;
}

/**
 * Keyboard entry for a popover picker (a trigger button and a cmdk list),
 * so a form can be filled without the mouse:
 *
 * - typing on the closed trigger opens the picker searching for that key;
 * - Enter or Tab in the open picker takes the highlighted entry and moves
 *   on to the next field, Shift+Tab closes it and moves back.
 *
 * Wire the returned handlers to the trigger (onKeyDown), the search input
 * (onKeyDown), the popover content (onOpenAutoFocus, onCloseAutoFocus), and call
 * `onPicked` from every entry's onSelect.
 */
export function useComboboxKeyboardEntry({
  enabled,
  triggerRef,
  openWithSearch,
  close,
}: ComboboxKeyboardEntryOptions) {
  const moveAfterClose = React.useRef<FocusDirection | null>(null);
  const openedByTyping = React.useRef(false);

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!enabled || event.ctrlKey || event.metaKey || event.altKey) return;
    // One printable character; Space keeps opening the picker as a button does.
    if (event.key.length !== 1 || event.key === ' ') return;
    event.preventDefault();
    openedByTyping.current = true;
    openWithSearch(event.key);
  };

  /**
   * Opened by typing: focus the search with the caret after that key. Radix
   * would select the text, and the next key would replace the first.
   */
  const onOpenAutoFocus = (event: Event) => {
    if (!openedByTyping.current) return;
    openedByTyping.current = false;
    const input = (event.target as HTMLElement | null)?.querySelector<HTMLInputElement>(
      SEARCH_INPUT
    );
    if (!input) return;
    event.preventDefault();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  const onPicked = () => {
    if (enabled) moveAfterClose.current = FOCUS_DIRECTION.next;
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!enabled || event.key !== 'Tab') return;
    event.preventDefault();
    if (event.shiftKey) {
      moveAfterClose.current = FOCUS_DIRECTION.previous;
      close();
      return;
    }
    moveAfterClose.current = FOCUS_DIRECTION.next;
    const highlighted = event.currentTarget
      .closest(COMMAND_ROOT)
      ?.querySelector<HTMLElement>(HIGHLIGHTED_ITEM);
    if (highlighted) highlighted.click();
    else close();
  };

  const onCloseAutoFocus = (event: Event) => {
    const direction = moveAfterClose.current;
    moveAfterClose.current = null;
    const trigger = triggerRef.current;
    if (direction === null || !trigger) return;
    event.preventDefault();
    if (!focusAdjacentField(trigger, direction)) trigger.focus();
  };

  return { onTriggerKeyDown, onInputKeyDown, onPicked, onOpenAutoFocus, onCloseAutoFocus };
}
