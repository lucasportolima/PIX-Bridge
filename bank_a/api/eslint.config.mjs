// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.js', '**/*.d.ts'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Leverage TypeScript compiler instead of runtime checks
      ...tseslint.configs['recommended'].rules,

      // Zero tolerance for `any` — use unknown or explicit types
      '@typescript-eslint/no-explicit-any': 'error',

      // Enforce explicit return types on exported functions for readability
      '@typescript-eslint/explicit-function-return-type': ['warn', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      }],

      // Unused vars cause silent bugs — only allow underscore-prefixed params
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // Promises must be awaited or explicitly void-cast
      '@typescript-eslint/no-floating-promises': 'error',

      // Require await in async functions (prevents accidentally returning non-Promise)
      '@typescript-eslint/require-await': 'warn',

      // Consistent type imports for better tree-shaking
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      }],
    },
  },
  // Disable formatting rules that conflict with Prettier — Prettier owns formatting
  eslintConfigPrettier,
];
