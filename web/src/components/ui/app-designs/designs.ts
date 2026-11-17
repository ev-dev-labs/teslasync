import type { PackId } from '@/features/dashboard/widgets/designPacks/types';
import { appDesignPortalScope, type AppDesignOriginSnapshot, type AppDesignPortalScope } from '../appDesignOrigin';

export interface ApplicationDesign {
  readonly navigation: 'rail' | 'sidebar' | 'top' | 'hybrid';
  readonly header: 'banner' | 'split' | 'masthead' | 'compact' | 'instrument';
  readonly content: 'cards' | 'editorial' | 'workbench' | 'canvas' | 'ledger';
  readonly controls: 'filled' | 'outline' | 'underline' | 'segmented';
  readonly data: 'table' | 'ledger' | 'cards' | 'instrument';
  readonly chart: 'precision' | 'editorial' | 'instrument' | 'soft' | 'geometric';
  readonly map: 'instrument' | 'atlas' | 'minimal' | 'framed';
  readonly feedback: 'inline' | 'callout' | 'terminal';
}

/**
 * Static composition choices, not preference defaults. Only verified app-wide
 * selection activates these; Classic is an explicit design, not an opt-out.
 * Category CSS owns mode composition; packs own their individual treatments.
 * This table is the coordinated pack-author contract, not inferred defaults.
 */
export const APPLICATION_DESIGNS: Readonly<Record<PackId, ApplicationDesign>> = {
  classic: { navigation: 'rail', header: 'banner', content: 'cards', controls: 'outline', data: 'table', chart: 'precision', map: 'framed', feedback: 'inline' },
  v1: { navigation: 'rail', header: 'instrument', content: 'workbench', controls: 'outline', data: 'instrument', chart: 'instrument', map: 'instrument', feedback: 'terminal' },
  v2: { navigation: 'sidebar', header: 'split', content: 'cards', controls: 'filled', data: 'cards', chart: 'soft', map: 'framed', feedback: 'callout' },
  v3: { navigation: 'rail', header: 'compact', content: 'ledger', controls: 'underline', data: 'ledger', chart: 'precision', map: 'minimal', feedback: 'inline' },
  v4: { navigation: 'sidebar', header: 'banner', content: 'cards', controls: 'outline', data: 'cards', chart: 'editorial', map: 'atlas', feedback: 'inline' },
  v5: { navigation: 'hybrid', header: 'masthead', content: 'canvas', controls: 'filled', data: 'instrument', chart: 'soft', map: 'framed', feedback: 'callout' },
  v6: { navigation: 'top', header: 'split', content: 'canvas', controls: 'segmented', data: 'cards', chart: 'geometric', map: 'atlas', feedback: 'callout' },
  v7: { navigation: 'rail', header: 'instrument', content: 'workbench', controls: 'outline', data: 'table', chart: 'geometric', map: 'instrument', feedback: 'terminal' },
  motorsport: { navigation: 'hybrid', header: 'instrument', content: 'workbench', controls: 'filled', data: 'instrument', chart: 'instrument', map: 'instrument', feedback: 'callout' },
  blueprint: { navigation: 'sidebar', header: 'instrument', content: 'workbench', controls: 'outline', data: 'ledger', chart: 'precision', map: 'atlas', feedback: 'terminal' },
  editorial: { navigation: 'top', header: 'masthead', content: 'editorial', controls: 'underline', data: 'ledger', chart: 'editorial', map: 'minimal', feedback: 'inline' },
  ambient: { navigation: 'sidebar', header: 'split', content: 'canvas', controls: 'filled', data: 'cards', chart: 'soft', map: 'minimal', feedback: 'callout' },
  terminal: { navigation: 'rail', header: 'compact', content: 'ledger', controls: 'outline', data: 'ledger', chart: 'precision', map: 'instrument', feedback: 'terminal' },
  atlas: { navigation: 'hybrid', header: 'banner', content: 'canvas', controls: 'outline', data: 'cards', chart: 'editorial', map: 'atlas', feedback: 'inline' },
  analog: { navigation: 'sidebar', header: 'instrument', content: 'cards', controls: 'filled', data: 'instrument', chart: 'instrument', map: 'framed', feedback: 'callout' },
  observatory: { navigation: 'rail', header: 'split', content: 'canvas', controls: 'outline', data: 'instrument', chart: 'precision', map: 'instrument', feedback: 'inline' },
  bauhaus: { navigation: 'top', header: 'split', content: 'cards', controls: 'segmented', data: 'cards', chart: 'geometric', map: 'framed', feedback: 'callout' },
  quiet: { navigation: 'rail', header: 'compact', content: 'editorial', controls: 'underline', data: 'table', chart: 'editorial', map: 'minimal', feedback: 'inline' },
  warm: { navigation: 'sidebar', header: 'masthead', content: 'editorial', controls: 'filled', data: 'cards', chart: 'soft', map: 'atlas', feedback: 'callout' },
  swiss: { navigation: 'top', header: 'compact', content: 'ledger', controls: 'underline', data: 'table', chart: 'precision', map: 'minimal', feedback: 'inline' },
  material: { navigation: 'hybrid', header: 'banner', content: 'cards', controls: 'filled', data: 'cards', chart: 'soft', map: 'framed', feedback: 'inline' },
  glass: { navigation: 'sidebar', header: 'split', content: 'canvas', controls: 'outline', data: 'cards', chart: 'soft', map: 'minimal', feedback: 'callout' },
  deco: { navigation: 'top', header: 'masthead', content: 'editorial', controls: 'outline', data: 'ledger', chart: 'geometric', map: 'framed', feedback: 'callout' },
  kinetic: { navigation: 'hybrid', header: 'instrument', content: 'workbench', controls: 'segmented', data: 'instrument', chart: 'geometric', map: 'instrument', feedback: 'inline' },
  brutal: { navigation: 'top', header: 'banner', content: 'workbench', controls: 'outline', data: 'table', chart: 'geometric', map: 'framed', feedback: 'terminal' },
  cyber: { navigation: 'rail', header: 'instrument', content: 'canvas', controls: 'segmented', data: 'instrument', chart: 'instrument', map: 'instrument', feedback: 'terminal' },
  memphis: { navigation: 'hybrid', header: 'split', content: 'canvas', controls: 'segmented', data: 'cards', chart: 'geometric', map: 'atlas', feedback: 'callout' },
};

