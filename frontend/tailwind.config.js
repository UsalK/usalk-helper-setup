/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fbf8f3',
          100: '#f5edd9',
          200: '#ebd9b1',
          300: '#debe82',
          400: '#d0a256',
          500: '#c28637',
          600: '#a96a2b',
          700: '#8c5124',
          800: '#734120',
          900: '#5e341b',
        }
      }
    },
  },
  plugins: [],
}
