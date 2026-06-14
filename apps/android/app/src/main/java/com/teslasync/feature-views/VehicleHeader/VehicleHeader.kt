// The native Jetpack Compose + Material 3 VehicleHeader feature view — a parity port of
// web/src/features/vehicles/components/VehicleHeader.tsx. The web component is the vehicle-detail page header:
// inside a `FadeIn`, a back affordance, an identity block (a bold title beside a `StatusBadge`, over a muted
// "model trim · VIN" subtitle whose VIN is monospace), and a Wake action.
//
// This port keeps that contract end to end. The view performs NO HTTP. Two entry points are offered: a
// state-holder-bound [VehicleHeader] that binds the shared [VehicleDetailViewModel] (the P1/S8 `useVehicles`
// detail + state feeds and the `useWakeVehicle` command runner) and adapts its cached flows through the pure
// [VehicleHeaderAdapter]; and a decoupled [VehicleHeader] overload that takes already-adapted [VehicleHeaderData]
// plus `onBack`/`onWake` callbacks the host wires to its NavController + command runner — mirroring the sibling
// DriveDetailHeader port, the view never touches navigation or commands directly. Every content derivation flows
// through the pure [VehicleHeaderProjection] (the title, the status token, the optional descriptor, the optional
// VIN); [VehicleHeaderContent] is a thin render layer that resolves the i18n title/Wake strings and paints the
// projected strings. The back affordance, the title, the status chip, and the Wake action render in every state,
// so the header is never a blank box even before the vehicle resolves.
//
// Token + component mapping (P1/S9 tokens, no ported Tailwind): the web `<FadeIn>` maps to [FadeIn] (entrance
// motion that honors reduced motion); the flex row (`gap-4`) to a Material [Row] (`Spacing.lg`); the bold
// `text-3xl` `h1` to the [Heading] Page role (capped at one line so a long name never dominates the header on a
// phone); the `<StatusBadge>` to the shared [StatusBadge] (which derives its own dot + capitalization); the muted
// `text-sm` subtitle (`model trim · vin`) to a [HelperText] descriptor + a "·" separator + the monospace VIN as
// [CodeText] (the sanctioned monospace role — the role layer has no muted-monospace variant, so the salient
// monospace trait is preserved). The Wake action maps to the primary [Button] with a `Power` leading icon and a
// `loading` spinner driven by [waking] (web `<Button loading={waking} icon={<Power/>}>`). The back affordance uses
// the locally-authored `ArrowLeft` glyph (web lucide `ArrowLeft`) and is labeled for TalkBack with the real
// `common.back` catalog key.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleHeader — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehicleheader

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.vehicles.VehicleDetailViewModel
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** One-line title cap — keeps a long display name from dominating the header on a phone. */
private const val TITLE_MAX_LINES: Int = 1

/** The middot the web subtitle places between the "model trim" descriptor and the VIN (`model trim · vin`). */
private const val SUBTITLE_SEPARATOR: String = "·"

/**
 * State-holder-bound entry point. Binds the shared [VehicleDetailViewModel] (P1/S8) — the `useVehicles` detail +
 * state feeds and the `useWakeVehicle` confirm-then-run command — collecting each lifecycle-aware, adapting the
 * cached `vehicle` + `state` into the render-ready inputs via [VehicleHeaderAdapter], and delegating to the
 * decoupled [VehicleHeader] overload. The Wake action requests the ADR-013 confirm-then-run wake (the confirmation
 * dialog is the owning page's responsibility); [waking] reflects the command being in flight. The back affordance
 * emits through [onBack], which the host routes (web `<Link to="/vehicles">`).
 *
 * @param viewModel the shared vehicle-detail state holder (P1/S8).
 * @param onBack invoked by the back affordance; the host navigates.
 */
@Composable
fun VehicleHeader(
    viewModel: VehicleDetailViewModel,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val detail by viewModel.detail.collectAsStateWithLifecycle()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val wake by viewModel.wake.collectAsStateWithLifecycle()
    val data = remember(detail.data, state.data) { VehicleHeaderAdapter.from(detail.data, state.data) }
    VehicleHeader(
        data = data,
        onBack = onBack,
        onWake = viewModel::requestWake,
        waking = wake.isInFlight,
        modifier = modifier,
    )
}