export const APP_DESIGN_PACK_FILES: Readonly<Record<PackId, string>> = {
  classic: 'classic.css',
  v1: 'studio.css',
  v2: 'elevated.css',
  v3: 'precision.css',
  v4: 'concierge.css',
  v5: 'iconic.css',
  v6: 'expressive.css',
  v7: 'pixel.css',
  motorsport: 'motorsport.css',
  blueprint: 'blueprint.css',
  editorial: 'editorial.css',
  ambient: 'ambient.css',
  terminal: 'terminal.css',
  atlas: 'atlas.css',
  analog: 'analog.css',
  observatory: 'observatory.css',
  bauhaus: 'bauhaus.css',
  quiet: 'quiet.css',
  warm: 'warm.css',
  swiss: 'swiss.css',
  material: 'material.css',
  glass: 'glass.css',
  deco: 'deco.css',
  kinetic: 'kinetic.css',
  brutal: 'brutal.css',
  cyber: 'cyber.css',
  memphis: 'memphis.css',
};

/** Also usable on an isolated preview host, without mounting the bridge. */
export function getAppDesignAttributes(packId: PackId) {
  const design = APPLICATION_DESIGNS[packId];
  return {
    'data-app-design-pack': packId,
    'data-app-navigation': design.navigation,
    'data-app-header': design.header,
    'data-app-content': design.content,
    'data-app-controls': design.controls,
    'data-app-data': design.data,
    'data-app-chart': design.chart,
    'data-app-map': design.map,
    'data-app-feedback': design.feedback,
  } as const;
}

const OWNER_ATTRIBUTE = 'data-app-design-owner';
const PREVIEW_ATTRIBUTE = 'data-app-design-preview';
const PRESERVE_ATTRIBUTE = 'data-app-design-preserve';
const scopeObservers = new WeakMap<Document, {
  users: number;
  refresh: (scope: Element) => void;
  dispose: () => void;
}>();

/**
 * Selector ownership only: copy the existing complete profile at the nearest
 * boundary. Never derive preferences or change theme tokens. Preview consumers
 * register their host too, so they also work without the authenticated bridge.
 */
