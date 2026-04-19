/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#232323',
        slate808: '#4d4e4f',
        cream: '#fff6ea',
        'cream-deep': '#f5ead5',
        paper: '#fffdf8',
        crimson: '#a80404',
        'crimson-dark': '#7d0303',
        line: '#e6dcc6',
        'line-soft': '#f0e6d2',
        muted: '#8a8070',
        ok: '#2d6a4f',
        warn: '#b8860b'
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        bebas: ['"Bebas Neue"', 'Impact', 'sans-serif']
      }
    }
  },
  plugins: []
};
