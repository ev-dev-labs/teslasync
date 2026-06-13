// The native Jetpack Compose + Material 3 VehicleHeader feature view — a parity port of
// web/src/features/vehicles/components/vehicle-detail/VehicleHeader.tsx. The web component is the vehicle-detail
// page header: inside a GlassPanel, a back affordance, a status chip (a colored dot beside the raw status
// token), a neutral "model trim" chip, the monospace VIN, and a Wake action.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). Like the sibling DriveDetailHeader port —
// the other zero-data-source presentational header — it has no cache-then-network loading / error / stale /
// offline lifecycle of its own to render; modelling those would invent behaviour the web spec does not have
// (honesty covenant: no silent drift). What it genuinely varies is its content, and every derivation flows
// through the pure [VehicleHeaderProjection] (the status tone, the optional descriptor, the optional VIN); the
// composable below is a thin render layer that resolves the Wake label, maps the tone to a chip variant, and
// paints the projected strings. The back affordance, status chip, and Wake action render in every state, so the
// header is never a blank box even before the vehicle resolves.
//
// Decoupling: the web `<Link to="/vehicles">` and `onWake` become the [onBack] / [onWake] callbacks the host
// wires to its NavController + command runner — the view never touches navigation or commands directly,
// mirroring the DriveDetailHeader port.
//
// Token + component mapping (P1/S9 tokens, no ported Tailwind): the web `<GlassPanel className="p-6">` maps to
// [GlassPanel] (padding [PanelPadding.Lg]); the flex row to a Material [Row] (`gap-4` ⇒ [Spacing.lg]); the
// wrapping badge row (web `flex-wrap`) to a [FlowRow] (`gap-3` ⇒ [Spacing.md]); the muted monospace VIN (web
// `text-sm text-[var(--text-muted)] font-mono`) to [CodeText], the sanctioned monospace role (the role layer has
// no muted-monospace variant, and hand-rolling one would breach the typography rule, so the salient monospace
// trait is preserved). The Wake action maps to the primary [Button] with a `Power` leading icon and a `loading`
// spinner driven by [waking] (web `<Button loading={waking} icon={<Power/>}>`). The back affordance uses the
// locally-authored `ArrowLeft` glyph (web lucide `ArrowLeft`) and is labeled for TalkBack with the real
// `common.back` catalog key. `FadeIn` wraps the panel for the page-template entrance motion and honors reduced
// motion (accessibility).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleHeader — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehicleheader

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point for the vehicle-detail header. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), projects the raw [data] into the render-ready model, and renders it. The surface binds no data of
 * its own; the back / wake affordances emit through [onBack] / [onWake] (web `<Link to="/vehicles">` / `onWake`),
 * which the host routes.
 *
 * @param data the loaded header inputs (web `vehicle` + derived `status`).
 * @param onBack invoked by the back affordance (web `<Link to="/vehicles">`); the host navigates.
 * @param onWake invoked by the Wake action (web `onWake`); the host issues the wake command.
 * @param waking whether a wake command is in flight (web `waking`) — drives the Wake button's loading spinner.
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
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web header inside a GlassPanel:
 * the back affordance, the identity block (status chip + optional "model trim" chip over the optional VIN), and
 * the Wake action. The back affordance, status chip, and Wake action remain present in every state, so the
 * header is never a blank box.
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
        GlassPanel(padding = PanelPadding.Lg) {
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
}

/**
 * The identity block — the web `<div className="flex-1">`: a wrapping chip row (the status chip, web
 * `<Badge dot>{status}</Badge>`, plus the optional "model trim" chip, web `<Badge variant="neutral">`) over the
 * optional monospace VIN. The status chip's leading dot is decorative (the token text carries the meaning). The
 * descriptor chip and VIN line are each omitted when absent so a not-yet-loaded vehicle never renders a blank
 * chip or a dangling line.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VehicleHeaderIdentity(
    model: VehicleHeaderUiModel,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Badge(text = model.statusLabel, variant = badgeVariant(model.statusTone), dot = true)
            val descriptor = model.descriptor
            if (descriptor != null) {
                Badge(text = descriptor, variant = BadgeVariant.Neutral)
            }
        }
        val vin = model.vin
        if (vin != null) {
            CodeText(vin)
        }
    }
}

/** Maps the framework-free [VehicleStatusTone] onto the shared [BadgeVariant] the chip is painted with. */
private fun badgeVariant(tone: VehicleStatusTone): BadgeVariant =
    when (tone) {
        VehicleStatusTone.Info -> BadgeVariant.Info
        VehicleStatusTone.Success -> BadgeVariant.Success
        VehicleStatusTone.Warning -> BadgeVariant.Warning
        VehicleStatusTone.Danger -> BadgeVariant.Danger
        VehicleStatusTone.Neutral -> BadgeVariant.Neutral
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
                        model = "Model 3",
                        trimBadging = "Long Range",
                        vin = "5YJ3E1EA7KF000001",
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
                        model = "Model Y",
                        trimBadging = "Performance",
                        vin = "7SAYGDEF9NF000002",
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
                    VehicleHeaderData(model = null, trimBadging = null, vin = null, status = "offline"),
                ),
            onBack = {},
            onWake = {},
            waking = false,
        )
    }
}
