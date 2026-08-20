/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        graphite: {
          900: '#0F1216',
          800: '#171B21',
          700: '#1F242C',
          600: '#2B323C',
        },
        vapor: {
          100: '#EDF0F3',
          400: '#98A2B0',
          600: '#5D6773',
        },
        amber: {
          500: '#FF8A3D',
          600: '#E5761F',
        },
        glass: {
          400: '#5EC8FF',
        },
        mint: {
          400: '#3ED598',
        },
        flare: {
          400: '#FF5A5A',
        }
      },
      fontFamily: {
        display: ['Archivo', 'sans-serif'],
        sans: ['IBM Plex Sans', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '4px',
        md: '8px',
      },
    },
  },
  plugins: [],
}