export function observeAppDesignScopes(scope: Element): () => void {
  const doc = scope.ownerDocument;
  let shared = scopeObservers.get(doc);
  if (!shared) {
    const Observer = doc.defaultView?.MutationObserver;
    if (!Observer) return () => {};
    const profileAttributes = Object.keys(getAppDesignAttributes('classic'));
    const readOwner = (host: Element): string | null => {
      const packId = host.getAttribute('data-app-design-pack');
      if (!packId || !Object.prototype.hasOwnProperty.call(APPLICATION_DESIGNS, packId)) return null;
      const id = packId as PackId;
      if (!Object.entries(getAppDesignAttributes(id)).every(([name, value]) => host.getAttribute(name) === value)) return null;
      return [`pack-${id}`, ...Object.entries(APPLICATION_DESIGNS[id]).map(([slot, value]) => `${slot}-${value}`)].join(' ');
    };
    const writeOwner = (element: Element, owner: string | null) => {
      if (owner === null) element.removeAttribute(OWNER_ATTRIBUTE);
      else if (element.getAttribute(OWNER_ATTRIBUTE) !== owner) element.setAttribute(OWNER_ATTRIBUTE, owner);
    };
    const clear = (element: Element) => {
      element.removeAttribute(OWNER_ATTRIBUTE);
      for (const child of element.querySelectorAll(`[${OWNER_ATTRIBUTE}]`)) child.removeAttribute(OWNER_ATTRIBUTE);
    };
    const refresh = (start: Element) => {
      if (!start.isConnected) { clear(start); return; }
      const applicationOwner = readOwner(doc.documentElement);
      writeOwner(doc.documentElement, applicationOwner);
      const root = start === doc.documentElement ? doc.body : start;
      if (!root) return;
      if (root.parentElement?.closest(`[${PRESERVE_ATTRIBUTE}]`)) {
        clear(root);
        return;
      }
      const boundary = root.parentElement?.closest(`[${PREVIEW_ATTRIBUTE}]`);
      const inherited = boundary ? readOwner(boundary) : applicationOwner;
      const pending: Array<[Element, string | null]> = [[root, inherited]];
      while (pending.length) {
        const [element, parentOwner] = pending.pop()!;
        if (element.hasAttribute(PRESERVE_ATTRIBUTE)) {
          clear(element);
          continue;
        }
        const owner = element.hasAttribute(PREVIEW_ATTRIBUTE) ? readOwner(element) : parentOwner;
        // Widget-only trees do not need a traversal on every live DOM update.
        if (owner === null && !element.hasAttribute(OWNER_ATTRIBUTE) &&
          !element.querySelector(`[${PREVIEW_ATTRIBUTE}], [${OWNER_ATTRIBUTE}]`)) continue;
        writeOwner(element, owner);
        for (const child of element.children) pending.push([child, owner]);
      }
    };
    const observer = new Observer(records => {
      const changed = new Set<Element>();
      for (const record of records) {
        if (record.type === 'attributes') changed.add(record.target as Element);
        else {
          for (const node of record.removedNodes) {
            if (node.nodeType === 1 && !node.isConnected) clear(node as Element);
          }
          for (const node of record.addedNodes) {
            if (node.nodeType === 1 && node.isConnected && doc.body?.contains(node)) changed.add(node as Element);
          }
        }
      }
      // Nine profile attributes change together; refresh each subtree once.
      for (const element of changed) {
        let parent = element.parentElement;
        while (parent && !changed.has(parent)) parent = parent.parentElement;
        if (!parent) refresh(element);
      }
    });
    observer.observe(doc.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: [PREVIEW_ATTRIBUTE, PRESERVE_ATTRIBUTE, ...profileAttributes],
    });
    shared = {
      users: 0, refresh,
      dispose: () => {
        for (const record of observer.takeRecords()) {
          for (const node of record.removedNodes) if (node.nodeType === 1) clear(node as Element);
        }
        observer.disconnect();
        clear(doc.documentElement);
      },
    };
    scopeObservers.set(doc, shared);
  }
  const registration = shared;
  ++registration.users;
  registration.refresh(scope);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--registration.users === 0) {
      registration.dispose();
      scopeObservers.delete(doc);
    } else registration.refresh(scope);
  };
}

/**
 * Keep portal verification at the existing lazy metadata/observer boundary.
 * The lightweight portal retains its DOM, overlay engine and invocation state.
 */
