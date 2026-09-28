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
  // Local working notes (never in git) and the folder's own README aren't part of the site.
  srcExclude: ['project/**', 'README.md', 'README-old.md'],
  // Every link between pages is checked at build time. Source files are linked on GitHub; the only
  // exception is local services (localhost), which aren't pages.
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  // The dev server answers to its compose name (screenshots, links) and Codespaces' forwarded hosts.
  vite: { server: { allowedHosts: ['docs', '.app.github.dev'] } },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/eco-manage/favicon.svg' }],
    // The wordmark's face (Audiowide), for the letters of "EcoManage" only.
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Audiowide&text=EcoManage&display=swap' }],
    ['meta', { name: 'theme-color', content: '#3ecf8e' }],
    ['meta', { property: 'og:image', content: 'https://e-choness.github.io/eco-manage/media/banner-16x9.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['link', { rel: 'apple-touch-icon', href: '/eco-manage/apple-touch-icon.png' }],
  ],
  themeConfig: {
    logo: '/favicon.svg',
    // Four sections, by reader: people using the app, people running it, people changing it, and
    // the reference all of them look things up in.
    nav: [
      { text: 'User guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Deploy', link: '/deploy/', activeMatch: '/deploy/' },
      { text: 'Develop', link: '/develop/', activeMatch: '/develop/' },
      { text: 'Reference', link: '/reference/api', activeMatch: '/reference/' },
      { text: 'Changelog', link: '/changelog' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Start here',
          items: [
            { text: 'Introduction', link: '/guide/' },
            { text: 'Try the demo', link: '/guide/getting-started' },
            { text: 'Roles and access', link: '/guide/roles' },
          ],
        },
        {
          text: 'Using EcoManage',
          items: [
            { text: 'Home: the live site', link: '/guide/home' },
            { text: 'Devices', link: '/guide/devices' },
            { text: 'History and reports', link: '/guide/history' },
            { text: 'Bills and tariffs', link: '/guide/bills' },
            { text: 'Inbox: decisions and alerts', link: '/guide/inbox' },
            { text: 'Settings', link: '/guide/settings' },
            { text: 'The site model', link: '/guide/site-model' },
            { text: 'Explanations in plain words', link: '/guide/explanations' },
          ],
        },
      ],
      '/deploy/': [
        {
          text: 'Running EcoManage',
          items: [
            { text: 'Overview', link: '/deploy/' },
            { text: 'On a server', link: '/deploy/production' },
            { text: 'On Oracle Cloud', link: '/deploy/oracle' },
            { text: 'Hosting a demo for free', link: '/deploy/demo-hosting' },
          ],
        },
        {
          text: 'Setting up',
          items: [
            { text: 'Configuration', link: '/deploy/configuration' },
            { text: 'Installing a gateway', link: '/deploy/gateway' },
            { text: 'Security', link: '/deploy/security' },
          ],
        },
        {
          text: 'Looking after it',
          items: [
            { text: 'Operations', link: '/deploy/operations' },
            { text: 'Troubleshooting', link: '/deploy/troubleshooting' },
          ],
        },
      ],
      '/develop/': [
        {
          text: 'Getting going',
          items: [
            { text: 'Development setup', link: '/develop/' },
            { text: 'Architecture', link: '/develop/architecture' },
          ],
        },
        {
          text: 'How it works',
          items: [
            { text: 'API', link: '/develop/api' },
            { text: 'Web app', link: '/develop/web' },
            { text: 'Ingest and intervals', link: '/develop/ingest' },
            { text: 'Rules: alerts, recommendations, commands', link: '/develop/rules' },
            { text: 'Worker: bills, email, reports, forecasts', link: '/develop/worker' },
            { text: 'Simulator', link: '/develop/simulator' },
            { text: 'Gateway agent', link: '/develop/gateway-agent' },
            { text: '3D model converter', link: '/develop/model-converter' },
          ],
        },
        {
          text: 'Making changes',
          items: [
            { text: 'Extending EcoManage', link: '/develop/extending' },
            { text: 'Testing', link: '/develop/testing' },
            { text: 'Contributing', link: '/develop/contributing' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'REST API', link: '/reference/api' },
            { text: 'MQTT topics and messages', link: '/reference/mqtt' },
            { text: 'Database', link: '/reference/database' },
            { text: 'Device profiles', link: '/reference/device-profiles' },
            { text: 'Configuration', link: '/deploy/configuration' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    outline: { level: [2, 3] },
    footer: { message: 'Proprietary. All rights reserved.', copyright: '© EcoManage' },
  },
})
