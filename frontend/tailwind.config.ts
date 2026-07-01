import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

// Design tokens sourced directly from docs/design-system.md §1. Colors are backed by CSS
// variables (defined in src/index.css) rather than hard-coded hex values so the Theme settings
// tab (a later phase) can swap `--accent`/`--accent-light`/`--accent-mid` at runtime without a
// rebuild — the one part of the palette that's per-user; everything else is a fixed, shared
// token per docs/design-system.md §1.1.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-2': 'var(--color-surface-2)',
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        text: {
          DEFAULT: 'var(--color-text)',
          muted: 'var(--color-text-muted)',
          faint: 'var(--color-text-faint)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          light: 'var(--accent-light)',
          mid: 'var(--accent-mid)',
        },
        success: {
          DEFAULT: 'var(--color-green)',
          light: 'var(--color-green-light)',
        },
        warning: {
          DEFAULT: 'var(--color-amber)',
          light: 'var(--color-amber-light)',
        },
        danger: {
          DEFAULT: 'var(--color-red)',
          light: 'var(--color-red-light)',
        },
        special: {
          DEFAULT: 'var(--color-purple)',
          light: 'var(--color-purple-light)',
        },
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
      },
      boxShadow: {
        md: '0 4px 16px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'system-ui',
          'sans-serif',
        ],
        serif: ['"Times New Roman"', 'serif'],
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
