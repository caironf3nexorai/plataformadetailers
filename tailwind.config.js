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
          950: '#0A0D12',
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
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#3ED598',
          500: '#10B981',
          600: '#059669',
        },
        flare: {
          200: '#FECACA',
          300: '#FCA5A5',
          400: '#FF5A5A',
          500: '#EF4444',
          600: '#DC2626',
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
