// The native Jetpack Compose + Material 3 SummaryStatsRow feature view — a parity port of
// web/src/features/admin/components/security-access/SummaryStatsRow.tsx. The web component renders four
// summary MetricCards (current secure/unsecure status, the relative age of the last lock change, the sentry
// uptime percentage, and the total security-event count) in a responsive 1 / 2 / 4-column grid, switching
// the whole grid to four skeleton tiles while the owning page's query loads. This port keeps that contract:
// the four cards always render (showing "—" and zeros, never a blank box, when a value is absent), the grid
// reflows at the web Tailwind `sm` (640dp) and `lg` (1024dp) breakpoints, and the resolved grid fades in
// exactly as the web `<FadeIn>` wrapper does.
//
// Every derivation flows through the pure [SummaryStatsRowProjection]; the composable is a thin render
// layer that resolves the i18n labels (P1/S10) and the design-token accents (P1/S9) and hands them to the
// shared MetricCard. The card labels, the Secure/Unsecure values, and the relative-age microcopy all
// resolve through the generated catalog (`admin.security.*` + `freshness.*` keys) — there is no English
// literal in this file. The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SummaryStatsRow) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.summarystatsrow

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the four cards lay out in a single row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the cards lay out two-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG: Int = 4
private const val GRID_COLUMNS_SM: Int = 2
private const val GRID_COLUMNS_BASE: Int = 1

/** The four summary tiles, matching the web component's fixed card set. */
private const val CARD_COUNT: Int = 4

/** Web `<Skeleton height={88} />` — each loading tile is 88dp tall. */
private val SKELETON_HEIGHT: Dp = 88.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `SummaryStatsRow({ isSecure, lastLockChange,
 * sentryUptime, totalEvents, isLoading })` props. Records the one-shot `view.opened` diagnostic on first
 * composition (P1/S11), projects the props onto a [SummaryStatsRowDisplay] via the pure
 * [SummaryStatsRowProjection], and renders.
 *
 * @param lastLockChange ISO-8601 timestamp of the most recent lock change, or `null` when unknown.
 * @param nowMillis wall clock the last-lock relative age is measured against; defaults to the system clock
 *   and is injectable so previews/tests stay deterministic.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SummaryStatsRow(
    isSecure: Boolean,
    lastLockChange: String?,
    sentryUptime: Double,
    totalEvents: Int,
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SummaryStatsRowDiagnostics.recordViewOpened(logger) }
    val display =
        remember(isSecure, lastLockChange, sentryUptime, totalEvents, isLoading, nowMillis) {
            SummaryStatsRowProjection.project(
                summary =
                    SecuritySummary(
                        isSecure = isSecure,
                        lastLockChange = lastLockChange,
                        sentryUptime = sentryUptime,
                        totalEvents = totalEvents,
                    ),
                loading = isLoading,
                nowMillis = nowMillis,
            )
        }
    SummaryStatsRowContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. While [SummaryStatsRowDisplay.loading] is
 * true it shows the four-tile skeleton grid (web `isLoading` branch); otherwise it fades in the four
 * MetricCards. Every card is always present and always carries an accessible label + value (the last-lock
 * card resolves to "—" when the timestamp is absent), so no surface is ever hidden or blank.
 */
@Composable
fun SummaryStatsRowContent(
    display: SummaryStatsRowDisplay,
    modifier: Modifier = Modifier,
) {
    if (display.loading) {
        SummaryStatsLoading(modifier = modifier)
        return
    }

    val locale: Locale = LocalConfiguration.current.locales[0]
    val statusLabel = stringResource(R.string.translation_admin_security_stat_status)
    val secureValue = stringResource(R.string.translation_admin_security_secure)
    val unsecureValue = stringResource(R.string.translation_admin_security_unsecure)
    val lastLockLabel = stringResource(R.string.translation_admin_security_stat_lastLock)
    val sentryLabel = stringResource(R.string.translation_admin_security_stat_sentryUptime)
    val totalLabel = stringResource(R.string.translation_admin_security_stat_totalEvents)
    val lockLabels =
        LockChangeLabels(
            dash = EM_DASH,
            justNow = stringResource(R.string.translation_freshness_justNow),
            minutesAgo = stringResource(R.string.translation_freshness_minutes),
            hoursAgo = stringResource(R.string.translation_freshness_hours),
            daysAgo = stringResource(R.string.translation_freshness_days),
        )

    // Web `MetricCard` color → design-token accent: secure/unsecure are the success/danger semantics; the
    // web 'cyan' is the info token (both #00F0FF), and the web 'blue'/'purple' map to the brand chart
    // palette's speed/power hues (#3B82F6 / #A855F7, the latter an exact match for web's neon-purple).
    val statusValue = if (display.isSecure) secureValue else unsecureValue
    val statusAccent = if (display.isSecure) TeslaTokens.status.success else TeslaTokens.status.danger
    val lastLockValue = SummaryStatsRowProjection.formatLockChange(display.lastLock, lockLabels)
    val sentryValue = SummaryStatsRowProjection.formatUptimePercent(display.sentryUptime, locale)
    val totalValue = SummaryStatsRowProjection.formatEventCount(display.totalEvents)

    FadeIn(modifier = modifier) {
        SummaryStatsGrid(
            cards =
                listOf(
                    { cardModifier ->
                        MetricCard(
                            label = statusLabel,
                            value = statusValue,
                            icon = SummaryStatsRowGlyphs.ShieldCheck,
                            accent = statusAccent,
                            modifier = cardModifier,
                        )
                    },
                    { cardModifier ->
                        MetricCard(
                            label = lastLockLabel,
                            value = lastLockValue,
                            icon = DataDisplayGlyphs.Clock,
                            accent = TeslaTokens.status.info,
                            modifier = cardModifier,
                        )
                    },
                    { cardModifier ->
                        MetricCard(
                            label = sentryLabel,
                            value = sentryValue,
                            icon = SummaryStatsRowGlyphs.Activity,
                            accent = TeslaTokens.chart.speed,
                            modifier = cardModifier,
                        )
                    },
                    { cardModifier ->
                        MetricCard(
                            label = totalLabel,
                            value = totalValue,
                            icon = SummaryStatsRowGlyphs.BarChart3,
                            accent = TeslaTokens.chart.power,
                            modifier = cardModifier,
                        )
                    },
                ),
        )
    }
}

