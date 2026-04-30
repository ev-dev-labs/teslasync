import L from 'leaflet';

/**
 * Custom vehicle marker icon using CSS — replaces broken default Leaflet markers.
 * Renders as a pulsing dot with a theme-colored glow.
 */
export function vehicleIcon(color = '#00f0ff'): L.DivIcon {
  return L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `
      <div style="width:28px;height:28px;position:relative">
        <div style="
          position:absolute;inset:0;border-radius:50%;
          background:${color};opacity:0.25;
          animation:vehicle-pulse 2s ease-in-out infinite;
        "></div>
        <div style="
          position:absolute;inset:5px;border-radius:50%;
          background:${color};border:2px solid white;
          box-shadow:0 0 10px ${color};
        "></div>
      </div>
      <style>
        @keyframes vehicle-pulse {
          0%, 100% { transform: scale(1); opacity: 0.25; }
          50% { transform: scale(1.6); opacity: 0; }
        }
      </style>
    `,
  });
}
