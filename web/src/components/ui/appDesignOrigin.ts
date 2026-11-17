const PROFILE_BINDINGS = [
  ['data-app-design-pack', 'pack'],
  ['data-app-navigation', 'navigation'],
  ['data-app-header', 'header'],
  ['data-app-content', 'content'],
  ['data-app-controls', 'controls'],
  ['data-app-data', 'data'],
  ['data-app-chart', 'chart'],
  ['data-app-map', 'map'],
  ['data-app-feedback', 'feedback'],
] as const;

type Locale = 'dir' | 'lang';

export interface AppDesignOriginSnapshot {
  readonly origin: HTMLElement | null;
  readonly scope: Element | null;
  readonly preview: boolean;
  readonly ancestors: readonly Element[];
  readonly profile: Readonly<Record<string, string>> | null;
  readonly locale: Readonly<Record<Locale, string | null>>;
  readonly localeOwners: Readonly<Record<Locale, Element | null>>;
}

export interface AppDesignInvocation {
  readonly origin: HTMLElement | null;
  readonly snapshot: AppDesignOriginSnapshot;
}

export interface AppDesignPortalScope {
  preview: Element | null;
  releaseOwner: (() => void) | null;
  retained: Pick<AppDesignOriginSnapshot, 'profile' | 'locale'> & {
    snapshot: AppDesignOriginSnapshot | undefined;
  };
}

type ConnectPortal = (
  source: HTMLElement,
  boundary: HTMLElement,
  snapshot: AppDesignOriginSnapshot | undefined,
  state: AppDesignPortalScope,
) => () => void;

/** The canonical lazy design module installs its synchronous portal binding. */
export const appDesignPortalScope: { connect?: ConnectPortal } = {};

function readVerifiedProfile(scope: Element | null): Readonly<Record<string, string>> | null {
  const owner = new Set(scope?.getAttribute('data-app-design-owner')?.split(/\s+/));
  const profile: Record<string, string> = {};
  for (const [attribute, slot] of PROFILE_BINDINGS) {
    const value = scope?.getAttribute(attribute);
    if (!value || !owner.has(`${slot}-${value}`)) return null;
    profile[attribute] = value;
  }
  return Object.freeze(profile);
}

/**
 * Capture the foundation's matching complete-owner receipt before lazy loading
 * can lose DOM ancestry. This lightweight path must not import pack metadata.
 * The existing portal verifies the captured profile against its registry again.
 */
export function captureAppDesignOrigin(origin: HTMLElement | null): AppDesignOriginSnapshot {
  const doc = origin?.ownerDocument ?? (typeof document === 'undefined' ? null : document);
  const preview = origin?.closest('[data-app-design-preview]') ?? null;
  const scope = preview ?? doc?.documentElement ?? null;
  const localeSource = origin ?? scope;
  const localeOwners = {
    dir: localeSource?.closest('[dir]') ?? null,
    lang: localeSource?.closest('[lang]') ?? null,
  };
  const ancestors: Element[] = [];
  for (let ancestor = scope; ancestor; ancestor = ancestor.parentElement) ancestors.push(ancestor);
  return Object.freeze({
    origin,
    scope,
    preview: preview !== null,
    ancestors: Object.freeze(ancestors),
    profile: readVerifiedProfile(scope),
    locale: Object.freeze({
      dir: localeOwners.dir?.getAttribute('dir') ?? null,
      lang: localeOwners.lang?.getAttribute('lang') ?? null,
    }),
    localeOwners: Object.freeze(localeOwners),
  });
}

function isSnapshot(value: unknown, origin: HTMLElement | null): value is AppDesignOriginSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<AppDesignOriginSnapshot>;
  return snapshot.origin === origin
    && (snapshot.scope === null || snapshot.scope instanceof Element)
    && typeof snapshot.preview === 'boolean'
    && Array.isArray(snapshot.ancestors)
    && snapshot.ancestors.every((ancestor: unknown) => ancestor instanceof Element)
    && (snapshot.scope === null ? snapshot.ancestors.length === 0 : snapshot.ancestors[0] === snapshot.scope)
    && (snapshot.profile === null || typeof snapshot.profile === 'object'
      && Object.values(snapshot.profile).every(attribute => typeof attribute === 'string'))
    && !!snapshot.locale && !!snapshot.localeOwners
    && (['dir', 'lang'] as const).every(name =>
      (snapshot.locale?.[name] === null || typeof snapshot.locale?.[name] === 'string')
      && (snapshot.localeOwners?.[name] === null || snapshot.localeOwners?.[name] instanceof Element));
}

export function readAppDesignInvocation(event: Event): AppDesignInvocation {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null;
  const explicit = detail && typeof detail === 'object' && 'origin' in detail
    && detail.origin instanceof HTMLElement ? detail.origin : null;
  const active = document.activeElement;
  const origin = explicit ?? (active instanceof HTMLElement && active !== document.body && active !== document.documentElement
    ? active : null);
  const captured = detail && typeof detail === 'object' && 'designOrigin' in detail ? detail.designOrigin : null;
  return { origin, snapshot: isSnapshot(captured, origin) ? captured : captureAppDesignOrigin(origin) };
}
