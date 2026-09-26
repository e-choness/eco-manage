
/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		fontFamily: {
  			sans: ['Geist', 'system-ui', 'sans-serif'],
  			mono: ['"Geist Mono"', 'ui-monospace', 'monospace']
  		},
  		backgroundImage: {
  			'app-gr': 'var(--gr)'
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			// App v2 palette (src/index.css)
  			app: {
  				bg: 'var(--bg)',
  				pn: 'var(--pn)',
  				ps: 'var(--ps)',
  				ln: 'var(--ln)',
  				l2: 'var(--l2)',
  				tx: 'var(--tx)',
  				sb: 'var(--sb)',
  				dm: 'var(--dm)',
  				ch: 'var(--ch)',
  				tr: 'var(--tr)',
  				rl: 'var(--rl)',
  				hv: 'var(--hv)'
  			},
  			tag: {
  				pv: 'var(--pvT)',
  				bat: 'var(--btT)',
  				grid: 'var(--gdT)',
  				ev: 'var(--evT)',
  				hp: 'var(--hpT)'
  			},
  			price: {
  				off: 'var(--op)',
  				mid: 'var(--md)',
  				peak: 'var(--pk)'
  			},
  			// Device colours, the same in both themes (COL in the design)
  			flow: {
  				pv: '#f2b33d',
  				bat: '#3ecf8e',
  				grid: '#5b9dff',
  				ev: '#b48cff',
  				hp: '#ff7a59',
  				gw: '#9aa7bd'
  			},
  			badge: {
  				DEFAULT: '#f2b33d',
  				foreground: '#1a1305'
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
}

