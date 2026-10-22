import js from '@eslint/js'
import next from 'eslint-config-next'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import security from 'eslint-plugin-security'

/** ESLint 10 flat config (PLAN §6.1.4). */
export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'tsconfig.tsbuildinfo', '**/*.css'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      security,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...security.configs.recommended.rules,
      // The object-injection rule fires on every `record[key]` lookup. The
      // codebase uses typed Maps and controlled keys throughout, and rewriting
      // them to satisfy a heuristic would make the code worse, not safer.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**'],
  },
)
