/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Eqova Medicare brand palette, from the brand kit.
        eqova: {
          navy: '#0E3C56',   // primary
          gold: '#F1AF38',   // primary accent
          grey: '#A0A3A6',   // primary neutral
          mist: '#F1F1F1',   // primary light
          ink: '#232323',    // secondary
          crimson: '#970E10', // secondary
        },
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          200: '#bcdcff',
          300: '#8ec6ff',
          400: '#59a5ff',
          500: '#3182f6',
          600: '#1d63db',
          700: '#194fb0',
          800: '#1a448c',
          900: '#1b3c73',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
