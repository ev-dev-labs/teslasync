import {
  getRoutesForNativeTarget,
  routes,
  webRouteManifest,
  type RouteDefinition,
  type RouteId,
  type WebRouteDefinition,
} from './routes';

export interface RouteSearchResult {
  route: RouteDefinition;
  matchedWebRoutes: WebRouteDefinition[];
  statusLabel: string;
  helper: string;
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replace(/^\/+/, '');
}

function routeStatusLabel(route: RouteDefinition) {
  if (route.parity.pending === 0) {
    return 'Ready';
  }

  if (route.parity.implemented === 0) {
    return 'Unavailable';
  }

  return 'Needs parity';
}

function routeSearchText(
  route: RouteDefinition,
  mappedRoutes: readonly WebRouteDefinition[],
) {
  return normalizeSearchText(
    [
      route.id,
      route.label,
      route.shortDescription,
      route.description,
      ...route.webPaths,
      ...mappedRoutes.flatMap(mappedRoute => [
        mappedRoute.id,
        mappedRoute.label,
        mappedRoute.sourcePath,
        mappedRoute.webPath,
        mappedRoute.nativeImplementationStatus,
      ]),
    ].join(' '),
  );
}

function matchedWebRoutesForQuery(
  mappedRoutes: readonly WebRouteDefinition[],
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return mappedRoutes.slice(0, 3);
  }

  return mappedRoutes
    .filter(mappedRoute =>
      normalizeSearchText(
        [
          mappedRoute.id,
          mappedRoute.label,
          mappedRoute.sourcePath,
          mappedRoute.webPath,
          mappedRoute.nativeImplementationStatus,
        ].join(' '),
      ).includes(normalizedQuery),
    )
    .slice(0, 3);
}

function scoreRoute(
  route: RouteDefinition,
  mappedRoutes: readonly WebRouteDefinition[],
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return 0;
  }

  if (
    normalizeSearchText(route.id) === normalizedQuery ||
    normalizeSearchText(route.label) === normalizedQuery
  ) {
    return 100;
  }

  if (
    mappedRoutes.some(
      mappedRoute =>
        normalizeSearchText(mappedRoute.webPath) === normalizedQuery ||
        normalizeSearchText(mappedRoute.sourcePath) === normalizedQuery ||
        normalizeSearchText(mappedRoute.label) === normalizedQuery,
    )
  ) {
    return 80;
  }

  if (route.parity.pending === 0) {
    return 10;
  }

  return 1;
}

export function searchRoutes(query: string, limit = routes.length) {
  const normalizedQuery = normalizeSearchText(query);

  return routes
    .map(route => {
      const mappedRoutes = getRoutesForNativeTarget(route.id);
      const searchText = routeSearchText(route, mappedRoutes);

      if (normalizedQuery && !searchText.includes(normalizedQuery)) {
        return null;
      }

      return {
        route,
        matchedWebRoutes: matchedWebRoutesForQuery(
          mappedRoutes,
          normalizedQuery,
        ),
        statusLabel: routeStatusLabel(route),
        helper:
          route.parity.pending === 0
            ? `${route.parity.total} web routes deletion-gate ready`
            : `${route.parity.pending} of ${route.parity.total} web routes still unresolved`,
        score: scoreRoute(route, mappedRoutes, normalizedQuery),
      };
    })
    .filter((result): result is RouteSearchResult & {score: number} =>
      Boolean(result),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({score: _score, ...result}) => result);
}

export function resolveRouteCommand(query: string): RouteId | null {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return null;
  }

  const nativeRoute = routes.find(
    route =>
      normalizeSearchText(route.id) === normalizedQuery ||
      normalizeSearchText(route.label) === normalizedQuery,
  );
  if (nativeRoute) {
    return nativeRoute.id;
  }

  const mappedRoute = webRouteManifest.find(
    route =>
      normalizeSearchText(route.webPath) === normalizedQuery ||
      normalizeSearchText(route.sourcePath) === normalizedQuery ||
      normalizeSearchText(route.label) === normalizedQuery,
  );
  if (mappedRoute) {
    return mappedRoute.nativeTarget;
  }

  return searchRoutes(query, 1)[0]?.route.id ?? null;
}
