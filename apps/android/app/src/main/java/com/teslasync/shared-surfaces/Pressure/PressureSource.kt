// The single data seam the Pressure shared surface binds to, plus its factories — the native analogue of the
// web component's `useUnits()` hook (web/src/components/data-display/format/Pressure.tsx via
// web/src/hooks/useUnits.ts). The web `Pressure` reads the user's live pressure preference from `useUnits`;
// this seam is that boundary, narrowed to the one thing the surface needs — the resolved [UnitFormatter]
// (the SI → display unit formatter the `DataContainer` derives from `settingsStore`, the web `useUnits`
// port). The view depends on this abstraction (a real adapter over the shared S8 layer in production, a fake
// in tests) and performs NO HTTP itself (the P1/S8 boundary, ADR-002).
//
// A [Flow] — not a plain value — because the preference is genuinely live: when the user switches bar ↔ psi
// in settings the formatter re-emits and every mounted Pressure value re-renders in the new unit. The common
// case (a fixed formatter for a preview or test) is covered by [staticPressureSource], which emits once;
// production binds the container's live `unitFormatter` through [dataContainerUnitsSource].
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/Pressure) cannot form a valid Kotlin package; `ktlint:standard:filename` /
// `MatchingDeclarationName` are suppressed for the co-located factories alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pressure

import io.teslasync.android.data.DataContainer
import io.teslasync.android.data.UnitFormatter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * The seam the [PressureViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake), never
 * on a concrete store or the network — the Android analogue of the web `useUnits` boundary (the P1/S8
 * state-holder boundary for this surface). [units] streams the current [UnitFormatter]; it re-emits whenever
 * the user's display-unit preference changes. No HTTP touches the view.
 */
fun interface PressureSource {
    /** Streams the live display-unit formatter; re-emits on every unit-preference change. */
    fun units(): Flow<UnitFormatter>
}

/**
 * Builds a [PressureSource] that emits a fixed [formatter] once — the seam for a preview, a test, or any
 * placement whose units never change. Production binds the live preference through [dataContainerUnitsSource].
 */
fun staticPressureSource(formatter: UnitFormatter): PressureSource = PressureSource { flowOf(formatter) }

/**
 * Binds the [PressureSource] to the process [DataContainer]'s live `unitFormatter` — the shared S8 formatter
 * derived from `settingsStore` (the web `useUnits` port). This is the production seam: a settings unit change
 * flows through `settingsStore` → `unitFormatter` → here → the surface, with no HTTP in the view.
 */
fun dataContainerUnitsSource(container: DataContainer): PressureSource = PressureSource { container.unitFormatter }
