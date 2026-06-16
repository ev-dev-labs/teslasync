// Pure, framework-free model + projections for the RoadmapPage system surface — the native analogue of everything
// the web page derives before composing its panels (web/src/features/system/pages/RoadmapPage.tsx, the product
// roadmap mounted at /roadmap). No Compose, no Android framework, no HTTP lives here: every declaration is plain
// Kotlin, so the catalog grouping, the per-phase tallies, and the empty/success projection are exercised off-device
// and the composable stays a thin render layer.
//
// The web page renders from a hardcoded, inline `roadmapItems` array — it reads no API. This port mirrors that
// exactly: the catalog is a static, ordered list of [RoadmapEntry] (a stable [RoadmapItemId] + its [RoadmapPhase]),
// and the visible copy (titles, descriptions, feature bullets, icons) is resolved at the render boundary from the
// platform string catalog + the page glyph set — never hardcoded here. [buildRoadmapSnapshot] reproduces the web's
// two derivations: the four-phase progress tally (web maps over every phase, including empty ones) and the
// per-phase card sections (web drops a phase whose `items.length === 0`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace
// uses, so the package intentionally diverges from the path — exactly as the sibling system / dashboard page
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.roadmap

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical metadata for the RoadmapPage surface. The web page is a top-level system route that renders only its
 * static catalog, so this object carries just the cross-cutting concerns the surface owes: the navigation
 * [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only destination at Destinations.kt
 * `page("roadmap", "/roadmap", NavGroup.System)`) and the diagnostics [SLUG] emitted with the one-shot
 * `view.opened` event (P1/S11). There is no feed metadata because the page reads no data of its own.
 */
object RoadmapPageRegistration {
    /** The navigation destination id (Destinations.kt `page("roadmap", "/roadmap", NavGroup.System)`). */
    const val ROUTE_ID: String = "roadmap"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/roadmap"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RoadmapPage"
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no roadmap content. */
internal fun recordRoadmapPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to RoadmapPageRegistration.SLUG))
}

/**
 * A roadmap delivery phase — the web `RoadmapPhase` union (`done` | `current` | `next` | `future`). Declared in
 * the canonical display order the web `phases` array fixes, so [canonicalPhaseOrder] (and therefore both the
 * progress tally and the card sections) always reads done → current → next → future.
 */
enum class RoadmapPhase { Done, Current, Next, Future }

/** The phases in the web's fixed display order (`['done', 'current', 'next', 'future']`). */
val canonicalPhaseOrder: List<RoadmapPhase> = listOf(
    RoadmapPhase.Done,
    RoadmapPhase.Current,
    RoadmapPhase.Next,
    RoadmapPhase.Future,
)

/**
 * A stable identity for one roadmap catalog entry — the web `roadmapItems[i]` row. It carries no copy itself; the
 * render boundary maps each id to its localized title/description/feature strings + glyph (web `RoadmapEntry`),
 * keeping this model free of Android resources and Compose types so it is unit-testable off-device.
 */
enum class RoadmapItemId {
    CorePlatform,
    SmartNotifications,
    Intelligence,
    FleetTelemetry,
    PremiumUi,
    ExternalIntegrations,
    EnhancedVisualization,
    Helix,
    Enterprise,
    MobileApp,
    AdvancedFleet,
    SmartRouting,
    Security,
    SmartHome,
    Community,
    DeveloperPlatform,
    Global,
}

/**
 * One catalog entry: a stable [id] and the [phase] it belongs to — the native analogue of a web `roadmapItems`
 * row reduced to the two fields this layer derives over (the visible copy is resolved at render).
 */
data class RoadmapEntry(
    val id: RoadmapItemId,
    val phase: RoadmapPhase,
)

/**
 * The static roadmap catalog, in the web's exact declaration order
 * (web/src/features/system/pages/RoadmapPage.tsx `roadmapItems`). The page reads no API, so this fixed list is the
 * single source of truth — mirrored verbatim from the web page (5 done, 1 current, 2 next, 9 future).
 */
