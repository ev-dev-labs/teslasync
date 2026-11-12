import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import catalog from './en.json';
import settingsCatalog from './en/locale-settings.json';
import themeCatalog from './en/locale-detail-theme.json';
import transition from './__fixtures__/widget-implementation-transition.json';
import appDesign from './__fixtures__/app-design-preservation.json';
import helpCold from './__fixtures__/help-cold-preservation.json';
import replayUrlRace from './__fixtures__/replay-url-race-preservation.json';
import replayTransitionQueue from './__fixtures__/replay-transition-queue-preservation.json';
import runtimeV9 from './__fixtures__/runtime-v9-preservation.json';
import previewMapFrame from './__fixtures__/preview-map-frame-preservation.json';
import previewOverlayInvoker from './__fixtures__/preview-overlay-invoker-preservation.json';
import previewMapPopup from './__fixtures__/preview-map-popup-preservation.json';
import previewOverlayTooltip from './__fixtures__/preview-overlay-tooltip-preservation.json';
import tableNoMatch from './__fixtures__/table-no-match-preservation.json';
import previewMapReset from './__fixtures__/preview-map-reset-preservation.json';
import previewOverlayHelpInset from './__fixtures__/preview-overlay-help-inset-preservation.json';
import commandDeckModal from './__fixtures__/command-deck-modal-preservation.json';
import tableEmptyViewport from './__fixtures__/table-empty-viewport-preservation.json';
import settingsPreviewInvoker from './__fixtures__/settings-preview-invoker-preservation.json';
import previewChartQuery from './__fixtures__/preview-chart-query-preservation.json';
import { producerProjection } from './producer-projection';
import { nativeRepairPredecessor, restoreNativeSourceRepair } from './verified-native-source-repair-contract';
import {
  catalogBeforeAppDesign, catalogBeforeWidgetImplementation,
  restoreAppDesignSource, restoreHelpColdSource, restoreReplayUrlRaceSource, restoreWidgetImplementationSource,
  restoreReplayTransitionQueueSource, restoreRuntimeV9Source, restorePreviewMapFrameSource,
  restorePreviewOverlayInvokerSource, restorePreviewMapPopupSource,
  restorePreviewOverlayTooltipSource, restoreTableNoMatchSource, restorePreviewMapControlsSource,
  restorePreviewOverlayHelpInsetSource,
  restoreCommandDeckModalSource,
  restoreTableEmptyViewportSource,
  restoreSettingsPreviewInvokerSource,
  restorePreviewChartQuerySource,
} from './verified-widget-implementation-contract';

