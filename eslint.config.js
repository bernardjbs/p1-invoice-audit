import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  // Ignore build output, deps, and installed third-party agent skills
  // (.agents/skills + the .claude/skills symlinks into them).
  { ignores: ['**/dist/**', '**/node_modules/**', '.agents/**', '.claude/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Web (browser) — React 19 + hooks discipline.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // API + root config files run on Node.
  {
    files: ['apps/api/**/*.ts', '*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Prettier last — turns off all formatting rules ESLint might fight over.
  prettier,
)