/**
 * The loading branch — four skeleton tiles in the same responsive grid as the resolved cards (web
 * `Array.from({ length: 4 }).map(... <Skeleton height={88} />)`). The grid carries a single TalkBack
 * "Loading" content description so the loading state is announced rather than read as four empty boxes.
 */
@Composable
private fun SummaryStatsLoading(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val skeleton: @Composable (Modifier) -> Unit = { cardModifier ->
        Skeleton(modifier = cardModifier, height = SKELETON_HEIGHT)
    }
    SummaryStatsGrid(
        modifier = modifier.semantics { contentDescription = loadingLabel },
        cards = List(CARD_COUNT) { skeleton },
    )
}

/**
 * Lays out the [cards] as the web responsive grid: four-per-row at or above [GRID_LG_MIN_WIDTH] (`lg:4`),
 * two-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:2`), and stacked below it (`default:1`). Each card fills
 * its column via [Modifier.weight]; a partial trailing row is padded with weighted spacers so the cards keep
 * a uniform width. Card cells are spaced by `Spacing.md`, the native expression of the web `gap-4`.
 */
@Composable
private fun SummaryStatsGrid(
    cards: List<@Composable (Modifier) -> Unit>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            cards.chunked(columns).forEach { rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCards.forEach { card -> card(Modifier.weight(1f)) }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * The three glyphs this surface needs that the shared [DataDisplayGlyphs] set does not carry. The web uses
 * lucide `ShieldCheck`, `Activity`, and `BarChart3`; Android ships no equivalents without the frozen
 * `material-icons-extended` artifact, so — exactly as the shared sets do for their lucide ports — they are
 * authored here as 24×24 stroked vectors faithful to the lucide paths. The `Clock` glyph (last-lock card)
 * is reused from `DataDisplayGlyphs`.
 */
private object SummaryStatsRowGlyphs {
    val ShieldCheck: ImageVector =
        stroked("ShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 12.5f)
            lineTo(11f, 14.5f)
            lineTo(15.5f, 9.5f)
        }

    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    val BarChart3: ImageVector =
        stroked("BarChart3") {
            moveTo(3f, 3f)
            lineTo(3f, 21f)
            lineTo(21f, 21f)
            moveTo(8f, 17f)
            lineTo(8f, 14f)
            moveTo(13f, 17f)
            lineTo(13f, 5f)
            moveTo(18f, 17f)
            lineTo(18f, 9f)
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SummaryStatsRowLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsRowContent(
            SummaryStatsRowDisplay(
                loading = true,
                isSecure = true,
                lastLock = LockChangeAge.Unknown,
                sentryUptime = 0.0,
                totalEvents = 0,
            ),
        )
    }
}

@Preview(name = "Resolved — secure", showBackground = true)
@Composable
private fun SummaryStatsRowSecurePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsRowContent(
            SummaryStatsRowDisplay(
                loading = false,
                isSecure = true,
                lastLock = LockChangeAge.Minutes(5),
                sentryUptime = 98.0,
                totalEvents = 1234,
            ),
        )
    }
}

@Preview(name = "Resolved — unsecure", showBackground = true)
@Composable
private fun SummaryStatsRowUnsecurePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsRowContent(
            SummaryStatsRowDisplay(
                loading = false,
                isSecure = false,
                lastLock = LockChangeAge.Hours(3),
                sentryUptime = 42.0,
                totalEvents = 87,
            ),
        )
    }
}

@Preview(name = "Resolved — empty (no lock time / zeros)", showBackground = true)
@Composable
private fun SummaryStatsRowEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SummaryStatsRowContent(
            SummaryStatsRowDisplay(
                loading = false,
                isSecure = true,
                lastLock = LockChangeAge.Unknown,
                sentryUptime = 0.0,
                totalEvents = 0,
            ),
        )
    }
}
