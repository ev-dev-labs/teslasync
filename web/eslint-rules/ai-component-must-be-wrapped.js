// AI-off contract enforcement.
//
// Custom ESLint rule: `teslasync/ai-component-must-be-wrapped`.
//
// Statically enforces the invariant that every AI surface in
// the SPA goes through `withAiFeature(...)`. A component is in scope
// when EITHER:
//
// - Its file path matches `web/src/features/**/ai/**/*.tsx`
//   (the official AI feature directory layout).
//
// - It has a `default export` whose name matches `/^Ai[A-Z]/`
// (the project naming convention for AI-prefixed components,
// e.g. `AiChatbotPanel`, `AiFleetSummary`).
//
// For each in-scope component the rule asserts that the default
// export is the *return value* of a `withAiFeature(...)` call —
// either inline (`export default withAiFeature('id', Inner)`) or
// via a top-level binding (`const Wrapped = withAiFeature(...)
// export default Wrapped`).
//
// Counter-examples that this rule REJECTS:
//
// - `export default function AiChatbotPanel() { … }` (raw)
// - `export default AiChatbotPanel` (raw)
// - `export default memo(AiChatbotPanel)` (memo only)
// - `export default withRouter(AiChatbotPanel)` (wrong wrapper)
//
// Counter-example that this rule ACCEPTS:
//
// - `export default withAiFeature('chatbot-llm', AiChatbotPanel)`
// - `const Gated = withAiFeature('chatbot-llm', AiChatbotPanel); export default Gated;`
//
// The rule is intentionally conservative: it ONLY inspects default
// exports, because the AI feature loader (`React.lazy`) imports
// default exports. A named export that is unused by the loader
// cannot leak AI UI by definition.

'use strict';

import path from 'node:path';

const FEATURE_FILE_RE = /[\\/]src[\\/]features[\\/][^\\/]+[\\/]ai[\\/].+\.tsx$/i;
const AI_NAME_RE = /^Ai[A-Z]/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'AI feature components must be wrapped with withAiFeature() to enforce the ADR-015 AI-Off Contract.',
      recommended: true,
    },
    schema: [],
    messages: {
      mustWrap:
        "AI component '{{name}}' must be the return value of withAiFeature(...) " +
        'so the ADR-015 AI-Off Contract gates it. ' +
        "Wrap the default export: `export default withAiFeature('<feature-id>', {{name}})`.",
      mustWrapNoName:
        'This file appears to define an AI feature component but its default export is not ' +
        'the return value of withAiFeature(...). ' +
        'See ADR-015 (.github/prompts/db-refactor/adrs/ADR-015-ai-off-contract.md).',
    },
  },

  create(context) {
    const filename = context.getFilename();
    const isFeatureAiFile = FEATURE_FILE_RE.test(filename);

    // Track top-level bindings so `const X = withAiFeature(...)` followed
    // by `export default X` resolves correctly.
    const wrappedBindings = new Set();
    let defaultExportNode = null;
    let defaultExportName = null;

    function isWithAiFeatureCall(node) {
      if (!node || node.type !== 'CallExpression') return false;
      const callee = node.callee;
      // Direct identifier: `withAiFeature(...)`
      if (callee.type === 'Identifier' && callee.name === 'withAiFeature') {
        return true;
      }
      // Re-export form: `someNs.withAiFeature(...)`
      if (
        callee.type === 'MemberExpression' &&
        callee.property &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'withAiFeature'
      ) {
        return true;
      }
      return false;
    }

    return {
      // const Foo = withAiFeature(...) — record the binding.
      VariableDeclarator(node) {
        if (
          node.id &&
          node.id.type === 'Identifier' &&
          node.init &&
          isWithAiFeatureCall(node.init)
        ) {
          wrappedBindings.add(node.id.name);
        }
      },

      // export default <expr> — capture for end-of-program check.
      ExportDefaultDeclaration(node) {
        defaultExportNode = node;
        const decl = node.declaration;
        if (decl.type === 'Identifier') {
          defaultExportName = decl.name;
        } else if (
          decl.type === 'FunctionDeclaration' &&
          decl.id &&
          decl.id.name
        ) {
          defaultExportName = decl.id.name;
        } else if (
          decl.type === 'ClassDeclaration' &&
          decl.id &&
          decl.id.name
        ) {
          defaultExportName = decl.id.name;
        } else {
          defaultExportName = null;
        }
      },

      'Program:exit'() {
        if (!defaultExportNode) {
          // No default export — file is harmless from this rule's
          // perspective (the lazy() loader can't import nothing).
          return;
        }

        // Compute "is this an AI surface?" After the file has been
        // parsed, both the path and the export name are available.
        const looksLikeAiByName = defaultExportName && AI_NAME_RE.test(defaultExportName);
        const isAiSurface = isFeatureAiFile || looksLikeAiByName;
        if (!isAiSurface) return;

        // Allow withAiFeature.tsx itself + the off-mode invariant
        // suite, both of which legitimately handle the wrapper
        // without being a feature surface.
        const base = path.basename(filename);
        if (base === 'withAiFeature.tsx' || base === 'withAiFeature.test.tsx') {
          return;
        }

        const decl = defaultExportNode.declaration;

        // Direct: `export default withAiFeature(...)`
        if (isWithAiFeatureCall(decl)) return;

        // Indirect: `export default Identifier` where Identifier was
        // assigned `withAiFeature(...)` earlier in the file.
        if (
          decl.type === 'Identifier' &&
          wrappedBindings.has(decl.name)
        ) {
          return;
        }

        context.report({
          node: defaultExportNode,
          messageId: defaultExportName ? 'mustWrap' : 'mustWrapNoName',
          data: { name: defaultExportName ?? 'default export' },
        });
      },
    };
  },
};

export default rule;
