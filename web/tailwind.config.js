/** @type {import('tailwindcss').Config} */
import plugin from 'tailwindcss/plugin';
import containerQueries from '@tailwindcss/container-queries';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      zIndex: {
        overlay: '60',
        'shell-panel': '80',
        'map-control': '1000',
        'presentation-controls': '9999',
        'presentation-dimmer': '9998',
        'presentation-cursor': '9997',
        'map-tile-control': '800',
      },
      width: {
        'side-panel': '420px',
        'theme-switcher': '22rem',
        'connection-diagnostics': 'min(92vw, 320px)',
        'presentation-menu': 'min(92vw, 340px)',
        'workspace-context': 'min(92vw, 27rem)',
        'alerts-preview': 'min(92vw, 380px)',
        'recent-pages': 'min(92vw, 360px)',
        'command-deck-collapsed': '76px',
        'command-deck-expanded': '320px',
      },
      maxWidth: {
        'modal-full': 'min(96vw,1100px)',
        'tooltip-viewport': 'calc(100vw - 1.5rem)',
        'side-panel-viewport': '40vw',
        'shell-panel-viewport': 'calc(100vw - 1rem)',
        'breadcrumb-label': '200px',
        'background-summary': '180px',
        'active-vehicle-label': '160px',
        'active-vehicle-compact-label': '140px',
      },
      maxHeight: {
        modal: '90vh',
        'notification-panel': 'calc(100vh - 6rem)',
        'workspace-context': 'min(80vh, 38rem)',
        'alerts-preview': '320px',
        'status-options': '280px',
        'table-filter-viewport': 'calc(100dvh - 2rem)',
      },
      minWidth: {
        'freshness-age': '4.5rem',
        'background-work': '260px',
        'vehicle-options': '220px',
      },
      gridTemplateColumns: {
        'metric-compact': 'minmax(0,1fr) minmax(0,1fr) 5rem',
        'replay-shortcuts': 'auto 1fr',
        'page-actions-scope': 'minmax(0,1fr) auto',
      },
      flex: {
        'replay-scrubber': '1 1 12rem',
      },
      screens: {
        // Ultra-wide breakpoint for the modern-ui full-width redesign.
        // Pages use `3xl:` grid columns so dashboards fill wide monitors
        // (2K/ultrawide) instead of leaving dead space at the edges.
        '3xl': '1920px',
      },
      colors: {
        tesla: {
          red: '#e31937',
          blue: '#3e6ae1',
          dark: '#0b0d12',
          darker: '#07090d',
          gray: '#393c49',
        },
        neon: {
          cyan: 'rgb(var(--semantic-info-rgb) / <alpha-value>)',
          blue: 'rgb(var(--semantic-info-rgb) / <alpha-value>)',
          purple: 'rgb(var(--semantic-purple-rgb) / <alpha-value>)',
          pink: 'rgb(var(--semantic-danger-rgb) / <alpha-value>)',
          green: 'rgb(var(--semantic-success-rgb) / <alpha-value>)',
          amber: 'rgb(var(--semantic-warning-rgb) / <alpha-value>)',
          red: 'rgb(var(--semantic-danger-rgb) / <alpha-value>)',
        },
        glass: {
          light: 'var(--surface-1)',
          medium: 'var(--surface-2)',
          heavy: 'var(--surface-3)',
          border: 'var(--border-default)',
        },
        surface: {
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          4: 'var(--surface-3)',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glow-cyan': 'none',
        'glow-purple': 'none',
        'glow-blue': 'none',
        'mesh-gradient': 'none',
      },
      boxShadow: {
        'glow-sm': 'var(--elevation-1)',
        'glow-md': 'var(--elevation-2)',
        'glow-lg': 'var(--elevation-3)',
        'glow-red': 'var(--elevation-1)',
        'glow-green': 'var(--elevation-1)',
        'glow-purple': 'var(--elevation-1)',
        'inner-glow': 'none',
        'glass': 'var(--panel-shadow)',
        // Neutral elevation ladder — the modern default for expressing depth.
        // Mode-aware: the underlying vars are re-declared under
        // `:root.light-mode` in index.css. Prefer these over `shadow-glow-*`,
        // which only reads correctly on the cyan presets.
        'e1': 'var(--elevation-1)',
        'e2': 'var(--elevation-2)',
        'e3': 'var(--elevation-3)',
        'panel': 'var(--panel-shadow)',
        'panel-hover': 'var(--panel-shadow-hover)',
      },
      borderRadius: {
        // Token-backed shape scale (index.css → SHAPE SCALE). Deliberately
        // ADDITIVE: Tailwind's own `sm`/`md`/`lg`/`xl` radii are left alone so
        // this re-skin cannot silently reshape all 651 existing components.
        // Propagation happens through the shared primitives instead, which is
        // predictable and reviewable. New code should prefer these names.
        'shape-xs': 'var(--radius-xs)',
        'shape-sm': 'var(--radius-sm)',
        'shape-md': 'var(--radius-md)',
        'shape-lg': 'var(--radius-lg)',
        'shape-xl': 'var(--radius-xl)',
        'pill': 'var(--radius-pill)',
        'panel': 'var(--panel-radius)',
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'pulse-slow': 'none',
        'glow-pulse': 'none',
        'slide-up': 'slideUp 0.5s ease-out',
        'fade-in': 'fadeIn 0.3s ease-out',
        'spin-slow': 'spin 3s linear infinite',
        'border-flow': 'none',
        'shimmer': 'shimmer 2s infinite linear',
        'skeleton-wave': 'skeletonWave 1.8s ease-in-out infinite',
        'chart-grow': 'chartGrow 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'number-pop': 'none',
      },
      keyframes: {
        glowPulse: {
          '0%, 100%': { boxShadow: 'var(--elevation-1)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        borderFlow: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        skeletonWave: {
          '0%': { opacity: '0.03' },
          '50%': { opacity: '0.08' },
          '100%': { opacity: '0.03' },
        },
        chartGrow: {
          '0%': { transform: 'scaleY(0)', opacity: '0' },
          '100%': { transform: 'scaleY(1)', opacity: '1' },
        },
        numberPop: {
          '0%': { transform: 'scale(0.5)', opacity: '0' },
          '60%': { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        boltPulse: {
          '0%': { opacity: '0.8' },
          '100%': { opacity: '1' },
        },
        carGlow: {
          '0%': { strokeOpacity: '0.7' },
          '100%': { strokeOpacity: '1' },
        },
      },
      fontFamily: {
        // Driven by the --font-* CSS variables (see index.css :root and
        // components/ui/FontProvider.tsx). The user's chosen UI/monospace
        // font flows through every `font-sans` / `font-mono` utility.
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontWeight: {
        // Mapped to the --font-weight-* vars so a user "heading weight"
        // preference (which rewrites --font-weight-bold) flows through
        // `font-bold` etc. app-wide.
        normal: 'var(--font-weight-normal)',
        medium: 'var(--font-weight-medium)',
        semibold: 'var(--font-weight-semibold)',
        bold: 'var(--font-weight-bold)',
      },
      fontSize: {
        'size-inherit': 'inherit',
        // Explicit sizes multiply by --font-scale so text scales but layout
        // spacing does not. Body sizes derive their line-height from
        // --leading (`calc(var(--leading) * 1em)`) so the line-height
        // control is real and scales with the text; larger display sizes
        // keep a tighter unitless leading for headline balance.
        '2xs': ['calc(var(--font-scale) * 0.625rem)', { lineHeight: 'calc(var(--leading) * 1em)' }],
        xs: ['calc(var(--font-scale) * 0.75rem)', { lineHeight: 'calc(var(--leading) * 1em)' }],
        sm: ['calc(var(--font-scale) * 0.875rem)', { lineHeight: 'calc(var(--leading) * 1em)' }],
        base: ['calc(var(--font-scale) * 1rem)', { lineHeight: 'calc(var(--leading) * 1em)' }],
        lg: ['calc(var(--font-scale) * 1.125rem)', { lineHeight: 'calc(var(--leading) * 1em)' }],
        xl: ['calc(var(--font-scale) * 1.25rem)', { lineHeight: '1.4' }],
        '2xl': ['calc(var(--font-scale) * 1.5rem)', { lineHeight: '1.3' }],
        '3xl': ['calc(var(--font-scale) * 1.875rem)', { lineHeight: '1.2' }],
        '4xl': ['calc(var(--font-scale) * 2.25rem)', { lineHeight: '1.15' }],
        '5xl': ['calc(var(--font-scale) * 3rem)', { lineHeight: '1.1' }],
        '6xl': ['calc(var(--font-scale) * 3.75rem)', { lineHeight: '1.05' }],
        '7xl': ['calc(var(--font-scale) * 4.5rem)', { lineHeight: '1' }],
        '8xl': ['calc(var(--font-scale) * 6rem)', { lineHeight: '1' }],
        '9xl': ['calc(var(--font-scale) * 8rem)', { lineHeight: '1' }],
        // Density-aware body text size. Tracks `--density-text` set by
        // `body[data-density="..."]`, additionally scaled by --font-scale.
        'd-base': ['calc(var(--font-scale) * var(--density-text))', { lineHeight: 'calc(var(--leading) * 1em)' }],
      },
      spacing: {
        // Density-aware padding/gap tokens.
        // Tracks `--density-pad-x` / `--density-pad-y` / `--density-gap`
        // set by `body[data-density="..."]` in index.css. Use as
        // `px-d-pad-x`, `py-d-pad-y`, `gap-d-gap` so the value flows
        // through className strings (no inline styles required, keeps
        // the style audit clean).
        'd-pad-x': 'var(--density-pad-x)',
        'd-pad-y': 'var(--density-pad-y)',
        'd-gap': 'var(--density-gap)',
        'd-row': 'var(--density-row-h)',
      },
      minHeight: {
        'error-fallback': '400px',
        'side-panel-header': '4.5rem',
        'vehicle-grid': '28rem',
        // Density-aware row height.
        // Use `min-h-d-row` on table rows / list items so the height
        // adapts to the user's density preference.
        'd-row': 'var(--density-row-h)',
      },
      height: {
        'vehicle-grid': 'min(72vh, 56rem)',
        // Same density-aware row height as a fixed-height utility.
        'd-row': 'var(--density-row-h)',
      },
      // motion duration tokens.
      // Backed by --motion-duration-* CSS vars in index.css that collapse to
      // 0ms under prefers-reduced-motion. Use `duration-fast | duration-normal
      // | duration-slow` instead of raw `duration-NNN` numeric utilities so
      // motion timings stay consistent across the app. The audit script
      // `scripts/auditMotionTokens.mjs` enforces this.
      transitionProperty: {
        width: 'width',
      },
      transitionDuration: {
        fast: 'var(--motion-duration-fast)',
        normal: 'var(--motion-duration-normal)',
        slow: 'var(--motion-duration-slow)',
      },
      transitionTimingFunction: {
        standard: 'var(--motion-easing-standard)',
        accelerate: 'var(--motion-easing-accelerate)',
        decelerate: 'var(--motion-easing-decelerate)',
      },
    },
  },
  plugins: [
    // forced-colors variant.
    //
    // Tailwind v3.4 ships a built-in `forced-colors:` variant, but we
    // register it explicitly so:
    // 1. our intent ("the app supports Windows High Contrast / Aquatic
    // contrast themes") is documented in source rather than implicit
    // in a framework version, and
    // 2. the `forced-colors:` token survives any future Tailwind
    // upgrade or downgrade without silently disappearing.
    //
    // Use it on critical components (Button, Card, GlassPanel, Modal,
    // etc.) to map borders/backgrounds to system colors that survive
    // forced-colors mode:
    // className="border border-transparent forced-colors:border-[CanvasText]"
    //
    // Audit: `npm run audit:forced-colors` checks every critical
    // component file uses the variant at least once.
    plugin(function forcedColorsVariant({ addVariant }) {
      addVariant('forced-colors', '@media (forced-colors: active)');
    }),
    // Container queries — used by dashboard widget primitives so grids
    // collapse based on the widget's own rendered width (not the viewport),
    // since a widget's pixel width depends on the dashboard grid placement.
    containerQueries,
  ],
}
