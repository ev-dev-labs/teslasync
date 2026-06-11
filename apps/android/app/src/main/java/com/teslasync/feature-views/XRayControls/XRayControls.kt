// The native Jetpack Compose + Material 3 Ingest X-Ray controls feature view — a parity port of
// web/src/features/admin/components/ingest-xray/XRayControls.tsx. The web component is a controlled controls
// bar: it receives the fleet `vehicles`, the current `vehicleId` / `windowSel` / `bucketSel`, and three change
// callbacks, and renders three `Select`s constrained to the server-accepted literals so a typo never
// round-trips a 400. The bucket select auto-disables any bucket whose span is >= the current window (the
// server-side "bucket >= window" guard).
//
// The native surface keeps that contract. Its only web hook is `useTranslation`, mapped here to the i18n
// catalog (P1/S10); it performs NO HTTP and binds no feed of its own — the fleet `vehicles` arrive through the
// shared state-holder layer (P1/S8) as a [UiState], exactly as the page parent would feed them. Because that
// layer carries a full lifecycle, the surface renders every state it can carry: a loading skeleton while the
// fleet list is first loading, a hard error with retry, the ready controls, an always-visible no-vehicles hint
// where the web simply shows the empty-selection row, and a stale/offline freshness chip (with auto-refresh)
// when cached vehicles are shown — never a blank box. A web-parity overload takes the `vehicles` list directly
// for hosts that already hold it.
//
// Per Android guidelines this is built from native primitives + design tokens (P1/S9), never ported Tailwind
// classes; the three web `aria-label`s become the Material field labels (the accessible name TalkBack reads).
// `view.opened` is emitted once via the sanctioned redacting logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/XRayControls — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xraycontrols

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val EM_DASH: String = "\u2014"
private val VEHICLE_FIELD_WIDTH: Dp = 240.dp
private val SELECTOR_FIELD_WIDTH: Dp = 150.dp
private val SELECT_SKELETON_HEIGHT: Dp = 56.dp

/**
 * Stateful entry point for the Ingest X-Ray controls bar. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [vehiclesState] the shared feature-view layer can carry. The
 * host owns the fleet feed (P1/S8) and supplies [onRetry]; this view never performs HTTP. The current
 * selections and change callbacks are controlled by the parent, mirroring the web component's props.
 *
 * @param vehiclesState the fleet list lifecycle projection (cached-then-network). `Loading`/`Error`/stale are
 *   reproduced for full state coverage; a host that already holds the list can use the web-parity overload.
 * @param onRetry re-runs the host's fleet load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun XRayControls(
    vehiclesState: UiState<List<XRayVehicle>>,
    vehicleId: Long?,
    windowSel: IngestXRayWindow,
    bucketSel: IngestXRayBucket,
    onVehicleChange: (Long?) -> Unit,
    onWindowChange: (IngestXRayWindow) -> Unit,
    onBucketChange: (IngestXRayBucket) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to XRayControlsRegistration.SLUG))
    }
    XRayControlsContent(
        vehiclesState = vehiclesState,
        vehicleId = vehicleId,
        windowSel = windowSel,
        bucketSel = bucketSel,
        onVehicleChange = onVehicleChange,
        onWindowChange = onWindowChange,
        onBucketChange = onBucketChange,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's controlled props (the host already holds the [vehicles]
 * list). Wraps the list in a ready [UiState] and offers no retry affordance, since there is no fetch behind it.
 * Records `view.opened` like the stateful entry.
 */
