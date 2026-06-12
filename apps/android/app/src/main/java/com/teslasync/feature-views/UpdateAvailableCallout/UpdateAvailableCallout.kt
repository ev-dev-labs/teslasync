// The native Jetpack Compose + Material 3 UpdateAvailableCallout feature view — a parity port of
// web/src/features/system/components/status/UpdateAvailableCallout.tsx. The web component renders an in-page
// callout (distinct from the global NewVersionBanner) shown above the status chip bar when
// /system/update-check reports update_available: a Sparkles glyph, a "Update available — v{latest}" title, a
// muted line ("You're running v{current}. Review the release notes before upgrading your deployment.
// · Last checked {when}"), and a "View notes" link that opens the GitHub release notes so an operator can
// review a release before upgrading their deployment.
//
// Every derivation flows through the pure [UpdateAvailableCalloutProjection]; the composable is a thin render
// layer. The surface binds no data hook — the owning /system-status page supplies `current`, `latest`, and
// `checkedAt` (web parity), so the cache-then-network lifecycle (loading / error / stale / offline) lives on
// that page, not here (see the model header for the honesty-covenant rationale). Each conditional render
// branch the web source defines is reproduced: the title's version suffix, the "running" line, and the muted
// "last checked" tail all appear only when their input is present; the body sentence always renders, so the
// callout is never a blank box.
//
// i18n (P1/S10): the web source hardcodes its English copy (it calls no `t()`), so — exactly as the sibling
// LiveStatusPill port did — the strings are routed through the i18n catalog (the `statusBar.version.*` group
// that already owns `updateAvailable`). There is no English literal in this file. Color mapping (P1/S9 tokens,
// no ported Tailwind): the web cyan Sparkles glyph and cyan panel accent map to `TeslaTokens.status.info`; the
// title is `onSurface` (web `--text-primary`), the body is `onSurfaceVariant` (web `--text-secondary`), and the
// "last checked" tail is the same at a reduced alpha (web `--text-muted`). The whole panel is a polite live
// region (web `role="status"` + `aria-live="polite"`); the "View notes" control carries its own label and
// opens the release-notes URL through the platform URI handler (web `<a target="_blank">`). The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/UpdateAvailableCallout) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.updateavailablecallout

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** The release-notes target — web `href="…/releases/latest"`. A URL, not translatable copy. */
private const val RELEASE_NOTES_URL = "https://github.com/ev-dev-labs/teslasync/releases/latest"

/** The muted "last checked" tail relative to the secondary body (web `--text-muted` vs `--text-secondary`). */
private const val MUTED_ALPHA = 0.7f

/** Web `·` middot joining the body to the "last checked" tail (locale-neutral punctuation, no translatable word). */
private const val SEPARATOR = " \u00b7 "

/** A single space joining the "running" sentence to the body (web renders them in one paragraph). */
private const val SENTENCE_GAP = " "

/**
 * Stateful entry point — the faithful 1:1 port of the web `UpdateAvailableCallout({ current, latest, checkedAt })`
 * props. Records the one-shot `view.opened` diagnostic on first composition (P1/S11), projects the props onto a
 * [UpdateAvailableCalloutDisplay] via the pure [UpdateAvailableCalloutProjection], and renders. The surface
 * binds no data of its own; the owning page supplies the versions and the check timestamp.
 *
 * @param current the installed deployment version, or null/blank when unknown (web `current`).
 * @param latest the available target version, or null/blank when unknown (web `latest`).
 * @param checkedAt the ISO-8601 instant of the last update check, or null (web `checkedAt`).
 * @param zone the zone the timestamp is rendered in; defaults to the device zone (web `useDateFormat` tz).
 * @param locale the formatting locale; defaults to the device locale (web `useDateFormat` locale).
 * @param onViewNotes opens the release notes; defaults to the Compose `LocalUriHandler` (web `<a target="_blank">`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun UpdateAvailableCallout(
    current: String?,
    latest: String?,
    modifier: Modifier = Modifier,
    checkedAt: String? = null,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = LocalConfiguration.current.locales[0],
    onViewNotes: () -> Unit = rememberReleaseNotesOpener(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { UpdateAvailableCalloutDiagnostics.recordViewOpened(logger) }
    val display =
        remember(current, latest, checkedAt, zone, locale) {
            UpdateAvailableCalloutProjection.project(current, latest, checkedAt, zone, locale)
        }
    UpdateAvailableCalloutContent(display = display, modifier = modifier, onViewNotes = onViewNotes)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web layout: a cyan-accented
 * [GlassPanel] (a polite live region) holding a top-aligned row of the Sparkles glyph, the title + body
 * column, and the "View notes" action. The title carries the version suffix only when [latestVersion] is
 * present; the body prepends the "running" sentence only when [currentVersion] is present and appends the
 * muted "last checked" tail only when [checkedAtLabel] is present — every other input still renders the body
 * sentence, so the callout is never a blank box.
 */
