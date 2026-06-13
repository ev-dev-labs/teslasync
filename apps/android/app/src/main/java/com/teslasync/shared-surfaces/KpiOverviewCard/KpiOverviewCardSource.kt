// The single data seam the KpiOverviewCard shared surface binds to, plus its static factory — the native
// analogue of where the web component's props originate (web/src/components/data-display/KpiOverviewCard.tsx).
// The web card is presentational: its header, KPI tiles and secondary line are computed by the parent page
// (from the shared S8 stores: drives / charging / trips overviews) and handed in. This seam is that boundary,
// narrowed to the one projection the surface needs, so the view depends on an abstraction (a real adapter over
// the shared S8 layer in production, a fake in tests) and performs NO HTTP itself (the P1/S8 boundary, ADR-002).
//
// A [Flow] — not a plain value — because an overview is genuinely live: a host re-emits when the period
// selection changes or a new drive / charge lands, and the card's tiles update in place. The common case (a
// fixed, already-computed overview) is covered by [staticKpiOverviewCardSource], which emits once.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/KpiOverviewCard) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.kpioverviewcard

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * The seam the [KpiOverviewCardViewModel] binds to so it depends on an abstraction (a real overview adapter ↔ a
 * test fake), never on a concrete store or the network. [overview] streams the card's current [KpiOverviewData];
 * it re-emits whenever a data-derived field (the period, a tile value, the secondary summary) changes. No HTTP
 * touches the view.
 */
fun interface KpiOverviewCardSource {
    /** Streams the card's current overview projection; re-emits on every change (period / tile / summary). */
    fun overview(): Flow<KpiOverviewData>
}

/**
 * Builds a [KpiOverviewCardSource] that emits a fixed [data] once — the production seam for an already-computed
 * overview. A host with a live overview implements [KpiOverviewCardSource] directly so its flow re-emits; a test
 * fake does the same.
 */
fun staticKpiOverviewCardSource(data: KpiOverviewData): KpiOverviewCardSource = KpiOverviewCardSource { flowOf(data) }
