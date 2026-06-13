// The native Jetpack Compose + Material 3 BreadcrumbOverridesContext shared surface — a parity port of the
// web context bridge web/src/components/layout/BreadcrumbOverridesContext.tsx. The web source is NOT a
// visual view: it is the React context plumbing that lets pages push dynamic breadcrumb labels (keyed by
// route pattern) up to the single global Layout breadcrumb without each page rendering its own duplicate
// breadcrumb row. This file reproduces that plumbing with the idiomatic Compose analogue of a React context
// — a [CompositionLocal] — plus the matching provider, reader, and registration composable, and demonstrates
// the bridge end-to-end (a breadcrumb trail consuming the merged overrides) in tooling-only previews. Every
// pure decision lives in BreadcrumbOverridesContextModel.kt.
//
// Element-for-element mapping of the web API:
//   - `createContext<BreadcrumbOverridesContextValue | null>(null)` -> two locals: [LocalBreadcrumbOverrides]
//     (the merged map, default empty — the READ half the web `useBreadcrumbOverrides` returns as `?? {}`) and
//     [LocalBreadcrumbOverridesController] (the register half, default `null` outside a provider). Splitting
//     the web's single context value into a value-local + a controller-local is the established Compose idiom
//     (the value-local recomposes only readers when the merged map changes; the controller-local is stable),
//     and reproduces both halves of the web `{ overrides, register, unregister }` value faithfully.
//   - `<BreadcrumbOverridesProvider>` (the `useState` registrations + merged `overrides` useMemo) ->
//     [BreadcrumbOverridesProvider]: a `remember`ed [BreadcrumbOverridesCoordinator] whose merged map is
//     collected and provided to readers, with the coordinator provided to setters.
//   - `useBreadcrumbOverrides()` -> [useBreadcrumbOverrides]; `useSetBreadcrumbOverrides(map)` ->
//     [SetBreadcrumbOverrides] (a composable that registers in a `DisposableEffect` and unregisters on dispose).
//
// A context bridge has no loading / empty / error / stale / offline lifecycle of its own (see the model for
// the full Honesty-Covenant-#9 rationale, shared with the accepted ChartHiddenSeriesContext /
// NavigationGuardProvider siblings). Its real states — absent (no provider / no registrations), empty-merge
// (only blank values), and some-overrides (a later registration wins) — are reproduced: the reader yields the
// default empty map outside a provider (web `?? {}`), and the previews render a breadcrumb consumer in both
// the fallback and overridden states. The surface renders no copy of its own (the web source renders
// `children`), so it is anonymous and carries no i18n keys; the preview labels are tooling-only sample data,
// never shipped UI. The one PII-safe `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `MatchingDeclarationName` / `InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/BreadcrumbOverridesContext) cannot form a valid Kotlin package and the file
// hosts several co-located declarations, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.breadcrumboverridescontext

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The merged breadcrumb-override map exposed to the Compose tree — the READ half of the web context value,
 * what `useBreadcrumbOverrides()` returns. Defaults to an empty map so a reader rendered outside any
 * [BreadcrumbOverridesProvider] keeps working unchanged (web `ctx?.overrides ?? {}`). A `compositionLocalOf`
 * (not static) so that when the merged map changes only the consumers that read it recompose, mirroring React
 * re-rendering only the context consumers. Read it through [useBreadcrumbOverrides].
 */
val LocalBreadcrumbOverrides: ProvidableCompositionLocal<BreadcrumbOverrideMap> = compositionLocalOf { emptyMap() }

/**
 * The register half of the web context value exposed to the Compose tree — the surface a page binds to via
 * [SetBreadcrumbOverrides]. Defaults to `null` outside any [BreadcrumbOverridesProvider] so a page can call
 * [SetBreadcrumbOverrides] unconditionally and stay inert when no provider is above it (web
 * `useSetBreadcrumbOverrides`'s `if (!ctx) return`). A `staticCompositionLocalOf` because the coordinator
 * reference is stable for the provider's lifetime.
 */
val LocalBreadcrumbOverridesController: ProvidableCompositionLocal<BreadcrumbOverridesController?> =
    staticCompositionLocalOf { null }

/**
 * Provides per-page breadcrumb-label overrides to the entire [content] subtree — the native port of the web
 * `<BreadcrumbOverridesProvider>`. Mount it once, high in the tree (around the Layout that renders the global
 * breadcrumb), so every page below can push dynamic labels up to the single breadcrumb slot.
 *
 * It `remember`s one [BreadcrumbOverridesCoordinator] (the registrations registry + merged-map derivation),
 * collects its merged map, and provides BOTH the merged map (through [LocalBreadcrumbOverrides], so readers
 * recompose when it changes) and the coordinator (through [LocalBreadcrumbOverridesController], so setters can
 * register). A one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition. The provider
 * renders no chrome of its own — exactly like the web component, which only wraps its children. Performs NO HTTP.
 *
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic routes through; defaults to the
 *   app's [LocalDataContainer] (a test or preview passes a capturing / no-op logger).
 * @param content the subtree that may read [useBreadcrumbOverrides] and push labels via [SetBreadcrumbOverrides].
 */
