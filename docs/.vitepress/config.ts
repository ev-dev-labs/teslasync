import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: 'TeslaSync Docs',
  description: 'Open-source Tesla intelligence on your infrastructure. Installation, Tesla connectivity, operations, and contributing.',
  base: '/teslasync/',

  ignoreDeadLinks: true,

  srcExclude: [
    'A11Y_GUIDELINES.md',
    'FORM_GUIDELINES.md',
    'I18N_GUIDELINES.md',
    'ICON_GUIDELINES.md',
    'MOBILE_GUIDELINES.md',
    'TABLE_GUIDELINES.md',
    'URL_STATE_GUIDELINES.md',
    'audits/**',
    'runbooks/**',
    'signal-audits/**',
    'observability/**',
    'architecture/**',
    'user/**',
    'upgrade-notes-*.md',
  ],

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/teslasync/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#ffffff' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;650;700&family=IBM+Plex+Mono:wght@400;500&display=swap' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'TeslaSync Docs' }],
    ['meta', { name: 'og:description', content: 'Install, connect Tesla, operate, and find every in-app screen.' }],
  ],

  lastUpdated: true,
  cleanUrls: true,
  appearance: false,

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'TeslaSync',

    nav: [
      { text: 'Product', link: '/', activeMatch: '^/$' },
      { text: 'Docs', link: '/get-started', activeMatch: '/(get-started|guide/)' },
      { text: 'Catalogue', link: '/features/catalogue', activeMatch: '/features/' },
      { text: 'Deploy', link: '/deployment/docker', activeMatch: '/deployment/' },
      { text: 'Operate', link: '/operations/release-verification', activeMatch: '/operations/' },
      { text: 'Contribute', link: '/CONTRIBUTING', activeMatch: '/(CONTRIBUTING|contributing/)' },
    ],

    sidebar: [
      {
        text: 'Get started',
        items: [
          { text: 'Overview', link: '/get-started' },
          { text: 'Install', link: '/guide/getting-started' },
          { text: 'Connect Tesla', link: '/guide/tesla-fleet-api' },
          { text: 'Enable streaming', link: '/guide/fleet-telemetry' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'FAQ', link: '/guide/faq' },
        ],
      },
      {
        text: 'Find a screen',
        collapsed: true,
        items: [
          { text: 'Catalogue', link: '/features/catalogue' },
          { text: 'Home', link: '/features/catalogue-home' },
          { text: 'Vehicles', link: '/features/catalogue-vehicles' },
          { text: 'Tesla Physics', link: '/features/catalogue-tesla-physics' },
          { text: 'Driving', link: '/features/catalogue-driving' },
          { text: 'Charging', link: '/features/catalogue-charging' },
          { text: 'Battery', link: '/features/catalogue-battery' },
          { text: 'Energy', link: '/features/catalogue-energy' },
          { text: 'Service', link: '/features/catalogue-service' },
          { text: 'Cabin', link: '/features/catalogue-cabin' },
          { text: 'Reports', link: '/features/catalogue-reports' },
          { text: 'Commands', link: '/features/catalogue-commands' },
          { text: 'Automation', link: '/features/catalogue-automation' },
          { text: 'Notifications', link: '/features/catalogue-notifications' },
          { text: 'Advanced Intelligence', link: '/features/catalogue-advanced-intelligence' },
          { text: 'Ownership Intelligence', link: '/features/catalogue-ownership-intelligence' },
          { text: 'Security', link: '/features/catalogue-security' },
          { text: 'Account', link: '/features/catalogue-account' },
          { text: 'Settings', link: '/features/catalogue-settings' },
          { text: 'Integrations', link: '/features/catalogue-integrations' },
          { text: 'Data', link: '/features/catalogue-data' },
          { text: 'Diagnostics', link: '/features/catalogue-diagnostics' },
        ],
      },
      {
        text: 'Deploy',
        collapsed: true,
        items: [
          { text: 'Docker', link: '/deployment/docker' },
          { text: 'Kubernetes', link: '/deployment/kubernetes' },
          { text: 'GitHub Pages (Docs)', link: '/deployment/github-pages' },
        ],
      },
      {
        text: 'Guide',
        collapsed: true,
        items: [
          { text: 'Local development', link: '/guide/local-development' },
          { text: 'Architecture', link: '/guide/architecture' },
          { text: 'API endpoints', link: '/guide/api-endpoints' },
          { text: 'Database', link: '/guide/database' },
          { text: 'Technology', link: '/guide/technology' },
          { text: 'Helix AI', link: '/guide/helix-ai' },
          { text: 'Remote commands', link: '/guide/remote-commands' },
          { text: 'Troubleshooting', link: '/guide/troubleshooting' },
          { text: 'Printing', link: '/guide/printing' },
          { text: 'Roadmap', link: '/guide/roadmap' },
        ],
      },
      {
        text: 'Operate',
        collapsed: true,
        items: [
          { text: 'Release verification', link: '/operations/release-verification' },
          { text: 'Secret management', link: '/operations/secret-management' },
          { text: 'Cost controls', link: '/operations/cost-controls' },
          { text: 'Fleet API budget', link: '/operations/fleet-api-budget' },
          { text: 'Production scorecard', link: '/operations/production-readiness-scorecard' },
        ],
      },
      {
        text: 'Contribute',
        collapsed: true,
        items: [
          { text: 'Start contributing', link: '/CONTRIBUTING' },
          { text: 'Code structure', link: '/contributing/code-structure' },
          { text: 'Adding features', link: '/contributing/adding-features' },
          { text: 'API reference', link: '/contributing/api-reference' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ev-dev-labs/teslasync' },
    ],

    editLink: {
      pattern: 'https://github.com/ev-dev-labs/teslasync/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'MIT License · Self-hosted Tesla intelligence',
      copyright: `Copyright © ${new Date().getFullYear()} TeslaSync contributors`,
    },

    docFooter: {
      prev: 'Previous',
      next: 'Next',
    },

    returnToTopLabel: 'Back to top',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Appearance',

    search: {
      provider: 'local',
    },

    outline: {
      label: 'On this page',
      level: [2, 3],
    },

    lastUpdatedText: 'Updated',
  },

  mermaid: {
    theme: 'neutral',
    themeVariables: {
      primaryColor: '#e3e8ee',
      primaryTextColor: '#0a2540',
      primaryBorderColor: '#0a5cff',
      lineColor: '#425466',
      secondaryColor: '#f6f9fc',
      tertiaryColor: '#ffffff',
    },
  },
}))
