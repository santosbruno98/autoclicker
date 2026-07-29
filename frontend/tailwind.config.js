/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        housing: '#0B0D0F',
        panel: '#14171A',
        'panel-border': '#2A2F35',
        amber: '#FFB000',
        'amber-dim': '#7A5200',
        led: {
          run: '#3DDC84',
          stop: '#FF4D4D',
        },
        ink: {
          primary: '#E8E6E1',
          secondary: '#8A9099',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};