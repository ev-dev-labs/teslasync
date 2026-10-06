/** Match the real OperationalBrief value node, not an ancestor's combined copy. */
export function statText(expected: string) {
  return (_content: string, element: Element | null) =>
    element?.hasAttribute('data-operational-value') === true
      && element.textContent === expected;
}