export function connectAppDesignPortal(
  source: HTMLElement,
  boundary: HTMLElement,
  originSnapshot: AppDesignOriginSnapshot | undefined,
  state: AppDesignPortalScope,
): () => void {
  const profileAttributes = Object.keys(getAppDesignAttributes('classic'));
  if (state.retained.snapshot !== originSnapshot) {
    state.retained = {
      snapshot: originSnapshot,
      profile: originSnapshot?.profile ?? null,
      locale: originSnapshot?.locale ?? { dir: null, lang: null },
    };
  }
  const setAttribute = (name: string, value: string | null) => {
    if (value === null) boundary.removeAttribute(name);
    else if (boundary.getAttribute(name) !== value) boundary.setAttribute(name, value);
  };
  const sync = () => {
    const currentPreview = source.closest('[data-app-design-preview]');
    if (source.isConnected || currentPreview) state.preview = currentPreview;
    const capturedScope = originSnapshot?.scope;
    const liveCapture = !!capturedScope?.isConnected && !!originSnapshot?.ancestors.every(
      (ancestor, index, ancestors) => ancestor.parentElement === (ancestors[index + 1] ?? null),
    );
    const preview = originSnapshot
      ? liveCapture && (!originSnapshot.preview || capturedScope?.hasAttribute('data-app-design-preview')) ? capturedScope : null
      : state.preview;
    const candidate: Readonly<Record<string, string | null>> | null = preview
      ? Object.fromEntries(profileAttributes.map(name => [name, preview.getAttribute(name)] as const))
      : originSnapshot && !liveCapture ? state.retained.profile : null;
    const packId = candidate?.['data-app-design-pack'];
    const profile = packId && Object.prototype.hasOwnProperty.call(APPLICATION_DESIGNS, packId)
      ? getAppDesignAttributes(packId as keyof typeof APPLICATION_DESIGNS)
      : null;
    const verified = profile && Object.entries(profile).every(([name, value]) => candidate?.[name] === value);
    const activeProfile: Readonly<Record<string, string>> | null = verified && profile ? profile : null;

    // An incomplete preview is still an isolation boundary.
    setAttribute('data-app-design-preview', originSnapshot || preview ? '' : null);
    for (const name of profileAttributes) setAttribute(name, activeProfile?.[name] ?? null);
    const localeSource = source.isConnected ? source : preview ?? source;
    const locale = { dir: null, lang: null } as Record<'dir' | 'lang', string | null>;
    for (const name of ['dir', 'lang'] as const) {
      if (originSnapshot) {
        locale[name] = state.retained.locale[name];
        if (liveCapture && capturedScope) {
          const belongs = (element: Element) => capturedScope.contains(element) && (originSnapshot.preview
            ? element.closest('[data-app-design-preview]') === capturedScope
            : !element.closest('[data-app-design-preview]'));
          const owner = originSnapshot.localeOwners[name];
          const ownerRetained = !owner || originSnapshot.ancestors.includes(owner) || belongs(owner);
          if (ownerRetained) {
            const originSource = originSnapshot.origin;
            const liveSource = originSource?.isConnected && belongs(originSource) ? originSource
              : owner && !originSnapshot.ancestors.includes(owner) ? owner : capturedScope;
            locale[name] = liveSource.closest(`[${name}]`)?.getAttribute(name) ?? null;
          }
        }
      } else {
        const value = localeSource.closest(`[${name}]`)?.getAttribute(name);
        locale[name] = value ?? (localeSource.isConnected ? null : boundary.getAttribute(name));
      }
      setAttribute(name, locale[name]);
    }
    if (originSnapshot && liveCapture) state.retained = { snapshot: originSnapshot, profile: activeProfile, locale };
    if (activeProfile && !state.releaseOwner) state.releaseOwner = observeAppDesignScopes(boundary);
    else if (!activeProfile && state.releaseOwner) {
      state.releaseOwner();
      state.releaseOwner = null;
    }
  };

  sync();
  if (!originSnapshot && !state.preview && !source.closest('[data-app-design-portal]') &&
    !source.ownerDocument.documentElement.hasAttribute('data-app-design-pack')) {
    return () => {};
  }
  const observer = new MutationObserver(sync);
  const options = {
    attributes: true, attributeFilter: ['data-app-design-preview', ...profileAttributes, 'dir', 'lang'],
    childList: !!originSnapshot,
  };
  for (let ancestor: Element | null = source; ancestor; ancestor = ancestor.parentElement) observer.observe(ancestor, options);
  for (let ancestor = state.preview; ancestor; ancestor = ancestor.parentElement) observer.observe(ancestor, options);
  for (const ancestor of originSnapshot?.ancestors ?? []) observer.observe(ancestor, options);
  for (const name of ['dir', 'lang'] as const) {
    const owner = originSnapshot?.localeOwners[name];
    if (owner) observer.observe(owner, options);
  }
  return () => observer.disconnect();
}

appDesignPortalScope.connect = connectAppDesignPortal;
