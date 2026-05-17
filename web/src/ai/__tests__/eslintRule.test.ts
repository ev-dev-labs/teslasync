// Phase-50 / 0001 — F0 AI-Off Contract.
//
// Direct-Linter test for `teslasync/ai-component-must-be-wrapped`.
//
// We use `createRequire(import.meta.url)` to load the rule because
// the rule lives outside `web/src/` (in `web/eslint-rules/`) and
// Vite's dev-server FS sandbox refuses static `import` statements
// that escape the project root. `createRequire` evaluates at Node
// runtime and bypasses the analyzer entirely, which is the
// idiomatic vitest-on-Vite escape hatch for tooling files.
//
// This test exercises the rule's logic in isolation; the fact that
// the rule is correctly registered in `web/eslint.config.js` is
// proven by the `npm run lint` step in the slice-gate transcript.

import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requireFn = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const rulePath = path.resolve(here, '..', '..', '..', 'eslint-rules', 'ai-component-must-be-wrapped.js');
const ruleModule = requireFn(rulePath) as { default?: import('eslint').Rule.RuleModule };
// CJS-from-ESM interop returns either the namespace or the default
// export depending on the loader; tolerate both shapes.
const rule = (ruleModule.default ?? (ruleModule as unknown as import('eslint').Rule.RuleModule));

const linter = new Linter();
// `linter.verify`'s flat-config code path in ESLint 8 silently
// ignores `languageOptions.parser` for many in-tree parsers; the
// legacy `defineParser` + `parser: '<name>'` shape is the supported
// way to drive a TypeScript parser through `Linter.verify` directly.
linter.defineParser('@typescript-eslint/parser', tsParser as unknown as Linter.ParserModule);

function lint(filename: string, code: string) {
  return linter.verify(
    code,
    {
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      plugins: ['teslasync'] as unknown as string[],
      rules: { 'teslasync/ai-component-must-be-wrapped': 'error' },
    } as unknown as Linter.Config,
    { filename },
  );
}

// Register the rule under the `teslasync` plugin namespace so the
// rules-key form above resolves it. `defineRule` is the legacy
// counterpart to flat config's `plugins` map.
linter.defineRule('teslasync/ai-component-must-be-wrapped', rule);

describe('teslasync/ai-component-must-be-wrapped — valid cases', () => {
  it('feature-path file with inline withAiFeature default export', () => {
    const messages = lint(
      '/repo/web/src/features/chatbot/ai/AiPanel.tsx',
      `import { withAiFeature } from '@/components/ai/withAiFeature';
       function AiPanel() { return null; }
       export default withAiFeature('chatbot-llm', AiPanel);`,
    );
    expect(messages).toEqual([]);
  });

  it('feature-path file with indirect-binding withAiFeature export', () => {
    const messages = lint(
      '/repo/web/src/features/chatbot/ai/AiPanel.tsx',
      `import { withAiFeature } from '@/components/ai/withAiFeature';
       function AiPanel() { return null; }
       const Gated = withAiFeature('chatbot-llm', AiPanel);
       export default Gated;`,
    );
    expect(messages).toEqual([]);
  });

  it('non-AI file with raw default export is ignored', () => {
    const messages = lint(
      '/repo/web/src/features/dashboard/Dashboard.tsx',
      `export default function Dashboard() { return null; }`,
    );
    expect(messages).toEqual([]);
  });

  it('the wrapper file itself is excluded', () => {
    const messages = lint(
      '/repo/web/src/components/ai/withAiFeature.tsx',
      `export function withAiFeature() { return () => null; }
       export default withAiFeature;`,
    );
    expect(messages).toEqual([]);
  });
});

describe('teslasync/ai-component-must-be-wrapped — invalid cases', () => {
  it('feature-path file with raw default export is rejected', () => {
    const messages = lint(
      '/repo/web/src/features/chatbot/ai/AiPanel.tsx',
      `export default function AiPanel() { return null; }`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe('teslasync/ai-component-must-be-wrapped');
    expect(messages[0].messageId).toBe('mustWrap');
  });

  it('Ai-prefixed default export wrapped only by memo() is rejected', () => {
    // Use a feature-path file so the path heuristic catches this
    // even if the export-name signal is hidden inside memo(). Real
    // AI components in this repo always live under
    // web/src/features/<x>/ai/<file>.tsx; a memo()-wrapped raw
    // export there is exactly the kind of leak we want to catch.
    const messages = lint(
      '/repo/web/src/features/chatbot/ai/AiThing.tsx',
      `import { memo } from 'react';
       function AiThing() { return null; }
       export default memo(AiThing);`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe('teslasync/ai-component-must-be-wrapped');
  });

  it('feature-path file exporting an unrelated identifier is rejected', () => {
    const messages = lint(
      '/repo/web/src/features/chatbot/ai/AiPanel.tsx',
      `function AiPanel() { return null; }
       const Other = AiPanel;
       export default Other;`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe('teslasync/ai-component-must-be-wrapped');
  });
});
