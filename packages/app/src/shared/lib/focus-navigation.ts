/**
 * Moving focus between the fields of a form from code, the way Tab would:
 * used after a picker closes or a value is committed with Enter.
 */

export const FOCUS_DIRECTION = { next: 1, previous: -1 } as const;
export type FocusDirection = (typeof FOCUS_DIRECTION)[keyof typeof FOCUS_DIRECTION];

const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';
/** Where Tab would move within: the form, else the dialog, else the page. */
const SCOPE_SELECTOR = 'form, [role="dialog"]';

function isTabStop(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false;
  if (element.matches(':disabled') || element.getAttribute('aria-hidden') === 'true') return false;
  if (element.closest('[hidden], [inert]')) return false;
  if (element instanceof HTMLInputElement && element.type === 'hidden') return false;
  // Browsers know rendered visibility; without it (jsdom) every element counts as shown.
  return typeof element.checkVisibility === 'function' ? element.checkVisibility() : true;
}

/** The tab stops of the scope `from` belongs to, in document order. */
export function tabStopsAround(from: Element): HTMLElement[] {
  const scope = from.closest(SCOPE_SELECTOR) ?? from.ownerDocument.body;
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isTabStop);
}

/**
 * Focuses the tab stop after (or before) `from`, skipping whatever `from`
 * contains. `from` need not be a tab stop itself. Resolves whether one was found.
 */
export function focusAdjacentField(from: Element, direction: FocusDirection): boolean {
  const stops = tabStopsAround(from).filter(
    (element) => !from.contains(element) && !element.contains(from)
  );
  const following = (element: HTMLElement) =>
    Boolean(from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  const candidates =
    direction === FOCUS_DIRECTION.next
      ? stops.filter(following)
      : stops.filter((element) => !following(element)).reverse();
  const target = candidates[0];
  if (!target) return false;
  target.focus();
  return true;
}

/**
 * Fields marked `data-enter-commits-field` take their value on Enter and move
 * on; a form that saves on Enter leaves those keys to them.
 */
export const ENTER_COMMITS_FIELD_SELECTOR = '[data-enter-commits-field]';
