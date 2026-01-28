import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Unnamed RTS',
  description: 'Browser-based real-time strategy game',
  base: '/unnamed_rts/',

  themeConfig: {
    nav: [
      { text: 'Play', link: '/game/', target: '_self' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Units', link: '/units/infantry' },
      { text: 'Buildings', link: '/buildings/' },
      { text: 'Strategy', link: '/strategy/build-orders' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/getting-started' },
            { text: 'Controls', link: '/guide/controls' },
            { text: 'Economy', link: '/guide/economy' },
            { text: 'Production', link: '/guide/production' },
            { text: 'Combat', link: '/guide/combat' }
          ]
        }
      ],
      '/units/': [
        {
          text: 'Units',
          items: [
            { text: 'Infantry', link: '/units/infantry' },
            { text: 'Vehicles', link: '/units/vehicles' },
            { text: 'Aircraft', link: '/units/aircraft' }
          ]
        }
      ],
      '/buildings/': [
        {
          text: 'Buildings',
          items: [
            { text: 'Overview', link: '/buildings/' }
          ]
        }
      ],
      '/strategy/': [
        {
          text: 'Strategy',
          items: [
            { text: 'Build Orders', link: '/strategy/build-orders' },
            { text: 'Unit Counters', link: '/strategy/unit-counters' },
            { text: 'Advanced Tactics', link: '/strategy/advanced-tactics' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/egecan/unnamed_rts' }
    ]
  }
})
