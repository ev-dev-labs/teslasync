import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  resolveRouteCommand,
  searchRoutes,
  type RouteSearchResult,
} from '../../navigation/routeSearch';
import type { RouteId } from '../../navigation/routes';
import { colors, spacing } from '../../theme/tokens';
import { EmptyState } from '../feedback/EmptyState';
import { AppText } from '../ui/AppText';
import { GlassPanel } from '../ui/GlassPanel';
import { StatusPill } from '../ui/StatusPill';

interface RouteSearchPanelProps {
  activeRoute: RouteId;
  compact: boolean;
  onNavigate: (route: RouteId) => void;
  style?: StyleProp<ViewStyle>;
}

function statusStateForResult(result: RouteSearchResult) {
  if (result.statusLabel === 'Ready') {
    return 'online' as const;
  }

  return result.statusLabel === 'Unavailable' ? ('offline' as const) : ('warning' as const);
}

export function RouteSearchPanel({
  activeRoute,
  compact,
  onNavigate,
  style,
}: RouteSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [focusedResult, setFocusedResult] = useState<RouteId | null>(null);
  const resultLimit = compact ? 4 : 6;
  const results = useMemo(() => searchRoutes(query, resultLimit), [
    query,
    resultLimit,
  ]);
  const commandRoute = useMemo(() => resolveRouteCommand(query), [query]);
  const trimmedQuery = query.trim();

  const submitCommand = () => {
    if (commandRoute) {
      onNavigate(commandRoute);
    }
  };

  return (
    <GlassPanel
      style={[styles.root, compact && styles.compactRoot, style]}
      testID="route-search-panel"
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="caption" tone="muted" weight="semibold">
            Command route
          </AppText>
          <AppText variant="caption" tone="muted">
            Search native routes or paste a web path, then press Enter.
          </AppText>
        </View>
        <StatusPill
          label={commandRoute ? 'Ready' : 'Index'}
          state={commandRoute ? 'online' : 'warning'}
        />
      </View>

      <TextInput
        accessibilityLabel="Route search"
        accessibilityHint="Type a native route name or web path, then press Enter to switch routes."
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onBlur={() => setFocused(false)}
        onChangeText={setQuery}
        onFocus={() => setFocused(true)}
        onSubmitEditing={submitCommand}
        placeholder="Search routes or paste /vehicles"
        placeholderTextColor={colors.textMuted}
        returnKeyType="go"
        selectionColor={colors.accent}
        style={[styles.input, focused && styles.inputFocused]}
        testID="route-search-input"
        value={query}
      />

      <AppText variant="caption" tone={results.length === 0 ? 'danger' : 'muted'}>
        {trimmedQuery
          ? `${results.length} route ${results.length === 1 ? 'match' : 'matches'} for "${trimmedQuery}"`
          : `Browser route index: showing ${results.length} of ${searchRoutes('').length} native targets`}
      </AppText>

      {results.length === 0 ? (
        <EmptyState
          title="No route matches"
          message="Try a native target such as charging, a web path such as /battery-cells, or clear the command field to browse the route index."
        />
      ) : (
        <View
          accessibilityLabel="Route search results"
          style={styles.results}
          testID="route-search-results"
        >
          {results.map(result => {
            const selected = result.route.id === activeRoute;
            const resultFocused = focusedResult === result.route.id;

            return (
              <Pressable
                accessibilityHint={`Switches to the ${result.route.label} native route.`}
                accessibilityLabel={`Open ${result.route.label} route`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                focusable
                key={result.route.id}
                onBlur={() => setFocusedResult(null)}
                onFocus={() => setFocusedResult(result.route.id)}
                onPress={() => onNavigate(result.route.id)}
                style={({ pressed }) => [
                  styles.result,
                  selected && styles.resultSelected,
                  resultFocused && styles.resultFocused,
                  pressed && styles.resultPressed,
                ]}
                testID={`route-search-result-${result.route.id}`}
              >
                <View style={styles.resultCopy}>
                  <View style={styles.resultTitle}>
                    <AppText weight="semibold">{result.route.label}</AppText>
                    <StatusPill
                      label={result.statusLabel}
                      state={statusStateForResult(result)}
                    />
                  </View>
                  <AppText variant="caption" tone="muted">
                    {result.helper}
                  </AppText>
                  {result.matchedWebRoutes.length > 0 ? (
                    <AppText variant="caption" tone="muted">
                      {result.matchedWebRoutes
                        .map(mappedRoute => mappedRoute.webPath)
                        .join(', ')}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="caption" tone="accent" weight="semibold">
                  {result.route.id}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: spacing.md,
    gap: spacing.md,
  },
  compactRoot: {
    flex: 1,
    minWidth: 280,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
  },
  inputFocused: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  results: {
    gap: spacing.sm,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  resultSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  resultFocused: {
    borderColor: colors.accent,
  },
  resultPressed: {
    opacity: 0.82,
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  resultTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
