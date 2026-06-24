import {
  webRouteManifest,
  type RouteId,
  type RouteImplementationStatus,
  type WebRouteDefinition,
} from '../navigation/routes';

export const TESLASYNC_URL_SCHEME = 'teslasync';

export interface ParsedDeepLink {
  url: string;
  sourcePath: string;
  webPath: string;
  routeId: RouteId | null;
  label: string;
  implementationStatus: RouteImplementationStatus | 'unmatched';
  matched: boolean;
  params: Record<string, string>;
  queryParams: Record<string, string>;
  reason?: string;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function removeQueryAndHash(value: string): string {
  return value.replace(/[?#].*$/, '');
}

function queryStringFromDeepLinkURL(url: string): string {
  const questionIndex = url.indexOf('?');
  if (questionIndex === -1) {
    return '';
  }

  const hashIndex = url.indexOf('#', questionIndex);
  return url.slice(
    questionIndex + 1,
    hashIndex === -1 ? undefined : hashIndex,
  );
}

function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function normalizeSourcePath(value: string): string {
  const trimmed = trimSlashes(value);
  return trimmed.length === 0 ? '/' : trimmed;
}

export function pathFromDeepLinkURL(url: string): string {
  const raw = removeQueryAndHash(url.trim());
  const schemePrefix = `${TESLASYNC_URL_SCHEME}:`;

  if (raw.toLowerCase().startsWith(`${schemePrefix}//`)) {
    const remainder = raw.slice(`${schemePrefix}//`.length);
    const sourcePath = normalizeSourcePath(remainder);
    return sourcePath.startsWith('app/')
      ? sourcePath.slice('app/'.length)
      : sourcePath;
  }

  if (raw.toLowerCase().startsWith(schemePrefix)) {
    return normalizeSourcePath(raw.slice(schemePrefix.length));
  }

  if (/^https?:\/\//i.test(raw)) {
    const withoutProtocol = raw.replace(/^https?:\/\//i, '');
    const slashIndex = withoutProtocol.indexOf('/');
    return normalizeSourcePath(
      slashIndex === -1 ? '/' : withoutProtocol.slice(slashIndex + 1),
    );
  }

  return normalizeSourcePath(raw);
}

export function queryParamsFromDeepLinkURL(
  url: string,
): Record<string, string> {
  const queryString = queryStringFromDeepLinkURL(url.trim());
  if (!queryString) {
    return {};
  }

  const queryParams: Record<string, string> = {};
  for (const segment of queryString.split('&')) {
    if (!segment) {
      continue;
    }
    const [rawKey, ...rawValueParts] = segment.split('=');
    const key = decodeQueryComponent(rawKey);
    const value = decodeQueryComponent(rawValueParts.join('='));
    queryParams[key] = value;
  }
  return queryParams;
}

function matchRoutePattern(
  pattern: string,
  sourcePath: string,
): { matched: boolean; params: Record<string, string> } {
  if (pattern === '*') {
    return { matched: true, params: {} };
  }

  if (pattern === '/') {
    return { matched: sourcePath === '/', params: {} };
  }

  const patternSegments = trimSlashes(pattern).split('/');
  const sourceSegments = trimSlashes(sourcePath).split('/');
  if (patternSegments.length !== sourceSegments.length) {
    return { matched: false, params: {} };
  }

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];
    const sourceSegment = sourceSegments[index];
    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = decodeURIComponent(sourceSegment);
      continue;
    }
    if (patternSegment !== sourceSegment) {
      return { matched: false, params: {} };
    }
  }

  return { matched: true, params };
}

function findRoute(sourcePath: string): {
  route: WebRouteDefinition | null;
  params: Record<string, string>;
} {
  for (const route of webRouteManifest) {
    if (route.sourcePath === '*') {
      continue;
    }
    const result = matchRoutePattern(route.sourcePath, sourcePath);
    if (result.matched) {
      return { route, params: result.params };
    }
  }

  return { route: null, params: {} };
}

export function parseDeepLink(url: string): ParsedDeepLink {
  const sourcePath = pathFromDeepLinkURL(url);
  const queryParams = queryParamsFromDeepLinkURL(url);
  const { route, params } = findRoute(sourcePath);

  if (!route) {
    return {
      url,
      sourcePath,
      webPath: sourcePath === '/' ? '/' : `/${sourcePath}`,
      routeId: null,
      label: 'Unmatched route',
      implementationStatus: 'unmatched',
      matched: false,
      params,
      queryParams,
      reason: 'No route manifest entry matched this deep-link path.',
    };
  }

  return {
    url,
    sourcePath,
    webPath: route.webPath,
    routeId: route.nativeTarget,
    label: route.label,
    implementationStatus: route.implementationStatus,
    matched: true,
    params,
    queryParams,
    reason: route.evidence,
  };
}
