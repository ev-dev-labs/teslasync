import { vi } from 'vitest';

export function forceMobileDataTables(width = 360) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const box = original.call(this);
    return this.hasAttribute('data-grid-frame')
      ? new DOMRect(box.x, box.y, width, box.height)
      : box;
  });
}
