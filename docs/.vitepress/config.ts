import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'TeslaSync Docs',
  description: 'Documentation for TeslaSync - Tesla Fleet Intelligence Platform',
  base: '/TeslaSync/',

  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/TeslaSync/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#00f0ff' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'TeslaSync Docs' }],
    ['meta', { name: 'og:description', content: 'Documentation for TeslaSync - Tesla Fleet Intelligence Platform' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'TeslaSync',

    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Deployment', link: '/deployment/docker', activeMatch: '/deployment/' },
      { text: 'Features', link: '/features/dashboard', activeMatch: '/features/' },
      { text: 'Contributing', link: '/contributing/code-structure', activeMatch: '/contributing/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Local Development', link: '/guide/local-development' },
            { text: 'Architecture', link: '/guide/architecture' },
            { text: 'Diagrams', link: '/guide/diagrams' },
            { text: 'Technology Stack', link: '/guide/technology' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
            { text: 'FAQ', link: '/guide/faq' },
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
            { text: 'Alerts & Notifications', link: '/features/alerts' },
            { text: 'Data Export', link: '/features/data-export' },
            { text: 'Analytics & Charts', link: '/features/analytics' },
          ],
        },
      ],
      '/contributing/': [
        {
          text: 'Contributing',
          items: [
            { text: 'Code Structure', link: '/contributing/code-structure' },
            { text: 'Adding Features', link: '/contributing/adding-features' },
            { text: 'API Reference', link: '/contributing/api-reference' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/your-org/TeslaSync' },
    ],

    editLink: {
      pattern: 'https://github.com/your-org/TeslaSync/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 TeslaSync Contributors',
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
    },
  },
})
