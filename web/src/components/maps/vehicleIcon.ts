import { createElement, type ReactElement } from 'react';

/**
 * Vehicle marker visual — a pulsing, glowing dot rendered as a React element
 * (consumed by `<Marker icon={vehicleIcon()} />`). Replaces the previous
 * Leaflet `DivIcon`; no Leaflet dependency.
 */
export function vehicleIcon(color = '#00f0ff'): ReactElement {
  return createElement(
    'div',
    { className: 'relative h-7 w-7', 'aria-hidden': true },
    createElement('span', {
      className: 'absolute inset-0 rounded-full animate-ping',
      style: { backgroundColor: color, opacity: 0.25 },
    }),
    createElement('span', {
      className: 'absolute inset-[5px] rounded-full border-2 border-white',
      style: { backgroundColor: color, boxShadow: `0 0 10px ${color}` },
    }),
  );
}
