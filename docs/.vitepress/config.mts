import { execSync } from 'node:child_process'
import { defineConfig } from 'vitepress'

// "Last updated" dates come from git: on in CI, off in the dev image (it has no git).
const hasGit = (() => {
  try {
    execSync('git --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

// The documentation site, published to GitHub Pages at /eco-manage/ by .github/workflows/docs.yml.
// The reference pages are the same markdown files the repository links to.

const repo = 'https://github.com/e-choness/eco-manage'

export default defineConfig({
  title: 'EcoManage',
  description: 'Energy management for buildings with solar, batteries, EV chargers and heat pumps.',
  base: '/eco-manage/',
  lang: 'en-CA',
  cleanUrls: true,
  lastUpdated: hasGit,
  // Design handoff bundles, old notes and the folder's own README aren't part of the site.
  srcExclude: ['project/**', 'README.md', 'README-old.md'],
  // Reference pages link into the repository (source files, the root README), and the guide to
  // local services (localhost); neither is a page.
  ignoreDeadLinks: [/^\.\.\//, /^\.\/\.\.\//, /^https?:\/\/localhost/],
  // The dev server answers to its compose name (screenshots, links) and Codespaces' forwarded hosts.
  vite: { server: { allowedHosts: ['docs', '.app.github.dev'] } },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/eco-manage/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#3ecf8e' }],
    ['meta', { property: 'og:image', content: 'https://e-choness.github.io/eco-manage/media/banner-16x9.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['link', { rel: 'apple-touch-icon', href: '/eco-manage/apple-touch-icon.png' }],
  ],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: 'Reference', link: '/ARCHITECTURE', activeMatch: '/(ARCHITECTURE|API_REFERENCE|DATABASE|GATEWAY|DEPLOYMENT|TESTING|TROUBLESHOOTING|CONTRIBUTING)' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'What it does', link: '/guide/features' },
          { text: 'Explanations', link: '/guide/explanations' },
          { text: 'Hosting a demo', link: '/guide/demo-hosting' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Architecture', link: '/ARCHITECTURE' },
          { text: 'API', link: '/API_REFERENCE' },
          { text: 'Database', link: '/DATABASE' },
          { text: 'Gateway agent', link: '/GATEWAY' },
        ],
      },
      {
        text: 'Operations',
        items: [
          { text: 'Deployment', link: '/DEPLOYMENT' },
          { text: 'Testing', link: '/TESTING' },
          { text: 'Troubleshooting', link: '/TROUBLESHOOTING' },
          { text: 'Contributing', link: '/CONTRIBUTING' },
        ],
      },
      { text: 'Changelog', link: '/changelog' },
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    outline: { level: [2, 3] },
    footer: { message: 'Proprietary. All rights reserved.', copyright: '© EcoManage' },
  },
})