@Composable
fun UpdateAvailableCalloutContent(
    display: UpdateAvailableCalloutDisplay,
    modifier: Modifier = Modifier,
    onViewNotes: () -> Unit = {},
) {
    val title =
        if (display.latestVersion != null) {
            stringResource(R.string.translation_statusBar_version_calloutTitleVersion, display.latestVersion)
        } else {
            stringResource(R.string.translation_statusBar_version_updateAvailable)
        }
    val running = display.currentVersion?.let { stringResource(R.string.translation_statusBar_version_calloutRunning, it) }
    val body = stringResource(R.string.translation_statusBar_version_calloutBody)
    val lastChecked = display.checkedAtLabel?.let { stringResource(R.string.translation_statusBar_version_calloutLastChecked, it) }
    val viewNotes = stringResource(R.string.translation_statusBar_version_calloutViewNotes)

    val secondaryColor = MaterialTheme.colorScheme.onSurfaceVariant
    val mutedColor = secondaryColor.copy(alpha = MUTED_ALPHA)
    val bodyText =
        buildAnnotatedString {
            withStyle(SpanStyle(color = secondaryColor)) {
                if (running != null) {
                    append(running)
                    append(SENTENCE_GAP)
                }
                append(body)
            }
            if (lastChecked != null) {
                withStyle(SpanStyle(color = mutedColor)) {
                    append(SEPARATOR)
                    append(lastChecked)
                }
            }
        }

    GlassPanel(
        modifier = modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        padding = PanelPadding.Md,
        accent = PanelAccent.Info,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = UpdateAvailableCalloutGlyphs.Sparkles,
                contentDescription = null,
                size = IconSize.Lg,
                tint = TeslaTokens.status.info,
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(text = bodyText, style = MaterialTheme.typography.bodySmall)
            }
            Button(onClick = onViewNotes, variant = ButtonVariant.Secondary, size = ButtonSize.Sm) {
                Text(text = viewNotes, style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.width(Spacing.xs))
                Icon(imageVector = UpdateAvailableCalloutGlyphs.ExternalLink, contentDescription = null, size = IconSize.Sm)
            }
        }
    }
}

/** Opener for the release-notes URL — the native analogue of the web `<a target="_blank" rel="noopener">`. */
@Composable
private fun rememberReleaseNotesOpener(): () -> Unit {
    val uriHandler = LocalUriHandler.current
    return remember(uriHandler) { { uriHandler.openUri(RELEASE_NOTES_URL) } }
}

/**
 * The two glyphs this surface needs that the shared sets do not carry. The web uses lucide `Sparkles` (the
 * "new release" affordance) and `ExternalLink` (the link trailing icon); Android ships no equivalents without
 * the frozen `material-icons-extended` artifact, so — exactly as the sibling StatusHeader/LiveStatusPill ports
 * do — they are authored here as 24×24 stroked vectors: a four-point sparkle with two small accent marks, and
 * the box-with-out-arrow external-link mark (the verbatim lucide `external-link` path).
 */
private object UpdateAvailableCalloutGlyphs {
    val Sparkles: ImageVector =
        stroked("Sparkles") {
            // Main four-point star (tips N/E/S/W, concave inner points between them).
            moveTo(12f, 3f)
            lineTo(13.4f, 10.6f)
            lineTo(21f, 12f)
            lineTo(13.4f, 13.4f)
            lineTo(12f, 21f)
            lineTo(10.6f, 13.4f)
            lineTo(3f, 12f)
            lineTo(10.6f, 10.6f)
            close()
            // Small accent in the free NE corner (a sparkle "plus").
            moveTo(18.5f, 4f)
            lineTo(18.5f, 7f)
            moveTo(17f, 5.5f)
            lineTo(20f, 5.5f)
            // Small accent in the free SW corner.
            moveTo(5.5f, 17f)
            lineTo(5.5f, 20f)
            moveTo(4f, 18.5f)
            lineTo(7f, 18.5f)
        }

    val ExternalLink: ImageVector =
        stroked("ExternalLink") {
            // lucide `external-link`: the out-arrow head, the diagonal stroke, then the open-cornered box.
            moveTo(15f, 3f)
            horizontalLineToRelative(6f)
            verticalLineToRelative(6f)
            moveTo(10f, 14f)
            lineTo(21f, 3f)
            moveTo(18f, 13f)
            verticalLineToRelative(6f)
            arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
            horizontalLineTo(5f)
            arcToRelative(2f, 2f, 0f, false, true, -2f, -2f)
            verticalLineTo(5f)
            arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
            horizontalLineToRelative(6f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each conditional render branch) ──────────────

private const val PREVIEW_CHECKED_AT = "2026-04-04T21:30:00Z"
private val PREVIEW_ZONE: ZoneId = ZoneId.of("America/Los_Angeles")
private val PREVIEW_LOCALE: Locale = Locale.US

private fun previewDisplay(
    current: String?,
    latest: String?,
    checkedAt: String?,
): UpdateAvailableCalloutDisplay = UpdateAvailableCalloutProjection.project(current, latest, checkedAt, PREVIEW_ZONE, PREVIEW_LOCALE)

@Preview(name = "Full — current + latest + checked", showBackground = true)
@Composable
private fun UpdateAvailableCalloutFullPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UpdateAvailableCalloutContent(previewDisplay(current = "2026.8.1", latest = "2026.12.0", checkedAt = PREVIEW_CHECKED_AT))
    }
}

@Preview(name = "No installed version", showBackground = true)
@Composable
private fun UpdateAvailableCalloutNoCurrentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UpdateAvailableCalloutContent(previewDisplay(current = null, latest = "2026.12.0", checkedAt = PREVIEW_CHECKED_AT))
    }
}

@Preview(name = "No target version (bare title)", showBackground = true)
@Composable
private fun UpdateAvailableCalloutNoLatestPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UpdateAvailableCalloutContent(previewDisplay(current = "2026.8.1", latest = null, checkedAt = null))
    }
}

@Preview(name = "Minimal — all inputs absent", showBackground = true)
@Composable
private fun UpdateAvailableCalloutMinimalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UpdateAvailableCalloutContent(previewDisplay(current = null, latest = null, checkedAt = null))
    }
}
