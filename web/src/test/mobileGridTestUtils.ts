import { vi } from 'vitest';

export function forceMobileDataTables(width = 360) {
  const measurement = HTMLElement.prototype.getBoundingClientRect;
  const original = vi.isMockFunction(measurement)
    ? measurement.getMockImplementation() ?? Element.prototype.getBoundingClientRect
    : measurement;
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const box = original.call(this);
    return this.hasAttribute('data-grid-frame')
      ? new DOMRect(box.x, box.y, width, box.height)
      : box;
  });
}
