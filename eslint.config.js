// ESLint: the recommended rules plus what matters for an engine that must never throw on a stranger's input.
import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['node_modules/', 'types/', 'data/'] },
    js.configs.recommended,
    {
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.es2024 } },
        rules: {
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-constant-condition': ['error', { checkLoops: false }],
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'prefer-const': 'error',
            'no-var': 'error',
        },
    },
    { files: ['board/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
    { files: ['bin/**/*.js', 'bench/**/*.mjs', 'scripts/**/*.mjs', 'eslint.config.js'], languageOptions: { globals: { ...globals.node } } },
    { files: ['test/**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } } },
];