val roadmapCatalog: List<RoadmapEntry> = listOf(
    RoadmapEntry(RoadmapItemId.CorePlatform, RoadmapPhase.Done),
    RoadmapEntry(RoadmapItemId.SmartNotifications, RoadmapPhase.Done),
    RoadmapEntry(RoadmapItemId.Intelligence, RoadmapPhase.Done),
    RoadmapEntry(RoadmapItemId.FleetTelemetry, RoadmapPhase.Done),
    RoadmapEntry(RoadmapItemId.PremiumUi, RoadmapPhase.Done),
    RoadmapEntry(RoadmapItemId.ExternalIntegrations, RoadmapPhase.Current),
    RoadmapEntry(RoadmapItemId.EnhancedVisualization, RoadmapPhase.Next),
    RoadmapEntry(RoadmapItemId.Helix, RoadmapPhase.Next),
    RoadmapEntry(RoadmapItemId.Enterprise, RoadmapPhase.Future),
    RoadmapEntry(RoadmapItemId.MobileApp, RoadmapPhase.Future),
    RoadmapEntry(RoadmapItemId.AdvancedFleet, RoadmapPhase.Future),
    RoadmapEntry(RoadmapItemId.SmartRouting, RoadmapPhase.Future),
    RoadmapEntry(RoadmapItemId.Security, RoadmapPhase.Future),
    RoadmapEntry(RoadmapItemId.SmartHome, RoadmapPhase.Future),
    RoadmapEntry(RoadmapItemId.Community, RoadmapPhase.Future),
    RoadmapEntry(RoadmapItemId.DeveloperPlatform, RoadmapPhase.Future),
    RoadmapEntry(RoadmapItemId.Global, RoadmapPhase.Future),
)

/**
 * One phase's count for the progress bar (GlassPanel1). Every phase gets a tally — including a zero one — because
 * the web progress bar maps over the full `phases` array regardless of how many items each holds.
 *
 * @property phase the delivery phase.
 * @property count how many catalog entries sit in [phase].
 */
data class RoadmapPhaseTally(
    val phase: RoadmapPhase,
    val count: Int,
)

/**
 * One non-empty phase section for the card grid (GlassPanel2) — a [phase] and its ordered [entries]. The web
 * renders a phase section only when it has at least one item (`if (items.length === 0) return null`), so empty
 * phases never produce a group here (they still appear in the [RoadmapPhaseTally] list above).
 */
data class RoadmapPhaseGroup(
    val phase: RoadmapPhase,
    val entries: List<RoadmapEntry>,
)

/**
 * The immutable success surface the ViewModel exposes and the page renders. [tallies] drives the four-phase
 * progress bar (always all phases); [groups] drives the per-phase card sections (only non-empty phases). The page
 * is [isEmpty] only when the catalog yields no card section at all (web: nothing to render) — the empty-state seam
 * the parity gate requires.
 */
data class RoadmapSnapshot(
    val tallies: List<RoadmapPhaseTally>,
    val groups: List<RoadmapPhaseGroup>,
) {
    /** True when there is no card section to show — the empty-data surface (web renders an empty list). */
    val isEmpty: Boolean get() = groups.isEmpty()

    /** Total catalog entries across all phases (web `roadmapItems.length`). */
    val total: Int get() = tallies.sumOf { it.count }
}

/**
 * Derive the [RoadmapSnapshot] from a [catalog] — the native analogue of the web page's two derivations: the
 * per-phase `count` the progress bar shows for every phase, and the per-phase `items` sections (dropping any phase
 * with zero items). Both read in [canonicalPhaseOrder] so the surface is stable. Pure, so the grouping contract is
 * unit-tested without Android.
 */
fun buildRoadmapSnapshot(catalog: List<RoadmapEntry> = roadmapCatalog): RoadmapSnapshot {
    val tallies =
        canonicalPhaseOrder.map { phase ->
            RoadmapPhaseTally(phase = phase, count = catalog.count { it.phase == phase })
        }
    val groups =
        canonicalPhaseOrder.mapNotNull { phase ->
            catalog.filter { it.phase == phase }.takeIf { it.isNotEmpty() }?.let { entries ->
                RoadmapPhaseGroup(phase = phase, entries = entries)
            }
        }
    return RoadmapSnapshot(tallies = tallies, groups = groups)
}

/**
 * Wrap a derived [snapshot] in a terminal cache-then-network [Resource.Success] so the page renders through the
 * same lifecycle-aware [io.teslasync.android.data.UiState] surface every parity page uses (loading → empty →
 * success), even though the catalog is static and never errors. [fetchedAt] stamps the synthetic load. Pure.
 */
fun roadmapSnapshotResource(
    snapshot: RoadmapSnapshot,
    fetchedAt: Long,
): Resource<RoadmapSnapshot> = Resource.Success(data = snapshot, fetchedAt = fetchedAt, stale = false)
