import L from 'leaflet';

/**
 * Default marker color — the app's neon-cyan accent (matches the PWA
 * `theme_color`). Used whenever no color is supplied or the supplied value is
 * missing / malformed.
 */
export const DEFAULT_VEHICLE_COLOR = '#00f0ff';

/**
 * Injection-safe CSS color grammar: `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`
 * hex, `rgb()/rgba()/hsl()/hsla()` with numeric bodies, or a bare named color.
 * Deliberately narrow — a value containing quotes, angle brackets, semicolons
 * or other markup can never match, so it can't break out of the marker's inline
 * `style="…"` attributes.
 */
const SAFE_COLOR =
  /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^(?:rgb|hsl)a?\([0-9.,%\s]+\)$|^[a-z]+$/i;

/**
 * Validate a caller-supplied marker color, falling back to
 * {@link DEFAULT_VEHICLE_COLOR} when it is `null` / `undefined`, blank, or not a
 * recognised safe CSS color. `vehicleIcon` interpolates the result straight into
 * an HTML string, so any untrusted input must be normalised here first.
 */
export function sanitizeColor(color?: string | null): string {
  if (typeof color !== 'string') return DEFAULT_VEHICLE_COLOR;
  const trimmed = color.trim();
  return SAFE_COLOR.test(trimmed) ? trimmed : DEFAULT_VEHICLE_COLOR;
}

/**
 * Custom vehicle marker icon using CSS — replaces broken default Leaflet markers.
 * Renders as a pulsing dot with a theme-colored glow.
 */
export function vehicleIcon(color: string = DEFAULT_VEHICLE_COLOR): L.DivIcon {
  const safe = sanitizeColor(color);
  return L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `
      <div style="width:28px;height:28px;position:relative">
        <div style="
          position:absolute;inset:0;border-radius:50%;
          background:${safe};opacity:0.25;
          animation:vehicle-pulse 2s ease-in-out infinite;
        "></div>
        <div style="
          position:absolute;inset:5px;border-radius:50%;
          background:${safe};border:2px solid white;
          box-shadow:0 0 10px ${safe};
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
