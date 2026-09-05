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
    ['meta', { name: 'theme-color', content: '#00f0ff' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'TeslaSync Docs' }],
    ['meta', { name: 'og:description', content: 'Documentation for TeslaSync - Tesla Fleet Intelligence Platform' }],
    ['script', { src: '/teslasync/particles.js', defer: 'true' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'TeslaSync',

    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Deployment', link: '/deployment/docker', activeMatch: '/deployment/' },
      { text: 'Features', link: '/features/dashboard', activeMatch: '/features/' },
      { text: 'Contributing', link: '/CONTRIBUTING', activeMatch: '/(CONTRIBUTING|contributing/)' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Tesla Fleet API Setup', link: '/guide/tesla-fleet-api' },
            { text: 'Enable Fleet Telemetry', link: '/guide/fleet-telemetry' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Local Development', link: '/guide/local-development' },
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'API Reference', link: '/guide/api-endpoints' },
            { text: 'API Spec (OpenAPI)', link: '/teslasync/openapi.yaml' },
            { text: 'Diagrams', link: '/guide/diagrams' },
            { text: 'Database Schema', link: '/guide/database' },
            { text: 'Technology Stack', link: '/guide/technology' },
            { text: 'Helix AI', link: '/guide/helix-ai' },
            { text: 'Remote Commands', link: '/guide/remote-commands' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
            { text: 'Printing pages', link: '/guide/printing' },
            { text: 'FAQ', link: '/guide/faq' },
            { text: 'Roadmap', link: '/guide/roadmap' },
          ],
        },
      ],
      '/deployment/': [
        {
          text: 'Deployment',
          items: [
            { text: 'Docker', link: '/deployment/docker' },
            { text: 'Kubernetes', link: '/deployment/kubernetes' },
            { text: 'GitHub Pages (Docs)', link: '/deployment/github-pages' },
          ],
        },
      ],
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Dashboard', link: '/features/dashboard' },
            { text: 'Vehicle Tracking', link: '/features/vehicle-tracking' },
            { text: 'Helix AI', link: '/features/helix-ai' },
            { text: 'Alerts & Notifications', link: '/features/alerts' },
            { text: 'Automations', link: '/features/automations' },
            { text: 'Data Export', link: '/features/data-export' },
            { text: 'Analytics & Charts', link: '/features/analytics' },
            { text: 'Backup & Restore', link: '/features/backup-restore' },
          ],
        },
      ],
      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Start Contributing', link: '/CONTRIBUTING' },
            { text: 'Code Structure', link: '/contributing/code-structure' },
            { text: 'Adding Features', link: '/contributing/adding-features' },
            { text: 'API Reference', link: '/contributing/api-reference' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ev-dev-labs/teslasync' },
    ],

    editLink: {
      pattern: 'https://github.com/ev-dev-labs/teslasync/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License. <br/><img src="https://komarev.com/ghpvc/?username=teslasync-docs&label=visitors&color=00f0ff&style=flat" alt="Visitors" style="display:inline-block;vertical-align:middle;margin-top:4px;" />',
      copyright: `Copyright © ${new Date().getFullYear()} TeslaSync Contributors`,
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
    },
  },

  mermaid: {
    theme: 'dark',
    themeVariables: {
      primaryColor: '#00f0ff',
      primaryTextColor: '#e4e4ef',
      primaryBorderColor: '#00f0ff',
      lineColor: '#10b981',
      secondaryColor: '#141430',
      tertiaryColor: '#0f0f2a',
    },
  },
}))
