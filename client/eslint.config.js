import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Ignore PascalCase / CONSTANT names for both vars and args: component
      // identifiers used only inside JSX (e.g. a destructured `Icon`) aren't seen
      // as "used" by core no-unused-vars without eslint-plugin-react's
      // jsx-uses-vars, so this keeps them from being false-flagged.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
      // React Compiler rule — this project doesn't run the compiler (plain
      // @vitejs/plugin-react), so its manual useMemo/useCallback are intentional.
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
])
