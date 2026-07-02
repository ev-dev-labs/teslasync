import type { Preview } from '@storybook/react'
// Full design-system CSS bundle — Tailwind v4 `@theme` tokens, the
// `dark`/`forced-colors` custom variants, density spacing vars, and every
// component-level utility/reset in the app. Importing the same entry point
// `src/main.tsx` uses (rather than a trimmed-down subset) is what makes
// stories render pixel-identical to the real app.
import '../src/index.css'

// Mirror web/index.html's production shell so components pick up the same
// design tokens they get at runtime: `<html class="dark">` selects the
// `.dark` custom-variant (see `@custom-variant dark` in src/index.css) that
// Tailwind `dark:` utilities key off (e.g. Button.tsx's `dark:bg-gray-700`),
// and `<body class="bg-tesla-dark text-white antialiased">` sets the base
// surface color instead of Storybook's default white canvas.
// `body[data-density]` drives the `--density-*` custom properties consumed
// by density-aware utilities (e.g. Button's `size="auto"`); 'comfortable'
// matches index.html/main.tsx's own fallback default.
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark')
  document.documentElement.lang = 'en'
  document.body.classList.add('bg-tesla-dark', 'text-white', 'antialiased')
  document.body.dataset.density = 'comfortable'
}

const preview: Preview = {
  parameters: {
    layout: 'centered',
    // Canvas background matches the app shell instead of Storybook's
    // default white -- without this every component preview would show a
    // jarring white flash/border around dark-themed glassmorphism UI.
    backgrounds: {
      default: 'tesla-dark',
      values: [
        { name: 'tesla-dark', value: '#0a0a0f' },
        { name: 'tesla-darker', value: '#050508' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}
export default preview
