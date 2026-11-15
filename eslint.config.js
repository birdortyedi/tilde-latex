import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'public/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  // Small helper scripts that run in Node, not in the browser.
  { files: ['scripts/**'], languageOptions: { globals: { console: 'readonly' } } },
);
