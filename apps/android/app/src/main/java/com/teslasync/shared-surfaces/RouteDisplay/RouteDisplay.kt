// The native Jetpack Compose + Material 3 RouteDisplay shared surface — a parity port of
// web/src/components/data-display/RouteDisplay.tsx. The web surface is the generic, inline "From → To" /
// "↻ round trip" / single-location / "No location data" line used by every history-style row (Drives,
// Charging, Trips): an optional leading map-pin icon followed by one secondary-coloured, single-line label
// that truncates. It is pure presentational — the parent owns the two endpoints and the component's only
// hook is useTranslation.
//
// Every derivation flows through the pure [projectRouteDisplay] in RouteDisplayModel.kt; this composable is
// a thin render layer that resolves the two localized catalog strings (P1/S10), lays out the shared `Icon` +
// secondary label using the platform type ramp + spacing tokens (P1/S9), and fires the one-shot PII-safe
// `view.opened` diagnostic (P1/S11). It performs NO HTTP. The whole line is collapsed into a single
// accessibility node carrying the visible text (the icon is decorative), so a screen reader reads exactly
// the route line it sees — the same information the web `<div>`'s text content conveys to assistive tech.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RouteDisplay) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helper, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routedisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful port of the web `RouteDisplay`. Records the one-shot `view.opened`
 * diagnostic on first composition, then renders the route line for the [start] → [end] pair. Always renders
 * (the web component never returns `null`): a pair with no resolvable labels falls through to the single
 * "No location data" line. Performs no HTTP; [logger] defaults to the process logger.
 *
 * @param start the starting endpoint (web `start`); an address is preferred over a coordinate fallback.
 * @param end the ending endpoint (web `end`); `null` ⇒ a single-location read-out (no "round trip" phrase).
 * @param roundTripThresholdM metres below which start≈end counts as a round trip when only coordinates are
 *   available (web `roundTripThresholdM`, default 100 m).
 * @param showIcon whether to lead with the map-pin glyph (web `showIcon`, default `true`).
 */
@Composable
fun RouteDisplay(
    start: RouteEndpoint,
    modifier: Modifier = Modifier,
    end: RouteEndpoint? = null,
    roundTripThresholdM: Double = DEFAULT_ROUND_TRIP_THRESHOLD_M,
    showIcon: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { RouteDisplayDiagnostics.recordViewOpened(logger) }
    RouteDisplayContent(
        start = start,
        end = end,
        modifier = modifier,
        roundTripThresholdM = roundTripThresholdM,
        showIcon = showIcon,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reduces the endpoints
 * into a [RouteDisplayProjection], resolves the two localized catalog strings, and draws the optional map-pin
 * glyph + the single-line secondary label, collapsing the row into one accessibility node that speaks the
 * visible line (the icon is decorative, web `aria-hidden`). Carries no diagnostics, so a parent rendering
 * many rows in a list never emits per-item events.
 */
@Composable
fun RouteDisplayContent(
    start: RouteEndpoint,
    modifier: Modifier = Modifier,
    end: RouteEndpoint? = null,
    roundTripThresholdM: Double = DEFAULT_ROUND_TRIP_THRESHOLD_M,
    showIcon: Boolean = true,
) {
    val strings = rememberRouteDisplayStrings()
    val projection =
        remember(start, end, roundTripThresholdM, strings) {
            projectRouteDisplay(start, end, roundTripThresholdM, strings)
        }
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = projection.text },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (showIcon) {
            Icon(
                DataDisplayGlyphs.MapPin,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = projection.text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * Builds the localized [RouteDisplayStrings] from the P1/S10 catalog (web `route.noLocationData` /
 * `route.roundTrip`); tests pass a deterministic instance so no English literal lives in this file.
 */
@Composable
private fun rememberRouteDisplayStrings(): RouteDisplayStrings =
    RouteDisplayStrings(
        noLocationData = stringResource(R.string.translation_route_noLocationData),
        roundTrip = stringResource(R.string.translation_route_roundTrip),
    )

// ── Previews — one per rendered branch (no-location / point-to-point / matched round trip / nearby-coords
// round trip / single location), plus a dark variant. ────────────────────────────────────────────────────

@Preview(name = "RouteDisplay · no location", showBackground = true)
@Composable
private fun RouteDisplayNoLocationPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteDisplayContent(start = RouteEndpoint())
    }
}

@Preview(name = "RouteDisplay · point to point", showBackground = true)
@Composable
private fun RouteDisplayPointToPointPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteDisplayContent(start = RouteEndpoint(address = "Home"), end = RouteEndpoint(address = "Office"))
    }
}

@Preview(name = "RouteDisplay · round trip (addresses)", showBackground = true)
@Composable
private fun RouteDisplayRoundTripPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteDisplayContent(start = RouteEndpoint(address = "Home"), end = RouteEndpoint(address = "Home"))
    }
}

@Preview(name = "RouteDisplay · round trip (coords)", showBackground = true)
@Composable
private fun RouteDisplayCoordsRoundTripPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteDisplayContent(
            start = RouteEndpoint(lat = 47.71, lon = -122.18),
            end = RouteEndpoint(lat = 47.71, lon = -122.18),
        )
    }
}

@Preview(name = "RouteDisplay · single location", showBackground = true)
@Composable
private fun RouteDisplaySingleLocationPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteDisplayContent(start = RouteEndpoint(address = "Supercharger Costco"))
    }
}

@Preview(name = "RouteDisplay · point to point (dark)", showBackground = true)
@Composable
private fun RouteDisplayDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        RouteDisplayContent(
            start = RouteEndpoint(address = "Home"),
            end = RouteEndpoint(),
            showIcon = false,
        )
    }
}