@Composable
fun XRayControls(
    vehicles: List<XRayVehicle>,
    vehicleId: Long?,
    windowSel: IngestXRayWindow,
    bucketSel: IngestXRayBucket,
    onVehicleChange: (Long?) -> Unit,
    onWindowChange: (IngestXRayWindow) -> Unit,
    onBucketChange: (IngestXRayBucket) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val phase = if (vehicles.isEmpty()) UiPhase.Empty else UiPhase.Content
    val state = remember(vehicles, phase) { UiState(phase = phase, data = vehicles) }
    XRayControls(
        vehiclesState = state,
        vehicleId = vehicleId,
        windowSel = windowSel,
        bucketSel = bucketSel,
        onVehicleChange = onVehicleChange,
        onWindowChange = onWindowChange,
        onBucketChange = onBucketChange,
        onRetry = {},
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Switches on the host lifecycle: a
 * loading skeleton, a hard-error retry surface, or — when ready — an optional freshness chip (only while
 * refreshing/stale/offline) above the three selects, plus an always-visible no-vehicles hint when the fleet is
 * empty. Stale (non-error) data auto-refreshes, mirroring the shared freshness contract.
 */
@Composable
fun XRayControlsContent(
    vehiclesState: UiState<List<XRayVehicle>>,
    vehicleId: Long?,
    windowSel: IngestXRayWindow,
    bucketSel: IngestXRayBucket,
    onVehicleChange: (Long?) -> Unit,
    onWindowChange: (IngestXRayWindow) -> Unit,
    onBucketChange: (IngestXRayBucket) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: XRayControlsStrings = rememberXRayControlsStrings(),
    windowLabel: (IngestXRayWindow) -> String = rememberWindowLabelResolver(),
    bucketLabel: (IngestXRayBucket) -> String = rememberBucketLabelResolver(),
) {
    LaunchedEffect(vehiclesState.stale, vehiclesState.refreshing, vehiclesState.hasError) {
        if (vehiclesState.stale && !vehiclesState.refreshing && !vehiclesState.hasError) onRetry()
    }
    val formatAge = rememberXRayFreshnessFormatter()

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        when (xrayControlsSurfaceFor(isLoading = vehiclesState.isLoading, isError = vehiclesState.isError)) {
            XRayControlsSurfaceState.Loading ->
                XRayControlsLoading(label = stringResource(R.string.translation_common_loading))

            XRayControlsSurfaceState.Error -> XRayControlsError(onRetry = onRetry)

            XRayControlsSurfaceState.Ready -> {
                val vehicles = vehiclesState.data ?: emptyList()
                if (vehiclesState.stale || vehiclesState.refreshing || vehiclesState.hasError) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        DataFreshness(
                            updatedAtMillis = vehiclesState.fetchedAt?.takeIf { it > 0 },
                            isFetching = vehiclesState.refreshing,
                            isStale = vehiclesState.stale,
                            isError = vehiclesState.hasError,
                            fetchingLabel = stringResource(R.string.translation_common_loading),
                            errorLabel = stringResource(R.string.translation_common_offline),
                            formatAge = formatAge,
                        )
                    }
                }
                XRayControlsRow(
                    vehicles = vehicles,
                    vehicleId = vehicleId,
                    windowSel = windowSel,
                    bucketSel = bucketSel,
                    onVehicleChange = onVehicleChange,
                    onWindowChange = onWindowChange,
                    onBucketChange = onBucketChange,
                    strings = strings,
                    windowLabel = windowLabel,
                    bucketLabel = bucketLabel,
                )
                if (!XRayControlsProjection.hasSelectableVehicles(vehicles)) {
                    HelperText(strings.noVehicles)
                }
            }
        }
    }
}

/** The three selects in a wrapping row — the native analogue of the web `flex flex-wrap items-center gap-4`. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun XRayControlsRow(
    vehicles: List<XRayVehicle>,
    vehicleId: Long?,
    windowSel: IngestXRayWindow,
    bucketSel: IngestXRayBucket,
    onVehicleChange: (Long?) -> Unit,
    onWindowChange: (IngestXRayWindow) -> Unit,
    onBucketChange: (IngestXRayBucket) -> Unit,
    strings: XRayControlsStrings,
    windowLabel: (IngestXRayWindow) -> String,
    bucketLabel: (IngestXRayBucket) -> String,
) {
    val vehicleOptions =
        remember(vehicles, strings.selectVehicle) {
            XRayControlsProjection.vehicleOptions(vehicles, strings.selectVehicle).toSelectOptions()
        }
    val windowOptions =
        remember(windowLabel) {
            XRayControlsProjection.windowOptions(windowLabel).toSelectOptions()
        }
    val bucketOptions =
        remember(windowSel, bucketLabel) {
            XRayControlsProjection.bucketOptions(windowSel, bucketLabel).toSelectOptions()
        }

    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Select(
            options = vehicleOptions,
            selectedValue = XRayControlsProjection.vehicleSelectedValue(vehicleId),
            onSelect = { onVehicleChange(XRayControlsProjection.parseVehicleSelection(it)) },
            label = strings.vehicleLabel,
            emptyLabel = strings.selectVehicle,
            modifier = Modifier.width(VEHICLE_FIELD_WIDTH),
        )
        Select(
            options = windowOptions,
            selectedValue = windowSel.wire,
            onSelect = { value -> IngestXRayWindow.fromWire(value)?.let(onWindowChange) },
            label = strings.windowLabel,
            modifier = Modifier.width(SELECTOR_FIELD_WIDTH),
        )
        Select(
            options = bucketOptions,
            selectedValue = bucketSel.wire,
            onSelect = { value -> IngestXRayBucket.fromWire(value)?.let(onBucketChange) },
            label = strings.bucketLabel,
            modifier = Modifier.width(SELECTOR_FIELD_WIDTH),
        )
    }
}

/** First-load skeleton — three field-shaped bars so the controls bar is never blank while the fleet loads. */
@Composable
private fun XRayControlsLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = SELECT_SKELETON_HEIGHT, rounded = true)
        Skeleton(height = SELECT_SKELETON_HEIGHT, rounded = true)
        Skeleton(height = SELECT_SKELETON_HEIGHT, rounded = true)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun XRayControlsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Maps the pure [XRayOption]s onto the shared [Select]'s [SelectOption] (value / label / enabled) contract. */
private fun List<XRayOption>.toSelectOptions(): List<SelectOption> =
    map { SelectOption(value = it.value, label = it.label, enabled = it.enabled) }

/**
 * Builds the localized [XRayControlsStrings]. The four control keys exist in the catalog and resolve through
 * compile-time resources; the no-vehicles hint resolves by-name with the web `t(key, default)` fallback, since
 * the web has no empty branch and so no catalog key. Remembered against the resolved strings so a locale change
 * re-projects.
 */
