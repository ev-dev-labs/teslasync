/** Finite production registries reviewed for the six remaining trio producers.
 * Read defaults from their real owners, never from the catalog being verified.
 * Exact call/default expressions are required; changed shapes fail closed.
 */
const cache = new Map();
export const registryDependencies = [
  'web/src/lib/routeRegistry.ts', 'web/src/lib/helpGlossary.ts',
  'web/src/lib/emptyStateGuidance.ts', 'web/src/lib/onboardingTasks.ts',
  'web/src/lib/dataUnavailability.ts', 'web/src/lib/helpIndex.ts',
  'web/src/lib/routeMeta.ts', 'web/src/lib/contextNavigation.ts',
  'web/src/lib/palettePrefix.ts',
  'web/src/components/layout/sidebar/collections.ts',
  'web/src/components/layout/reportGroups.ts',
  'web/src/components/layout/diagnosticGroups.ts',
];
export function registryCalls(call, api) {
  const read = (file, name) => {
    const id = file + ':' + name;
    if (!cache.has(id)) {
      const declaration = api.declarations(file.replace(/^web\//, '')).get(name);
      if (!declaration) throw new Error('Missing registry declaration: ' + id);
      let node = declaration.node;
      if (name === 'navSections') {
        const suffix = `.map(section => ({
  ...section,
  items: section.items.map(item => ({
    ...item,
    icon: SIDEBAR_ROUTE_ICONS[item.to] ?? item.icon,
  })),
}))`;
        if (!node.getText().replaceAll('\r', '').endsWith(suffix)) throw new Error('Sidebar transformation changed');
        node = node.expression.expression;
      }
      cache.set(id, api.staticValue(node));
    }
    return cache.get(id);
  };
  const key = call.keyNode?.getText(call.tree), fallback = call.fallbackNode?.getText(call.tree);
  const isLayout = call.file === 'web/src/components/layout/Layout.tsx';
  const isPalette = call.file === 'web/src/components/ui/CommandPalette.tsx';
  const expand = pairs => pairs.map(([key, fallback]) => {
    if (typeof key !== 'string' || typeof fallback !== 'string') throw new Error('Nonliteral registry pair');
    return { ...call, key, fallback };
  });
  if (call.file === 'web/src/components/layout/sidebar/AtlasPanel.tsx' && key === 'group.labelKey' && fallback === 'group.label') {
    const definitions = read('web/src/components/layout/sidebar/collections.ts', 'DEFINITIONS');
    const groups = [
      ...read('web/src/components/layout/reportGroups.ts', 'REPORT_GROUPS'),
      ...read('web/src/components/layout/diagnosticGroups.ts', 'DIAGNOSTIC_GROUPS'),
    ];
    return expand([...groups.map(group => [group.labelKey, group.label]),
      ...definitions.map(([label, primary]) => ['nav.collections.' + primary.slice(1).replace(/\W/g, '_'), label])]);
  }
  if (call.file === 'web/src/features/system/pages/RoadmapPage.tsx') {
    const entries = read(call.file, 'roadmapItems');
    if (key === '`roadmap.entries.${item.id}.title`' && fallback === 'item.title') return expand(entries.map(item => ['roadmap.entries.' + item.id + '.title', item.title]));
    if (key === '`roadmap.entries.${item.id}.description`' && fallback === 'item.description') return expand(entries.map(item => ['roadmap.entries.' + item.id + '.description', item.description]));
    if (key === '`roadmap.entries.${item.id}.features.${i}`' && fallback === 'feature') return expand(entries.flatMap(item => item.features.map((feature, i) => ['roadmap.entries.' + item.id + '.features.' + i, feature])));
    if (key === 'segment.meta.labelKey' && fallback === 'segment.meta.labelFallback') return expand(Object.values(read(call.file, 'PHASE_META')).map(meta => [meta.labelKey, meta.labelFallback]));
  }
  if ((isLayout || isPalette) && ['item.labelKey', 'section.titleKey'].includes(key)) {
    const sections = read('web/src/components/layout/Layout.tsx', 'navSections');
    if (key === 'item.labelKey' && fallback === 'item.label') return expand(sections.flatMap(s => s.items.map(i => [i.labelKey, i.label])));
    if (key === 'section.titleKey' && fallback === 'section.title') return expand(sections.filter(s => s.titleKey).map(s => [s.titleKey, s.title]));
  }
  if (isPalette && key === 'route.i18nKey' && fallback === 'route.defaultLabel') {
    return expand(read('web/src/lib/routeRegistry.ts', 'ROUTE_REGISTRY').map(r => [r.i18nKey, r.label]));
  }
  if (isPalette && key?.includes('${activeScope}')) {
    const scopes = read('web/src/lib/palettePrefix.ts', 'PALETTE_SCOPE_TABLE');
    if (key === '`palette.scope.${activeScope}`' && fallback === 'getScopeMeta(activeScope).label') return expand(scopes.map(([scope, meta]) => ['palette.scope.' + scope, meta.label]));
    if (key === '`palette.placeholder.${activeScope}`' && fallback === 'getScopeMeta(activeScope).placeholder') return expand(scopes.map(([scope, meta]) => ['palette.placeholder.' + scope, meta.placeholder]));
    if (key === '`palette.scope.${activeScope}.empty`' && fallback === '`No ${getScopeMeta(activeScope).label.toLowerCase()} available`') return expand(scopes.map(([scope, meta]) => ['palette.scope.' + scope + '.empty', 'No ' + meta.label.toLowerCase() + ' available']));
  }
  if (isPalette && key === '`palette.scope.${hint.scope}`' && fallback === 'hint.label') return expand(read('web/src/lib/palettePrefix.ts', 'PALETTE_SCOPE_TABLE').map(([scope, meta]) => ['palette.scope.' + scope, meta.label]));
  if (call.file === 'web/src/features/system/components/help-index/HelpSearch.tsx' && ['entry.titleKey','entry.summaryKey'].includes(key)) {
    if (fallback !== (key === 'entry.titleKey' ? 'entry.titleFallback' : 'entry.summaryFallback')) return null;
    const entries = [
      ...read('web/src/lib/routeRegistry.ts','ROUTE_REGISTRY').filter(r=>!r.hidden).map(r=>({titleKey:r.i18nKey,titleFallback:r.label,summaryKey:'helpIndex.page.'+r.name+'.summary',summaryFallback:'Open the '+r.label+' page.'})),
      ...read('web/src/lib/helpGlossary.ts','GLOSSARY').map(r=>({titleKey:r.termKey,titleFallback:r.termFallback,summaryKey:r.definitionKey,summaryFallback:r.definitionFallback})),
      ...read('web/src/lib/onboardingTasks.ts','ONBOARDING_TASKS').map(r=>({titleKey:r.titleKey,titleFallback:r.titleFallback,summaryKey:r.bodyKey,summaryFallback:r.bodyFallback})),
      ...read('web/src/lib/emptyStateGuidance.ts','EMPTY_STATE_GUIDANCE').map(r=>({titleKey:r.meaningKey,titleFallback:r.meaningFallback,summaryKey:r.likelyCauseKey,summaryFallback:r.likelyCauseFallback})),
      ...Object.values(read('web/src/lib/dataUnavailability.ts','EXPLANATIONS')).map(r=>({titleKey:r.titleKey,titleFallback:r.titleFallback,summaryKey:r.whatToDoKey,summaryFallback:r.whatToDoFallback})),
    ];
    return expand(entries.map(r => key === 'entry.titleKey' ? [r.titleKey,r.titleFallback] : [r.summaryKey,r.summaryFallback]));
  }
  return null;
}