/**
 * Decoupled entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), projects the adapted
 * [data] into the render-ready model, and renders it. The surface performs no HTTP; the back / wake affordances
 * emit through [onBack] / [onWake] (web `<Link to="/vehicles">` / `useWakeVehicle().mutate`), which the host routes.
 *
 * @param data the adapted header inputs (web `vehicle` + derived `status`).
 * @param onBack invoked by the back affordance (web `<Link to="/vehicles">`); the host navigates.
 * @param onWake invoked by the Wake action (web `handleWake`); the host issues the wake command.
 * @param waking whether a wake command is in flight (web `wakeMut.isPending`) — drives the Wake button spinner.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleHeader(
    data: VehicleHeaderData,
    onBack: () -> Unit,
    onWake: () -> Unit,
    waking: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { VehicleHeaderDiagnostics.recordViewOpened(logger) }
    val model = remember(data) { VehicleHeaderProjection.project(data) }
    VehicleHeaderContent(
        model = model,
        onBack = onBack,
        onWake = onWake,
        waking = waking,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web header row: the back
 * affordance, the identity block (the title + status chip over the optional "model trim · VIN" subtitle), and the
 * Wake action. The back affordance, the title, the status chip, and the Wake action remain present in every state,
 * so the header is never a blank box.
 */
@Composable
fun VehicleHeaderContent(
    model: VehicleHeaderUiModel,
    onBack: () -> Unit,
    onWake: () -> Unit,
    waking: Boolean,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            IconButton(
                imageVector = VehicleHeaderGlyphs.ArrowLeft,
                contentDescription = stringResource(R.string.translation_common_back),
                onClick = onBack,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            VehicleHeaderIdentity(model = model, modifier = Modifier.weight(1f))
            Button(
                label = stringResource(R.string.translation_common_wakeUp),
                onClick = onWake,
                loading = waking,
                leadingIcon = VehicleHeaderGlyphs.Power,
            )
        }
    }
}

/**
 * The identity block — the web `<div className="flex-1">`: the title row (the bold title, web
 * `display_name || vin || t('common.vehicle')`, beside the [StatusBadge]) over the muted "model trim · VIN"
 * subtitle. The title falls back to the `common.vehicle` catalog string when the vehicle has not loaded, so the
 * header always shows a heading and a status chip; the subtitle is omitted entirely when there is no descriptor
 * and no VIN so a not-yet-loaded vehicle never renders a dangling separator.
 */
@Composable
private fun VehicleHeaderIdentity(
    model: VehicleHeaderUiModel,
    modifier: Modifier = Modifier,
) {
    val title = model.title ?: stringResource(R.string.translation_common_vehicle)
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Heading(
                text = title,
                modifier = Modifier.weight(1f, fill = false),
                level = HeadingLevel.Page,
                maxLines = TITLE_MAX_LINES,
            )
            StatusBadge(status = model.status, size = ChipSize.Md)
        }
        VehicleHeaderSubtitle(descriptor = model.descriptor, vin = model.vin)
    }
}

/**
 * The muted subtitle — the web `<p className="text-sm text-muted">{model} {trim} · <span font-mono>{vin}</span></p>`:
 * the "model trim" [descriptor] in muted body text, a "·" separator when both parts are present, and the
 * monospace [vin]. Each part is omitted when absent, so the line collapses cleanly (and renders nothing at all)
 * for a not-yet-loaded vehicle rather than showing a dangling separator.
 */
@Composable
private fun VehicleHeaderSubtitle(
    descriptor: String?,
    vin: String?,
) {
    if (descriptor == null && vin == null) return
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (descriptor != null) {
            val prefix = if (vin != null) "$descriptor $SUBTITLE_SEPARATOR" else descriptor
            HelperText(text = prefix, modifier = Modifier.weight(1f, fill = false))
        }
        if (vin != null) {
            CodeText(text = vin)
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private fun previewModel(data: VehicleHeaderData): VehicleHeaderUiModel = VehicleHeaderProjection.project(data)

@Preview(name = "Loaded (online)", showBackground = true)
@Composable
private fun VehicleHeaderLoadedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeaderContent(
            model =
                previewModel(
                    VehicleHeaderData(
                        displayName = "My Model 3",
                        vin = "5YJ3E1EA7KF000001",
                        model = "Model 3",
                        trim = "Long Range",
                        status = "online",
                    ),
                ),
            onBack = {},
            onWake = {},
            waking = false,
        )
    }
}

@Preview(name = "Waking (charging)", showBackground = true)
@Composable
private fun VehicleHeaderWakingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeaderContent(
            model =
                previewModel(
                    VehicleHeaderData(
                        displayName = "",
                        vin = "7SAYGDEF9NF000002",
                        model = "Model Y",
                        trim = "Performance",
                        status = "charging",
                    ),
                ),
            onBack = {},
            onWake = {},
            waking = true,
        )
    }
}

@Preview(name = "Vehicle not yet loaded (offline)", showBackground = true)
@Composable
private fun VehicleHeaderUnloadedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeaderContent(
            model =
                previewModel(
                    VehicleHeaderData(displayName = null, vin = null, model = null, trim = null, status = "offline"),
                ),
            onBack = {},
            onWake = {},
            waking = false,
        )
    }
}
