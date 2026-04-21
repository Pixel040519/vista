/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        navy: {
          950: '#050c1a',
          900: '#0a1628',
          800: '#0f2040',
          700: '#152a52',
          600: '#1e3a6e',
        },
        brand: {
          50:  '#eef3fb',
          100: '#dbe5f6',
          200: '#b9cbec',
          300: '#89a5dc',
          400: '#5c7fc8',
          500: '#2b4f9e',
          600: '#1f3d82',
          700: '#17306a',
        },
        accent: '#f0a500',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease forwards',
        'slide-up': 'slideUp 0.4s ease forwards',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        pulseSoft: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } },
      }
    }
  },
  plugins: []
}