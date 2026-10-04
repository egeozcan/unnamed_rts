// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: ['**/*', '!src/', '!src/**', '!tests/', '!tests/**', '!eslint.config.js']
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './tsconfig.test.json',
                tsconfigRootDir: import.meta.dirname
            },
            globals: { ...globals.browser, ...globals.node }
        },
        rules: {
            // TypeScript already checks undefined identifiers
            'no-undef': 'off',
            // Correctness
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'no-fallthrough': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
            '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
            // Style / hygiene
            'prefer-const': 'error',
            'no-var': 'error',
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }],
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrors: 'none'
            }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'off'
        }
    },
    {
        files: ['tests/**/*.ts', '**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off'
        }
    },
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: { globals: { ...globals.node } }
    }
);
