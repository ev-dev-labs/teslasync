import { createElement, forwardRef } from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react'
import { NAV_ICON_PARTS, type NavGlyph } from './navIconParts'
import './nav-motion.css'

function glyph(id: keyof typeof NAV_ICON_PARTS): LucideIcon {
  const data: NavGlyph = NAV_ICON_PARTS[id]
  const Icon = forwardRef<SVGSVGElement, LucideProps>(({ size = 24, className = '', ...props }, ref) =>
    <svg ref={ref} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" {...props} className={`lucide lucide-${data.lucideName} nav-motion-icon nav-glyph-${id} ${className}`} data-nav-icon={id}>
      {data.static?.map(([tag, attrs], index) => createElement(tag, { ...attrs, key: index }))}
      {data.parts.map((part, index) => <g key={index} className={`nav-icon-part part-${index + 1}`} style={{ transformOrigin: `${part.origin[0]}px ${part.origin[1]}px` }}>
        {part.nodes.map(([tag, attrs], node) => createElement(tag, { ...attrs, key: node }))}
      </g>)}
    </svg>)
  Icon.displayName = `NavIcon(${id})`
  return Icon
}
export const NAV_SECTION_ICONS: Record<string, LucideIcon> = {
  'Home': /* @__PURE__ */ glyph('home'),
  'Vehicles': /* @__PURE__ */ glyph('vehicles'),
  'Driving': /* @__PURE__ */ glyph('driving'),
  'Charging': /* @__PURE__ */ glyph('charging'),
  'Battery': /* @__PURE__ */ glyph('battery'),
  'Energy': /* @__PURE__ */ glyph('energy'),
  'Cabin': /* @__PURE__ */ glyph('cabin'),
  'Reports': /* @__PURE__ */ glyph('reports'),
  'Service': /* @__PURE__ */ glyph('service'),
  'Commands': /* @__PURE__ */ glyph('commands'),
  'Automation': /* @__PURE__ */ glyph('automation'),
  'Notifications': /* @__PURE__ */ glyph('inbox'),
  'Security': /* @__PURE__ */ glyph('security'),
  'Advanced intelligence': /* @__PURE__ */ glyph('advanced'),
  'Ownership intelligence': /* @__PURE__ */ glyph('ownership'),
  'Tesla physics': /* @__PURE__ */ glyph('physics'),
  'Data': /* @__PURE__ */ glyph('data'),
  'Diagnostics': /* @__PURE__ */ glyph('diagnostics'),
  'Account': /* @__PURE__ */ glyph('account'),
  'Settings': /* @__PURE__ */ glyph('settings'),
  'Integrations': /* @__PURE__ */ glyph('connect'),
  'About': /* @__PURE__ */ glyph('about'),
  'Experiments': /* @__PURE__ */ glyph('experiments'),
}
export const NAV_UTILITY_ICONS = {
  alerts: /* @__PURE__ */ glyph('alerts'),
  display: /* @__PURE__ */ glyph('display'),
  avatar: /* @__PURE__ */ glyph('avatar'),
  more: /* @__PURE__ */ glyph('more'),
}
