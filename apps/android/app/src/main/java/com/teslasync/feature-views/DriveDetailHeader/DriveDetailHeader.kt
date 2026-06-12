// The native Jetpack Compose + Material 3 DriveDetailHeader feature view — a parity port of
// web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx. The web component is a presentational
// drive-detail page header: a back affordance, a title (a Route glyph beside either the "startAddress →
// endAddress" route or the localized "Drive Details" fallback), a muted subtitle ("vehicleName · date · time TZ
// [→ endTime]" rendered in the vehicle's local time), and a Replay + Share action pair.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the P1/S10 i18n catalog). Like the sibling QuickNav port — the other
// zero-data-source presentational surface — it has no loading / error / stale / offline lifecycle to render;
// modelling those would invent behaviour the web spec does not have (honesty covenant: no silent drift). What it
// genuinely varies is its content, and every derivation flows through the pure [DriveDetailHeaderProjection]
// (the route-vs-fallback title, the assembled subtitle, the optional end-time tail); the composable below is a
// thin render layer that resolves the i18n title fallback and paints the projected strings.
//
// Decoupling: the web `<Link to="/drives">` / `<Link to="/drives/{id}/replay">` / `onShare` become the
// [onBack] / [onReplay] / [onShare] callbacks the host wires to its NavController — the view never touches
// navigation directly, mirroring the QuickNav port.
//
// Token + component mapping (P1/S9 tokens, no ported Tailwind): the web flex row maps to a Material [Row]; the
// `h1` title maps to the [Heading] Page role (web `text-2xl font-bold`); the `--text-muted` subtitle maps to
// [HelperText] (`onSurfaceVariant`); the cyan Route glyph (web `text-cyan-400`) maps to `TeslaTokens.status.info`
// (the brand cyan), never a hand-picked hex. Two documented, intentional glyph substitutions — the vendored
// components layer (out of scope here, P3 component-library bundle) ships no left-arrow or share glyph, so the
// back affordance uses `TeslaGlyphs.ChevronLeft` (web lucide `ArrowLeft`) and Share uses
// `DataDisplayGlyphs.ExternalLink` (web lucide `Share2`); the title `MapsGlyphs.Route` and Replay
// `DataDisplayGlyphs.Play` map 1:1. The web `gap-4` row spacing maps to `Spacing.sm`, a compact phone-first
// adaptation. Date/time are formatted through the pure projection's localized java.time formatters.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DriveDetailHeader — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivedetailheader

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** One-line title, two-line wrap cap — keeps a long "start → end" route from dominating the header on a phone. */
private const val TITLE_MAX_LINES: Int = 2

/**
 * Stateful entry point for the drive-detail header. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), projects the raw [data] into the render-ready model, and renders it. The surface binds no data of
 * its own; the back / replay / share affordances emit through [onBack] / [onReplay] / [onShare] (web
 * `<Link to="/drives">` / `<Link to="/drives/{id}/replay">` / `onShare`), which the host routes.
 *
 * Timezone parity: the owning page resolves the vehicle's IANA [zone] (mirroring the web `<DateTime in="vehicle">`
 * provider that lives outside this surface's data sources) and hands it in; [zone]/[locale] default to the device
 * values so the header renders correctly even before a host overrides them.
 *
 * @param data the loaded drive-header inputs (web `drive` + `driveId` + `vehicleName`).
 * @param onBack invoked by the back affordance (web `<Link to="/drives">`); the host navigates.
 * @param onReplay invoked by the Replay action (web `<Link to="/drives/{driveId}/replay">`); the host navigates.
 * @param onShare invoked by the Share action (web `onShare`).
 * @param zone the vehicle timezone the timestamps render in; defaults to the device zone.
 * @param locale the formatting locale; defaults to the device locale.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveDetailHeader(
    data: DriveHeaderData,
    onBack: () -> Unit,
    onReplay: () -> Unit,
    onShare: () -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DriveDetailHeaderDiagnostics.recordViewOpened(logger) }
    val model = remember(data, zone, locale) { DriveDetailHeaderProjection.project(data, zone, locale) }
    DriveDetailHeaderContent(
        model = model,
        onBack = onBack,
        onReplay = onReplay,
        onShare = onShare,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web header row: the back
 * affordance, the Route-glyph title (the projected [DriveHeaderUiModel.routeTitle], or the localized
 * `driveDetail.title` fallback when the drive has no start/end address — web `start && end ? … : t(...)`), the
 * muted subtitle (rendered only when non-empty so the surface is never a dangling separator), and the Replay +
 * Share actions. The back affordance, title, and subtitle remain present in every state, so the header is never
 * a blank box.
 */
@Composable
fun DriveDetailHeaderContent(
    model: DriveHeaderUiModel,
    onBack: () -> Unit,
    onReplay: () -> Unit,
    onShare: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = model.routeTitle ?: stringResource(R.string.translation_driveDetail_title)
    FadeIn(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            IconButton(
                imageVector = TeslaGlyphs.ChevronLeft,
                contentDescription = stringResource(R.string.translation_common_back),
                onClick = onBack,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            DriveHeaderTitleBlock(title = title, subtitle = model.subtitle, modifier = Modifier.weight(1f))
            Button(
                label = stringResource(R.string.translation_driveDetail_replay),
                onClick = onReplay,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = DataDisplayGlyphs.Play,
            )
            Button(
                label = stringResource(R.string.translation_driveDetail_share),
                onClick = onShare,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = DataDisplayGlyphs.ExternalLink,
            )
        }
    }
}

/**
 * The title + subtitle column — the web `<div className="flex-1">` block: an `h1` (a cyan Route glyph beside the
 * [title]) over the muted [subtitle]. The Route glyph is decorative (the title text carries the meaning), so it
 * exposes no content description; the subtitle line is omitted when blank so a degenerate drive never renders a
 * dangling separator.
 */
@Composable
private fun DriveHeaderTitleBlock(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = MapsGlyphs.Route,
                contentDescription = null,
                size = IconSize.Xl,
                tint = TeslaTokens.status.info,
            )
            Heading(
                text = title,
                modifier = Modifier.weight(1f),
                level = HeadingLevel.Page,
                maxLines = TITLE_MAX_LINES,
            )
        }
        if (subtitle.isNotBlank()) {
            HelperText(subtitle)
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_ZONE: ZoneId = ZoneId.of("America/Los_Angeles")

private fun previewModel(data: DriveHeaderData): DriveHeaderUiModel = DriveDetailHeaderProjection.project(data, PREVIEW_ZONE, Locale.US)

@Preview(name = "Route (completed drive)", showBackground = true)
@Composable
private fun DriveDetailHeaderRoutePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveDetailHeaderContent(
            model =
                previewModel(
                    DriveHeaderData(
                        driveId = "1024",
                        vehicleName = "Model 3",
                        startAddress = "Cupertino, CA",
                        endAddress = "San Francisco, CA",
                        startTsIso = "2026-01-15T18:30:00Z",
                        endTsIso = "2026-01-15T19:42:00Z",
                    ),
                ),
            onBack = {},
            onReplay = {},
            onShare = {},
        )
    }
}

@Preview(name = "Fallback title (live drive)", showBackground = true)
@Composable
private fun DriveDetailHeaderFallbackPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveDetailHeaderContent(
            model =
                previewModel(
                    DriveHeaderData(
                        driveId = "1025",
                        vehicleName = "Model Y",
                        startAddress = null,
                        endAddress = null,
                        startTsIso = "2026-01-15T18:30:00Z",
                        endTsIso = null,
                    ),
                ),
            onBack = {},
            onReplay = {},
            onShare = {},
        )
    }
}
