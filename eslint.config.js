import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'public/wasm', 'src/rust-pkg']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  // Dev-only one-shot scripts and CLI tools: relax unused-var and
  // useless-escape rules so leftover scaffolding (intermediate
  // constants, partially used imports, diagnostic regex strings)
  // doesn't gate CI. None of this code ships to production — the
  // production bundle never imports anything under scripts/ or tools/.
  {
    files: ['scripts/**/*.{ts,tsx,mjs,cjs,js}', 'tools/**/*.{ts,tsx,mjs,cjs,js}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-escape': 'off',
    },
  },
])