@Composable
private fun rememberXRayControlsStrings(): XRayControlsStrings {
    val context = LocalContext.current
    val vehicleLabel = stringResource(R.string.translation_admin_xray_controls_vehicleAria)
    val windowLabel = stringResource(R.string.translation_admin_xray_controls_windowAria)
    val bucketLabel = stringResource(R.string.translation_admin_xray_controls_bucketAria)
    val selectVehicle = stringResource(R.string.translation_admin_xray_controls_selectVehicle)
    val noVehicles = resolveOptional({ context.optionalString(it) }, KEY_NO_VEHICLES, XRayControlsDefaults.NO_VEHICLES)
    return remember(vehicleLabel, windowLabel, bucketLabel, selectVehicle, noVehicles) {
        XRayControlsStrings(
            vehicleLabel = vehicleLabel,
            windowLabel = windowLabel,
            bucketLabel = bucketLabel,
            selectVehicle = selectVehicle,
            noVehicles = noVehicles,
        )
    }
}

/**
 * The window option-label resolver — web `t(\`admin.xray.windowOption.${'$'}{w}\`, w)`. The catalog defines no
 * option key, so each label resolves by-name and falls back to the wire token, reproducing the web default.
 */
@Composable
private fun rememberWindowLabelResolver(): (IngestXRayWindow) -> String {
    val context = LocalContext.current
    return remember(context) {
        { window -> resolveOptional({ context.optionalString(it) }, windowOptionKey(window), window.wire) }
    }
}

/** The bucket option-label resolver — web `t(\`admin.xray.bucketOption.${'$'}{b}\`, b)`, wire-token fallback. */
@Composable
private fun rememberBucketLabelResolver(): (IngestXRayBucket) -> String {
    val context = LocalContext.current
    return remember(context) {
        { bucket -> resolveOptional({ context.optionalString(it) }, bucketOptionKey(bucket), bucket.wire) }
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`), with an explicit
 * [Locale] so the numeric substitution is locale-correct.
 */
@Composable
private fun rememberXRayFreshnessFormatter(): (FreshnessAge) -> String {
    val locale = currentLocale()
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(locale, justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(locale, age.value)
                is FreshnessAge.Minutes -> minutes.format(locale, age.value)
                is FreshnessAge.Hours -> hours.format(locale, age.value)
                is FreshnessAge.Days -> days.format(locale, age.value)
                is FreshnessAge.Weeks -> weeks.format(locale, age.value)
            }
        }
    }
}

/** The active configuration [Locale] (the first in the locale list), falling back to the JVM default. */
@Composable
private fun currentLocale(): Locale {
    val configuration = LocalConfiguration.current
    return if (configuration.locales.isEmpty) Locale.getDefault() else configuration.locales[0]
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed.
 * Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; @Preview entry points exercise each render surface) ──────────────────────────────

private val PREVIEW_VEHICLES =
    listOf(
        XRayVehicle(id = 1, displayName = "Garage Model 3", vin = "5YJ3E1EA7KF000001"),
        XRayVehicle(id = 2, displayName = null, vin = "5YJSA1E26JF000002"),
        XRayVehicle(id = 3, displayName = null, vin = null),
    )

@Preview(name = "Ready", showBackground = true)
@Composable
private fun XRayControlsReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayControlsContent(
            vehiclesState = UiState(phase = UiPhase.Content, data = PREVIEW_VEHICLES),
            vehicleId = 1,
            windowSel = IngestXRayWindow.W1H,
            bucketSel = IngestXRayBucket.B5M,
            onVehicleChange = {},
            onWindowChange = {},
            onBucketChange = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Empty (no vehicles)", showBackground = true)
@Composable
private fun XRayControlsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayControlsContent(
            vehiclesState = UiState(phase = UiPhase.Empty, data = emptyList()),
            vehicleId = null,
            windowSel = IngestXRayWindow.W5M,
            bucketSel = IngestXRayBucket.B30S,
            onVehicleChange = {},
            onWindowChange = {},
            onBucketChange = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun XRayControlsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayControlsContent(
            vehiclesState = UiState.loading(),
            vehicleId = null,
            windowSel = IngestXRayWindow.W5M,
            bucketSel = IngestXRayBucket.B30S,
            onVehicleChange = {},
            onWindowChange = {},
            onBucketChange = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun XRayControlsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayControlsContent(
            vehiclesState = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            vehicleId = null,
            windowSel = IngestXRayWindow.W5M,
            bucketSel = IngestXRayBucket.B30S,
            onVehicleChange = {},
            onWindowChange = {},
            onBucketChange = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Offline (stale)", showBackground = true)
@Composable
private fun XRayControlsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayControlsContent(
            vehiclesState =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_VEHICLES,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            vehicleId = 2,
            windowSel = IngestXRayWindow.W24H,
            bucketSel = IngestXRayBucket.B1H,
            onVehicleChange = {},
            onWindowChange = {},
            onBucketChange = {},
            onRetry = {},
        )
    }
}