describe('additive widget implementation preservation', () => {
  it('rejects source drift instead of silently projecting an unverified edit', () => {
    const patch = transition.sources[0];
    const source = readFileSync(resolve(process.cwd(), '..', patch.file), 'utf8');
    expect(restoreWidgetImplementationSource(patch.file, source)).not.toBe(source);
    expect(() => restoreWidgetImplementationSource(patch.file, source + '\n')).toThrow();
  });

  const source = (file: string) => readFileSync(resolve(process.cwd(), '..', file), 'utf8');
  // Only historical comparisons consume this independently verified successor
  // inverse. Actual new-source assertions below continue reading source().
  const historicalSource = (file: string) => nativeRepairPredecessor(file, source);
  const runtimePredecessor = (file: string) => restoreRuntimeV9Source(file, historicalSource(file));
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const previewProducerPredecessor = (file: string, text: string) =>
    restorePreviewOverlayInvokerSource(file, restorePreviewOverlayTooltipSource(file,
      restorePreviewOverlayHelpInsetSource(file, restorePreviewMapFrameSource(file, restorePreviewMapPopupSource(file,
        restorePreviewMapControlsSource(file, restoreTableNoMatchSource(file, restoreTableEmptyViewportSource(file, restorePreviewChartQuerySource(file, text)))))))));
  function translationCalls(file: string, text: string): ts.CallExpression[] {
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: ts.CallExpression[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && (
        ts.isIdentifier(node.expression) && node.expression.text === 't'
        || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'
      )) found.push(node);
      ts.forEachChild(node, visit);
    }
    visit(tree);
    return found;
  }
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  const signature = (call: ts.CallExpression) =>
    printer.printNode(ts.EmitHint.Expression, call, call.getSourceFile());
  function nested(resource: unknown, path: string[]): unknown {
    return path.reduce<unknown>((value, key) =>
      value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, resource);
  }

  describe('exact additive application-design preservation', () => {
    it.each(appDesign.sources)('preserves complete source and every original call in $file', patch => {
      const current = source(patch.file);
      const previous = restoreAppDesignSource(patch.file, current);
      const designCurrent = restoreNativeSourceRepair(patch.file, current);
      expect(hash(restoreRuntimeV9Source(patch.file,
        restoreTableNoMatchSource(patch.file,
          restoreCommandDeckModalSource(patch.file, restoreTableEmptyViewportSource(patch.file, designCurrent)))))).toBe(patch.after);
      expect(hash(previous)).toBe(patch.before);
      expect(previous).not.toBe(current);
      const moved = appDesign.relocations.filter(([owner]) => owner === patch.file)
        .map(([, target]) => ({ file: target, text: historicalSource(target) }));
      const actualSources = [{ file: patch.file, text: designCurrent }, ...moved];
      const actualCalls = actualSources.flatMap(entry =>
        translationCalls(entry.file, entry.text).map(signature));
      // Consume occurrences, not a Set: relocation cannot silently drop a
      // duplicate original call, default, arity or complete option operand.
      for (const call of translationCalls(patch.file, previous)) {
        const expected = signature(call);
        const index = actualCalls.indexOf(expected);
        expect(index, patch.file + ': protected original call ' + expected).toBeGreaterThanOrEqual(0);
        actualCalls.splice(index, 1);
      }
      const bindings = actualSources.flatMap(entry => producerProjection(entry.file, entry.text).bindings);
      for (const binding of producerProjection(patch.file, previous).bindings) {
        expect(bindings, patch.file + ': original translator/unit origin').toContain(binding);
      }
      // These are current-byte approvals, never permission to ship old source.
      expect(() => restoreAppDesignSource(patch.file, previous)).toThrow();
      expect(() => restoreAppDesignSource(patch.file, current + '\n// unrelated edit\n')).toThrow();
      expect(() => restoreAppDesignSource(patch.file, current.slice(1))).toThrow();
      expect(source(patch.file)).toBe(current);
    });

    it.each(appDesign.relocations)('keeps moved original calls in the actual cold body: %s → %s', (owner, target) => {
      const current = source(owner);
      const previous = restoreAppDesignSource(owner, current);
      const retained = translationCalls(owner, restoreNativeSourceRepair(owner, current)).map(signature);
      const body = translationCalls(target, historicalSource(target)).map(signature);
      let moved = 0;
      for (const call of translationCalls(owner, previous)) {
        const expected = signature(call);
        const index = retained.indexOf(expected);
        if (index >= 0) retained.splice(index, 1);
        else {
          const destination = body.indexOf(expected);
          expect(destination, target + ': moved original ' + expected).toBeGreaterThanOrEqual(0);
          body.splice(destination, 1);
          moved++;
        }
      }
      expect(moved, owner + ': genuine body extraction').toBeGreaterThan(0);
      expect(source(owner)).toContain(target.split('/').at(-1)!.replace('.tsx', ''));
    });

    it('pins real new producers and every exact authorized catalog key/default before subtraction', () => {
      const calls = appDesign.catalogProducers.flatMap(producer => {
        const current = source(producer.file);
        const predecessor = previewProducerPredecessor(producer.file, current);
        expect(hash(predecessor), producer.file + ': complete preview producer').toBe(producer.sha256);
        return translationCalls(producer.file, current);
      });
      for (const addition of appDesign.catalogAdditions) {
        const key = addition.path.join('.');
        const actual = calls.filter(call =>
          ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === key);
        expect(actual.length, key + ': actual source producer').toBeGreaterThan(0);
        for (const call of actual) {
          const fallback = call.arguments[1];
          expect(ts.isStringLiteral(fallback), key + ': literal fallback').toBe(true);
          if (ts.isStringLiteral(fallback)) expect(fallback.text, key).toBe(addition.value);
        }
        for (const resource of [catalog, settingsCatalog, themeCatalog]) {
          expect(nested(resource, addition.path), key + ': shipping English').toBe(addition.value);
        }
      }
      expect(catalogBeforeAppDesign(catalog).theme).not.toHaveProperty('appDesignPreview');
      expect(catalog.theme.appDesignPreview.overview).toBe('Overview');
    });

    it('rejects changed, missing and unapproved additive copy without touching frozen catalog leaves', () => {
      const changed = structuredClone(catalog);
      changed.theme.appDesignPreview.overview = 'Changed default';
      expect(() => catalogBeforeAppDesign(changed)).toThrow();
      const missing: Record<string, unknown> = structuredClone(catalog.theme.appDesignPreview);
      delete missing.overview;
      expect(() => catalogBeforeAppDesign({ ...catalog, theme: { ...catalog.theme, appDesignPreview: missing } })).toThrow();
      expect(() => catalogBeforeAppDesign({
        ...catalog, theme: { ...catalog.theme, appDesignPreview: { ...catalog.theme.appDesignPreview, unapproved: 'Extra' } },
      })).toThrow();
      const previous = catalogBeforeAppDesign(catalog);
      const { appDesignPreview: additions, ...retainedTheme } = catalog.theme;
      expect(Object.keys(additions)).toHaveLength(110);
      expect(previous).toEqual({ ...catalog, theme: retainedTheme });
    });

    it('does not exempt unrelated producers, even at a similarly named path', () => {
      const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      expect(restoreAppDesignSource('web/src/components/layout/LayoutOther.tsx', text)).toBe(text);
    });
  });

  describe('exact fourth cold pair: Help menu, not the abandoned Nav experiment', () => {
    const owner = 'web/src/components/layout/status-bar/HelpSegment.tsx';
    const body = 'web/src/components/layout/status-bar/HelpMenuContent.tsx';
    const tree = (file: string, text: string) =>
      ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function initializer(file: string, text: string, name: string): string {
      const parsed = tree(file, text);
      let found: ts.Expression | undefined;
      function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
          expect(found, name + ': unique declaration').toBeUndefined();
          found = node.initializer;
        }
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      expect(found, name + ': real source initializer').toBeDefined();
      return found!.getText(parsed);
    }
    function assertOriginalOrigin(file: string, text: string) {
      const parsed = tree(file, text);
      expect(parsed.statements.some(statement => ts.isImportDeclaration(statement)
        && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === 'react-i18next'
        && statement.importClause?.namedBindings
        && ts.isNamedImports(statement.importClause.namedBindings)
        && statement.importClause.namedBindings.elements.some(binding =>
          binding.name.text === 'useTranslation' && !binding.propertyName))).toBe(true);
      for (const call of translationCalls(file, text)) {
        let binding: ts.VariableDeclaration | undefined;
        for (let scope: ts.Node | undefined = call.parent; scope && !binding; scope = scope.parent) {
          if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
          for (const statement of scope.statements) {
            if (!ts.isVariableStatement(statement)) continue;
            binding = statement.declarationList.declarations.find(declaration =>
              ts.isObjectBindingPattern(declaration.name) && declaration.name.elements.some(element =>
                ts.isIdentifier(element.name) && element.name.text === 't' && !element.propertyName));
            if (binding) break;
          }
        }
        expect(binding?.initializer?.getText(), file + ': original installed default translator')
          .toBe('useTranslation()');
      }
    }

    it('pins only the exact released Help pair and its complete predecessor bytes', () => {
      expect(helpCold.sources.map(patch => patch.file)).toEqual([owner]);
      expect(helpCold.relocations).toEqual([[owner, body]]);
      const patch = helpCold.sources[0];
      const current = source(owner);
      const previous = restoreAppDesignSource(owner, current);
      expect(hash(current)).toBe(patch.after);
      expect(hash(previous)).toBe(patch.before);
      expect(previous).not.toBe(current);
      expect(() => restoreAppDesignSource(owner, previous)).toThrow();
      expect(() => restoreAppDesignSource(owner, current + '\n// unrelated change\n')).toThrow();
      expect(() => restoreAppDesignSource(owner, current.slice(1))).toThrow();
      expect(restoreHelpColdSource(owner.replace('HelpSegment', 'HelpSegmentOther'), current)).toBe(current);
      expect(source(owner)).toBe(current);
    });

    it('retains all twelve original call occurrences, seven in the real cold body and five in the host', () => {
      const current = source(owner);
      const content = source(body);
      const previous = restoreAppDesignSource(owner, current);
      const original = translationCalls(owner, previous).map(signature);
      const hostCalls = translationCalls(owner, current).map(signature);
      const moved = translationCalls(body, content).map(signature);
      expect(original).toEqual(helpCold.originalCalls);
      expect(original).toHaveLength(12);
      expect(moved).toEqual(helpCold.movedCalls);
      expect(moved).toHaveLength(7);
      expect(helpCold.retainedCalls).toHaveLength(5);
      expect(hostCalls).toEqual([...helpCold.addedLoaderCalls, ...helpCold.retainedCalls]);
      const remaining = [...hostCalls, ...moved];
      for (const expected of original) {
        const index = remaining.indexOf(expected);
        expect(index, 'protected original Help key/default/arity/options: ' + expected).toBeGreaterThanOrEqual(0);
        remaining.splice(index, 1);
      }
      expect(remaining).toEqual(helpCold.addedLoaderCalls);
      for (const [file, text] of [[owner, previous], [owner, current], [body, content]]) {
        assertOriginalOrigin(file, text);
      }
      const bindings = [...producerProjection(owner, current).bindings, ...producerProjection(body, content).bindings];
      for (const binding of producerProjection(owner, previous).bindings) {
        expect(bindings, 'original translator/unit binding').toContain(binding);
      }
    });

    it('keeps the original menu, action ordering, public API and eager trigger lifecycle byte-for-byte', () => {
      const current = source(owner);
      const content = source(body);
      const previous = restoreAppDesignSource(owner, current);
      const parsed = tree(body, content);
      const component = parsed.statements.find(statement =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === 'HelpMenuContent');
      expect(component && ts.isFunctionDeclaration(component) && component.body).toBeTruthy();
      if (!component || !ts.isFunctionDeclaration(component) || !component.body) throw new Error('Missing real Help body');
      const returned = component.body.statements.find(ts.isReturnStatement);
      expect(returned?.expression?.getText(parsed)).toBe(initializer(owner, previous, 'menu'));
      for (const name of ['menuActionClassName', 'runAndClose']) {
        expect(initializer(body, content, name), name).toBe(initializer(owner, previous, name));
      }
      const publicStart = 'export interface HelpSegmentProps';
      const publicEnd = '\n}\n';
      const publicApi = (text: string) =>
        text.slice(text.indexOf(publicStart), text.indexOf(publicEnd, text.indexOf(publicStart)) + publicEnd.length);
      expect(publicApi(current)).toBe(publicApi(previous));
      const functionStart = 'export function HelpSegment(';
      expect(current.slice(current.indexOf(functionStart), current.indexOf('  const menu =')))
        .toBe(previous.slice(previous.indexOf(functionStart), previous.indexOf('  const menuActionClassName =')));
      const eagerTail = '  if (embedded) {';
      expect(current.slice(current.indexOf(eagerTail))).toBe(previous.slice(previous.indexOf(eagerTail)));
    });

    it('enumerates and hashes every direct local host/body dependency without wildcard exemptions', () => {
      const actual = new Set([body]);
      const approved = helpCold.dependencies.map(dependency => dependency.file);
      for (const file of [owner, body]) {
        const parsed = tree(file, source(file));
        for (const statement of parsed.statements) {
          if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
          const specifier = statement.moduleSpecifier.text;
          if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
          const base = specifier.startsWith('@/') ? 'web/src/' + specifier.slice(2)
            : posix.normalize(posix.join(posix.dirname(file), specifier));
          const resolved = ['.ts', '.tsx', '/index.ts', '/index.tsx']
            .map(extension => base + extension).filter(candidate => approved.includes(candidate));
          expect(resolved, file + ': real dependency ' + specifier).toHaveLength(1);
          actual.add(resolved[0]);
        }
      }
      expect([...actual].sort()).toEqual([...approved].sort());
      expect(approved).toHaveLength(14);
      for (const dependency of helpCold.dependencies) {
        expect(hash(runtimePredecessor(dependency.file)), dependency.file).toBe(dependency.sha256);
      }
    });

    it.each(helpCold.dependencies)('rejects changed real dependency bytes: $file', dependency => {
      const current = source(owner);
      expect(() => restoreHelpColdSource(owner, current, file =>
        source(file) + (file === dependency.file ? '\n// unapproved dependency change\n' : ''))).toThrow();
    });

    it('rejects changed protected host and moved-body defaults before historical projection', () => {
      const current = source(owner);
      const hostCall = "t('statusBar.help.open', 'Open help and about')";
      const movedCall = "t('help.shortcuts', 'Open keyboard shortcuts')";
      expect(current.split(hostCall)).toHaveLength(2);
      expect(source(body).split(movedCall)).toHaveLength(2);
      expect(() => restoreAppDesignSource(owner, current.replace(hostCall,
        "t('statusBar.help.open', 'Changed default')"))).toThrow();
      expect(() => restoreHelpColdSource(owner, current, file =>
        file === body ? source(file).replace(movedCall,
          "t('help.shortcuts', 'Changed moved default')") : source(file))).toThrow();
    });
  });

  describe('exact parent-owned Replay URL race repair', () => {
    const file = 'web/src/features/trips/pages/TripReplayPage.tsx';
    const patch = replayUrlRace.sources[0];
    // Keep every original CF-stage proof, reached only through the strictly
    // verified successor inverse. Never feed unverified shipping bytes here.
    const reviewedCfSource = () => restoreReplayTransitionQueueSource(file, runtimePredecessor(file));

    it('reconstructs the independently frozen pre-repair page without refreshing earlier approvals', () => {
      expect(replayUrlRace.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks).toHaveLength(3);
      expect(patch.before).toBe('00ddb78ca752dc514eb05a70121f0dbc5247db762ec85fc79ab298c184edbfde');
      expect(patch.before).toBe(replayUrlRace.independentPredecessorProof.sha256);
      const current = reviewedCfSource();
      const previous = restoreReplayUrlRaceSource(file, current);
      expect(hash(current)).toBe(patch.after);
      expect(hash(previous)).toBe(patch.before);
      expect(restoreAppDesignSource(file, source(file))).toBe(previous);
      expect(previous).not.toBe(current);
      expect(() => restoreReplayUrlRaceSource(file, previous)).toThrow();
      expect(() => restoreReplayUrlRaceSource(file, current + '\n// unrelated edit\n')).toThrow();
      expect(() => restoreReplayUrlRaceSource(file, current.slice(1))).toThrow();
      expect(reviewedCfSource()).toBe(current);
    });

    it('preserves every original call occurrence, default, arity, options, enclosing controls and binding', () => {
      const current = reviewedCfSource();
      const previous = restoreReplayUrlRaceSource(file, current);
      const originalCalls = translationCalls(file, previous).map(signature);
      expect(originalCalls).toHaveLength(patch.originalCallCount);
      expect(hash(JSON.stringify(originalCalls))).toBe(patch.originalCallsSha256);
      // Ordered arrays retain duplicate calls: no Set-based producer exemption.
      expect(translationCalls(file, current).map(signature)).toEqual(originalCalls);
      expect(producerProjection(file, current)).toEqual(producerProjection(file, previous));
      const imports = (text: string) => {
        const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        return parsed.statements.filter(ts.isImportDeclaration).map(statement => statement.getText(parsed));
      };
      expect(imports(current)).toEqual(imports(previous));
      expect(imports(current)).toContain("import { useTranslation } from 'react-i18next';");
      expect(imports(current)).toContain("import { useUnits } from '@/hooks/useUnits';");
      expect(producerProjection(file, current).bindings).toContain('{ t } = useTranslation()');
      expect(producerProjection(file, current).bindings).toContain('{ unitPrefs } = useUnits()');
    });

    it('keeps the existing debounce, precision, replace mode and other query parameters intact', () => {
      const current = reviewedCfSource();
      const previous = restoreReplayUrlRaceSource(file, current);
      const payload = (text: string) =>
        text.slice(text.indexOf('        (prev) => {'), text.indexOf('    }, 300);') + '    }, 300);'.length);
      expect(payload(current)).toBe(payload(previous));
      for (const fragment of [
        'const snapshotProgress = replay.progress;',
        'const snapshotPlaying = replay.isPlaying;',
        'const next = new URLSearchParams(prev);',
        "next.set('at', snapshotProgress.toFixed(3));",
        "if (snapshotPlaying) next.set('play', '1');",
        '{ replace: true },',
        '    }, 300);',
      ]) {
        expect(current, fragment).toContain(fragment);
        expect(previous, fragment).toContain(fragment);
      }
      expect(current).toContain('replayUrlWriterRef.current = { id, setSearchParams };');
      expect(current).toContain('      if (writer.id !== id) return;');
      expect(current).toContain('      writer.setSearchParams(');
    });

    it.each(patch.hunks)('rejects missing, modified and duplicated approved hunk at line $start', hunk => {
      const current = reviewedCfSource();
      const fragment = hunk.new.join('\n');
      expect(current.split(fragment)).toHaveLength(2);
      expect(() => restoreReplayUrlRaceSource(file, current.replace(fragment, ''))).toThrow();
      expect(() => restoreReplayUrlRaceSource(file, current.replace(fragment, fragment + '!'))).toThrow();
      expect(() => restoreReplayUrlRaceSource(file, current + '\n' + fragment)).toThrow();
    });

    it.each([
      ["t('replay.title', 'Trip Replay')", "t('replay.changedTitle', 'Trip Replay')", 2],
      ["t('replay.title', 'Trip Replay')", "t('replay.title', 'Changed default')", 2],
      ['const { t } = useTranslation();', "const { t } = useTranslation('trips');", 1],
      ['const { unitPrefs } = useUnits();', 'const { unitPrefs } = changedUnits();', 1],
      ['snapshotProgress.toFixed(3)', 'snapshotProgress.toFixed(2)', 1],
    ] as const)('keeps unrelated protected source mutations visible: %s', (original, edited, occurrences) => {
      const current = reviewedCfSource();
      expect(current.split(original)).toHaveLength(occurrences + 1);
      let offset = 0;
      for (let occurrence = 0; occurrence < occurrences; occurrence++) {
        const index = current.indexOf(original, offset);
        const changed = current.slice(0, index) + edited + current.slice(index + original.length);
        expect(() => restoreReplayUrlRaceSource(file, changed)).toThrow();
        offset = index + original.length;
      }
    });

    it('passes unrelated exact paths through without introducing a prefix or wildcard exemption', () => {
      const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      expect(restoreReplayUrlRaceSource(file.replace('.tsx', 'Other.tsx'), text)).toBe(text);
    });
  });

  describe('exact successor: transition-queued Replay URL write', () => {
    const file = 'web/src/features/trips/pages/TripReplayPage.tsx';
    const patch = replayTransitionQueue.sources[0];
    // Preserve this immutable e0-stage mechanism, reached from actual V9 bytes.
    const reviewedQueueSource = () => runtimePredecessor(file);
    function namedCalls(text: string, name: string): ts.CallExpression[] {
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const found: ts.CallExpression[] = [];
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && (
          ts.isIdentifier(node.expression) && node.expression.text === name
          || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name
        )) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      return found;
    }

    it('pins exactly four reviewed regions and the independently frozen CF/map predecessor', () => {
      expect(replayTransitionQueue.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks).toHaveLength(4);
      expect(patch.before).toBe('cf0aa3273b1214deeecdf0e0f4eed8e834f03a45cd66391dcbcc3dad12f8de73');
      expect(patch.before).toBe(replayTransitionQueue.independentPredecessorProof.sha256);
      expect(patch.before).toBe(replayUrlRace.sources[0].after);
      expect(replayTransitionQueue.independentPredecessorProof.receipt)
        .toBe('full-design-post-replay-acceptance-source-freeze.json');
      expect(replayTransitionQueue.independentPredecessorProof.sourceMapSource)
        .toBe('../../src/features/trips/pages/TripReplayPage.tsx');
      expect(hash(JSON.stringify(replayUrlRace)))
        .toBe('e36da2acfdbe61ebd3ffd95953779b9d3c87a5b7a8f869bb9fb2ef13014eb372');
      expect(hash(JSON.stringify(appDesign)))
        .toBe('3fb94cebaedae05cee60df9fa1b53ec45566a9825ee6bf449f507704eeb477d2');
      expect(hash(JSON.stringify(helpCold)))
        .toBe('95d2c4e9c823a234c8afde60cc8eac55daa75ccf819bd09052fc09392d792e20');
      expect(hash(JSON.stringify(transition)))
        .toBe('ff96f3516b4f0b4ebdf4dc0f0ec3fab711a35e0394bb703b493b5ee18ecc97be');
    });

    it('accepts only current bytes and composes successor → CF → original without stale-stage bypass', () => {
      const current = reviewedQueueSource();
      const cf = restoreReplayTransitionQueueSource(file, current);
      const original = restoreReplayUrlRaceSource(file, cf);
      expect(hash(current)).toBe(patch.after);
      expect(hash(cf)).toBe(patch.before);
      expect(hash(original)).toBe(replayUrlRace.sources[0].before);
      expect(restoreAppDesignSource(file, source(file))).toBe(original);
      expect(() => restoreReplayUrlRaceSource(file, current)).toThrow();
      for (const stale of [cf, original, current + '\n', current.slice(1)]) {
        expect(() => restoreReplayTransitionQueueSource(file, stale)).toThrow();
        expect(() => restoreAppDesignSource(file, stale)).toThrow();
      }
      expect(reviewedQueueSource()).toBe(current);
    });

    it('preserves all 61 original occurrences/options and complete translator, unit and enclosing controls', () => {
      const current = reviewedQueueSource();
      const cf = restoreReplayTransitionQueueSource(file, current);
      const original = restoreReplayUrlRaceSource(file, cf);
      const originalCalls = translationCalls(file, original).map(signature);
      expect(originalCalls).toHaveLength(61);
      expect(hash(JSON.stringify(originalCalls))).toBe(patch.originalCallsSha256);
      expect(patch.originalCallsSha256).toBe(replayUrlRace.sources[0].originalCallsSha256);
      expect(patch.originalCallCount).toBe(replayUrlRace.sources[0].originalCallCount);
      expect(translationCalls(file, current).map(signature)).toEqual(originalCalls);
      expect(translationCalls(file, cf).map(signature)).toEqual(originalCalls);
      expect(producerProjection(file, current)).toEqual(producerProjection(file, original));
      expect(producerProjection(file, current)).toEqual(producerProjection(file, cf));
    });

    it('reverses only the precise installed React named import, not an import/origin exemption', () => {
      const current = reviewedQueueSource();
      const cf = restoreReplayTransitionQueueSource(file, current);
      const imports = (text: string) => {
        const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        return parsed.statements.filter(ts.isImportDeclaration).map(node => node.getText(parsed));
      };
      expect(imports(cf)[0]).toBe("import { useMemo, useEffect, useRef, useCallback, useState } from 'react';");
      expect(imports(current)).toEqual([
        "import { startTransition, useMemo, useEffect, useRef, useCallback, useState } from 'react';",
        ...imports(cf).slice(1),
      ]);
      const parsed = ts.createSourceFile(file, current, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const reactImport = parsed.statements[0] as ts.ImportDeclaration;
      const bindings = reactImport.importClause!.namedBindings as ts.NamedImports;
      expect(ts.isNamedImports(bindings)).toBe(true);
      expect(bindings.elements.map(binding => [binding.name.text, binding.propertyName?.text]))
        .toEqual(['startTransition', 'useMemo', 'useEffect', 'useRef', 'useCallback', 'useState']
          .map(name => [name, undefined]));
    });

    it('queues the exact snapshot inside startTransition, never writing the query in the timer', () => {
      const current = reviewedQueueSource();
      const timers = namedCalls(current, 'setTimeout');
      const transitions = namedCalls(current, 'startTransition');
      expect(timers).toHaveLength(1);
      expect(transitions).toHaveLength(1);
      const timer = timers[0];
      expect(timer.arguments[1].getText()).toBe('300');
      expect(ts.isArrowFunction(timer.arguments[0])).toBe(true);
      const timerBody = (timer.arguments[0] as ts.ArrowFunction).body as ts.Block;
      expect(timerBody.statements.map(statement => statement.getText()))
        .toEqual([transitions[0].getText() + ';']);
      expect(timerBody.getText()).not.toContain('setSearchParams');
      const queuedBody = (transitions[0].arguments[0] as ts.ArrowFunction).body as ts.Block;
      expect(queuedBody.statements.map(statement => statement.getText())).toEqual([
        'setPendingUrlWrite({ id, progress: snapshotProgress, playing: snapshotPlaying });',
      ]);
      expect(current).toContain('const snapshotProgress = replay.progress;');
      expect(current).toContain('const snapshotPlaying = replay.isPlaying;');
      expect(current).toContain(
        '}, [id, replay.progress, replay.isPlaying, positions.length, setSearchParams]);');
      expect(current).not.toContain('replayUrlWriterRef');
    });

    it('consumes only the pending snapshot after commit and guards record, sample count, progress and play', () => {
      const current = reviewedQueueSource();
      const effects = namedCalls(current, 'useEffect').filter(call =>
        call.arguments[0].getText().includes('if (!pendingUrlWrite) return;'));
      expect(effects).toHaveLength(1);
      const effect = effects[0];
      const body = (effect.arguments[0] as ts.ArrowFunction).body as ts.Block;
      expect(body.statements).toHaveLength(4);
      expect(body.statements.slice(0, 3).map(statement => statement.getText())).toEqual([
        'if (!pendingUrlWrite) return;',
        'setPendingUrlWrite(null);',
        'if (pendingUrlWrite.id !== id || positions.length === 0\n'
          + '      || pendingUrlWrite.progress !== replay.progress\n'
          + '      || pendingUrlWrite.playing !== replay.isPlaying) return;',
      ]);
      expect(body.statements[3].getText()).toBe(namedCalls(current, 'setSearchParams')[0].getText() + ';');
      expect(effect.arguments[1].getText()).toBe(
        '[pendingUrlWrite, id, positions.length, replay.progress, replay.isPlaying, setSearchParams]');
      expect(current).toContain(patch.hunks[1].new.join('\n'));
    });

    it('preserves the entire at/play updater and replace operand with only exact snapshot-field substitution', () => {
      const current = reviewedQueueSource();
      const cf = restoreReplayTransitionQueueSource(file, current);
      const currentWrites = namedCalls(current, 'setSearchParams');
      const cfWrites = namedCalls(cf, 'setSearchParams');
      expect(currentWrites).toHaveLength(1);
      expect(cfWrites).toHaveLength(1);
      const print = (node: ts.Node) =>
        printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
      const payload = print(currentWrites[0].arguments[0]);
      expect(payload.split('pendingUrlWrite.progress')).toHaveLength(4);
      expect(payload.split('pendingUrlWrite.playing')).toHaveLength(2);
      // Local URL-payload comparison ONLY; never normalize producer calls,
      // bindings, imports or bytes passed into any preservation inverse.
      expect(payload.replaceAll('pendingUrlWrite.progress', 'snapshotProgress')
        .replaceAll('pendingUrlWrite.playing', 'snapshotPlaying'))
        .toBe(print(cfWrites[0].arguments[0]));
      expect(currentWrites[0].arguments).toHaveLength(2);
      expect(cfWrites[0].arguments).toHaveLength(2);
      expect(print(currentWrites[0].arguments[1])).toBe(print(cfWrites[0].arguments[1]));
      expect(current).toContain('const next = new URLSearchParams(prev);');
      expect(current).toContain("next.set('at', pendingUrlWrite.progress.toFixed(3));");
      expect(current).toContain("if (pendingUrlWrite.playing) next.set('play', '1');");
      expect(current).toContain('{ replace: true },');
    });

    it.each(patch.hunks)('rejects missing, edited and duplicate successor region at line $start', hunk => {
      const current = reviewedQueueSource();
      const fragment = hunk.new.join('\n');
      expect(current.split(fragment)).toHaveLength(2);
      for (const changed of [
        current.replace(fragment, ''),
        current.replace(fragment, fragment + '!'),
        current + '\n' + fragment,
      ]) {
        expect(() => restoreReplayTransitionQueueSource(file, changed)).toThrow();
        expect(() => restoreReplayUrlRaceSource(file, restoreReplayTransitionQueueSource(file, changed))).toThrow();
      }
    });

    it.each([
      ['startTransition, useMemo', 'useMemo', 1],
      ["from 'react';", "from 'other-react';", 1],
      ['startTransition(() => {', 'queueMicrotask(() => {', 1],
      ['pendingUrlWrite.id !== id', 'false', 1],
      ['pendingUrlWrite.progress !== replay.progress', 'false', 1],
      ['pendingUrlWrite.playing !== replay.isPlaying', 'false', 1],
      ['setPendingUrlWrite(null);', 'setPendingUrlWrite(pendingUrlWrite);', 1],
      ['pendingUrlWrite.progress.toFixed(3)', 'pendingUrlWrite.progress.toFixed(2)', 1],
      [
        '[id, replay.progress, replay.isPlaying, positions.length, setSearchParams]',
        '[id, replay.progress, replay.isPlaying, positions.length]', 1,
      ],
      ["t('replay.title', 'Trip Replay')", "t('replay.changedTitle', 'Trip Replay')", 2],
      ["t('replay.title', 'Trip Replay')", "t('replay.title', 'Changed default')", 2],
      [
        "usePageTitle(t('replay.title', 'Trip Replay'));",
        "if (false) usePageTitle(t('replay.title', 'Trip Replay'));", 1,
      ],
      ['const { t } = useTranslation();', "const { t } = useTranslation('trips');", 1],
      ['const { unitPrefs } = useUnits();', 'const { unitPrefs } = changedUnits();', 1],
      ["from '@/lib/unitConversion';", "from '@/lib/changedUnits';", 1],
    ] as const)('rejects successor import, scheduling, control or protected producer drift: %s',
      (original, edited, occurrences) => {
        const current = reviewedQueueSource();
        expect(current.split(original)).toHaveLength(occurrences + 1);
        let offset = 0;
        for (let occurrence = 0; occurrence < occurrences; occurrence++) {
          const index = current.indexOf(original, offset);
          const changed = current.slice(0, index) + edited + current.slice(index + original.length);
          expect(() => restoreReplayTransitionQueueSource(file, changed)).toThrow();
          expect(() => restoreReplayUrlRaceSource(file, restoreReplayTransitionQueueSource(file, changed))).toThrow();
          offset = index + original.length;
        }
      });

    it.each(['before', 'after', 'file'] as const)('rejects stale fixture %s even before selecting a source', field => {
      const saved = patch[field];
      try {
        patch[field] = saved + '-stale';
        expect(() => restoreReplayTransitionQueueSource(file, reviewedQueueSource()))
          .toThrow('pinned Replay transition-queue transition');
      } finally {
        patch[field] = saved;
      }
      expect(hash(restoreReplayTransitionQueueSource(file, reviewedQueueSource()))).toBe(patch.before);
    });

    it('rejects stale independent provenance and inverse coordinates without altering old fixtures', () => {
      const proof = replayTransitionQueue.independentPredecessorProof;
      const savedProof = proof.sourceMapSha256;
      const hunk = patch.hunks[0];
      const savedStart = hunk.start;
      try {
        proof.sourceMapSha256 = '0'.repeat(64);
        expect(() => restoreReplayTransitionQueueSource(file, reviewedQueueSource()))
          .toThrow('pinned Replay transition-queue transition');
        proof.sourceMapSha256 = savedProof;
        hunk.start++;
        expect(() => restoreReplayTransitionQueueSource(file, reviewedQueueSource()))
          .toThrow('pinned Replay transition-queue transition');
      } finally {
        proof.sourceMapSha256 = savedProof;
        hunk.start = savedStart;
      }
      expect(hash(restoreReplayTransitionQueueSource(file, reviewedQueueSource()))).toBe(patch.before);
    });

    it('does not exempt a prefix, sibling or differently cased path', () => {
      const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const other of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase()]) {
        expect(restoreReplayTransitionQueueSource(other, text)).toBe(text);
      }
    });
  });

  describe('exact V9 successors: live Replay URL and complete mounted header chain', () => {
    const replayFile = 'web/src/features/trips/pages/TripReplayPage.tsx';
    const tooltipFile = 'web/src/components/ui/Tooltip.tsx';
    const containerFile = 'web/src/components/layout/PageContainer.tsx';
    const headerFile = 'web/src/components/layout/PageHeader.tsx';
    const freshnessFile = 'web/src/components/data-display/FreshnessDot.tsx';
    const iconFile = 'web/src/components/ui/IconButton.tsx';
    function declarations(text: string): ts.VariableDeclaration[] {
      const parsed = ts.createSourceFile('review.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const found: ts.VariableDeclaration[] = [];
      function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node)) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      return found;
    }
    const initializer = (text: string, name: string) => {
      const found = declarations(text).filter(node => node.name.getText() === name);
      expect(found, name + ': unique real declaration').toHaveLength(1);
      return found[0].initializer!;
    };

    it('pins exactly six endpoints, every original approval, and unchanged cold/copy scope', () => {
      expect(runtimeV9.sources.map(patch => patch.file)).toEqual([
        replayFile, tooltipFile, headerFile, containerFile, freshnessFile, iconFile,
      ]);
      expect(runtimeV9.sources.map(patch => patch.hunks.length)).toEqual([4, 24, 3, 3, 1, 6]);
      expect(runtimeV9.sources.reduce((count, patch) => count + patch.originalCallCount, 0)).toBe(78);
      expect(hash(JSON.stringify(replayTransitionQueue)))
        .toBe('96bdba6d588686db7a19a2d0aa0a77a52f1d1cfa719afe46b02257e69c775fee');
      expect(hash(JSON.stringify(replayUrlRace)))
        .toBe('e36da2acfdbe61ebd3ffd95953779b9d3c87a5b7a8f869bb9fb2ef13014eb372');
      expect(hash(JSON.stringify(helpCold)))
        .toBe('95d2c4e9c823a234c8afde60cc8eac55daa75ccf819bd09052fc09392d792e20');
      expect(hash(JSON.stringify(appDesign)))
        .toBe('3fb94cebaedae05cee60df9fa1b53ec45566a9825ee6bf449f507704eeb477d2');
      expect(hash(JSON.stringify(transition)))
        .toBe('ff96f3516b4f0b4ebdf4dc0f0ec3fab711a35e0394bb703b493b5ee18ecc97be');
      expect(appDesign.relocations).toHaveLength(3);
      expect(helpCold.relocations).toHaveLength(1);
      expect(appDesign.catalogAdditions).toHaveLength(110);
    });

    it.each(runtimeV9.sources)('preserves independently compiled complete predecessor and every producer: $file', patch => {
      const actual = source(patch.file);
      const current = restoreNativeSourceRepair(patch.file, actual);
      const previous = restoreRuntimeV9Source(patch.file, current);
      expect(hash(current)).toBe(patch.after);
      expect(hash(previous)).toBe(patch.before);
      const originalCalls = translationCalls(patch.file, previous).map(signature);
      expect(originalCalls).toHaveLength(patch.originalCallCount);
      expect(hash(JSON.stringify(originalCalls))).toBe(patch.originalCallsSha256);
      expect(translationCalls(patch.file, current).map(signature)).toEqual(originalCalls);
      expect(producerProjection(patch.file, current)).toEqual(producerProjection(patch.file, previous));
      for (const stale of [previous, current + '\n// unrelated drift\n', current.slice(1)]) {
        expect(() => restoreRuntimeV9Source(patch.file, stale)).toThrow();
        expect(() => restoreAppDesignSource(patch.file, stale)).toThrow();
      }
      expect(source(patch.file)).toBe(actual);
    });

    it('retains the full dbeb → e0 → CF → 00ddb chain and all 61 original Replay calls', () => {
      const current = source(replayFile);
      const e0 = restoreRuntimeV9Source(replayFile, current);
      const cf = restoreReplayTransitionQueueSource(replayFile, e0);
      const original = restoreReplayUrlRaceSource(replayFile, cf);
      expect(hash(e0)).toBe(replayTransitionQueue.sources[0].after);
      expect(hash(cf)).toBe(replayUrlRace.sources[0].after);
      expect(hash(original)).toBe(replayUrlRace.sources[0].before);
      expect(restoreAppDesignSource(replayFile, current)).toBe(original);
      expect(translationCalls(replayFile, original).map(signature)).toHaveLength(61);
      expect(translationCalls(replayFile, current).map(signature))
        .toEqual(translationCalls(replayFile, original).map(signature));
      expect(producerProjection(replayFile, current)).toEqual(producerProjection(replayFile, original));
      const suffix = '  /* ---- Elevation profile data ---- */';
      expect(current.slice(current.indexOf(suffix))).toBe(e0.slice(e0.indexOf(suffix)));
    });

    it('reads live browser query only inside the due 300ms callback, validates identity and writes owned params directly', () => {
      const current = source(replayFile);
      const start = current.indexOf('    writeTimerRef.current = setTimeout(() => {');
      const end = current.indexOf('    }, 300);', start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const timer = current.slice(start, end);
      const fragments = [
        'const writer = latestUrlWriterRef.current;',
        'if (writer.id !== id || writer.sampleCount === 0\n'
          + '        || writer.progress !== snapshotProgress || writer.playing !== snapshotPlaying) return;',
        'const currentUrl = new URL(window.location.href);',
        'if (currentUrl.pathname !== writer.pathname) return;',
        'const prev = currentUrl.searchParams;',
        'const next = new URLSearchParams(prev);',
        "next.set('at', snapshotProgress.toFixed(3));",
        "next.delete('at');",
        "if (snapshotPlaying) next.set('play', '1');",
        "else next.delete('play');",
        'if (next.toString() !== prev.toString()) {',
        'writer.setSearchParams(next, { replace: true });',
      ];
      let offset = -1;
      for (const fragment of fragments) {
        const index = timer.indexOf(fragment);
        expect(index, fragment).toBeGreaterThan(offset);
        offset = index;
      }
      expect(current.split('new URL(window.location.href)')).toHaveLength(2);
      expect(current).toContain(
        '}, [id, pathname, replay.progress, replay.isPlaying, positions.length, setSearchParams]);');
      expect(current).not.toContain('pendingUrlWrite');
      expect(current).not.toContain('startTransition');
      expect(current).toContain(
        "import { useParams, Link, useSearchParams, useLocation } from 'react-router-dom';");
      const imports = (text: string) => {
        const parsed = ts.createSourceFile(replayFile, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        return parsed.statements.filter(ts.isImportDeclaration).map(node => node.getText(parsed));
      };
      expect(imports(current).slice(2)).toEqual(imports(runtimePredecessor(replayFile)).slice(2));
    });

    it.each([headerFile, containerFile])('keeps portal context around ONLY the original header: %s', file => {
      const current = source(file);
      const previous = runtimePredecessor(file);
      const parsed = ts.createSourceFile(file, current, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const providers: ts.JsxElement[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'TooltipPortalContext.Provider') {
          providers.push(node);
        }
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      expect(providers).toHaveLength(1);
      const provider = providers[0];
      expect(provider.openingElement.getText()).toBe('<TooltipPortalContext.Provider value={true}>');
      const children = provider.children.filter(node => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node));
      expect(children).toHaveLength(1);
      expect(ts.isJsxElement(children[0]) && children[0].openingElement.tagName.getText()).toBe('header');
      expect(children[0].getText()).toBe(previous.slice(previous.indexOf('<header'), previous.indexOf('</header>') + '</header>'.length));
      const afterProvider = current.indexOf('</TooltipPortalContext.Provider>') + '</TooltipPortalContext.Provider>'.length;
      expect(current.slice(afterProvider)).toBe(previous.slice(previous.indexOf('</header>') + '</header>'.length));
    });

    it('retains real Tooltip child/aria enrichment, opt-in portal/profile binding and original Escape dismissal', () => {
      const current = source(tooltipFile);
      const previous = runtimePredecessor(tooltipFile);
      expect(initializer(current, 'enrichedChild').getText()).toBe(initializer(previous, 'enrichedChild').getText());
      const escapeStart = '  useEffect(() => {\n    const dismiss =';
      const escapeEnd = '  }, []);';
      const escape = (text: string) => text.slice(text.indexOf(escapeStart),
        text.indexOf(escapeEnd, text.indexOf(escapeStart)) + escapeEnd.length);
      expect(escape(current)).toBe(escape(previous));
      expect(escape(current)).toContain("event.key === 'Escape'");
      for (const fragment of [
        'TooltipPortalContext = createContext(false);',
        'const portal = portalProp ?? inheritedPortal;',
        '<AppDesignPortal anchorRef={triggerRef}>{bubble}</AppDesignPortal>',
        'role="tooltip"',
        "typography.color.inverse",
        "'forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]'",
      ]) expect(current).toContain(fragment);
      expect(helpCold.dependencies.find(dependency => dependency.file === tooltipFile)?.sha256)
        .toBe(hash(previous));
      expect(() => restoreHelpColdSource(helpCold.sources[0].file, source(helpCold.sources[0].file),
        file => source(file) + (file === tooltipFile ? '\n// changed actual Tooltip\n' : ''))).toThrow();
    });

    it('retains original Freshness/Icon producer checkpoints, confirm actions, links and opt-in native focus owner', () => {
      for (const [file, oldest] of [
        [freshnessFile, '6a1b40f8c9ace3f393909c3cbd33ff30ca31e420fa43b851c7fb458fac85b2e2'],
        [iconFile, '7e5cac2b43e66e5f65efa4ad341054536a333b196a11a0b5284e0c2575b741cd'],
      ]) {
        const stage = appDesign.sources.find(patch => patch.file === file)!;
        expect(hash(runtimePredecessor(file))).toBe(stage.after);
        expect(hash(restoreAppDesignSource(file, source(file)))).toBe(oldest);
        expect(stage.before).toBe(oldest);
      }
      const current = source(iconFile);
      const previous = runtimePredecessor(iconFile);
      expect(initializer(current, 'activate').getText()).toBe(initializer(previous, 'activate').getText());
      const control = initializer(current, 'control') as ts.ConditionalExpression;
      const oldControl = initializer(previous, 'control') as ts.ConditionalExpression;
      expect(control.whenTrue.getText()).toBe(oldControl.whenTrue.getText());
      for (const fragment of [
        'focusableWhenDisabled = false,',
        'const focusableDisabled = focusableWhenDisabled && (disabled || busy);',
        'loading={busy && !focusableDisabled}',
        'disabled={disabled && !focusableDisabled}',
        'aria-disabled={focusableDisabled || undefined}',
        'onClick={focusableDisabled ? undefined : activate}',
        "!reduce && 'animate-spin'",
      ]) expect(current).toContain(fragment);
      expect(source(freshnessFile)).toContain('focusableWhenDisabled={Boolean(onRefresh)}');
      expect(source(freshnessFile)).toContain('disabled={!onRefresh || isFetching}');
    });

    it.each(runtimeV9.sources.flatMap(patch =>
      patch.hunks.map(hunk => ({ file: patch.file, ...hunk }))))(
      'rejects missing, edited and duplicate exact region in $file at $start', hunk => {
      const current = historicalSource(hunk.file);
      const lines = current.split('\n');
      expect(lines.slice(hunk.start, hunk.start + hunk.new.length)).toEqual(hunk.new);
      for (const replacement of [[], [...hunk.new, '// drift'], [...hunk.new, ...hunk.new]]) {
        const changed = [...lines];
        changed.splice(hunk.start, hunk.new.length, ...replacement);
        expect(() => restoreRuntimeV9Source(hunk.file, changed.join('\n'))).toThrow();
        expect(() => restoreAppDesignSource(hunk.file, changed.join('\n'))).toThrow();
      }
      });

    it.each([
      [replayFile, 'new URL(window.location.href)', 'new URL(window.location.origin)', 1],
      [replayFile, 'writer.id !== id', 'false', 1],
      [replayFile, 'writer.sampleCount === 0', 'false', 1],
      [replayFile, 'writer.progress !== snapshotProgress', 'false', 1],
      [replayFile, 'writer.playing !== snapshotPlaying', 'false', 1],
      [replayFile, 'currentUrl.pathname !== writer.pathname', 'false', 1],
      [replayFile, 'next.toString() !== prev.toString()', 'true', 1],
      [replayFile, 'snapshotProgress.toFixed(3)', 'snapshotProgress.toFixed(2)', 1],
      [replayFile, "t('replay.title', 'Trip Replay')", "t('replay.title', 'Changed default')", 2],
      [replayFile, "t('replay.title', 'Trip Replay')", "t('replay.changedTitle', 'Trip Replay')", 2],
      [replayFile, 'const { t } = useTranslation();', "const { t } = useTranslation('trips');", 1],
      [tooltipFile, 'createContext(false)', 'createContext(true)', 1],
      [tooltipFile, 'portalProp ?? inheritedPortal', 'true', 1],
      [tooltipFile, 'anchorRef={triggerRef}', 'anchorRef={undefined}', 1],
      [containerFile, 'TooltipPortalContext.Provider value={true}', 'TooltipPortalContext.Provider value={false}', 1],
      [headerFile, 'TooltipPortalContext.Provider value={true}', 'TooltipPortalContext.Provider value={false}', 1],
      [freshnessFile, 'focusableWhenDisabled={Boolean(onRefresh)}', 'focusableWhenDisabled={true}', 1],
      [iconFile, 'focusableWhenDisabled = false,', 'focusableWhenDisabled = true,', 1],
      [iconFile, 'onClick={focusableDisabled ? undefined : activate}', 'onClick={activate}', 1],
    ] as const)('rejects live source/import/control/producer drift in %s: %s', (file, original, edited, occurrences) => {
      const current = source(file);
      expect(current.split(original)).toHaveLength(occurrences + 1);
      let offset = 0;
      for (let occurrence = 0; occurrence < occurrences; occurrence++) {
        const index = current.indexOf(original, offset);
        const changed = current.slice(0, index) + edited + current.slice(index + original.length);
        expect(() => restoreRuntimeV9Source(file, changed)).toThrow();
        expect(() => restoreAppDesignSource(file, changed)).toThrow();
        offset = index + original.length;
      }
    });

    it.each(runtimeV9.dependencies)('pins real support dependency and rejects drift: $file', dependency => {
      expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(() => restoreRuntimeV9Source(tooltipFile, historicalSource(tooltipFile), file =>
        source(file) + (file === dependency.file ? '\n// changed support dependency\n' : ''))).toThrow();
    });

    it.each(['before', 'after', 'file'] as const)('fails closed on stale successor fixture %s', field => {
      const patch = runtimeV9.sources[0];
      const saved = patch[field];
      try {
        patch[field] += '-stale';
        expect(() => restoreRuntimeV9Source(replayFile, source(replayFile))).toThrow('pinned V9 runtime successors');
      } finally {
        patch[field] = saved;
      }
      expect(hash(runtimePredecessor(replayFile))).toBe(patch.before);
    });

    it('rejects stale predecessor coordinates/provenance, without touching any original fixture', () => {
      const patch = runtimeV9.sources[0];
      const savedMap = patch.predecessorMapSha256;
      const savedStart = patch.hunks[0].start;
      try {
        patch.predecessorMapSha256 = '0'.repeat(64);
        expect(() => restoreRuntimeV9Source(replayFile, source(replayFile))).toThrow('pinned V9 runtime successors');
        patch.predecessorMapSha256 = savedMap;
        patch.hunks[0].start++;
        expect(() => restoreRuntimeV9Source(replayFile, source(replayFile))).toThrow('pinned V9 runtime successors');
      } finally {
        patch.predecessorMapSha256 = savedMap;
        patch.hunks[0].start = savedStart;
      }
      expect(hash(runtimePredecessor(replayFile))).toBe(patch.before);
    });

    it('never applies an approval by prefix, sibling, import or case-insensitive path match', () => {
      const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const patch of runtimeV9.sources) {
        for (const file of [patch.file + '/child', patch.file.replace('.tsx', 'Other.tsx'), patch.file.toLowerCase()]) {
          expect(restoreRuntimeV9Source(file, text)).toBe(text);
        }
      }
    });
  });

  describe('exact two-line synthetic PreviewMap frame successor', () => {
    const file = 'web/src/features/settings/components/app-design-preview/PreviewMap.tsx';
    const patch = previewMapFrame.sources[0];
    // Keep the original frame tests at their verified cc2 stage, not a bypass
    // accepting a new shipping endpoint or a refreshed historical fixture.
    const frameCurrent = restorePreviewMapPopupSource(file, source(file));
    const previous = () => restorePreviewMapFrameSource(file, frameCurrent);
    function elements(text: string): ts.JsxElement[] {
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const found: ts.JsxElement[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxElement(node)) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      return found;
    }

    it('pins only PreviewMap, exactly two single-line regions and the unchanged original producer endpoint', () => {
      expect(previewMapFrame.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks.map(hunk => hunk.start)).toEqual([19, 21]);
      expect(patch.hunks.every(hunk => hunk.old.length === 1 && hunk.new.length === 1)).toBe(true);
      expect(patch.before).toBe('ba1acdb232e5d3f1a7b4a2af25b164c8a4ce432afb1266343a4926d813acd7bd');
      expect(patch.before).toBe(previewMapFrame.independentPredecessorProof.sha256);
      expect(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256).toBe(patch.before);
      expect(hash(JSON.stringify(appDesign)))
        .toBe('3fb94cebaedae05cee60df9fa1b53ec45566a9825ee6bf449f507704eeb477d2');
      expect(hash(JSON.stringify(runtimeV9)))
        .toBe('a8f309cdfd4f3f9afcece102a27d16b4de7af29578dff7c57951d5b3c401194d');
    });

    it('checks complete current/predecessor bytes without accepting old, mixed or unrelated source', () => {
      const current = frameCurrent;
      const original = previous();
      expect(hash(current)).toBe(patch.after);
      expect(hash(original)).toBe(patch.before);
      expect(original.split('\n')).toHaveLength(current.split('\n').length);
      for (const changed of [original, current + '\n', current.slice(1)]) {
        expect(() => restorePreviewMapFrameSource(file, changed)).toThrow();
      }
      expect(restorePreviewMapPopupSource(file, source(file))).toBe(current);
    });

    it('preserves all nine ordered calls/defaults/options, installed origin, bindings, controls and every import', () => {
      const current = frameCurrent;
      const original = previous();
      const originalCalls = translationCalls(file, original).map(signature);
      expect(originalCalls).toHaveLength(9);
      expect(originalCalls).toHaveLength(patch.originalCallCount);
      expect(hash(JSON.stringify(originalCalls))).toBe(patch.originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(originalCalls);
      expect(producerProjection(file, current)).toEqual(producerProjection(file, original));
      expect(producerProjection(file, current).bindings).toEqual([
        "import { useTranslation } from 'react-i18next';",
        "{ t } = useTranslation('settings')",
      ]);
      const imports = (text: string) => {
        const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        return parsed.statements.filter(ts.isImportDeclaration).map(node => node.getText(parsed));
      };
      expect(imports(current)).toEqual(imports(original));
    });

    it('allocates the outer frame while retaining every map child, section, marker and interaction byte', () => {
      const current = frameCurrent;
      const original = previous();
      const maps = (text: string) => elements(text).filter(node => node.openingElement.tagName.getText() === 'MapContainer');
      const currentMaps = maps(current);
      const oldMaps = maps(original);
      expect(currentMaps).toHaveLength(1);
      expect(oldMaps).toHaveLength(1);
      expect(currentMaps[0].children.map(node => node.getText())).toEqual(oldMaps[0].children.map(node => node.getText()));
      expect(currentMaps[0].openingElement.attributes.properties.map(node => node.getText())).toEqual(
        oldMaps[0].openingElement.attributes.properties.map(node =>
          node.getText() === 'className="h-72 w-full"' ? 'className="h-full w-full"' : node.getText()));
      const frame = elements(current).filter(node =>
        node.openingElement.tagName.getText() === 'div'
        && node.openingElement.attributes.getText().includes('data-app-part="map map-stage"'));
      expect(frame).toHaveLength(1);
      expect(frame[0].openingElement.getText()).toBe(patch.hunks[0].new[0].trim());
      expect(elements(current).filter(node => node.openingElement.tagName.getText() === 'GlassPanel')).toHaveLength(1);
      expect(current).toContain('data-preview-section="map"');
      expect(current).toContain('routeVisible && <Polyline');
    });

    it('keeps all four independently pinned itinerary stops and existing map controls', () => {
      const fixture = previewMapFrame.dependencies.find(dependency => dependency.file.endsWith('/fixtures.ts'))!;
      const parsed = ts.createSourceFile(fixture.file, source(fixture.file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      let route: ts.ArrayLiteralExpression | undefined;
      function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && node.name.getText() === 'PREVIEW_ROUTE') {
          expect(route).toBeUndefined();
          expect(node.initializer && ts.isArrayLiteralExpression(node.initializer)).toBe(true);
          route = node.initializer as ts.ArrayLiteralExpression;
        }
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      expect(route).toBeDefined();
      expect(route!.elements.map(node => (node as ts.ArrayLiteralExpression).elements.map(value => value.getText())))
        .toEqual([['0.008', '-0.015'], ['0.012', '-0.007'], ['0.005', '0.001'], ['0.014', '0.012']]);
      expect(hash(source(fixture.file))).toBe(fixture.sha256);
      const controls = previewMapFrame.dependencies.find(dependency => dependency.file.endsWith('/PreviewMapControls.tsx'))!;
      expect(appDesign.catalogProducers.find(producer => producer.file === controls.file)?.sha256).toBe(controls.sha256);
      expect(hash(restorePreviewMapControlsSource(controls.file, source(controls.file)))).toBe(controls.sha256);
    });

    it.each(patch.hunks)('rejects missing, modified, duplicated or individually reverted region at $start', hunk => {
      const current = frameCurrent;
      const fragment = hunk.new.join('\n');
      expect(current.split(fragment)).toHaveLength(2);
      for (const changed of [
        current.replace(fragment, ''),
        current.replace(fragment, fragment + '!'),
        current + '\n' + fragment,
        current.replace(fragment, hunk.old.join('\n')),
      ]) expect(() => restorePreviewMapFrameSource(file, changed)).toThrow();
    });

    it.each([
      ["t('theme.appDesignPreview.map', 'Fictional route map')", "t('theme.appDesignPreview.map', 'Changed default')", 2],
      ["t('theme.appDesignPreview.map', 'Fictional route map')", "t('theme.appDesignPreview.changedMap', 'Fictional route map')", 2],
      ["useTranslation('settings')", "useTranslation('other')", 1],
      ['number: index + 1', 'number: index + 2', 2],
      ['routeVisible && <Polyline', '!routeVisible && <Polyline', 1],
      ['marker.openPopup();', 'return;', 1],
      ['scrollWheelZoom={false}', 'scrollWheelZoom={true}', 1],
    ] as const)('rejects protected call, option, origin, control or interaction drift: %s', (original, edited, occurrences) => {
      const current = frameCurrent;
      expect(current.split(original)).toHaveLength(occurrences + 1);
      let offset = 0;
      for (let occurrence = 0; occurrence < occurrences; occurrence++) {
        const index = current.indexOf(original, offset);
        const changed = current.slice(0, index) + edited + current.slice(index + original.length);
        expect(() => restorePreviewMapFrameSource(file, changed)).toThrow();
        offset = index + original.length;
      }
    });

    it('retains every other preview producer comparison after the separately verified overlay successor', () => {
      const others = appDesign.catalogProducers.filter(producer => producer.file !== file);
      expect(others).toHaveLength(9);
      for (const producer of others) {
        const current = source(producer.file);
        expect(restorePreviewMapFrameSource(producer.file, current)).toBe(current);
        expect(hash(previewProducerPredecessor(producer.file, current))).toBe(producer.sha256);
        const changed = current + '\n// unrelated producer drift\n';
        expect(restorePreviewMapFrameSource(producer.file, changed)).toBe(changed);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, changed))).toBe(producer.sha256)).toThrow();
      }
    });

    it.each(previewMapFrame.dependencies)('rejects real geometry/control dependency drift: $file', dependency => {
      expect(() => restorePreviewMapFrameSource(file, frameCurrent, path =>
        source(path) + (path === dependency.file ? '\n// changed map dependency\n' : ''))).toThrow();
    });

    it.each(['before', 'after', 'file'] as const)('rejects stale exact successor fixture %s', field => {
      const saved = patch[field];
      try {
        patch[field] += '-stale';
        expect(() => restorePreviewMapFrameSource(file, frameCurrent)).toThrow('pinned PreviewMap frame successor');
      } finally {
        patch[field] = saved;
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('rejects stale independent proof and inverse coordinates without mutating historical fixtures', () => {
      const proof = previewMapFrame.independentPredecessorProof;
      const savedMap = proof.mapSha256;
      const savedStart = patch.hunks[0].start;
      try {
        proof.mapSha256 = '0'.repeat(64);
        expect(() => restorePreviewMapFrameSource(file, frameCurrent)).toThrow('pinned PreviewMap frame successor');
        proof.mapSha256 = savedMap;
        patch.hunks[0].start++;
        expect(() => restorePreviewMapFrameSource(file, frameCurrent)).toThrow('pinned PreviewMap frame successor');
      } finally {
        proof.mapSha256 = savedMap;
        patch.hunks[0].start = savedStart;
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('never applies the inverse to a prefix, sibling, differently cased path or import name', () => {
      const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './PreviewMap']) {
        expect(restorePreviewMapFrameSource(path, text)).toBe(text);
      }
    });
  });

  describe('exact three-hunk preview overlay invoker successor', () => {
    const file = 'web/src/features/settings/components/app-design-preview/PreviewOverlays.tsx';
    const patch = previewOverlayInvoker.sources[0];
    // Preserve the original invoker-stage guards against verified d70 bytes.
    const invokerCurrent = restorePreviewOverlayTooltipSource(file, restorePreviewOverlayHelpInsetSource(file, source(file)));
    const previous = () => restorePreviewOverlayInvokerSource(file, invokerCurrent);
    const tree = (text: string) =>
      ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function elements(text: string): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
      const parsed = tree(text);
      const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      return found;
    }
    const opening = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
      ts.isJsxElement(node) ? node.openingElement : node;

    it('pins only the three reviewed regions and the independently compiled original/current endpoints', () => {
      expect(previewOverlayInvoker.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks.map(hunk => hunk.start)).toEqual([10, 19, 33]);
      expect(patch.hunks.map(hunk => [hunk.old.length, hunk.new.length])).toEqual([[0, 1], [1, 1], [0, 1]]);
      expect(patch.before).toBe('200eec6effc01a8faf9d05be1bd3d1645c52d1d478940d0b9435ef9e9502bb35');
      expect(patch.after).toBe('d70cc7377a476cccc13602feb4b38a8a57ee9cc24a8588f124cd579515ce9a1c');
      expect(patch.before).toBe(previewOverlayInvoker.independentPredecessorProof.sha256);
      expect(patch.after).toBe(previewOverlayInvoker.compiledCurrentProof.sha256);
      expect(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256).toBe(patch.before);
      expect(hash(JSON.stringify(previewMapFrame)))
        .toBe('9da57db20bff20217a41523ac0b0a57e2da3900f70432c7d11bb5994b7ffbb75');
      expect(hash(JSON.stringify(runtimeV9)))
        .toBe('a8f309cdfd4f3f9afcece102a27d16b4de7af29578dff7c57951d5b3c401194d');
    });

    it('recovers the entire 48-line original from the exact 50-line current source, not a partial projection', () => {
      const current = invokerCurrent;
      const original = previous();
      expect(hash(current)).toBe(patch.after);
      expect(hash(original)).toBe(patch.before);
      expect(original.trimEnd().split('\n')).toHaveLength(patch.originalLineCount);
      expect(current.trimEnd().split('\n')).toHaveLength(patch.currentLineCount);
      expect(patch.originalLineCount).toBe(48);
      expect(patch.currentLineCount).toBe(50);
      for (const changed of [original, current + '\n', current.slice(1)]) {
        expect(() => restorePreviewOverlayInvokerSource(file, changed)).toThrow();
      }
      expect(restorePreviewOverlayTooltipSource(file, restorePreviewOverlayHelpInsetSource(file, source(file)))).toBe(current);
    });

    it('retains all fifteen ordered calls/defaults/arity/options, complete controls, translator bindings and imports', () => {
      const current = invokerCurrent;
      const original = previous();
      const calls = translationCalls(file, original).map(signature);
      expect(calls).toHaveLength(15);
      expect(calls).toHaveLength(patch.originalCallCount);
      expect(hash(JSON.stringify(calls))).toBe(patch.originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(calls);
      expect(translationCalls(file, current).map(call => call.arguments.length)).toEqual(Array(15).fill(2));
      const projection = producerProjection(file, original);
      expect(hash(JSON.stringify(projection))).toBe(patch.originalProjectionSha256);
      expect(producerProjection(file, current)).toEqual(projection);
      expect(projection.bindings).toEqual([
        "import { useTranslation } from 'react-i18next';",
        "{ t } = useTranslation('settings')",
      ]);
      const imports = (text: string) => {
        const parsed = tree(text);
        return parsed.statements.filter(ts.isImportDeclaration).map(node => node.getText(parsed));
      };
      expect(imports(current)).toEqual(imports(original));
      expect(imports(current)).toEqual([
        "import { useId, useRef, useState } from 'react';",
        "import { useTranslation } from 'react-i18next';",
        "import { Button, Modal, Popover, Tabs, Text, Tooltip } from '@/components/ui';",
      ]);
    });

    it('changes only the invoker ref and explicit return intent, retaining every original section, child and control', () => {
      const current = invokerCurrent;
      const original = previous();
      const nodes = elements(current);
      const oldNodes = elements(original);
      const tags = nodes.map(node => opening(node).tagName.getText());
      expect(tags).toEqual(oldNodes.map(node => opening(node).tagName.getText()));
      expect(tags.filter(tag => tag === 'Button')).toHaveLength(5);
      for (const tag of ['Modal', 'Popover', 'Tooltip', 'Tabs']) expect(tags.filter(value => value === tag)).toHaveLength(1);
      const trigger = nodes.filter(node => opening(node).attributes.getText().includes('ref={dialogTrigger}'));
      expect(trigger).toHaveLength(1);
      expect(opening(trigger[0]).tagName.getText()).toBe('Button');
      expect(trigger[0].getText().replace(' ref={dialogTrigger}', '')).toBe(
        oldNodes.find(node => node.getText().includes("t('theme.appDesignPreview.openDialog'")
          && opening(node).tagName.getText() === 'Button')?.getText());
      const modal = nodes.find(node => opening(node).tagName.getText() === 'Modal') as ts.JsxElement;
      const oldModal = oldNodes.find(node => opening(node).tagName.getText() === 'Modal') as ts.JsxElement;
      expect(modal.children.map(node => node.getText())).toEqual(oldModal.children.map(node => node.getText()));
      expect(modal.openingElement.attributes.properties.filter(node =>
        node.getText() !== 'getReturnFocusTarget={() => dialogTrigger.current}').map(node => node.getText()))
        .toEqual(oldModal.openingElement.attributes.properties.map(node => node.getText()));
      expect(modal.openingElement.attributes.properties.filter(node =>
        node.getText() === 'getReturnFocusTarget={() => dialogTrigger.current}')).toHaveLength(1);
      expect(current.split('const dialogTrigger = useRef<HTMLButtonElement>(null);')).toHaveLength(2);
      for (const tag of ['Popover', 'Tooltip', 'Tabs']) {
        expect(nodes.find(node => opening(node).tagName.getText() === tag)?.getText())
          .toBe(oldNodes.find(node => opening(node).tagName.getText() === tag)?.getText());
      }
    });

    it('uses the unchanged public Modal focus API and shared ref-forwarding Button without a global behavior exemption', () => {
      expect(previewOverlayInvoker.dependencies).toHaveLength(10);
      for (const dependency of previewOverlayInvoker.dependencies) expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(source('web/src/components/ui/index.ts')).toContain("export { Modal, type ModalProps } from './Modal';");
      expect(source('web/src/components/ui/index.ts')).toContain("} from './Button';");
      expect(source('web/src/components/ui/Button.tsx')).toContain('forwardRef<HTMLButtonElement, ButtonProps>');
      expect(source('web/src/components/ui/Modal.tsx')).toContain("getReturnFocusTarget?: UseDialogFocusOptions['getReturnFocusTarget'];");
      expect(source('web/src/components/ui/Modal.tsx'))
        .toContain('useDialogFocus({ open, containerRef: dialogRef, onClose, getReturnFocusTarget });');
      expect(source('web/src/hooks/useDialogFocus.ts')).toContain('returnFocusTargetRef.current?.() ?? null');
    });

    it.each(patch.hunks)('rejects missing, modified, duplicated or individually reverted region at $start', hunk => {
      const current = invokerCurrent;
      const fragment = hunk.new.join('\n');
      expect(current.split(fragment)).toHaveLength(2);
      for (const changed of [
        current.replace(fragment, ''),
        current.replace(fragment, fragment + '!'),
        current + '\n' + fragment,
        current.replace(fragment, hunk.old.join('\n')),
      ]) expect(() => restorePreviewOverlayInvokerSource(file, changed)).toThrow();
    });

    it.each(Array.from({ length: 15 }, (_, index) => index))('rejects key, fallback, arity or option drift at ordered call %s', index => {
      const current = invokerCurrent;
      const call = translationCalls(file, current)[index];
      expect(call.arguments).toHaveLength(2);
      const changedCalls = [
        `t('theme.appDesignPreview.changedKey', ${call.arguments[1].getText()})`,
        `t(${call.arguments[0].getText()}, 'Changed default')`,
        `t(${call.arguments[0].getText()})`,
        `t(${call.arguments.map(argument => argument.getText()).join(', ')}, { changedOption: true })`,
      ];
      for (const changed of changedCalls) {
        const mutant = current.slice(0, call.getStart()) + changed + current.slice(call.getEnd());
        expect(() => restorePreviewOverlayInvokerSource(file, mutant)).toThrow();
      }
    });

    it.each([
      ["from 'react-i18next'", "from 'other-translator'", 1],
      ["useTranslation('settings')", "useTranslation('other')", 1],
      ['useId, useRef, useState', 'useId, useState', 1],
      ['setDialog(false)', 'setDialog(true)', 2],
      ['setPopover(false)', 'setPopover(true)', 2],
      ['onChange={setTab}', 'onChange={() => {}}', 1],
      ["hidden={tab !== item.key}", "hidden={true}", 1],
      ['disabled: true', 'disabled: false', 1],
      ['getReturnFocusTarget={() => dialogTrigger.current}', 'getReturnFocusTarget={() => anchor.current}', 1],
    ] as const)('rejects import/origin/action/section/control/return-target drift: %s', (original, edited, occurrences) => {
      const current = invokerCurrent;
      expect(current.split(original)).toHaveLength(occurrences + 1);
      let offset = 0;
      for (let occurrence = 0; occurrence < occurrences; occurrence++) {
        const index = current.indexOf(original, offset);
        const changed = current.slice(0, index) + edited + current.slice(index + original.length);
        expect(() => restorePreviewOverlayInvokerSource(file, changed)).toThrow();
        offset = index + original.length;
      }
    });

    it.each(previewOverlayInvoker.dependencies)('rejects actual shared UI/focus dependency drift: $file', dependency => {
      expect(() => restorePreviewOverlayInvokerSource(file, invokerCurrent, path =>
        source(path) + (path === dependency.file ? '\n// changed overlay dependency\n' : ''))).toThrow();
      expect(() => restorePreviewOverlayInvokerSource(file, invokerCurrent, path => {
        if (path === dependency.file) throw new Error('Missing overlay dependency');
        return source(path);
      })).toThrow();
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256', 'originalProjectionSha256'] as const)(
      'rejects stale exact successor fixture %s', field => {
        const saved = patch[field];
        try {
          patch[field] += '-stale';
          expect(() => restorePreviewOverlayInvokerSource(file, invokerCurrent)).toThrow('pinned preview overlay invoker successor');
        } finally {
          patch[field] = saved;
        }
        expect(hash(previous())).toBe(patch.before);
      },
    );

    it('rejects stale predecessor/current provenance, dependency and inverse coordinates without refreshing history', () => {
      const mutate = (read: () => string, write: (value: string) => void) => {
        const saved = read();
        try {
          write(saved + '-stale');
          expect(() => restorePreviewOverlayInvokerSource(file, invokerCurrent)).toThrow('pinned preview overlay invoker successor');
        } finally {
          write(saved);
        }
      };
      mutate(() => previewOverlayInvoker.independentPredecessorProof.mapSha256,
        value => { previewOverlayInvoker.independentPredecessorProof.mapSha256 = value; });
      mutate(() => previewOverlayInvoker.compiledCurrentProof.mapSha256,
        value => { previewOverlayInvoker.compiledCurrentProof.mapSha256 = value; });
      mutate(() => previewOverlayInvoker.dependencies[0].sha256,
        value => { previewOverlayInvoker.dependencies[0].sha256 = value; });
      const saved = patch.hunks[0].start;
      try {
        patch.hunks[0].start++;
        expect(() => restorePreviewOverlayInvokerSource(file, invokerCurrent)).toThrow('pinned preview overlay invoker successor');
      } finally {
        patch.hunks[0].start = saved;
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('retains the exact map-frame inverse and raw comparisons for all eight other catalog producers', () => {
      const others = appDesign.catalogProducers.filter(producer => producer.file !== file);
      expect(others).toHaveLength(9);
      for (const producer of others) {
        const current = source(producer.file);
        expect(restorePreviewOverlayInvokerSource(producer.file, current)).toBe(current);
        const predecessor = previewProducerPredecessor(producer.file, current);
        expect(hash(predecessor)).toBe(producer.sha256);
        if (![previewMapFrame.sources[0].file, tableNoMatch.sources[1].file, previewMapReset.sources[0].file].includes(producer.file)) {
          expect(predecessor).toBe(restorePreviewChartQuerySource(producer.file, current));
        }
        const changed = current + '\n// unrelated producer drift\n';
        expect(restorePreviewOverlayInvokerSource(producer.file, changed)).toBe(changed);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, changed))).toBe(producer.sha256)).toThrow();
      }
    });

    it('never applies an inverse to a prefix, sibling, differently cased path or import name', () => {
      const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './PreviewOverlays']) {
        expect(restorePreviewOverlayInvokerSource(path, text)).toBe(text);
      }
    });
  });

  describe('exact two-line PreviewMap popup layout/title successor', () => {
    const file = 'web/src/features/settings/components/app-design-preview/PreviewMap.tsx';
    const patch = previewMapPopup.sources[0];
    const previous = () => restorePreviewMapPopupSource(file, source(file));
    function elements(text: string): ts.JsxElement[] {
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const found: ts.JsxElement[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxElement(node)) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      return found;
    }

    it('pins only two exact lines, independent compiled cc2, and both unchanged historical preview fixtures', () => {
      expect(previewMapPopup.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks).toHaveLength(2);
      expect(patch.hunks.map(hunk => hunk.start)).toEqual([19, 46]);
      expect(patch.hunks.every(hunk => hunk.old.length === 1 && hunk.new.length === 1)).toBe(true);
      expect(patch.before).toBe('cc2b432e4e21ed4c3dddf8f0cabba350259bc9063b43a35a0d961f717775e43d');
      expect(patch.after).toBe('5838c13c58dc2b205d08694f2512290f7f736c9aea59a50c90e5c03ca3a490c9');
      expect(patch.before).toBe(previewMapPopup.independentPredecessorProof.sha256);
      expect(patch.before).toBe(previewMapFrame.sources[0].after);
      expect(hash(JSON.stringify(previewMapFrame)))
        .toBe('9da57db20bff20217a41523ac0b0a57e2da3900f70432c7d11bb5994b7ffbb75');
      expect(hash(JSON.stringify(previewOverlayInvoker)))
        .toBe('571895973378718e346ff1ac11e8e5b5cf92d52765dc2a326fd6f0f62821d817');
    });

    it('requires the complete 59-line shipping source and recovers cc2 then the original ba1 producer in order', () => {
      const current = source(file);
      const cc2 = previous();
      expect(hash(current)).toBe(patch.after);
      expect(hash(cc2)).toBe(patch.before);
      expect(current.trimEnd().split('\n')).toHaveLength(59);
      expect(cc2.trimEnd().split('\n')).toHaveLength(59);
      expect(patch.currentLineCount).toBe(59);
      expect(patch.originalLineCount).toBe(59);
      const original = restorePreviewMapFrameSource(file, cc2);
      expect(hash(original)).toBe(previewMapFrame.sources[0].before);
      expect(hash(original)).toBe(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256);
      expect(() => restorePreviewMapFrameSource(file, current)).toThrow();
      const abandonedTitleOnly = current.replace(' [container-type:inline-size]', '')
        .replace(' className="[&_.leaflet-popup-content]:max-w-[calc(100cqw_-_5.5rem)]"', '');
      expect(hash(abandonedTitleOnly)).toBe('c3181f362ee684592fe86e315b54fc4ec7da954a0058f7d10e5902c51c4fb135');
      for (const changed of [cc2, original, abandonedTitleOnly, current + '\n', current.slice(1)]) {
        expect(() => restorePreviewMapPopupSource(file, changed)).toThrow();
      }
      expect(source(file)).toBe(current);
    });

    it('preserves every ordered call/default/option/arity, translator binding, control and original import', () => {
      const current = source(file);
      const cc2 = previous();
      const calls = translationCalls(file, cc2).map(signature);
      expect(calls).toHaveLength(9);
      expect(calls).toHaveLength(patch.originalCallCount);
      expect(hash(JSON.stringify(calls))).toBe(patch.originalCallsSha256);
      expect(patch.originalCallsSha256).toBe(previewMapFrame.sources[0].originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(calls);
      expect(translationCalls(file, current).map(call => call.arguments.length)).toEqual([2, 2, 2, 2, 3, 3, 2, 2, 2]);
      const projection = producerProjection(file, cc2);
      expect(hash(JSON.stringify(projection))).toBe(patch.originalProjectionSha256);
      expect(producerProjection(file, current)).toEqual(projection);
      expect(projection.bindings).toEqual([
        "import { useTranslation } from 'react-i18next';",
        "{ t } = useTranslation('settings')",
      ]);
      const imports = (text: string) => {
        const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        return parsed.statements.filter(ts.isImportDeclaration).map(node => node.getText(parsed));
      };
      expect(imports(current)).toEqual(imports(cc2));
      expect(imports(current)).toContain("import { CircleMarker, MapContainer, MapInvalidator, Polyline, Popup, Rectangle } from '@/components/maps';");
    });

    it('adds only container-relative layout and block-title semantics, retaining provenance and all map sections/actions', () => {
      const current = source(file);
      const cc2 = previous();
      const nodes = elements(current);
      const oldNodes = elements(cc2);
      expect(nodes.map(node => node.openingElement.tagName.getText()))
        .toEqual(oldNodes.map(node => node.openingElement.tagName.getText()));
      const popups = nodes.filter(node => node.openingElement.tagName.getText() === 'Popup');
      const oldPopups = oldNodes.filter(node => node.openingElement.tagName.getText() === 'Popup');
      expect(popups).toHaveLength(1);
      expect(oldPopups).toHaveLength(1);
      const children = popups[0].children.filter(ts.isJsxElement);
      const oldChildren = oldPopups[0].children.filter(ts.isJsxElement);
      expect(children.map(node => node.openingElement.tagName.getText())).toEqual(['Text', 'Caption']);
      expect(children[0].openingElement.attributes.properties.map(node => node.getText())).toEqual(['as="div"']);
      expect(oldChildren[0].openingElement.attributes.properties).toHaveLength(0);
      expect(children[0].children.map(node => node.getText())).toEqual(oldChildren[0].children.map(node => node.getText()));
      expect(children[1].getText()).toBe(oldChildren[1].getText());
      expect(popups[0].openingElement.attributes.properties.map(node => node.getText()))
        .toEqual(['className="[&_.leaflet-popup-content]:max-w-[calc(100cqw_-_5.5rem)]"']);
      expect(oldPopups[0].openingElement.attributes.properties).toHaveLength(0);
      const frame = nodes.filter(node => node.openingElement.attributes.getText().includes('data-app-part="map map-stage"'));
      expect(frame).toHaveLength(1);
      expect(frame[0].openingElement.getText()).toBe(patch.hunks[0].new[0].trim());
      let restored = current;
      for (const hunk of patch.hunks) restored = restored.replace(hunk.new[0], hunk.old[0]);
      expect(restored).toBe(cc2);
      for (const fragment of ['data-preview-section="map"', 'relative isolate h-72 min-w-0', 'className="h-full w-full"',
        'routeVisible && <Polyline', 'marker.openPopup();', 'data-preview-map-marker']) {
        expect(current).toContain(fragment);
        expect(cc2).toContain(fragment);
      }
      expect(source('web/src/components/ui/Typography.tsx')).toContain('as?: ElementType');
      expect(source('web/src/components/ui/Typography.tsx')).toContain('const Tag = as');
    });

    it.each(patch.hunks)('rejects missing, modified, duplicated or individually reverted popup region at $start', hunk => {
      const current = source(file);
      expect(current.split(hunk.new[0])).toHaveLength(2);
      for (const changed of [
        current.replace(hunk.new[0], ''),
        current.replace(hunk.new[0], hunk.new[0] + '!'),
        current + '\n' + hunk.new[0],
        current.replace(hunk.new[0], hunk.old[0]),
        current.replace('<Text as="div">', '<Text as="span">'),
        current.replace('<Text as="div">', '<Text as="p">'),
        current.replace('<Caption>{t(', '<Caption as="div">{t('),
        current.replace('[container-type:inline-size]', '[container-type:size]'),
        current.replace('100cqw_-_5.5rem', '100vw_-_5.5rem'),
      ]) expect(() => restorePreviewMapPopupSource(file, changed)).toThrow();
    });

    it.each(Array.from({ length: 9 }, (_, index) => index))('rejects key/default/arity/options drift at original ordered call %s', index => {
      const current = source(file);
      const call = translationCalls(file, current)[index];
      const argumentsText = call.arguments.map(argument => argument.getText());
      const changes = [
        `t(${["'theme.appDesignPreview.changedKey'", ...argumentsText.slice(1)].join(', ')})`,
        `t(${[argumentsText[0], "'Changed default'", ...argumentsText.slice(2)].join(', ')})`,
        `t(${argumentsText[0]})`,
        `t(${argumentsText.slice(0, 2).join(', ')}, { number: 0 })`,
      ];
      for (const changed of changes) {
        expect(() => restorePreviewMapPopupSource(file,
          current.slice(0, call.getStart()) + changed + current.slice(call.getEnd()))).toThrow();
      }
    });

    it.each([
      ["from 'react-i18next'", "from 'other-translator'", 1],
      ["useTranslation('settings')", "useTranslation('other')", 1],
      ['number: index + 1', 'number: index + 2', 2],
      ['routeVisible && <Polyline', '!routeVisible && <Polyline', 1],
      ['marker.openPopup();', 'return;', 1],
      ['scrollWheelZoom={false}', 'scrollWheelZoom={true}', 1],
    ] as const)('rejects original import/origin/options/route/marker/interaction drift: %s', (original, edited, occurrences) => {
      const current = source(file);
      expect(current.split(original)).toHaveLength(occurrences + 1);
      let offset = 0;
      for (let occurrence = 0; occurrence < occurrences; occurrence++) {
        const index = current.indexOf(original, offset);
        expect(() => restorePreviewMapPopupSource(file,
          current.slice(0, index) + edited + current.slice(index + original.length))).toThrow();
        offset = index + original.length;
      }
    });

    it.each(previewMapPopup.dependencies)('rejects actual geometry/control/typography/import dependency drift: $file', dependency => {
      expect(hash(restorePreviewMapControlsSource(dependency.file, historicalSource(dependency.file)))).toBe(dependency.sha256);
      expect(() => restorePreviewMapPopupSource(file, source(file), path =>
        source(path) + (path === dependency.file ? '\n// unrelated dependency drift\n' : ''))).toThrow();
      expect(() => restorePreviewMapPopupSource(file, source(file), path => {
        if (path === dependency.file) throw new Error('Missing popup dependency');
        return source(path);
      })).toThrow();
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256', 'originalProjectionSha256'] as const)(
      'rejects stale popup fixture %s', field => {
        const saved = patch[field];
        try {
          patch[field] += '-stale';
          expect(() => restorePreviewMapPopupSource(file, source(file))).toThrow('pinned PreviewMap popup successor');
        } finally {
          patch[field] = saved;
        }
        expect(hash(previous())).toBe(patch.before);
      },
    );

    it('rejects stale independent map provenance and inverse coordinates without refreshing older fixtures', () => {
      const proof = previewMapPopup.independentPredecessorProof;
      const savedMap = proof.mapSha256;
      const savedStart = patch.hunks[0].start;
      try {
        proof.mapSha256 = '0'.repeat(64);
        expect(() => restorePreviewMapPopupSource(file, source(file))).toThrow('pinned PreviewMap popup successor');
        proof.mapSha256 = savedMap;
        patch.hunks[0].start++;
        expect(() => restorePreviewMapPopupSource(file, source(file))).toThrow('pinned PreviewMap popup successor');
      } finally {
        proof.mapSha256 = savedMap;
        patch.hunks[0].start = savedStart;
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('keeps the overlay successor and all eight other producers under their original exact comparisons', () => {
      const others = appDesign.catalogProducers.filter(producer => producer.file !== file);
      expect(others).toHaveLength(9);
      for (const producer of others) {
        const current = source(producer.file);
        expect(restorePreviewMapPopupSource(producer.file, current)).toBe(current);
        expect(hash(previewProducerPredecessor(producer.file, current))).toBe(producer.sha256);
        const changed = current + '\n// unrelated producer drift\n';
        expect(restorePreviewMapPopupSource(producer.file, changed)).toBe(changed);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, changed))).toBe(producer.sha256)).toThrow();
      }
      const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './PreviewMap']) {
        expect(restorePreviewMapPopupSource(path, text)).toBe(text);
      }
    });
  });

  describe('exact single-prop preview overlay tooltip portal successor', () => {
    const file = 'web/src/features/settings/components/app-design-preview/PreviewOverlays.tsx';
    const patch = previewOverlayTooltip.sources[0];
    // Keep every original tooltip-stage mutation guard meaningful against
    // verified e0e bytes, not a bypass for the newer shipping inset endpoint.
    const tooltipCurrent = restorePreviewOverlayHelpInsetSource(file, source(file));
    const previous = () => restorePreviewOverlayTooltipSource(file, tooltipCurrent);
    function elements(text: string): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parsed);
      return found;
    }
    const opening = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
      ts.isJsxElement(node) ? node.openingElement : node;

    it('pins only the exact opt-in line and independently compiled d70 without refreshing either older preview chain', () => {
      expect(previewOverlayTooltip.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks).toHaveLength(1);
      expect(patch.hunks[0].start).toBe(22);
      expect(patch.hunks[0].old).toHaveLength(1);
      expect(patch.hunks[0].new).toHaveLength(1);
      expect(patch.before).toBe('d70cc7377a476cccc13602feb4b38a8a57ee9cc24a8588f124cd579515ce9a1c');
      expect(patch.after).toBe('e0e892508533ec7cde37c639d6d94d526c193ccec11f7aaa94bf564aaa7d6ced');
      expect(patch.before).toBe(previewOverlayTooltip.independentPredecessorProof.sha256);
      expect(patch.before).toBe(previewOverlayInvoker.sources[0].after);
      expect(hash(JSON.stringify(previewOverlayInvoker)))
        .toBe('571895973378718e346ff1ac11e8e5b5cf92d52765dc2a326fd6f0f62821d817');
      expect(hash(JSON.stringify(previewMapPopup)))
        .toBe('f3c73ac20c03f3bbb96bc6a2d5672b724ee7375bf553c8a5fc465c402efea0da');
    });

    it('recovers complete 50-line d70 then the original 200e overlay, never accepting either old stage as shipping source', () => {
      const current = tooltipCurrent;
      const d70 = previous();
      expect(hash(current)).toBe(patch.after);
      expect(hash(d70)).toBe(patch.before);
      expect(current.trimEnd().split('\n')).toHaveLength(50);
      expect(d70.trimEnd().split('\n')).toHaveLength(50);
      expect(patch.originalLineCount).toBe(50);
      expect(patch.currentLineCount).toBe(50);
      const original = restorePreviewOverlayInvokerSource(file, d70);
      expect(hash(original)).toBe(previewOverlayInvoker.sources[0].before);
      expect(hash(original)).toBe(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256);
      expect(() => restorePreviewOverlayInvokerSource(file, current)).toThrow();
      for (const changed of [d70, original, current + '\n', current.slice(1)]) {
        expect(() => restorePreviewOverlayTooltipSource(file, changed)).toThrow();
      }
      expect(restorePreviewOverlayHelpInsetSource(file, source(file))).toBe(current);
    });

    it('retains all fifteen ordered calls/defaults/arity/options, complete controls, translator bindings and every import', () => {
      const current = tooltipCurrent;
      const d70 = previous();
      const calls = translationCalls(file, d70).map(signature);
      expect(calls).toHaveLength(15);
      expect(calls).toHaveLength(patch.originalCallCount);
      expect(hash(JSON.stringify(calls))).toBe(patch.originalCallsSha256);
      expect(patch.originalCallsSha256).toBe(previewOverlayInvoker.sources[0].originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(calls);
      expect(translationCalls(file, current).map(call => call.arguments.length)).toEqual(Array(15).fill(2));
      const projection = producerProjection(file, d70);
      expect(hash(JSON.stringify(projection))).toBe(patch.originalProjectionSha256);
      expect(producerProjection(file, current)).toEqual(projection);
      expect(projection.bindings).toEqual([
        "import { useTranslation } from 'react-i18next';",
        "{ t } = useTranslation('settings')",
      ]);
      const imports = (text: string) => {
        const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        return parsed.statements.filter(ts.isImportDeclaration).map(node => node.getText(parsed));
      };
      expect(imports(current)).toEqual(imports(d70));
      expect(imports(current)).toEqual([
        "import { useId, useRef, useState } from 'react';",
        "import { useTranslation } from 'react-i18next';",
        "import { Button, Modal, Popover, Tabs, Text, Tooltip } from '@/components/ui';",
      ]);
    });

    it('opts only the existing Tooltip into its unchanged public portal API, preserving every child and modal return action', () => {
      const current = tooltipCurrent;
      const d70 = previous();
      const nodes = elements(current);
      const oldNodes = elements(d70);
      const tags = nodes.map(node => opening(node).tagName.getText());
      expect(tags).toEqual(oldNodes.map(node => opening(node).tagName.getText()));
      expect(tags.filter(tag => tag === 'Button')).toHaveLength(5);
      const tooltips = nodes.filter(node => opening(node).tagName.getText() === 'Tooltip') as ts.JsxElement[];
      const oldTooltips = oldNodes.filter(node => opening(node).tagName.getText() === 'Tooltip') as ts.JsxElement[];
      expect(tooltips).toHaveLength(1);
      expect(oldTooltips).toHaveLength(1);
      const attributes = tooltips[0].openingElement.attributes.properties;
      const portal = attributes.filter(node => ts.isJsxAttribute(node) && node.name.getText() === 'portal');
      expect(portal).toHaveLength(1);
      expect((portal[0] as ts.JsxAttribute).initializer).toBeUndefined();
      expect(attributes.filter(node => node !== portal[0]).map(node => node.getText()))
        .toEqual(oldTooltips[0].openingElement.attributes.properties.map(node => node.getText()));
      expect(tooltips[0].children.map(node => node.getText())).toEqual(oldTooltips[0].children.map(node => node.getText()));
      for (const tag of ['Modal', 'Popover', 'Tabs']) {
        expect(nodes.find(node => opening(node).tagName.getText() === tag)?.getText())
          .toBe(oldNodes.find(node => opening(node).tagName.getText() === tag)?.getText());
      }
      expect(current.replace(patch.hunks[0].new[0], patch.hunks[0].old[0])).toBe(d70);
      expect(current).toContain('getReturnFocusTarget={() => dialogTrigger.current}');
      expect(current).toContain('ref={dialogTrigger} onClick={() => setDialog(true)}');
      expect(previewOverlayTooltip.dependencies).toEqual(previewOverlayInvoker.dependencies);
      const tooltipFile = 'web/src/components/ui/Tooltip.tsx';
      expect(hash(historicalSource(tooltipFile))).toBe('63c0fe0e6025030564d73b10fc83a4544d0bdf914ca91a18308b788b36735ca9');
      expect(source(tooltipFile)).toContain('portal?: boolean;');
      expect(source(tooltipFile)).toContain('const portal = portalProp ?? inheritedPortal;');
      expect(source(tooltipFile)).toContain('<AppDesignPortal anchorRef={triggerRef}>{bubble}</AppDesignPortal>');
    });

    it('rejects missing, modified, duplicated, reverted, false or differently targeted portal opt-ins', () => {
      const current = tooltipCurrent;
      const hunk = patch.hunks[0];
      expect(current.split(hunk.new[0])).toHaveLength(2);
      for (const changed of [
        current.replace(hunk.new[0], ''),
        current.replace(hunk.new[0], hunk.new[0] + '!'),
        current + '\n' + hunk.new[0],
        current.replace(hunk.new[0], hunk.old[0]),
        current.replace('<Tooltip portal content=', '<Tooltip portal={false} content='),
        current.replace('<Tooltip portal content=', '<Tooltip portal={true} content='),
        current.replace('<Tooltip portal content=', '<Tooltip portal={undefined} content='),
        current.replace('<Tooltip portal content=', '<Tooltip content=').replace('<Popover open=', '<Popover portal open='),
      ]) expect(() => restorePreviewOverlayTooltipSource(file, changed)).toThrow();
    });

    it.each(Array.from({ length: 15 }, (_, index) => index))('rejects key/default/arity/options drift at original ordered call %s', index => {
      const current = tooltipCurrent;
      const call = translationCalls(file, current)[index];
      expect(call.arguments).toHaveLength(2);
      for (const changed of [
        `t('theme.appDesignPreview.changedKey', ${call.arguments[1].getText()})`,
        `t(${call.arguments[0].getText()}, 'Changed default')`,
        `t(${call.arguments[0].getText()})`,
        `t(${call.arguments.map(argument => argument.getText()).join(', ')}, { changedOption: true })`,
      ]) expect(() => restorePreviewOverlayTooltipSource(file,
        current.slice(0, call.getStart()) + changed + current.slice(call.getEnd()))).toThrow();
    });

    it.each([
      ["from 'react-i18next'", "from 'other-translator'", 1],
      ["useTranslation('settings')", "useTranslation('other')", 1],
      ['setDialog(false)', 'setDialog(true)', 2],
      ['setPopover(false)', 'setPopover(true)', 2],
      ['disabled: true', 'disabled: false', 1],
      ['getReturnFocusTarget={() => dialogTrigger.current}', 'getReturnFocusTarget={() => anchor.current}', 1],
    ] as const)('rejects protected origin/action/disabled-tab/return-target drift: %s', (original, edited, occurrences) => {
      const current = tooltipCurrent;
      expect(current.split(original)).toHaveLength(occurrences + 1);
      let offset = 0;
      for (let occurrence = 0; occurrence < occurrences; occurrence++) {
        const index = current.indexOf(original, offset);
        expect(() => restorePreviewOverlayTooltipSource(file,
          current.slice(0, index) + edited + current.slice(index + original.length))).toThrow();
        offset = index + original.length;
      }
    });

    it.each(previewOverlayTooltip.dependencies)('rejects actual shared UI/focus dependency drift: $file', dependency => {
      expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(() => restorePreviewOverlayTooltipSource(file, tooltipCurrent, path =>
        source(path) + (path === dependency.file ? '\n// unrelated dependency drift\n' : ''))).toThrow();
      expect(() => restorePreviewOverlayTooltipSource(file, tooltipCurrent, path => {
        if (path === dependency.file) throw new Error('Missing overlay tooltip dependency');
        return source(path);
      })).toThrow();
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256', 'originalProjectionSha256'] as const)(
      'rejects stale exact tooltip successor fixture %s', field => {
        const saved = patch[field];
        try {
          patch[field] += '-stale';
          expect(() => restorePreviewOverlayTooltipSource(file, tooltipCurrent)).toThrow('pinned preview overlay tooltip successor');
        } finally {
          patch[field] = saved;
        }
        expect(hash(previous())).toBe(patch.before);
      },
    );

    it('rejects stale independent map provenance and inverse coordinates without refreshing the invoker fixture', () => {
      const proof = previewOverlayTooltip.independentPredecessorProof;
      const savedMap = proof.mapSha256;
      const savedStart = patch.hunks[0].start;
      try {
        proof.mapSha256 = '0'.repeat(64);
        expect(() => restorePreviewOverlayTooltipSource(file, tooltipCurrent)).toThrow('pinned preview overlay tooltip successor');
        proof.mapSha256 = savedMap;
        patch.hunks[0].start++;
        expect(() => restorePreviewOverlayTooltipSource(file, tooltipCurrent)).toThrow('pinned preview overlay tooltip successor');
      } finally {
        proof.mapSha256 = savedMap;
        patch.hunks[0].start = savedStart;
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('keeps the complete map chain and eight other producers exact without path/import/wildcard exemptions', () => {
      const others = appDesign.catalogProducers.filter(producer => producer.file !== file);
      expect(others).toHaveLength(9);
      for (const producer of others) {
        const current = source(producer.file);
        expect(restorePreviewOverlayTooltipSource(producer.file, current)).toBe(current);
        const predecessor = previewProducerPredecessor(producer.file, current);
        expect(hash(predecessor)).toBe(producer.sha256);
        const changed = current + '\n// unrelated producer drift\n';
        expect(restorePreviewOverlayTooltipSource(producer.file, changed)).toBe(changed);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, changed))).toBe(producer.sha256)).toThrow();
      }
      const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './PreviewOverlays']) {
        expect(restorePreviewOverlayTooltipSource(path, text)).toBe(text);
      }
    });
  });

  describe('exact DataTable no-match API and PreviewTable caller successor', () => {
    const api = tableNoMatch.sources[0];
    const caller = tableNoMatch.sources[1];
    // Keep every original API-stage proof against verified 555113 bytes.
    // Actual caller/API pair reads still validate the newer shipping endpoint.
    const noMatchCurrent = (file: string) => restoreTableEmptyViewportSource(file, source(file));
    const previous = (file: string) => restoreTableNoMatchSource(file, noMatchCurrent(file));
    const parsed = (file: string, text: string) =>
      ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function initializer(file: string, text: string, name: string): string {
      const tree = parsed(file, text);
      const found: ts.VariableDeclaration[] = [];
      function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(tree);
      expect(found, name + ': unique original binding').toHaveLength(1);
      expect(found[0].initializer).toBeDefined();
      return found[0].initializer!.getText(tree);
    }

    it('pins exactly two reviewed endpoints and four regions without changing old source or catalog producer pins', () => {
      expect(tableNoMatch.sources.map(patch => patch.file)).toEqual([
        'web/src/components/ui/DataTable.tsx',
        'web/src/features/settings/components/app-design-preview/PreviewTable.tsx',
      ]);
      expect(tableNoMatch.sources.map(patch => patch.hunks.map(hunk => hunk.start))).toEqual([[231, 503, 630], [43]]);
      expect(api.before).toBe('457005e75ef3bc7f8cd92db6bed78054b3bf0dcda2e236e6ddc64d224a0dbc06');
      expect(api.after).toBe('555113bc67b988967d83f10c52a46985a74f8dea6ae5c3db465a22126c9cb87a');
      expect(caller.before).toBe('47d8fe973084cfda4b2bc15bfebdb7f0c3648da1217afea2c0a5a0070483d35f');
      expect(caller.after).toBe('ff56272d6cdc2f981db0ab79f791b1b6b124b7b57c7c4d216225d98afdd91f3a');
      expect(api.before).toBe(appDesign.sources.find(patch => patch.file === api.file)?.after);
      expect(caller.before).toBe(appDesign.catalogProducers.find(producer => producer.file === caller.file)?.sha256);
      expect(hash(JSON.stringify(appDesign))).toBe('3fb94cebaedae05cee60df9fa1b53ec45566a9825ee6bf449f507704eeb477d2');
    });

    it.each(tableNoMatch.sources)('recovers complete independently compiled bytes and rejects old/mixed/unrelated source: $file', patch => {
      const current = noMatchCurrent(patch.file);
      const original = previous(patch.file);
      expect(hash(current)).toBe(patch.after);
      expect(hash(original)).toBe(patch.before);
      expect(patch.before).toBe(patch.independentPredecessorProof.sha256);
      expect(current.trimEnd().split('\n')).toHaveLength(patch.currentLineCount);
      expect(original.trimEnd().split('\n')).toHaveLength(patch.originalLineCount);
      for (const changed of [original, current + '\n', current.slice(1)]) {
        expect(() => restoreTableNoMatchSource(patch.file, changed)).toThrow();
      }
      expect(noMatchCurrent(patch.file)).toBe(current);
      if (patch.file === api.file) {
        expect(hash(restoreAppDesignSource(patch.file, source(patch.file))))
          .toBe(appDesign.sources.find(entry => entry.file === patch.file)?.before);
      } else expect(hash(previewProducerPredecessor(patch.file, current))).toBe(caller.before);
    });

    it.each(tableNoMatch.sources)('preserves every ordered original call, default, arity, options, binding and import: $file', patch => {
      const current = noMatchCurrent(patch.file);
      const original = previous(patch.file);
      const oldCalls = translationCalls(patch.file, original).map(signature);
      expect(oldCalls).toHaveLength(patch.originalCallCount);
      expect(patch.originalCallCount).toBe(patch.file === api.file ? 24 : 16);
      expect(hash(JSON.stringify(oldCalls))).toBe(patch.originalCallsSha256);
      expect(translationCalls(patch.file, current).map(signature)).toEqual(oldCalls);
      const oldProjection = producerProjection(patch.file, original);
      const currentProjection = producerProjection(patch.file, current);
      expect(hash(JSON.stringify(oldProjection))).toBe(patch.originalProjectionSha256);
      expect(hash(JSON.stringify(currentProjection))).toBe(patch.currentProjectionSha256);
      expect(currentProjection.bindings).toEqual(oldProjection.bindings);
      const imports = (text: string) => {
        const tree = parsed(patch.file, text);
        return tree.statements.filter(ts.isImportDeclaration).map(node => node.getText(tree));
      };
      expect(imports(current)).toEqual(imports(original));
      if (patch.file === caller.file) expect(currentProjection).toEqual(oldProjection);
    });

    it('accounts for exactly the new destructured API binding and one nullish fallback control, not a control exemption', () => {
      const current = noMatchCurrent(api.file);
      const original = previous(api.file);
      const parameterControl = (text: string) => {
        const tree = parsed(api.file, text);
        const functions = tree.statements.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === 'DataTable');
        expect(functions).toHaveLength(1);
        return 'parameters:' + functions[0].parameters.map(node =>
          printer.printNode(ts.EmitHint.Unspecified, node, tree).trim()).join(', ');
      };
      const oldParameter = parameterControl(original);
      const newParameter = parameterControl(current);
      expect(newParameter.replace('noMatchMessage: callerNoMatchMessage, ', '')).toBe(oldParameter);
      const projection = producerProjection(api.file, current);
      const expected = producerProjection(api.file, original);
      let nullishGuards = 0;
      let parameterBindings = 0;
      const recovered = {
        bindings: projection.bindings,
        calls: projection.calls.map(call => ({
          call: call.call,
          controls: call.controls.filter(control => {
            if (control !== 'binary:??:callerNoMatchMessage') return true;
            expect(call.call).toBe("t('combobox.noResults', 'No results')");
            nullishGuards++;
            return false;
          }).map(control => {
            if (control !== newParameter) return control;
            parameterBindings++;
            return oldParameter;
          }),
        })),
      };
      expect(nullishGuards).toBe(1);
      expect(parameterBindings).toBe(24);
      expect(recovered).toEqual(expected);
    });

    it('keeps genuine-empty, generic fallback, Clear filters and both mobile/desktop state plumbing byte-identical', () => {
      const current = noMatchCurrent(api.file);
      const original = previous(api.file);
      expect(current).toContain('noMatchMessage?: string');
      expect(current).toContain("emptyMessage = 'No data',");
      expect(initializer(api.file, current, 'noMatchMessage'))
        .toBe("callerNoMatchMessage ?? t('combobox.noResults', 'No results')");
      expect(initializer(api.file, original, 'noMatchMessage')).toBe("t('combobox.noResults', 'No results')");
      for (const name of ['localFilterNoMatch', 'resetFiltersLabel', 'clearFilters', 'mobileFilteredPresentation']) {
        expect(initializer(api.file, current, name)).toBe(initializer(api.file, original, name));
      }
      const oldTail = original.slice(original.indexOf('  const resetFiltersLabel ='));
      expect(current.slice(current.indexOf('  const resetFiltersLabel ='))).toBe(oldTail);
      expect(current).toContain('emptyMessage={emptyMessage}');
      expect(current).toContain(') : emptyMessage}');
      expect(current).toContain("kind: 'empty' as const, message: noMatchMessage,");
    });

    it('renames only the final PreviewTable prop while retaining all rows/SI/sort/filter/pagination and localized wording', () => {
      const current = source(caller.file);
      const original = previous(caller.file);
      expect(current.replace(caller.hunks[0].new[0], caller.hunks[0].old[0])).toBe(original);
      const table = (text: string) => {
        const tree = parsed(caller.file, text);
        const found: ts.JsxSelfClosingElement[] = [];
        function visit(node: ts.Node) {
          if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'DataTable') found.push(node);
          ts.forEachChild(node, visit);
        }
        visit(tree);
        expect(found).toHaveLength(1);
        return found[0];
      };
      expect(table(current).attributes.properties.map(node => node.getText().replace(/^noMatchMessage=/, 'emptyMessage=')))
        .toEqual(table(original).attributes.properties.map(node => node.getText()));
      expect(current).toContain("noMatchMessage={t('theme.appDesignPreview.noRows', 'No sample journeys match.')}");
      expect(current).not.toContain('emptyMessage=');
      expect(current).toContain('const { formatDistance } = useUnits();');
      expect(current).toContain('sortFn(PREVIEW_JOURNEYS');
      expect(current).toContain('row.energy_wh ?? Number.NEGATIVE_INFINITY');
    });

    it.each(tableNoMatch.sources.flatMap(patch => patch.hunks.map(hunk => ({ patch, hunk }))))(
      'rejects missing/modified/duplicated/individually reverted region at $hunk.start in $patch.file', ({ patch, hunk }) => {
        const current = noMatchCurrent(patch.file);
        const fragment = hunk.new.join('\n');
        expect(current.split(fragment)).toHaveLength(2);
        for (const changed of [
          current.replace(fragment, ''),
          current.replace(fragment, fragment + '!'),
          current + '\n' + fragment,
          current.replace(fragment, hunk.old.join('\n')),
        ]) expect(() => restoreTableNoMatchSource(patch.file, changed)).toThrow();
      },
    );

    it.each(tableNoMatch.sources)('rejects each occurrence-sensitive original key/default/arity/options mutation: $file', patch => {
      const current = noMatchCurrent(patch.file);
      for (const call of translationCalls(patch.file, current)) {
        expect(call.arguments.length).toBeGreaterThanOrEqual(2);
        const operands = call.arguments.map(argument => argument.getText());
        for (const changed of [
          `t(${["'table.changedKey'", ...operands.slice(1)].join(', ')})`,
          `t(${[operands[0], "'Changed default'", ...operands.slice(2)].join(', ')})`,
          `t(${operands[0]})`,
          `t(${operands.slice(0, 2).join(', ')}, { changedOption: true })`,
        ]) expect(() => restoreTableNoMatchSource(patch.file,
          current.slice(0, call.getStart()) + changed + current.slice(call.getEnd()))).toThrow();
      }
    });

    it('rejects logical-or fallback, lost genuine-empty state, removed clear action and wrong mobile no-match copy', () => {
      const current = noMatchCurrent(api.file);
      for (const [original, changed] of [
        ['callerNoMatchMessage ??', 'callerNoMatchMessage ||'],
        ["emptyMessage = 'No data'", "emptyMessage = 'Changed empty'"],
        ["t('common.clearFilters', 'Clear filters')", "'Clear'"],
        ["kind: 'empty' as const, message: noMatchMessage", "kind: 'empty' as const, message: emptyMessage"],
        ['searchControls?.onChange', 'return; // removed search reset'],
      ]) {
        expect(current).toContain(original);
        expect(() => restoreTableNoMatchSource(api.file, current.replace(original, changed))).toThrow();
      }
    });

    it.each(tableNoMatch.sources)('requires both actual current caller/API endpoints, not just supplied test bytes: $file', endpoint => {
      expect(() => restoreTableNoMatchSource(caller.file, source(caller.file), path =>
        source(path) + (path === endpoint.file ? '\n// actual endpoint drift\n' : ''))).toThrow();
    });

    it.each(tableNoMatch.dependencies)('rejects changed/missing actual mobile/filter/SI/barrel dependency: $file', dependency => {
      expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(() => restoreTableNoMatchSource(caller.file, source(caller.file), path =>
        source(path) + (path === dependency.file ? '\n// dependency drift\n' : ''))).toThrow();
      expect(() => restoreTableNoMatchSource(api.file, noMatchCurrent(api.file), path => {
        if (path === dependency.file) throw new Error('Missing table dependency');
        return source(path);
      })).toThrow();
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256', 'currentProjectionSha256'] as const)(
      'rejects stale exact successor fixture %s', field => {
        for (const patch of tableNoMatch.sources) {
          const current = noMatchCurrent(patch.file);
          const saved = patch[field];
          try {
            patch[field] += '-stale';
            expect(() => restoreTableNoMatchSource(caller.file, current)).toThrow('pinned table no-match successor');
          } finally {
            patch[field] = saved;
          }
          expect(hash(previous(patch.file))).toBe(patch.before);
        }
      },
    );

    it('rejects stale independent proof and inverse coordinates without mutating historical fixtures', () => {
      for (const patch of tableNoMatch.sources) {
        const proof = patch.independentPredecessorProof;
        const savedMap = proof.mapSha256;
        const savedStart = patch.hunks[0].start;
        try {
          proof.mapSha256 = '0'.repeat(64);
          expect(() => restoreTableNoMatchSource(patch.file, noMatchCurrent(patch.file))).toThrow('pinned table no-match successor');
          proof.mapSha256 = savedMap;
          patch.hunks[0].start++;
          expect(() => restoreTableNoMatchSource(patch.file, noMatchCurrent(patch.file))).toThrow('pinned table no-match successor');
        } finally {
          proof.mapSha256 = savedMap;
          patch.hunks[0].start = savedStart;
        }
      }
    });

    it('preserves all other exact producers and never applies to prefixes/siblings/case-folded/import paths', () => {
      const others = appDesign.catalogProducers.filter(producer => producer.file !== caller.file);
      expect(others).toHaveLength(9);
      for (const producer of others) {
        const current = source(producer.file);
        expect(restoreTableNoMatchSource(producer.file, current)).toBe(current);
        expect(hash(previewProducerPredecessor(producer.file, current))).toBe(producer.sha256);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, current + '\n'))).toBe(producer.sha256)).toThrow();
      }
      const text = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const patch of tableNoMatch.sources) {
        for (const file of [patch.file + '/child', patch.file.replace('.tsx', 'Other.tsx'), patch.file.toLowerCase(), './DataTable']) {
          expect(restoreTableNoMatchSource(file, text)).toBe(text);
        }
      }
    });
  });

  describe('exact native map reset successor before original control producer/dependency pins', () => {
    const patch = previewMapReset.sources[0];
    const file = patch.file;
    const current = source(file);
    const original = restorePreviewMapControlsSource(file, current);
    const parse = (text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    it('recovers complete independently compiled V25 bytes and links all three untouched historical endpoints', () => {
      expect(previewMapReset.sources).toHaveLength(1);
      expect(patch.hunks).toHaveLength(1);
      expect(patch.hunks[0].start).toBe(11);
      expect(hash(current)).toBe('0226d72b2bd55e63e67afb0fe2ccf83ab8c56211aab8b4aceb01933dac002cde');
      expect(hash(original)).toBe('e9f6de0d3b2e4ec118177f4a1d84b2094a641145706bc21bc2559499869b0541');
      expect(patch.before).toBe(patch.independentPredecessorProof.sha256);
      expect(patch.before).toBe(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256);
      for (const fixture of [previewMapFrame, previewMapPopup]) {
        expect(patch.before).toBe(fixture.dependencies.find(dependency => dependency.file === file)?.sha256);
      }
      expect(current.trimEnd().split('\n')).toHaveLength(16);
      expect(original.trimEnd().split('\n')).toHaveLength(16);
      expect(patch.currentLineCount).toBe(16);
      expect(patch.originalLineCount).toBe(16);
      expect(current.replace(patch.hunks[0].new[0], patch.hunks[0].old[0])).toBe(original);
    });

    it('preserves all three ordered calls, defaults, arities, options, imports and entire producer projection', () => {
      const oldCalls = translationCalls(file, original).map(signature);
      expect(oldCalls).toEqual([
        "t('theme.appDesignPreview.zoomIn', 'Zoom sample map in')",
        "t('theme.appDesignPreview.zoomOut', 'Zoom sample map out')",
        "t('theme.appDesignPreview.resetMap', 'Reset map')",
      ]);
      expect(patch.originalCallCount).toBe(3);
      expect(hash(JSON.stringify(oldCalls))).toBe(patch.originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(oldCalls);
      expect(producerProjection(file, current)).toEqual(producerProjection(file, original));
      expect(hash(JSON.stringify(producerProjection(file, current)))).toBe(patch.originalProjectionSha256);
      const imports = (text: string) => parse(text).statements.filter(ts.isImportDeclaration).map(node => node.getText());
      expect(imports(current)).toEqual(imports(original));
    });

    it('adds only the public animate:false option while retaining center, zoom, native map hook and both zoom actions', () => {
      const actions = (text: string) => {
        const found: [string, string[]][] = [];
        function visit(node: ts.Node) {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && node.expression.expression.getText() === 'map') {
            found.push([node.expression.name.text, node.arguments.map(argument => argument.getText())]);
          }
          ts.forEachChild(node, visit);
        }
        visit(parse(text));
        return found;
      };
      expect(actions(original)).toEqual([['zoomIn', []], ['zoomOut', []], ['setView', ['[0.01, 0]', '13']]]);
      expect(actions(current)).toEqual([
        ['zoomIn', []], ['zoomOut', []], ['setView', ['[0.01, 0]', '13', '{ animate: false }']],
      ]);
      expect(current).toContain('const map = useMap();');
      expect(source(previewMapReset.dependencies[0].file)).toContain("} from 'react-leaflet';");
      expect(current).not.toContain('reset:');
    });

    it('rejects predecessor, missing, modified, duplicated, individually reverted and unrelated source bytes', () => {
      const fragment = patch.hunks[0].new[0];
      expect(current.split(fragment)).toHaveLength(2);
      for (const changed of [
        original, current + '\n', current.slice(1), current.replace(fragment, ''),
        current.replace(fragment, fragment + '!'), current + '\n' + fragment,
      ]) expect(() => restorePreviewMapControlsSource(file, changed)).toThrow();
    });

    it('rejects changed center/zoom/actions/options and undocumented reset behavior', () => {
      for (const [before, after] of [
        ['[0.01, 0]', '[0, 0]'], [', 13,', ', 14,'], ['animate: false', 'animate: true'],
        ['animate: false', 'reset: true'], ['map.zoomIn()', 'map.zoomOut()'],
        ['map.zoomOut()', 'map.zoomIn()'], ['{ animate: false }', '{ animate: false, reset: true }'],
      ]) {
        expect(current).toContain(before);
        expect(() => restorePreviewMapControlsSource(file, current.replace(before, after))).toThrow();
      }
    });

    it('rejects every original key/default/arity/options mutation without changing source fixtures', () => {
      for (const call of translationCalls(file, current)) {
        const operands = call.arguments.map(argument => argument.getText());
        for (const changed of [
          `t('changed.key', ${operands[1]})`, `t(${operands[0]}, 'Changed default')`,
          `t(${operands[0]})`, `t(${operands.join(', ')}, { changed: true })`,
        ]) expect(() => restorePreviewMapControlsSource(file,
          current.slice(0, call.getStart()) + changed + current.slice(call.getEnd()))).toThrow();
      }
    });

    it.each(previewMapReset.dependencies)('requires unchanged actual native map/Button/barrel dependency: $file', dependency => {
      expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(() => restorePreviewMapControlsSource(file, current, path =>
        source(path) + (path === dependency.file ? '\n// drift\n' : ''))).toThrow();
      expect(() => restorePreviewMapControlsSource(file, current, path => {
        if (path === dependency.file) throw new Error('Missing native API dependency');
        return source(path);
      })).toThrow();
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256'] as const)('rejects stale reset fixture %s', field => {
      const saved = patch[field];
      try {
        patch[field] += '-stale';
        expect(() => restorePreviewMapControlsSource(file, current)).toThrow('pinned native map reset successor');
      } finally {
        patch[field] = saved;
      }
      expect(hash(restorePreviewMapControlsSource(file, current))).toBe(patch.before);
    });

    it('rejects stale compiled provenance and inverse coordinates', () => {
      const proof = patch.independentPredecessorProof;
      const mapHash = proof.mapSha256;
      const start = patch.hunks[0].start;
      try {
        proof.mapSha256 = '0'.repeat(64);
        expect(() => restorePreviewMapControlsSource(file, current)).toThrow('pinned native map reset successor');
        proof.mapSha256 = mapHash;
        patch.hunks[0].start++;
        expect(() => restorePreviewMapControlsSource(file, current)).toThrow('pinned native map reset successor');
      } finally {
        proof.mapSha256 = mapHash;
        patch.hunks[0].start = start;
      }
    });

    it('cannot exempt unrelated producer/dependency drift or apply to similar paths', () => {
      const others = appDesign.catalogProducers.filter(producer => producer.file !== file);
      expect(others).toHaveLength(9);
      for (const producer of others) {
        const bytes = source(producer.file);
        expect(restorePreviewMapControlsSource(producer.file, bytes)).toBe(bytes);
        expect(hash(previewProducerPredecessor(producer.file, bytes))).toBe(producer.sha256);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, bytes + '\n'))).toBe(producer.sha256)).toThrow();
      }
      const mapFile = previewMapFrame.sources[0].file;
      const changedControl = current + '\n// unrelated actual control drift\n';
      for (const restore of [restorePreviewMapPopupSource, restorePreviewMapFrameSource]) {
        const bytes = restore === restorePreviewMapPopupSource
          ? source(mapFile) : restorePreviewMapPopupSource(mapFile, source(mapFile));
        expect(() => restore(mapFile, bytes, path => path === file ? changedControl : source(path))).toThrow();
      }
      const bytes = "\uFEFF\r\n t('original.key', 'Default')\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './PreviewMapControls']) {
        expect(restorePreviewMapControlsSource(path, bytes)).toBe(bytes);
      }
    });
  });

  describe('exact preview help inset successor before unchanged tooltip and invoker proofs', () => {
    const file = 'web/src/features/settings/components/app-design-preview/PreviewOverlays.tsx';
    const patch = previewOverlayHelpInset.sources[0];
    const current = source(file);
    const previous = () => restorePreviewOverlayHelpInsetSource(file, current);
    const parse = (text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function elements(text: string): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
      const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parse(text));
      return found;
    }
    const opening = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
      ts.isJsxElement(node) ? node.openingElement : node;

    it('pins only the exact existing inner help class and independently compiled V26 predecessor', () => {
      expect(previewOverlayHelpInset.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks).toHaveLength(1);
      expect(patch.hunks[0]).toEqual({
        start: 27,
        old: ['        <div className="max-w-xs space-y-3">'],
        new: ['        <div className="max-w-xs space-y-3 p-4">'],
      });
      expect(patch.before).toBe('e0e892508533ec7cde37c639d6d94d526c193ccec11f7aaa94bf564aaa7d6ced');
      expect(patch.after).toBe('ae05a22f107fedec51d699ac745e2cf234f3795feb09d231beaa046017dfe126');
      expect(patch.before).toBe(previewOverlayHelpInset.independentPredecessorProof.sha256);
      expect(patch.before).toBe(previewOverlayTooltip.sources[0].after);
      expect(previewOverlayHelpInset.dependencies).toEqual(previewOverlayTooltip.dependencies);
      expect(hash(JSON.stringify(previewOverlayTooltip)))
        .toBe('5bdd3753808304ee2087c882c71045941e116d905904c8b0f4c30ea6d19c8c02');
      expect(hash(JSON.stringify(previewOverlayInvoker)))
        .toBe('571895973378718e346ff1ac11e8e5b5cf92d52765dc2a326fd6f0f62821d817');
    });

    it('recovers all compiled predecessor bytes through e0e/d70/200e without accepting any older stage as shipping source', () => {
      const e0e = previous();
      const d70 = restorePreviewOverlayTooltipSource(file, e0e);
      const original = restorePreviewOverlayInvokerSource(file, d70);
      expect(hash(current)).toBe(patch.after);
      expect(hash(e0e)).toBe(patch.before);
      expect(hash(d70)).toBe(previewOverlayInvoker.sources[0].after);
      expect(hash(original)).toBe(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256);
      expect(hash(previewProducerPredecessor(file, current))).toBe(hash(original));
      expect(patch.originalLineCount).toBe(50);
      expect(patch.currentLineCount).toBe(50);
      expect(current.trimEnd().split('\n')).toHaveLength(50);
      expect(e0e.trimEnd().split('\n')).toHaveLength(50);
      expect(current.replace(patch.hunks[0].new[0], patch.hunks[0].old[0])).toBe(e0e);
      for (const changed of [e0e, d70, original, current + '\n', current.slice(1)]) {
        expect(() => restorePreviewOverlayHelpInsetSource(file, changed)).toThrow();
      }
      expect(source(file)).toBe(current);
    });

    it('preserves all fifteen ordered calls/defaults/arity/options, complete controls, imports and state/translator bindings', () => {
      const e0e = previous();
      const calls = translationCalls(file, e0e).map(signature);
      expect(calls).toHaveLength(15);
      expect(patch.originalCallCount).toBe(15);
      expect(hash(JSON.stringify(calls))).toBe(patch.originalCallsSha256);
      expect(patch.originalCallsSha256).toBe(previewOverlayTooltip.sources[0].originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(calls);
      expect(translationCalls(file, current).map(call => call.arguments.length)).toEqual(Array(15).fill(2));
      const projection = producerProjection(file, e0e);
      expect(hash(JSON.stringify(projection))).toBe(patch.originalProjectionSha256);
      expect(producerProjection(file, current)).toEqual(projection);
      const imports = (text: string) => parse(text).statements.filter(ts.isImportDeclaration).map(node => node.getText());
      expect(imports(current)).toEqual(imports(e0e));
      const bindings = (text: string) => {
        const functions = parse(text).statements.filter(ts.isFunctionDeclaration);
        expect(functions).toHaveLength(1);
        return functions[0].body!.statements.filter(ts.isVariableStatement).map(node => node.getText());
      };
      expect(bindings(current)).toEqual(bindings(e0e));
    });

    it('adds padding only to the existing Popover child, preserving its entire content and every modal/tooltip/tab action', () => {
      const nodes = elements(current);
      const oldNodes = elements(previous());
      expect(nodes.map(node => opening(node).tagName.getText()))
        .toEqual(oldNodes.map(node => opening(node).tagName.getText()));
      expect(nodes.filter(node => opening(node).tagName.getText() === 'Button')).toHaveLength(5);
      const popover = nodes.find(node => opening(node).tagName.getText() === 'Popover') as ts.JsxElement;
      const oldPopover = oldNodes.find(node => opening(node).tagName.getText() === 'Popover') as ts.JsxElement;
      expect(popover.openingElement.getText()).toBe(oldPopover.openingElement.getText());
      const help = popover.children.filter(ts.isJsxElement);
      const oldHelp = oldPopover.children.filter(ts.isJsxElement);
      expect(help).toHaveLength(1);
      expect(oldHelp).toHaveLength(1);
      expect(help[0].openingElement.tagName.getText()).toBe('div');
      expect(help[0].openingElement.attributes.properties.map(node => node.getText()))
        .toEqual(['className="max-w-xs space-y-3 p-4"']);
      expect(oldHelp[0].openingElement.attributes.properties.map(node => node.getText()))
        .toEqual(['className="max-w-xs space-y-3"']);
      expect(help[0].children.map(node => node.getText())).toEqual(oldHelp[0].children.map(node => node.getText()));
      for (const tag of ['Modal', 'Tooltip', 'Tabs']) {
        expect(nodes.find(node => opening(node).tagName.getText() === tag)?.getText())
          .toBe(oldNodes.find(node => opening(node).tagName.getText() === tag)?.getText());
      }
      expect(current).toContain('<Tooltip portal content=');
      expect(current).toContain('getReturnFocusTarget={() => dialogTrigger.current}');
      expect(current).toContain('ref={dialogTrigger} onClick={() => setDialog(true)}');
    });

    it('rejects missing/modified/duplicated/reverted padding and moving or altering the exact inner-container classes', () => {
      const hunk = patch.hunks[0];
      expect(current.split(hunk.new[0])).toHaveLength(2);
      for (const changed of [
        current.replace(hunk.new[0], ''), current.replace(hunk.new[0], hunk.new[0] + '!'),
        current + '\n' + hunk.new[0], current.replace(hunk.new[0], hunk.old[0]),
        current.replace('max-w-xs space-y-3 p-4', 'max-w-xs space-y-3 p-3'),
        current.replace('max-w-xs space-y-3 p-4', 'max-w-xs space-y-3 px-4'),
        current.replace('max-w-xs space-y-3 p-4', 'max-w-xs space-y-3 p-4 p-4'),
        current.replace(hunk.new[0], hunk.old[0]).replace('flex flex-wrap gap-2', 'flex flex-wrap gap-2 p-4'),
      ]) expect(() => restorePreviewOverlayHelpInsetSource(file, changed)).toThrow();
    });

    it.each(Array.from({ length: 15 }, (_, index) => index))('rejects original call %s key/default/arity/options drift', index => {
      const call = translationCalls(file, current)[index];
      expect(call.arguments).toHaveLength(2);
      for (const changed of [
        `t('theme.appDesignPreview.changedKey', ${call.arguments[1].getText()})`,
        `t(${call.arguments[0].getText()}, 'Changed default')`,
        `t(${call.arguments[0].getText()})`,
        `t(${call.arguments.map(argument => argument.getText()).join(', ')}, { changedOption: true })`,
      ]) expect(() => restorePreviewOverlayHelpInsetSource(file,
        current.slice(0, call.getStart()) + changed + current.slice(call.getEnd()))).toThrow();
    });

    it('rejects each protected origin/state/action/portal/return-target change, including repeated dismiss actions', () => {
      for (const [original, edited, occurrences] of [
        ["from 'react-i18next'", "from 'other-translator'", 1],
        ["useTranslation('settings')", "useTranslation('other')", 1],
        ['setDialog(false)', 'setDialog(true)', 2],
        ['setPopover(false)', 'setPopover(true)', 2],
        ['disabled: true', 'disabled: false', 1],
        ['getReturnFocusTarget={() => dialogTrigger.current}', 'getReturnFocusTarget={() => anchor.current}', 1],
        ['<Tooltip portal content=', '<Tooltip content=', 1],
      ] as const) {
        expect(current.split(original)).toHaveLength(occurrences + 1);
        let offset = 0;
        for (let occurrence = 0; occurrence < occurrences; occurrence++) {
          const index = current.indexOf(original, offset);
          expect(() => restorePreviewOverlayHelpInsetSource(file,
            current.slice(0, index) + edited + current.slice(index + original.length))).toThrow();
          offset = index + original.length;
        }
      }
    });

    it.each(previewOverlayHelpInset.dependencies)('requires unchanged actual shared UI/focus dependency: $file', dependency => {
      expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(() => restorePreviewOverlayHelpInsetSource(file, current, path =>
        source(path) + (path === dependency.file ? '\n// unrelated actual dependency drift\n' : ''))).toThrow();
      expect(() => restorePreviewOverlayHelpInsetSource(file, current, path => {
        if (path === dependency.file) throw new Error('Missing help UI dependency');
        return source(path);
      })).toThrow();
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256', 'originalProjectionSha256'] as const)(
      'rejects stale exact inset fixture %s', field => {
        const saved = patch[field];
        try {
          patch[field] += '-stale';
          expect(() => restorePreviewOverlayHelpInsetSource(file, current)).toThrow('pinned preview help inset successor');
        } finally {
          patch[field] = saved;
        }
        expect(hash(previous())).toBe(patch.before);
      },
    );

    it('rejects stale independent compiled provenance and inverse coordinates without refreshing older fixtures', () => {
      const proof = previewOverlayHelpInset.independentPredecessorProof;
      const savedMap = proof.mapSha256;
      const savedStart = patch.hunks[0].start;
      try {
        proof.mapSha256 = '0'.repeat(64);
        expect(() => restorePreviewOverlayHelpInsetSource(file, current)).toThrow('pinned preview help inset successor');
        proof.mapSha256 = savedMap;
        patch.hunks[0].start++;
        expect(() => restorePreviewOverlayHelpInsetSource(file, current)).toThrow('pinned preview help inset successor');
      } finally {
        proof.mapSha256 = savedMap;
        patch.hunks[0].start = savedStart;
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('keeps all nine other exact producers and never applies to prefixes/siblings/case-folded/import paths', () => {
      const others = appDesign.catalogProducers.filter(producer => producer.file !== file);
      expect(others).toHaveLength(9);
      for (const producer of others) {
        const bytes = source(producer.file);
        expect(restorePreviewOverlayHelpInsetSource(producer.file, bytes)).toBe(bytes);
        expect(hash(previewProducerPredecessor(producer.file, bytes))).toBe(producer.sha256);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, bytes + '\n'))).toBe(producer.sha256)).toThrow();
      }
      const bytes = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './PreviewOverlays']) {
        expect(restorePreviewOverlayHelpInsetSource(path, bytes)).toBe(bytes);
      }
    });
  });

  describe('exact CommandDeck local modal-deferral successor before original app-design proof', () => {
    const file = 'web/src/components/layout/sidebar/CommandDeck.tsx';
    const patch = commandDeckModal.sources[0];
    const current = source(file);
    const previous = () => restoreCommandDeckModalSource(file, current);
    const parse = (text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = (text: string) => parse(text).statements.find(node =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'CommandDeck') as ts.FunctionDeclaration;
    const variables = (text: string) => component(text).body!.statements.filter(ts.isVariableStatement)
      .flatMap(node => [...node.declarationList.declarations]);
    const initializer = (text: string, name: string) => {
      const found = variables(text).filter(node => node.name.getText() === name);
      expect(found, name + ': exact unique component binding').toHaveLength(1);
      return found[0].initializer!.getText();
    };
    const effects = (text: string) => component(text).body!.statements.filter(ts.isExpressionStatement)
      .map(node => node.expression).filter(ts.isCallExpression).filter(node => node.expression.getText() === 'useEffect');
    function elements(text: string): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
      const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parse(text));
      return found;
    }
    const opening = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
      ts.isJsxElement(node) ? node.openingElement : node;

    it('pins exactly one source and eight independently reviewed regions without refreshing the original endpoint', () => {
      expect(commandDeckModal.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks.map(hunk => hunk.start)).toEqual([61, 67, 84, 121, 126, 132, 137, 139]);
      expect(patch.before).toBe('582b05334ecae836d8d6a4cdf63f86fcfeee12c41f43a077561f104ca74856c9');
      expect(patch.after).toBe('849f8d827da05395a6d7581735fcb5c40cbc72bc29b26d872cffc05d12a4be2e');
      expect(patch.before).toBe(commandDeckModal.independentPredecessorProof.sha256);
      expect(patch.before).toBe(appDesign.sources.find(entry => entry.file === file)?.after);
      expect(hash(JSON.stringify(appDesign))).toBe('3fb94cebaedae05cee60df9fa1b53ec45566a9825ee6bf449f507704eeb477d2');
    });

    it('recovers complete V27 bytes then the unchanged original owner, rejecting predecessor/mixed/unrelated shipping bytes', () => {
      const original = previous();
      expect(hash(current)).toBe(patch.after);
      expect(hash(original)).toBe(patch.before);
      expect(original.trimEnd().split('\n')).toHaveLength(144);
      expect(current.trimEnd().split('\n')).toHaveLength(158);
      expect(patch.originalLineCount).toBe(144);
      expect(patch.currentLineCount).toBe(158);
      const oldest = restoreAppDesignSource(file, current);
      expect(hash(oldest)).toBe('887a29202c7a33f1968832ce9bd7aa4ae02d4fb32c4ed0d67459bef6f0a71f64');
      expect(hash(oldest)).toBe(appDesign.sources.find(entry => entry.file === file)?.before);
      for (const changed of [original, oldest, current + '\n', current.slice(1)]) {
        expect(() => restoreCommandDeckModalSource(file, changed)).toThrow();
        expect(() => restoreAppDesignSource(file, changed)).toThrow();
      }
      expect(source(file)).toBe(current);
    });

    it('preserves the ordered original call/default/arity/options and full translator/control projection', () => {
      const original = previous();
      const calls = translationCalls(file, original).map(signature);
      expect(calls).toEqual(["t('nav.mobileMore', 'More')"]);
      expect(patch.originalCallCount).toBe(1);
      expect(hash(JSON.stringify(calls))).toBe(patch.originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(calls);
      expect(translationCalls(file, current).map(call => call.arguments.length)).toEqual([2]);
      expect(producerProjection(file, current)).toEqual(producerProjection(file, original));
      expect(hash(JSON.stringify(producerProjection(file, current)))).toBe(patch.originalProjectionSha256);
    });

    it('retains all imports/public props/route resolution/persistence exports and every old non-select component binding', () => {
      const original = previous();
      const external = (text: string) => parse(text).statements.filter(node =>
        !(ts.isFunctionDeclaration(node) && node.name?.text === 'CommandDeck')).map(node => node.getText());
      expect(external(current)).toEqual(external(original));
      const unchanged = (text: string, newer: boolean) => variables(text)
        .filter(node => !['select', ...(newer ? [
          'currentViewport', '[deferTabletPanel, setDeferTabletPanel]', 'panelVisible',
        ] : [])].includes(node.name.getText())).map(node => node.getText());
      expect(unchanged(current, true)).toEqual(unchanged(original, false));
      expect(initializer(current, 'select')
        .replace('    setDeferTabletPanel(false)\n', '')
        .replace('panelVisible && title === selection.title', 'panelOpen && title === selection.title'))
        .toBe(initializer(original, 'select'));
      expect(initializer(current, 'currentViewport')).toBe('useRef(viewport)');
      expect(initializer(current, '[deferTabletPanel, setDeferTabletPanel]')).toBe('useState(false)');
      expect(initializer(current, 'panelVisible')).toBe("panelOpen && !(viewport === 'tablet' && deferTabletPanel)");
    });

    it('defers only on a real breakpoint transition with a non-navigation modal, without changing docking preference in resize', () => {
      const oldEffects = effects(previous());
      const currentEffects = effects(current);
      expect(oldEffects).toHaveLength(5);
      expect(currentEffects).toHaveLength(5);
      const resize = currentEffects[0].arguments[0].getText();
      expect(currentEffects[0].arguments[1].getText()).toBe('[]');
      expect(resize).toContain('if (next !== currentViewport.current)');
      expect(resize).toContain("setDeferTabletPanel(next === 'tablet' && document.querySelector(");
      expect(resize).toContain("'[aria-modal=\"true\"]:not(.sidenav-tablet-panel):not(.sidenav-sheet)'");
      expect(resize).toContain('currentViewport.current = next');
      expect(resize).toContain('setViewport(next)');
      expect(resize).toContain("window.addEventListener('resize', resize)");
      expect(resize).toContain("return () => window.removeEventListener('resize', resize)");
      expect(resize).not.toContain('onPanelOpenChange');
      expect(currentEffects[1].getText().replace(
        'else { setDeferTabletPanel(false); onPanelOpenChange(true) }', 'else onPanelOpenChange(true)',
      )).toBe(oldEffects[1].getText());
      expect(currentEffects.slice(2).map(node => node.getText())).toEqual(oldEffects.slice(2).map(node => node.getText()));
    });

    it('retains every navigation section and Modal geometry/API while wiring only the approved visibility attributes', () => {
      const nodes = elements(current);
      const oldNodes = elements(previous());
      expect(nodes.map(node => opening(node).tagName.getText())).toEqual(oldNodes.map(node => opening(node).tagName.getText()));
      for (const tag of ['AtlasPanel', 'BottomTabBar']) {
        expect(nodes.find(node => opening(node).tagName.getText() === tag)?.getText())
          .toBe(oldNodes.find(node => opening(node).tagName.getText() === tag)?.getText());
      }
      const roots = nodes.filter(node => opening(node).attributes.properties.some(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText() === 'data-role'
        && attribute.initializer?.getText() === '"command-deck"'));
      const oldRoots = oldNodes.filter(node => opening(node).attributes.properties.some(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText() === 'data-role'
        && attribute.initializer?.getText() === '"command-deck"'));
      expect(roots).toHaveLength(1);
      expect(oldRoots).toHaveLength(1);
      const root = opening(roots[0]).getText();
      expect(root).toContain('data-panel-open={panelVisible}');
      expect(root.replace('data-panel-open={panelVisible}', 'data-panel-open={panelOpen}'))
        .toBe(opening(oldRoots[0]).getText());
      const rail = nodes.find(node => opening(node).tagName.getText() === 'SectionRail')!;
      const oldRail = oldNodes.find(node => opening(node).tagName.getText() === 'SectionRail')!;
      expect(rail.getText().replace('panelOpen={panelVisible}', 'panelOpen={panelOpen}')).toBe(oldRail.getText());
      const modals = nodes.filter(node => opening(node).tagName.getText() === 'Modal') as ts.JsxElement[];
      const oldModals = oldNodes.filter(node => opening(node).tagName.getText() === 'Modal') as ts.JsxElement[];
      expect(modals).toHaveLength(2);
      expect(oldModals).toHaveLength(2);
      expect(modals[0].openingElement.getText().replace("viewport === 'tablet' && panelVisible", "viewport === 'tablet' && panelOpen"))
        .toBe(oldModals[0].openingElement.getText());
      expect(modals[0].children.map(node => node.getText())).toEqual(oldModals[0].children.map(node => node.getText()));
      expect(modals[1].getText()).toBe(oldModals[1].getText());
      const desktop = (text: string) => text.split('\n').filter(line => line.includes('data-testid="command-deck-secondary"'));
      expect(desktop(current)).toHaveLength(1);
      expect(desktop(current)).toEqual(desktop(previous()));
      expect(desktop(current)[0]).toContain("viewport === 'desktop' && panelOpen");
    });

    it.each(patch.hunks)('rejects missing/modified/duplicated/individually reverted region at $start', hunk => {
      const fragment = hunk.new.join('\n');
      expect(current.split(fragment)).toHaveLength(2);
      for (const changed of [
        current.replace(fragment, ''), current.replace(fragment, fragment + '!'),
        current + '\n' + fragment, current.replace(fragment, hunk.old.join('\n')),
      ]) expect(() => restoreCommandDeckModalSource(file, changed)).toThrow();
    });

    it('rejects every protected key/default/arity/options mutation', () => {
      const call = translationCalls(file, current)[0];
      for (const changed of [
        "t('nav.changedKey', 'More')", "t('nav.mobileMore', 'Changed default')",
        "t('nav.mobileMore')", "t('nav.mobileMore', 'More', { changedOption: true })",
      ]) expect(() => restoreCommandDeckModalSource(file,
        current.slice(0, call.getStart()) + changed + current.slice(call.getEnd()))).toThrow();
    });

    it('rejects changed origin/transition/exclusions/intent/persistence/geometry and preference writes during resize', () => {
      for (const [original, changed] of [
        ["useTranslation()", "useTranslation('other')"],
        ["from '@/components/ui/Modal'", "from 'other-modal'"],
        ['next !== currentViewport.current', 'next === currentViewport.current'],
        [':not(.sidenav-tablet-panel)', ''], [':not(.sidenav-sheet)', ''],
        ["next === 'tablet' && document.querySelector", "next !== 'tablet' && document.querySelector"],
        ['setViewport(next)', 'onPanelOpenChange(false); setViewport(next)'],
        ['else { setDeferTabletPanel(false); onPanelOpenChange(true) }', 'else onPanelOpenChange(true)'],
        ["VIEW_KEY = 'teslasync-deck-view'", "VIEW_KEY = 'changed-view'"],
        ['className="sidenav-tablet-panel"', 'className="different-tablet-panel"'],
        ['panelOpen: boolean', 'panelOpen?: boolean'],
      ]) {
        expect(current).toContain(original);
        expect(() => restoreCommandDeckModalSource(file, current.replace(original, changed))).toThrow();
      }
    });

    it.each(commandDeckModal.dependencies)('requires unchanged actual navigation/modal/type/style dependency: $file', dependency => {
      expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(() => restoreCommandDeckModalSource(file, current, path =>
        source(path) + (path === dependency.file ? '\n// unrelated actual dependency drift\n' : ''))).toThrow();
      expect(() => restoreCommandDeckModalSource(file, current, path => {
        if (path === dependency.file) throw new Error('Missing actual navigation dependency');
        return source(path);
      })).toThrow();
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256', 'originalProjectionSha256'] as const)(
      'rejects stale exact navigation successor fixture %s', field => {
        const saved = patch[field];
        try {
          patch[field] += '-stale';
          expect(() => restoreCommandDeckModalSource(file, current)).toThrow('pinned CommandDeck modal successor');
        } finally {
          patch[field] = saved;
        }
        expect(hash(previous())).toBe(patch.before);
      },
    );

    it('rejects stale independent compiled provenance and each inverse coordinate', () => {
      const proof = commandDeckModal.independentPredecessorProof;
      const savedMap = proof.mapSha256;
      try {
        proof.mapSha256 = '0'.repeat(64);
        expect(() => restoreCommandDeckModalSource(file, current)).toThrow('pinned CommandDeck modal successor');
      } finally {
        proof.mapSha256 = savedMap;
      }
      for (const hunk of patch.hunks) {
        const saved = hunk.start;
        try {
          hunk.start++;
          expect(() => restoreCommandDeckModalSource(file, current)).toThrow('pinned CommandDeck modal successor');
        } finally {
          hunk.start = saved;
        }
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('keeps every preview successor exact and never applies to prefixes/siblings/case-folded/import paths', () => {
      for (const producer of appDesign.catalogProducers) {
        const bytes = source(producer.file);
        expect(restoreCommandDeckModalSource(producer.file, bytes)).toBe(bytes);
        expect(hash(previewProducerPredecessor(producer.file, bytes))).toBe(producer.sha256);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, bytes + '\n'))).toBe(producer.sha256)).toThrow();
      }
      const bytes = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './CommandDeck']) {
        expect(restoreCommandDeckModalSource(path, bytes)).toBe(bytes);
      }
    });
  });

  describe('exact native DataTable empty-viewport successor before unchanged API/source proofs', () => {
    const file = 'web/src/components/ui/DataTable.tsx';
    const patch = tableEmptyViewport.sources[0];
    const current = source(file);
    const previous = () => restoreTableEmptyViewportSource(file, current);
    const parse = (text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = (text: string) => parse(text).statements.find(node =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'DataTable') as ts.FunctionDeclaration;
    const variables = (text: string) => component(text).body!.statements.filter(ts.isVariableStatement)
      .flatMap(node => [...node.declarationList.declarations]);
    function elements(text: string): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
      const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parse(text));
      return found;
    }
    const opening = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
      ts.isJsxElement(node) ? node.openingElement : node;
    const attribute = (node: ts.JsxElement | ts.JsxSelfClosingElement, name: string) =>
      opening(node).attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText() === name) as ts.JsxAttribute | undefined;
    const emptyCell = (text: string) => {
      const found = elements(text).filter(node => opening(node).tagName.getText() === 'td'
        && attribute(node, 'className')?.initializer?.getText() === '"px-4 py-12 text-center text-sm text-[var(--text-muted)]"');
      expect(found).toHaveLength(1);
      return found[0] as ts.JsxElement;
    };

    it('pins only two exact viewport regions and the independently compiled Candidate28 API-stage endpoint', () => {
      expect(tableEmptyViewport.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks.map(hunk => hunk.start)).toEqual([1382, 1823]);
      expect(patch.before).toBe('555113bc67b988967d83f10c52a46985a74f8dea6ae5c3db465a22126c9cb87a');
      expect(patch.after).toBe('a6013d4ff197eef2fa1dc25d8a41fa2211ef01c732187d0f7b31182b59154c2c');
      expect(patch.before).toBe(tableEmptyViewport.independentPredecessorProof.sha256);
      expect(patch.before).toBe(tableNoMatch.sources[0].after);
      expect(hash(JSON.stringify(tableNoMatch))).toBe('44c29777ac0651aafd526e0a88d1d1ba9f1b17e50ec2e9c262065c29cebcab0d');
      expect(hash(JSON.stringify(appDesign))).toBe('3fb94cebaedae05cee60df9fa1b53ec45566a9825ee6bf449f507704eeb477d2');
    });

    it('recovers all compiled predecessor bytes through the unchanged older source chain, never accepting an older shipping stage', () => {
      const apiStage = previous();
      const preApi = restoreTableNoMatchSource(file, apiStage);
      expect(hash(current)).toBe(patch.after);
      expect(hash(apiStage)).toBe(patch.before);
      expect(hash(preApi)).toBe(tableNoMatch.sources[0].before);
      const oldOwner = restoreAppDesignSource(file, current);
      expect(hash(oldOwner)).toBe(appDesign.sources.find(entry => entry.file === file)?.before);
      expect(current.trimEnd().split('\n')).toHaveLength(1926);
      expect(apiStage.trimEnd().split('\n')).toHaveLength(1923);
      expect(patch.currentLineCount).toBe(1926);
      expect(patch.originalLineCount).toBe(1923);
      for (const changed of [apiStage, preApi, oldOwner, current + '\n', current.slice(1)]) {
        expect(() => restoreTableEmptyViewportSource(file, changed)).toThrow();
        expect(() => restoreAppDesignSource(file, changed)).toThrow();
      }
      expect(source(file)).toBe(current);
    });

    it('preserves all24 ordered original calls/defaults/arities/options, imports and complete translator/control projection', () => {
      const original = previous();
      const calls = translationCalls(file, original).map(signature);
      expect(calls).toHaveLength(24);
      expect(patch.originalCallCount).toBe(24);
      expect(hash(JSON.stringify(calls))).toBe(patch.originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(calls);
      expect(producerProjection(file, current)).toEqual(producerProjection(file, original));
      expect(hash(JSON.stringify(producerProjection(file, current)))).toBe(patch.originalProjectionSha256);
      const imports = (text: string) => parse(text).statements.filter(ts.isImportDeclaration).map(node => node.getText());
      expect(imports(current)).toEqual(imports(original));
    });

    it('keeps every public API/parameter/type/helper and all state/data/filter/paging/export/virtual/mobile bindings byte-identical', () => {
      const original = previous();
      const outside = (text: string) => parse(text).statements.filter(node =>
        !(ts.isFunctionDeclaration(node) && node.name?.text === 'DataTable')).map(node => node.getText());
      expect(outside(current)).toEqual(outside(original));
      expect(component(current).parameters.map(node => node.getText())).toEqual(component(original).parameters.map(node => node.getText()));
      const unchanged = (text: string) => variables(text).filter(node => node.name.getText() !== 'wrapperClass').map(node => node.getText());
      expect(unchanged(current)).toEqual(unchanged(original));
    });

    it('establishes inline-size only for zero filtered rows on the actual original scroll wrapper, not loaded rows or an ancestor', () => {
      const original = previous();
      const initializer = (text: string) => variables(text).find(node => node.name.getText() === 'wrapperClass')!.initializer as ts.CallExpression;
      const oldClass = initializer(original);
      const newClass = initializer(current);
      expect(newClass.expression.getText()).toBe('cn');
      expect(newClass.arguments[1].getText()).toBe("filteredData.length === 0 && '[container-type:inline-size]'");
      expect(newClass.arguments.filter((_, index) => index !== 1).map(node => node.getText()))
        .toEqual(oldClass.arguments.map(node => node.getText()));
      const scroll = (text: string) => elements(text).filter(node =>
        attribute(node, 'ref')?.initializer?.getText() === '{scrollContainerRef}');
      const oldScroll = scroll(original);
      const newScroll = scroll(current);
      expect(oldScroll).toHaveLength(1);
      expect(newScroll).toHaveLength(1);
      expect(opening(newScroll[0]).getText()).toBe(opening(oldScroll[0]).getText());
      expect(attribute(newScroll[0], 'className')?.initializer?.getText()).toContain('wrapperClass');
      expect(attribute(newScroll[0], 'style')?.initializer?.getText()).toBe('{wrapperStyle}');
    });

    it('retains native table/header/body/row/td/colspan and exact no-match/genuine-empty logic, status copy and recovery callback', () => {
      const original = previous();
      expect(elements(current).map(node => opening(node).tagName.getText()))
        .toEqual(elements(original).map(node => opening(node).tagName.getText()));
      const oldCell = emptyCell(original);
      const cell = emptyCell(current);
      expect(cell.openingElement.getText()).toBe(oldCell.openingElement.getText());
      expect(attribute(cell, 'colSpan')?.initializer?.getText()).toBe('{totalCols}');
      expect((cell.parent as ts.JsxElement).openingElement.getText())
        .toBe((oldCell.parent as ts.JsxElement).openingElement.getText());
      const branch = (node: ts.Node) => {
        let current: ts.Node | undefined = node;
        while (current && !(ts.isConditionalExpression(current) && current.condition.getText() === 'filteredData.length === 0')) {
          current = current.parent;
        }
        expect(current).toBeDefined();
        return current as ts.ConditionalExpression;
      };
      expect(branch(cell).condition.getText()).toBe(branch(oldCell).condition.getText());
      expect(branch(cell).whenFalse.getText()).toBe(branch(oldCell).whenFalse.getText());
      const wrappers = cell.children.filter(ts.isJsxElement);
      expect(wrappers).toHaveLength(1);
      expect(attribute(wrappers[0], 'className')?.initializer?.getText())
        .toBe('"sticky start-0 w-full max-w-[calc(100cqw-2rem)] space-y-3 whitespace-normal break-words"');
      const local = wrappers[0].children.filter(ts.isJsxExpression).find(node => node.expression)!.expression as ts.ConditionalExpression;
      const oldLocal = oldCell.children.filter(ts.isJsxExpression).find(node => node.expression)!.expression as ts.ConditionalExpression;
      expect(local.condition.getText()).toBe('localFilterNoMatch');
      expect(local.condition.getText()).toBe(oldLocal.condition.getText());
      expect(local.whenFalse.getText()).toBe('emptyMessage');
      expect(local.whenFalse.getText()).toBe(oldLocal.whenFalse.getText());
      expect(ts.isParenthesizedExpression(local.whenTrue)).toBe(true);
      expect(ts.isParenthesizedExpression(oldLocal.whenTrue)).toBe(true);
      const newContent = (local.whenTrue as ts.ParenthesizedExpression).expression;
      const originalContent = (oldLocal.whenTrue as ts.ParenthesizedExpression).expression;
      expect(ts.isJsxFragment(newContent)).toBe(true);
      expect(ts.isJsxElement(originalContent)).toBe(true);
      const content = (newContent as ts.JsxFragment).children.filter(ts.isJsxElement);
      const oldContent = (originalContent as ts.JsxElement).children.filter(ts.isJsxElement);
      expect(content.map(node => node.getText())).toEqual(oldContent.map(node => node.getText()));
      expect(content).toHaveLength(2);
      expect(attribute(content[0], 'role')?.initializer?.getText()).toBe('"status"');
      expect(attribute(content[1], 'onClick')?.initializer?.getText()).toBe('{clearFilters}');
    });

    it.each(tableNoMatch.sources)('requires the actual paired endpoint after only its exact accepted inverse: $file', endpoint => {
      const caller = tableNoMatch.sources[1];
      expect(() => restoreTableNoMatchSource(caller.file, source(caller.file), path =>
        source(path) + (path === endpoint.file ? '\n// actual paired endpoint drift\n' : ''))).toThrow();
      expect(hash(restoreTableNoMatchSource(caller.file, source(caller.file)))).toBe(caller.before);
    });

    it.each(patch.hunks)('rejects missing/modified/duplicated/individually reverted viewport region at $start', hunk => {
      const fragment = hunk.new.join('\n');
      expect(current.split(fragment)).toHaveLength(2);
      for (const changed of [
        current.replace(fragment, ''), current.replace(fragment, fragment + '!'),
        current + '\n' + fragment, current.replace(fragment, hunk.old.join('\n')),
      ]) expect(() => restoreTableEmptyViewportSource(file, changed)).toThrow();
    });

    it('rejects each original occurrence-sensitive key/default/arity/options mutation', () => {
      for (const call of translationCalls(file, current)) {
        expect(call.arguments.length).toBeGreaterThanOrEqual(2);
        const operands = call.arguments.map(node => node.getText());
        for (const changed of [
          `t(${["'table.changedKey'", ...operands.slice(1)].join(', ')})`,
          `t(${[operands[0], "'Changed default'", ...operands.slice(2)].join(', ')})`,
          `t(${operands[0]})`, `t(${operands.slice(0, 2).join(', ')}, { changedOption: true })`,
        ]) expect(() => restoreTableEmptyViewportSource(file,
          current.slice(0, call.getStart()) + changed + current.slice(call.getEnd()))).toThrow();
      }
    });

    it('rejects loaded/global containers, physical-side or viewport bounds, clipped wrapping and changed status/recovery/copy/API logic', () => {
      const bounded = 'sticky start-0 w-full max-w-[calc(100cqw-2rem)] space-y-3 whitespace-normal break-words';
      for (const [original, changed] of [
        [patch.hunks[0].new[0], "    '[container-type:inline-size]',"],
        [patch.hunks[0].new[0], "    filteredData.length > 0 && '[container-type:inline-size]',"],
        [bounded, bounded.replace('start-0', 'left-0')],
        [bounded, bounded.replace('100cqw-2rem', '100vw-2rem')],
        [bounded, bounded.replace('whitespace-normal break-words', 'whitespace-nowrap')],
        ['role="status">{noMatchMessage}', 'role="note">{noMatchMessage}'],
        ['onClick={clearFilters}>{resetFiltersLabel}', 'onClick={() => undefined}>{resetFiltersLabel}'],
        ['callerNoMatchMessage ??', 'callerNoMatchMessage ||'],
        ['localFilterNoMatch = data.length > 0 && filteredData.length === 0', 'localFilterNoMatch = filteredData.length === 0'],
      ]) {
        expect(current).toContain(original);
        expect(() => restoreTableEmptyViewportSource(file, current.replace(original, changed))).toThrow();
      }
    });

    it.each(tableEmptyViewport.dependencies)('requires unchanged actual tokens/content/mobile/filter dependency: $file', dependency => {
      expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(() => restoreTableEmptyViewportSource(file, current, path =>
        source(path) + (path === dependency.file ? '\n// unrelated actual dependency drift\n' : ''))).toThrow();
      expect(() => restoreTableEmptyViewportSource(file, current, path => {
        if (path === dependency.file) throw new Error('Missing actual table dependency');
        return source(path);
      })).toThrow();
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256', 'originalProjectionSha256'] as const)(
      'rejects stale exact viewport successor fixture %s', field => {
        const saved = patch[field];
        try {
          patch[field] += '-stale';
          expect(() => restoreTableEmptyViewportSource(file, current)).toThrow('pinned table empty viewport successor');
        } finally {
          patch[field] = saved;
        }
        expect(hash(previous())).toBe(patch.before);
      },
    );

    it('rejects stale independent compiled provenance and each exact inverse coordinate', () => {
      const proof = tableEmptyViewport.independentPredecessorProof;
      const savedMap = proof.mapSha256;
      try {
        proof.mapSha256 = '0'.repeat(64);
        expect(() => restoreTableEmptyViewportSource(file, current)).toThrow('pinned table empty viewport successor');
      } finally {
        proof.mapSha256 = savedMap;
      }
      for (const hunk of patch.hunks) {
        const saved = hunk.start;
        try {
          hunk.start++;
          expect(() => restoreTableEmptyViewportSource(file, current)).toThrow('pinned table empty viewport successor');
        } finally {
          hunk.start = saved;
        }
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('keeps unrelated exact producers precise and never applies to prefixes/siblings/case-folded/import paths', () => {
      for (const producer of appDesign.catalogProducers) {
        const bytes = source(producer.file);
        expect(restoreTableEmptyViewportSource(producer.file, bytes)).toBe(bytes);
        expect(hash(previewProducerPredecessor(producer.file, bytes))).toBe(producer.sha256);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, bytes + '\n'))).toBe(producer.sha256)).toThrow();
      }
      const bytes = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './DataTable']) {
        expect(restoreTableEmptyViewportSource(path, bytes)).toBe(bytes);
      }
    });
  });

  describe('exact original Settings preview invoker successor with unchanged retry and shared focus APIs', () => {
    const file = 'web/src/features/settings/components/WidgetDesignPackSettings.tsx';
    const patch = settingsPreviewInvoker.sources[0];
    const current = source(file);
    const previous = () => restoreSettingsPreviewInvokerSource(file, current);
    const parse = (text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = (text: string) => parse(text).statements.find(ts.isFunctionDeclaration)!;
    const variables = (text: string) => component(text).body!.statements.filter(ts.isVariableStatement)
      .flatMap(node => [...node.declarationList.declarations]);
    function openings(text: string): (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] {
      const found: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
      function visit(node: ts.Node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) found.push(node);
        ts.forEachChild(node, visit);
      }
      visit(parse(text));
      return found;
    }
    const attributes = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) =>
      node.attributes.properties.filter(ts.isJsxAttribute);
    const attr = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) =>
      attributes(node).find(attribute => attribute.name.getText() === name);
    const previewButton = (text: string) => {
      const buttons = openings(text).filter(node => node.tagName.getText() === 'Button'
        && attr(node, 'aria-label')?.initializer?.getText().includes("t('theme.widgetDesignPacks.previewNamed'"));
      expect(buttons).toHaveLength(1);
      return buttons[0];
    };
    const modal = (text: string) => {
      const modals = openings(text).filter(node => node.tagName.getText() === 'Modal');
      expect(modals).toHaveLength(1);
      return modals[0];
    };

    it('pins exactly three reviewed regions and independent whole Candidate29 source without inventing an older raw approval', () => {
      expect(settingsPreviewInvoker.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks.map(hunk => hunk.start)).toEqual([21, 118, 138]);
      expect(patch.before).toBe('7d20529a11b204eeed03bbc9b069ec02cb7c3785712e37cbe5929e964e3d3538');
      expect(patch.after).toBe('9d3af21b5f7ea494aa7bf142da4b65b37aa901294f0fcbb8f8d29c49fb7074ad');
      expect(patch.before).toBe(settingsPreviewInvoker.independentPredecessorProof.sha256);
      expect(appDesign.sources.some(entry => entry.file === file)).toBe(false);
      expect(transition.sources.some(entry => entry.file === file)).toBe(false);
      expect(hash(JSON.stringify(appDesign))).toBe('3fb94cebaedae05cee60df9fa1b53ec45566a9825ee6bf449f507704eeb477d2');
      expect(hash(JSON.stringify(tableEmptyViewport))).toBe('c207094fe32919497ec2769297d3716d41750a303c2f31f87c689f9720c75151');
    });

    it('restores every independent predecessor byte through the public composition and rejects old/mixed/unrelated shipping bytes', () => {
      const original = previous();
      expect(hash(current)).toBe(patch.after);
      expect(hash(original)).toBe(patch.before);
      expect(restoreAppDesignSource(file, current)).toBe(original);
      expect(restoreWidgetImplementationSource(file, current)).toBe(original);
      expect(current.trimEnd().split('\n')).toHaveLength(patch.currentLineCount);
      expect(original.trimEnd().split('\n')).toHaveLength(patch.originalLineCount);
      expect([patch.currentLineCount, patch.originalLineCount]).toEqual([157, 152]);
      for (const changed of [original, current + '\n', current.slice(1), current.replace('openPreview(entry.id);', 'openPreview(previewId);')]) {
        expect(() => restoreSettingsPreviewInvokerSource(file, changed)).toThrow();
        expect(() => restoreAppDesignSource(file, changed)).toThrow();
      }
      expect(source(file)).toBe(current);
    });

    it('preserves all38 original ordered calls/defaults/arities/options including dynamic dashboard namespace, bindings and controls', () => {
      const original = previous();
      const calls = translationCalls(file, original).map(signature);
      expect(calls).toHaveLength(38);
      expect(patch.originalCallCount).toBe(38);
      expect(calls[0]).toBe("t(key, { ns: 'dashboard' })");
      expect(hash(JSON.stringify(calls))).toBe(patch.originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(calls);
      expect(producerProjection(file, current)).toEqual(producerProjection(file, original));
      expect(hash(JSON.stringify(producerProjection(file, original)))).toBe(patch.originalProjectionSha256);
    });

    it('retains all imports/public parameters/state/filter/preference/save/sync declarations, effects and local functions byte-identically', () => {
      const original = previous();
      const outside = (text: string) => parse(text).statements.filter(node => !ts.isFunctionDeclaration(node)).map(node => node.getText());
      expect(outside(current)).toEqual(outside(original));
      expect(component(current).parameters.map(node => node.getText())).toEqual(component(original).parameters.map(node => node.getText()));
      expect(variables(current).filter(node => node.name.getText() !== 'previewTrigger').map(node => node.getText()))
        .toEqual(variables(original).map(node => node.getText()));
      const otherStatements = (text: string) => component(text).body!.statements
        .filter(node => !ts.isVariableStatement(node) && !ts.isReturnStatement(node)).map(node => node.getText());
      expect(otherStatements(current)).toEqual(otherStatements(original));
    });

    it('adds only the preview click handler and one public root Modal callback, keeping every other JSX attribute and tag unchanged', () => {
      const original = previous();
      const oldNodes = openings(original);
      const nodes = openings(current);
      expect(nodes.map(node => node.tagName.getText())).toEqual(oldNodes.map(node => node.tagName.getText()));
      const preview = previewButton(current);
      const root = modal(current);
      for (const [index, node] of nodes.entries()) {
        const allowed = node.pos === preview.pos ? 'onClick' : node.pos === root.pos ? 'getReturnFocusTarget' : undefined;
        const actual = attributes(node).filter(attribute => attribute.name.getText() !== allowed).map(attribute => attribute.getText());
        const expected = attributes(oldNodes[index]).filter(attribute => attribute.name.getText() !== allowed).map(attribute => attribute.getText());
        expect(actual, node.tagName.getText() + ': preserved original attributes').toEqual(expected);
      }
      const oldModal = modal(original).parent as ts.JsxElement;
      const currentModal = root.parent as ts.JsxElement;
      expect(currentModal.children.map(node => node.getText())).toEqual(oldModal.children.map(node => node.getText()));
    });

    it('remembers the exact native invoker before the unchanged open action using only an existing typed ref and public Modal callback', () => {
      const ref = variables(current).filter(node => node.name.getText() === 'previewTrigger');
      expect(ref).toHaveLength(1);
      expect(ref[0].getText()).toBe('previewTrigger = useRef<HTMLButtonElement | null>(null)');
      const handler = (attr(previewButton(current), 'onClick')!.initializer as ts.JsxExpression).expression as ts.ArrowFunction;
      expect(handler.parameters.map(node => node.getText())).toEqual(['event']);
      expect((handler.body as ts.Block).statements.map(node => node.getText()))
        .toEqual(['previewTrigger.current = event.currentTarget;', 'openPreview(entry.id);']);
      expect(attr(modal(current), 'getReturnFocusTarget')?.initializer?.getText()).toBe('{() => previewTrigger.current}');
      expect(current.match(/\bpreviewTrigger\b/g)).toHaveLength(3);
      expect(current).not.toContain('.focus(');
      expect(current).not.toContain('document.activeElement');
    });

    it('retains generation/lazy-load/error/close/select behavior and Retry without replacing the original remembered invoker', () => {
      const original = previous();
      const functions = (text: string) => component(text).body!.statements.filter(ts.isFunctionDeclaration);
      expect(functions(current).map(node => node.getText())).toEqual(functions(original).map(node => node.getText()));
      expect(functions(current).map(node => node.name?.text)).toEqual(['openPreview', 'closePreview', 'selectPack']);
      const retry = (text: string) => openings(text).filter(node => node.tagName.getText() === 'Button'
        && attr(node, 'onClick')?.initializer?.getText() === '{() => openPreview(previewId)}');
      expect(retry(current)).toHaveLength(1);
      expect(retry(current)[0].getText()).toBe(retry(original)[0].getText());
      expect(attr(modal(current), 'onClose')?.initializer?.getText()).toBe('{closePreview}');
      expect(attr(modal(current), 'open')?.initializer?.getText()).toBe('{previewId != null}');
      expect(attr(modal(current), 'size')?.initializer?.getText()).toBe('"full"');
    });

    it.each(patch.hunks)('rejects missing/changed/duplicated/individually reverted invoker region at $start', hunk => {
      const fragment = hunk.new.join('\n');
      expect(current.split(fragment)).toHaveLength(2);
      for (const changed of [
        current.replace(fragment, ''), current.replace(fragment, fragment + '!'),
        current + '\n' + fragment, current.replace(fragment, hunk.old.join('\n')),
      ]) expect(() => restoreSettingsPreviewInvokerSource(file, changed)).toThrow();
    });

    it.each(settingsPreviewInvoker.dependencies)('requires unchanged actual focus/preview/preference dependency: $file', dependency => {
      expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(() => restoreSettingsPreviewInvokerSource(file, current, path =>
        source(path) + (path === dependency.file ? '\n// unrelated actual Settings dependency drift\n' : ''))).toThrow();
      expect(() => restoreSettingsPreviewInvokerSource(file, current, path => {
        if (path === dependency.file) throw new Error('Missing actual Settings dependency');
        return source(path);
      })).toThrow();
    });

    it('rejects each original occurrence-sensitive call key/default/arity/options change including dynamic namespace operands', () => {
      for (const call of translationCalls(file, current)) {
        expect(call.arguments.length).toBeGreaterThanOrEqual(2);
        const operands = call.arguments.map(node => node.getText());
        for (const changed of [
          `t(${["'settings.changedKey'", ...operands.slice(1)].join(', ')})`,
          `t(${[operands[0], "'Changed default'", ...operands.slice(2)].join(', ')})`,
          `t(${operands[0]})`, `t(${operands.slice(0, 2).join(', ')}, { changedOption: true })`,
        ]) expect(() => restoreSettingsPreviewInvokerSource(file,
          current.slice(0, call.getStart()) + changed + current.slice(call.getEnd()))).toThrow();
      }
    });

    it('rejects wrong nested target/ref ownership/action ordering, active-element/manual-focus hacks, retry capture and loader/generation drift', () => {
      for (const [original, changed] of [
        ['previewTrigger.current = event.currentTarget;', 'previewTrigger.current = event.target;'],
        ['useRef<HTMLButtonElement | null>(null)', 'useRef<HTMLElement | null>(null)'],
        ['previewTrigger.current = event.currentTarget;\n              openPreview(entry.id);',
          'openPreview(entry.id);\n              previewTrigger.current = event.currentTarget;'],
        ['getReturnFocusTarget={() => previewTrigger.current}', 'getReturnFocusTarget={() => document.activeElement}'],
        ['getReturnFocusTarget={() => previewTrigger.current}', 'getReturnFocusTarget={() => { previewTrigger.current?.focus(); return previewTrigger.current; }}'],
        ['onClick={() => openPreview(previewId)}', 'onClick={event => { previewTrigger.current = event.currentTarget; openPreview(previewId); }}'],
        ['if (request === generation.current) setPreviewError(true);', 'setPreviewError(true);'],
        ['async function selectPack(id: PackId)', 'async function selectPack(id: string)'],
      ]) {
        expect(current).toContain(original);
        expect(() => restoreSettingsPreviewInvokerSource(file, current.replace(original, changed))).toThrow();
      }
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256', 'originalProjectionSha256'] as const)(
      'rejects stale exact Settings invoker fixture %s', field => {
        const saved = patch[field];
        try {
          patch[field] += '-stale';
          expect(() => restoreSettingsPreviewInvokerSource(file, current)).toThrow('pinned Settings preview invoker successor');
        } finally {
          patch[field] = saved;
        }
        expect(hash(previous())).toBe(patch.before);
      },
    );

    it('rejects altered independent compiled provenance and each exact inverse coordinate', () => {
      const proof = settingsPreviewInvoker.independentPredecessorProof;
      const saved = proof.mapSha256;
      try {
        proof.mapSha256 = '0'.repeat(64);
        expect(() => restoreSettingsPreviewInvokerSource(file, current)).toThrow('pinned Settings preview invoker successor');
      } finally {
        proof.mapSha256 = saved;
      }
      for (const hunk of patch.hunks) {
        const savedStart = hunk.start;
        try {
          hunk.start++;
          expect(() => restoreSettingsPreviewInvokerSource(file, current)).toThrow('pinned Settings preview invoker successor');
        } finally {
          hunk.start = savedStart;
        }
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('retains exact DataTable and all preview producer chains and matches only this exact Settings path', () => {
      const table = tableEmptyViewport.sources[0];
      expect(hash(source(table.file))).toBe(table.after);
      expect(hash(restoreAppDesignSource(table.file, source(table.file))))
        .toBe(appDesign.sources.find(entry => entry.file === table.file)?.before);
      for (const producer of appDesign.catalogProducers) {
        const bytes = source(producer.file);
        expect(restoreSettingsPreviewInvokerSource(producer.file, bytes)).toBe(bytes);
        expect(hash(previewProducerPredecessor(producer.file, bytes))).toBe(producer.sha256);
      }
      const bytes = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './WidgetDesignPackSettings']) {
        expect(restoreSettingsPreviewInvokerSource(path, bytes)).toBe(bytes);
      }
    });
  });

  describe('exact PreviewChart current-URL owned-key cleanup before original complete producer pin', () => {
    const file = 'web/src/features/settings/components/app-design-preview/PreviewChart.tsx';
    const patch = previewChartQuery.sources[0];
    const current = source(file);
    const previous = () => restorePreviewChartQuerySource(file, current);
    const parse = (text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = (text: string) => parse(text).statements.find(ts.isFunctionDeclaration)!;
    const variables = (text: string) => component(text).body!.statements.filter(ts.isVariableStatement)
      .flatMap(node => [...node.declarationList.declarations]);
    const effect = (text: string) => component(text).body!.statements.filter(ts.isExpressionStatement)
      .map(node => node.expression).filter(ts.isCallExpression).find(node => node.expression.getText() === 'useEffect')!;
    const cleanup = (text: string) => ((effect(text).arguments[0] as ts.ArrowFunction).body as ts.ArrowFunction).body as ts.Block;

    it('pins only five exact regions to the independent whole Candidate30 producer and untouched original approval', () => {
      expect(previewChartQuery.sources.map(entry => entry.file)).toEqual([file]);
      expect(patch.hunks.map(hunk => hunk.start)).toEqual([0, 2, 14, 18, 20]);
      expect(patch.before).toBe('706d9da9fe575ec0dfe0ae0945ba318e4c17c9f52d0e84e89ad4b6475b76929b');
      expect(patch.after).toBe('4c018f85e411ea52eb7234e14f6481551221f83ab3b205cff80bf1272365afaa');
      expect(patch.before).toBe(previewChartQuery.independentPredecessorProof.sha256);
      expect(patch.before).toBe(appDesign.catalogProducers.find(producer => producer.file === file)?.sha256);
      expect(hash(JSON.stringify(appDesign))).toBe('3fb94cebaedae05cee60df9fa1b53ec45566a9825ee6bf449f507704eeb477d2');
    });

    it('restores every independently compiled predecessor byte before all original producer comparisons and rejects older shipping stages', () => {
      const original = previous();
      expect(hash(current)).toBe(patch.after);
      expect(hash(original)).toBe(patch.before);
      expect(previewProducerPredecessor(file, current)).toBe(original);
      expect(restoreAppDesignSource(file, current)).toBe(original);
      expect(restoreWidgetImplementationSource(file, current)).toBe(original);
      for (const changed of [original, current + '\n', current.slice(1)]) {
        expect(() => restorePreviewChartQuerySource(file, changed)).toThrow();
        expect(() => restoreAppDesignSource(file, changed)).toThrow();
      }
      expect(source(file)).toBe(current);
    });

    it('preserves all9 ordered original calls/defaults/arities/options/origins and complete translator/control projection', () => {
      const original = previous();
      const calls = translationCalls(file, original).map(signature);
      expect(calls).toHaveLength(9);
      expect(patch.originalCallCount).toBe(9);
      expect(hash(JSON.stringify(calls))).toBe(patch.originalCallsSha256);
      expect(translationCalls(file, current).map(signature)).toEqual(calls);
      expect(producerProjection(file, current)).toEqual(producerProjection(file, original));
      expect(hash(JSON.stringify(producerProjection(file, original)))).toBe(patch.originalProjectionSha256);
    });

    it('keeps the ENTIRE unconditional chart section/plot/gauge/legend/fallback-data JSX byte-identical with93percent of original lines', () => {
      const original = previous();
      const returned = (text: string) => component(text).body!.statements.filter(ts.isReturnStatement).map(node => node.getText());
      expect(returned(current)).toHaveLength(1);
      expect(returned(current)).toEqual(returned(original));
      expect(returned(current)[0]).toContain('<section data-preview-section="chart"');
      expect(current.trimEnd().split('\n')).toHaveLength(59);
      expect(original.trimEnd().split('\n')).toHaveLength(63);
      expect([patch.currentLineCount, patch.originalLineCount]).toEqual([59, 63]);
      expect(patch.currentLineCount / patch.originalLineCount).toBeGreaterThanOrEqual(0.7);
      for (const fragment of ['<ChartContainer', '<LinearGauge', '<LineChart', '<ChartLegend', '<Line dataKey="battery"', '<Line dataKey="reference"']) {
        expect(current.split(fragment).length, fragment).toBe(original.split(fragment).length);
        expect(current).toContain(fragment);
      }
    });

    it('removes only obsolete useRef/useLocation imports and location/openedAt state; every other import/binding/parameter stays exact', () => {
      const original = previous();
      const imports = (text: string) => parse(text).statements.filter(ts.isImportDeclaration);
      const names = (text: string, module: string) => {
        const declaration = imports(text).find(node => (node.moduleSpecifier as ts.StringLiteral).text === module)!;
        return (declaration.importClause!.namedBindings as ts.NamedImports).elements.map(node => node.getText());
      };
      expect(names(current, 'react')).toEqual(names(original, 'react').filter(name => name !== 'useRef'));
      expect(names(current, 'react-router-dom')).toEqual(names(original, 'react-router-dom').filter(name => name !== 'useLocation'));
      const otherImports = (text: string) => imports(text).filter(node =>
        !['react', 'react-router-dom'].includes((node.moduleSpecifier as ts.StringLiteral).text)).map(node => node.getText());
      expect(otherImports(current)).toEqual(otherImports(original));
      expect(variables(current).map(node => node.getText())).toEqual(variables(original)
        .filter(node => !['location', 'openedAt'].includes(node.name.getText())).map(node => node.getText()));
      expect(component(current).parameters.map(node => node.getText())).toEqual(component(original).parameters.map(node => node.getText()));
    });

    it('reads the latest query, deletes ONLY its exact original hidden key, preserves latest path/hash and uses unchanged replace/dependency semantics', () => {
      const original = previous();
      expect(cleanup(current).statements.map(node => node.getText())).toEqual([
        'const params = new URLSearchParams(window.location.search);',
        'const parameter = `hidden_${chartKey}`;',
        'if (!params.has(parameter)) return;',
        'params.delete(parameter);',
        'navigate({ pathname: window.location.pathname, search: params.toString(), hash: window.location.hash }, { replace: true });',
      ]);
      expect(cleanup(current).statements.slice(0, 2).map(node => node.getText()))
        .toEqual(cleanup(original).statements.slice(0, 2).map(node => node.getText()));
      expect(effect(current).arguments.slice(1).map(node => node.getText())).toEqual(['[chartKey, navigate]']);
      expect(effect(current).arguments.slice(1).map(node => node.getText()))
        .toEqual(effect(original).arguments.slice(1).map(node => node.getText()));
      expect(current).not.toContain('openedAt');
      expect(current).not.toContain('useLocation');
      expect(current).not.toContain('useRef');
      expect(current).not.toContain('window.location.hash ||');
    });

    it('rejects reinserted obsolete opening-location state without treating a zero-length replacement as an unverified hole', () => {
      const removal = patch.hunks.filter(hunk => hunk.new.length === 0);
      expect(removal).toHaveLength(1);
      expect(removal[0].start).toBe(14);
      const lines = current.split('\n');
      lines.splice(removal[0].start, 0, ...removal[0].old);
      expect(() => restorePreviewChartQuerySource(file, lines.join('\n'))).toThrow();
    });

    it.each(patch.hunks.filter(hunk => hunk.new.length > 0))('rejects missing/changed/duplicated/individually reverted current region at $start', hunk => {
      const fragment = hunk.new.join('\n');
      expect(current.split(fragment)).toHaveLength(2);
      for (const changed of [
        current.replace(fragment, ''), current.replace(fragment, fragment + '!'),
        current + '\n' + fragment, current.replace(fragment, hunk.old.join('\n')),
      ]) expect(() => restorePreviewChartQuerySource(file, changed)).toThrow();
    });

    it.each(previewChartQuery.dependencies)('requires unchanged actual data/palette/chart dependency: $file', dependency => {
      expect(hash(historicalSource(dependency.file))).toBe(dependency.sha256);
      expect(() => restorePreviewChartQuerySource(file, current, path =>
        source(path) + (path === dependency.file ? '\n// unrelated actual chart dependency drift\n' : ''))).toThrow();
      expect(() => restorePreviewChartQuerySource(file, current, path => {
        if (path === dependency.file) throw new Error('Missing actual chart dependency');
        return source(path);
      })).toThrow();
    });

    it('rejects every original occurrence-sensitive key/default/arity/options change', () => {
      for (const call of translationCalls(file, current)) {
        const operands = call.arguments.map(node => node.getText());
        expect(operands.length).toBeGreaterThanOrEqual(2);
        for (const changed of [
          `t(${["'chart.changedKey'", ...operands.slice(1)].join(', ')})`,
          `t(${[operands[0], "'Changed default'", ...operands.slice(2)].join(', ')})`,
          `t(${operands[0]})`, `t(${operands.slice(0, 2).join(', ')}, { changedOption: true })`,
        ]) expect(() => restorePreviewChartQuerySource(file,
          current.slice(0, call.getStart()) + changed + current.slice(call.getEnd()))).toThrow();
      }
    });

    it('rejects stale/foreign query ownership, missing-key navigation, old-hash restoration, altered path/history/render behavior', () => {
      for (const [original, changed] of [
        ['new URLSearchParams(window.location.search)', 'new URLSearchParams(openedAt.current.search)'],
        ['const parameter = `hidden_${chartKey}`;', "const parameter = 'hidden_other_chart';"],
        ['if (!params.has(parameter)) return;', 'if (params.has(parameter)) return;'],
        ['params.delete(parameter);', "params.delete('unrelated_workspace_key');"],
        ['hash: window.location.hash', 'hash: openedAt.current.hash'],
        ['pathname: window.location.pathname', 'pathname: openedAt.current.pathname'],
        ['{ replace: true }', '{ replace: false }'],
        ['[chartKey, navigate]', '[chartKey]'],
        ['marker={80}', 'marker={72}'],
        ['connectNulls={false}', 'connectNulls'],
      ]) {
        expect(current).toContain(original);
        expect(() => restorePreviewChartQuerySource(file, current.replace(original, changed))).toThrow();
      }
    });

    it.each(['before', 'after', 'file', 'originalCallsSha256', 'originalProjectionSha256'] as const)(
      'rejects stale exact chart query fixture %s', field => {
        const saved = patch[field];
        try {
          patch[field] += '-stale';
          expect(() => restorePreviewChartQuerySource(file, current)).toThrow('pinned preview chart query successor');
        } finally {
          patch[field] = saved;
        }
        expect(hash(previous())).toBe(patch.before);
      },
    );

    it('rejects altered independent compiled provenance and every inverse coordinate including deleted original state', () => {
      const proof = previewChartQuery.independentPredecessorProof;
      const saved = proof.mapSha256;
      try {
        proof.mapSha256 = '0'.repeat(64);
        expect(() => restorePreviewChartQuerySource(file, current)).toThrow('pinned preview chart query successor');
      } finally {
        proof.mapSha256 = saved;
      }
      for (const hunk of patch.hunks) {
        const savedStart = hunk.start;
        try {
          hunk.start++;
          expect(() => restorePreviewChartQuerySource(file, current)).toThrow('pinned preview chart query successor');
        } finally {
          hunk.start = savedStart;
        }
      }
      expect(hash(previous())).toBe(patch.before);
    });

    it('retains all16 historical fixtures/other producer chains and matches only the exact chart path', () => {
      expect(hash(JSON.stringify(tableEmptyViewport))).toBe('c207094fe32919497ec2769297d3716d41750a303c2f31f87c689f9720c75151');
      expect(hash(JSON.stringify(settingsPreviewInvoker))).toBe('aa842948dc19b72a8492aa5a4726e82029557c492e9c3a0c7add96c1305bf2db');
      const settings = settingsPreviewInvoker.sources[0];
      expect(hash(restoreAppDesignSource(settings.file, source(settings.file)))).toBe(settings.before);
      for (const producer of appDesign.catalogProducers) {
        const bytes = source(producer.file);
        if (producer.file !== file) expect(restorePreviewChartQuerySource(producer.file, bytes)).toBe(bytes);
        expect(hash(previewProducerPredecessor(producer.file, bytes))).toBe(producer.sha256);
        expect(() => expect(hash(previewProducerPredecessor(producer.file, bytes + '\n'))).toBe(producer.sha256)).toThrow();
      }
      const bytes = "\uFEFF\r\n t('original.key', 'Default', { count: 0 })\u0000\r\n";
      for (const path of [file + '/child', file.replace('.tsx', 'Other.tsx'), file.toLowerCase(), './PreviewChart']) {
        expect(restorePreviewChartQuerySource(path, bytes)).toBe(bytes);
      }
    });
  });

  it('preserves the original widget copy and rejects changes to new copy', () => {
    expect(catalogBeforeWidgetImplementation(catalog).widget).toEqual(catalog.widget);
    const changed = structuredClone(catalog);
    changed.dashboard.designPacks.classic = 'Unverified replacement';
    expect(() => catalogBeforeWidgetImplementation(changed)).toThrow();
    expect(catalog.dashboard.designPacks.classic).not.toBe('Unverified replacement');
  });

  it('pins synchronized selection and style copy without changing historical checkpoints', () => {
    const changedScope = structuredClone(catalog);
    changedScope.theme.widgetDesignPacks.scope = 'Saved only in this browser';
    expect(() => catalogBeforeWidgetImplementation(changedScope)).toThrow();
    const changedStyle = structuredClone(catalog);
    changedStyle.theme.widgetDesignPacks.styleTechnical = 'Experimental';
    expect(() => catalogBeforeWidgetImplementation(changedStyle)).toThrow();
    const changedPack = structuredClone(catalog);
    changedPack.dashboard.designPacks.analog.name = 'Unreviewed';
    expect(() => catalogBeforeWidgetImplementation(changedPack)).toThrow();
  });
});
