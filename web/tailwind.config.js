/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        tesla: {
          red: '#e31937',
          blue: '#3e6ae1',
          dark: '#0a0a0f',
          darker: '#050508',
          gray: '#393c49',
        },
        neon: {
          cyan: '#00f0ff',
          blue: '#4f46e5',
          purple: '#a855f7',
          pink: '#ec4899',
          green: '#10b981',
          amber: '#f59e0b',
          red: '#ef4444',
        },
        glass: {
          light: 'rgba(255, 255, 255, 0.05)',
          medium: 'rgba(255, 255, 255, 0.08)',
          heavy: 'rgba(255, 255, 255, 0.12)',
          border: 'rgba(255, 255, 255, 0.10)',
        },
        surface: {
          1: '#0f1019',
          2: '#151621',
          3: '#1a1b2e',
          4: '#1f2037',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glow-cyan': 'radial-gradient(ellipse at center, rgba(0,240,255,0.15) 0%, transparent 70%)',
        'glow-purple': 'radial-gradient(ellipse at center, rgba(168,85,247,0.15) 0%, transparent 70%)',
        'glow-blue': 'radial-gradient(ellipse at center, rgba(79,70,229,0.15) 0%, transparent 70%)',
        'mesh-gradient': 'linear-gradient(135deg, #0f1019 0%, #1a1040 25%, #0f1019 50%, #0a1628 75%, #0f1019 100%)',
      },
      boxShadow: {
        'glow-sm': '0 0 15px rgba(0, 240, 255, 0.1)',
        'glow-md': '0 0 30px rgba(0, 240, 255, 0.15)',
        'glow-lg': '0 0 60px rgba(0, 240, 255, 0.2)',
        'glow-red': '0 0 30px rgba(227, 25, 55, 0.2)',
        'glow-green': '0 0 30px rgba(16, 185, 129, 0.2)',
        'glow-purple': '0 0 30px rgba(168, 85, 247, 0.2)',
        'inner-glow': 'inset 0 1px 0 rgba(255,255,255,0.05)',
        'glass': '0 8px 32px rgba(0, 0, 0, 0.4)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite alternate',
        'slide-up': 'slideUp 0.5s ease-out',
        'fade-in': 'fadeIn 0.3s ease-out',
        'spin-slow': 'spin 3s linear infinite',
        'border-flow': 'borderFlow 3s linear infinite',
        'shimmer': 'shimmer 2s infinite linear',
        'skeleton-wave': 'skeletonWave 1.8s ease-in-out infinite',
        'chart-grow': 'chartGrow 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'number-pop': 'numberPop 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        glowPulse: {
          '0%': { boxShadow: '0 0 5px rgba(0, 240, 255, 0.1)' },
          '100%': { boxShadow: '0 0 20px rgba(0, 240, 255, 0.3)' },
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
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        // Density-aware body text size (Phase 40 / Prompt 44).
        // Tracks `--density-text` set by `body[data-density="..."]`.
        'd-base': ['var(--density-text)', { lineHeight: '1.5' }],
      },
      spacing: {
        // Density-aware padding/gap tokens (Phase 40 / Prompt 44).
        // Tracks `--density-pad-x` / `--density-pad-y` / `--density-gap`
        // set by `body[data-density="..."]` in index.css. Use as
        // `px-d-pad-x`, `py-d-pad-y`, `gap-d-gap` so the value flows
        // through className strings (no inline styles required, keeps
        // the audit-violations sweep clean).
        'd-pad-x': 'var(--density-pad-x)',
        'd-pad-y': 'var(--density-pad-y)',
        'd-gap': 'var(--density-gap)',
        'd-row': 'var(--density-row-h)',
      },
      minHeight: {
        // Density-aware row height (Phase 40 / Prompt 44).
        // Use `min-h-d-row` on table rows / list items so the height
        // adapts to the user's density preference.
        'd-row': 'var(--density-row-h)',
      },
      height: {
        // Same density-aware row height as a fixed-height utility.
        'd-row': 'var(--density-row-h)',
      },
    },
  },
  plugins: [],
}