@Composable
fun BreadcrumbOverridesProvider(
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    val coordinator = remember { BreadcrumbOverridesCoordinator() }
    val overrides by coordinator.overrides.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { recordBreadcrumbOverridesContextOpened(logger) }

    CompositionLocalProvider(
        LocalBreadcrumbOverrides provides overrides,
        LocalBreadcrumbOverridesController provides coordinator,
        content = content,
    )
}

/**
 * Reads the merged breadcrumb-override map from the nearest [BreadcrumbOverridesProvider], or an empty map
 * when rendered outside one — the native analogue of the web `useBreadcrumbOverrides()`
 * (`useContext(...)?.overrides ?? {}`). The Layout breadcrumb calls this and forwards the map to its
 * breadcrumb builder so the single global slot can show rich page-supplied labels.
 */
@Composable
@ReadOnlyComposable
fun useBreadcrumbOverrides(): BreadcrumbOverrideMap = LocalBreadcrumbOverrides.current

/**
 * Registers [overrides] for the current page with the nearest [BreadcrumbOverridesProvider] for as long as
 * this composable is in the tree — the native analogue of the web `useSetBreadcrumbOverrides(map)`. A page
 * places this near its content (typically once an entity has loaded so the label is rich) to replace the
 * route's default breadcrumb label with a friendly one.
 *
 * Mirrors the web effect exactly: passing `null` registers nothing (web `serialised === ''` branch), and a
 * present map is registered and unregistered on dispose. The [DisposableEffect] is keyed on [overrides], whose
 * content-based map equality means a fresh-but-equal map literal does NOT re-register — the idiomatic Kotlin
 * equivalent of the web serialising the map with `JSON.stringify` to avoid redundant re-registration. Outside
 * any provider the controller resolves to [NoopBreadcrumbOverridesController], so registration is a safe no-op
 * (web `if (!ctx) return`).
 *
 * @param overrides the route-pattern -> label map to push up, or `null` to push nothing.
 */
@Composable
fun SetBreadcrumbOverrides(overrides: BreadcrumbOverrideMap?) {
    val controller = LocalBreadcrumbOverridesController.current ?: NoopBreadcrumbOverridesController
    DisposableEffect(controller, overrides) {
        if (overrides == null) {
            onDispose { }
        } else {
            val unregister = controller.register(overrides)
            onDispose(unregister)
        }
    }
}

// -- Previews (tooling-only; the sample breadcrumb labels are never shipped UI) ---------------------------

/** A logger that records nothing — keeps the @Preview render free of the [LocalDataContainer] dependency. */
private object PreviewLogger : Logger {
    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) = Unit
}

/** One sample crumb for the demo trail: a route pattern and the default label shown when no override exists. */
private data class DemoCrumb(
    val routePattern: String,
    val fallbackLabel: String,
)

private val DEMO_TRAIL =
    listOf(
        DemoCrumb(routePattern = "/", fallbackLabel = "Dashboard"),
        DemoCrumb(routePattern = "/drives", fallbackLabel = "Drives"),
        DemoCrumb(routePattern = "/drives/:id", fallbackLabel = "Drive #4421"),
    )

/** The friendly label a loaded drive page would push up for the `/drives/:id` route in the override demo. */
private const val DEMO_OVERRIDE_LABEL = "Trip to the office"

private const val DEMO_SEPARATOR = "/"

/**
 * A minimal breadcrumb-trail consumer used only by the previews: it reads [useBreadcrumbOverrides] and renders
 * one label per crumb, resolving each through [resolveBreadcrumbLabel] (a present override wins over the
 * route's default). This demonstrates the context bridge driving the single global breadcrumb — the surface
 * itself renders no such trail (that is the separate Breadcrumbs component); the trail is here purely to make
 * the @Preview states visible. The trailing (current-page) crumb is emphasized, like the web `<Breadcrumbs>`.
 */
@Composable
private fun BreadcrumbTrailDemo(trail: List<DemoCrumb>) {
    val overrides = useBreadcrumbOverrides()
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        trail.forEachIndexed { index, crumb ->
            val isLast = index == trail.lastIndex
            if (index > 0) {
                Text(
                    text = DEMO_SEPARATOR,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = resolveBreadcrumbLabel(overrides, crumb.routePattern, crumb.fallbackLabel),
                style = MaterialTheme.typography.labelMedium,
                color = if (isLast) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Preview(name = "No overrides (route defaults)", showBackground = true)
@Composable
private fun BreadcrumbOverridesDefaultsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalBreadcrumbOverrides provides emptyMap()) {
            BreadcrumbTrailDemo(trail = DEMO_TRAIL)
        }
    }
}

@Preview(name = "With page override", showBackground = true)
@Composable
private fun BreadcrumbOverridesOverriddenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        // The full bridge end to end: the provider + a page registering its label + the consuming trail.
        BreadcrumbOverridesProvider(logger = PreviewLogger) {
            SetBreadcrumbOverrides(mapOf("/drives/:id" to DEMO_OVERRIDE_LABEL))
            BreadcrumbTrailDemo(trail = DEMO_TRAIL)
        }
    }
}

@Preview(name = "With page override (dark)", showBackground = true)
@Composable
private fun BreadcrumbOverridesOverriddenDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        BreadcrumbOverridesProvider(logger = PreviewLogger) {
            SetBreadcrumbOverrides(mapOf("/drives/:id" to DEMO_OVERRIDE_LABEL))
            BreadcrumbTrailDemo(trail = DEMO_TRAIL)
        }
    }
}
