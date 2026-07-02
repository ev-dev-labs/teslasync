import type { StorybookConfig } from '@storybook/react-vite'
import { withoutVitePlugins } from '@storybook/builder-vite'

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-interactions', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    // No telemetry pings from CI or sandboxed/offline dev environments.
    disableTelemetry: true,
  },
  docs: {
    // Generate a docs page only for stories explicitly tagged 'autodocs'
    // (CSF3 default) rather than every story file matched above.
    autodocs: 'tag',
  },
  // @storybook/builder-vite auto-inherits this project's own web/vite.config.ts
  // as its base config (documented zero-config behavior of the Vite builder) —
  // that's what wires up the @tailwindcss/vite plugin and the `@/*` -> `src/*`
  // alias "for free" with zero duplication here. The one piece that must be
  // stripped back OUT is vite-plugin-pwa: it has no meaning for the Storybook
  // preview iframe, and left in, it silently emits a real service worker +
  // manifest.webmanifest into storybook-static/ that would register and start
  // intercepting requests if that output is ever deployed as a static site
  // (e.g. Chromatic's published build). `withoutVitePlugins` is builder-vite's
  // own public helper for exactly this "inherit vite.config.ts except one
  // plugin" case (same pattern Storybook core itself uses internally to strip
  // the legacy turbosnap plugin) — it resolves nested/async PluginOption
  // entries recursively, which a plain `.filter(p => p.name !== ...)` cannot
  // do safely since `VitePWA()` returns a Plugin[] nested inside `plugins`.
  async viteFinal(baseConfig) {
    return {
      ...baseConfig,
      plugins: await withoutVitePlugins(baseConfig.plugins, [
        'vite-plugin-pwa',
        'vite-plugin-pwa:build',
        'vite-plugin-pwa:dev-sw',
        'vite-plugin-pwa:info',
        'vite-plugin-pwa:pwa-assets',
      ]),
    }
  },
}
export default config
