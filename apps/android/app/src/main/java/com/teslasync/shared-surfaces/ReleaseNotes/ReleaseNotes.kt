// The native Jetpack Compose + Material 3 ReleaseNotes shared surface — a parity port of
// web/src/components/feedback/ReleaseNotes.tsx. The web surface is a compact, single-open collapsible
// release-notes accordion (the sidebar / about-page card form of the changelog): for each of the newest
// `limit` releases (default 3) it draws a GlassPanel whose clickable header carries a badge-tinted gift glyph,
// the `v{version}` label, a latest/stable/beta Badge, and the release date, with a chevron that points up while
// open and down while closed; the expanded body shows a "What's New" heading over the release's flat change
// list, each line led by a dot tinted to its Keep-a-Changelog type.
//
// This native surface reproduces that contract end to end and renders every branch the web source draws — the
// Content accordion (single-open: opening one header collapses any other) crossed with the per-release
// badge / change-type tints — plus the prompt's friendly Empty state (the web renders an empty container when
// the catalog is capped to nothing; here that becomes a never-blank EmptyState). It performs NO HTTP: its only
// data is the static release catalog, read through the [ReleaseNotesSource] seam (P1/S8) that defaults to the
// single embedded [ChangelogCatalog] the ChangelogModal surface also reads, so the two never drift. Because
// that catalog is build-time data rather than a remote query, there is no loading / error / stale / offline
// lifecycle to model — see the [ReleaseNotesModel] header for the honesty rationale. The chrome is composed
// from the shared ui atoms (GlassPanel / Badge / Icon / CodeText / Caption / BodyText / MetricLabel) + the
// feedback EmptyState and the design tokens (P1/S9), never ported Tailwind classes, so every tint stays correct
// across light / dark / high-contrast themes. Every string resolves through the P1/S10 i18n facade (the
// "What's New" heading + badge labels from their catalog keys, the empty hint from the shared no-data key, the
// header a11y affordances by-name with English fallbacks). Each release header is a single merged TalkBack
// button whose action label + state description track the web `aria-expanded`, and a one-shot PII-safe
// `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ReleaseNotes) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling AlertBanner / ChangelogModal surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + glyph + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.releasenotes

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogBadge
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogChange
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogChangeType
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogRelease
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful port of the web `ReleaseNotes`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, resolves the localized strings, caps the catalog to the newest
 * [limit] releases through the injected [source], and delegates rendering to the stateless
 * [ReleaseNotesContent]. Performs no HTTP and binds no data port other than the changelog catalog seam.
 *
 * @param limit the maximum number of newest-first releases to render (web `limit`, default 3).
 * @param source the changelog state-holder seam; defaults to the embedded catalog (web `@/generated/changelog`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ReleaseNotes(
    modifier: Modifier = Modifier,
    limit: Int = ReleaseNotesModel.DEFAULT_LIMIT,
    source: ReleaseNotesSource = rememberDefaultReleaseNotesSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ReleaseNotesDiagnostics.recordViewOpened(logger) }
    val strings = rememberReleaseNotesStrings()
    val releases = remember(source, limit) { ReleaseNotesModel.visibleReleases(source.releases, limit) }
    ReleaseNotesContent(releases = releases, strings = strings, modifier = modifier)
}

/** Remembers the default [ReleaseNotesSource] (the embedded [ChangelogCatalog]) across recompositions. */
@Composable
fun rememberDefaultReleaseNotesSource(): ReleaseNotesSource = remember { DefaultReleaseNotesSource() }

/**
 * Stateless renderer — the UI-test and preview entry point. Owns the single lifted `expanded` version (the web
 * `useState`), so opening one header collapses any other, and draws either the accordion of [ReleaseNotesEntry]
 * cards or — when the catalog is capped to nothing — a friendly [EmptyState] in place of a blank box. The
 * render state is classified by the pure [ReleaseNotesModel] so every branch is exercised off-device.
 */
@Composable
fun ReleaseNotesContent(
    releases: List<ChangelogRelease>,
    strings: ReleaseNotesStrings,
    modifier: Modifier = Modifier,
) {
    var expanded by rememberSaveable(releases.firstOrNull()?.version) {
        mutableStateOf(ReleaseNotesModel.initialExpanded(releases))
    }
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        when (ReleaseNotesModel.classify(releases.size)) {
            ReleaseNotesRender.Empty ->
                EmptyState(message = strings.emptyMessage, icon = ReleaseNotesGlyphs.Gift)

            is ReleaseNotesRender.Content ->
                releases.forEach { release ->
                    ReleaseNotesEntry(
                        release = release,
                        expanded = ReleaseNotesModel.isExpanded(expanded, release.version),
                        onToggle = { expanded = ReleaseNotesModel.toggle(expanded, release.version) },
                        strings = strings,
                    )
                }
        }
    }
}

/**
 * One collapsible release — the web `releases.map(...)` row. An always-present clickable header (a badge-tinted
 * gift glyph, the `v{version}` label, the badge chip, the date, and an up/down chevron) over a body revealed
 * only while [expanded]. The header is a single merged TalkBack button carrying the expand/collapse action +
 * open/closed state (web `aria-expanded`).
 */
@Composable
private fun ReleaseNotesEntry(
    release: ChangelogRelease,
    expanded: Boolean,
    onToggle: () -> Unit,
    strings: ReleaseNotesStrings,
) {
    GlassPanel(padding = PanelPadding.None) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable(
                            role = Role.Button,
                            onClickLabel = strings.affordances.actionLabel(expanded),
                        ) { onToggle() }
                        .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                        .semantics(mergeDescendants = true) {
                            stateDescription = strings.affordances.stateLabel(expanded)
                        },
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = ReleaseNotesGlyphs.Gift,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = badgeAccentColor(release.badge),
                )
                CodeText("v${release.version}")
                Badge(text = strings.badgeLabel(release.badge), variant = badgeVariant(release.badge))
                Caption(release.date, modifier = Modifier.weight(1f))
                Icon(
                    imageVector = if (expanded) TeslaGlyphs.ChevronUp else TeslaGlyphs.ChevronDown,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (expanded) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ReleaseNotesBody(release = release, strings = strings)
            }
        }
    }
}

/** The expanded body of a release — the "What's New" heading over the flat, type-dotted change list. */
@Composable
private fun ReleaseNotesBody(
    release: ChangelogRelease,
    strings: ReleaseNotesStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(strings.heading.uppercase())
        release.changes.forEach { change -> ReleaseNotesChangeRow(change) }
    }
}

/** One change line — a leading dot tinted to the change [ChangelogChangeType] (web `DOT_TINT`) + the text. */
@Composable
private fun ReleaseNotesChangeRow(change: ChangelogChange) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Box(
            modifier =
                Modifier
                    .padding(top = Spacing.xs)
                    .size(DOT_SIZE)
                    .clip(CircleShape)
                    .background(changeDotColor(change.type)),
        )
        BodyText(change.text, modifier = Modifier.weight(1f))
    }
}

/**
 * Resolves the localized strings once at the render boundary. The heading + badge labels come from their P1/S10
 * catalog keys (web `changelog.releaseNotes.heading` / `changelog.badges.*`), the empty hint from the shared
 * no-data key, and the header a11y affordances by-name with the English fallbacks.
 */
@Composable
private fun rememberReleaseNotesStrings(): ReleaseNotesStrings {
    val heading = stringResource(R.string.translation_changelog_releaseNotes_heading)
    val emptyMessage = stringResource(R.string.translation_common_noData)
    val badgeLabels =
        mapOf(
            ChangelogBadge.Latest to stringResource(R.string.translation_changelog_badges_latest),
            ChangelogBadge.Stable to stringResource(R.string.translation_changelog_badges_stable),
            ChangelogBadge.Beta to stringResource(R.string.translation_changelog_badges_beta),
        )
    val affordances = rememberReleaseNotesAffordances()
    return remember(heading, emptyMessage, badgeLabels, affordances) {
        ReleaseNotesStrings(
            heading = heading,
            emptyMessage = emptyMessage,
            badgeLabels = badgeLabels,
            affordances = affordances,
        )
    }
}

/**
 * Resolves the native-only accessibility affordance strings for a collapsible release header. The web source
 * owns no text keys for these (it relies on the DOM `aria-expanded`), so each resolves by-name through the i18n
 * facade with the English [ReleaseNotesDefaults] fallback.
 */
@Composable
private fun rememberReleaseNotesAffordances(): ReleaseNotesEntryAffordances {
    val context = LocalContext.current
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val expand = resolveOptional(lookup, KEY_EXPAND_ACTION, ReleaseNotesDefaults.EXPAND_ACTION)
    val collapse = resolveOptional(lookup, KEY_COLLAPSE_ACTION, ReleaseNotesDefaults.COLLAPSE_ACTION)
    val expanded = resolveOptional(lookup, KEY_EXPANDED_STATE, ReleaseNotesDefaults.EXPANDED_STATE)
    val collapsed = resolveOptional(lookup, KEY_COLLAPSED_STATE, ReleaseNotesDefaults.COLLAPSED_STATE)
    return remember(expand, collapse, expanded, collapsed) {
        ReleaseNotesEntryAffordances(expand, collapse, expanded, collapsed)
    }
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)` for the native-only a11y affordances. `getIdentifier` is the only way to attempt a key that
 * may be absent, so `DiscouragedApi` is suppressed; release builds keep resource names so the lookup stays
 * stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/** Map the release [ChangelogBadge] to the shared Badge tint (web `BADGE_VARIANT`). Pure, so it is unit-tested. */
internal fun badgeVariant(badge: ChangelogBadge): BadgeVariant =
    when (badge) {
        ChangelogBadge.Latest -> BadgeVariant.Success
        ChangelogBadge.Stable -> BadgeVariant.Info
        ChangelogBadge.Beta -> BadgeVariant.Warning
    }

/** The badge-tinted color of the leading gift glyph (web `ICON_TINT`). */
@Composable
private fun badgeAccentColor(badge: ChangelogBadge): Color =
    when (badge) {
        ChangelogBadge.Latest -> TeslaTokens.status.success
        ChangelogBadge.Stable -> TeslaTokens.status.info
        ChangelogBadge.Beta -> TeslaTokens.status.warning
    }

/** The type-tinted color of a change line's leading dot (web `DOT_TINT`). */
@Composable
private fun changeDotColor(type: ChangelogChangeType): Color =
    when (type) {
        ChangelogChangeType.Added -> TeslaTokens.status.success
        ChangelogChangeType.Changed -> TeslaTokens.status.info
        ChangelogChangeType.Fixed -> TeslaTokens.status.warning
        ChangelogChangeType.Removed -> TeslaTokens.status.danger
        ChangelogChangeType.Deprecated -> MaterialTheme.colorScheme.tertiary
        ChangelogChangeType.Security -> TeslaTokens.status.danger
    }

private val DOT_SIZE: Dp = 6.dp

private val GLYPH_SIZE: Dp = 24.dp
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE: Float = 2f

/**
 * The surface's one self-contained glyph. The web library uses `lucide-react`'s `Gift`; Android has no bundled
 * equivalent without the frozen `material-icons-extended` artifact and no shared `Gift` exists in the ui /
 * feedback glyph sets, so it is authored here as a 24×24 stroked vector (a ribboned box with a bow), recolored
 * at render time by the [Icon] composable's `tint`.
 */
private object ReleaseNotesGlyphs {
    val Gift: ImageVector =
        ImageVector
            .Builder(
                name = "ReleaseNotesGift",
                defaultWidth = GLYPH_SIZE,
                defaultHeight = GLYPH_SIZE,
                viewportWidth = GLYPH_VIEWPORT,
                viewportHeight = GLYPH_VIEWPORT,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = GLYPH_STROKE,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                ) {
                    // Lid band across the top of the box.
                    moveTo(3f, 8f)
                    lineTo(21f, 8f)
                    lineTo(21f, 11.5f)
                    lineTo(3f, 11.5f)
                    close()
                    // Box body beneath the lid.
                    moveTo(5f, 11.5f)
                    lineTo(5f, 20f)
                    lineTo(19f, 20f)
                    lineTo(19f, 11.5f)
                    // Vertical ribbon down the centre.
                    moveTo(12f, 8f)
                    lineTo(12f, 20f)
                    // Left bow loop.
                    moveTo(12f, 8f)
                    curveTo(12f, 5f, 9.5f, 3f, 8f, 4.5f)
                    curveTo(6.5f, 6f, 8f, 8f, 12f, 8f)
                    // Right bow loop.
                    moveTo(12f, 8f)
                    curveTo(12f, 5f, 14.5f, 3f, 16f, 4.5f)
                    curveTo(17.5f, 6f, 16f, 8f, 12f, 8f)
                }
            }.build()
}

// ── Previews — one per genuinely reachable render state ──────────────────────────────────────────────────

private fun previewStrings(): ReleaseNotesStrings =
    ReleaseNotesStrings(
        heading = "What's New",
        emptyMessage = "No data available",
        badgeLabels =
            mapOf(
                ChangelogBadge.Latest to "Latest",
                ChangelogBadge.Stable to "Stable",
                ChangelogBadge.Beta to "Beta",
            ),
        affordances =
            ReleaseNotesEntryAffordances(
                expandAction = ReleaseNotesDefaults.EXPAND_ACTION,
                collapseAction = ReleaseNotesDefaults.COLLAPSE_ACTION,
                expandedState = ReleaseNotesDefaults.EXPANDED_STATE,
                collapsedState = ReleaseNotesDefaults.COLLAPSED_STATE,
            ),
    )

private fun previewReleases(): List<ChangelogRelease> =
    listOf(
        ChangelogRelease(
            version = "0.7.0",
            date = "2026-03-29",
            badge = ChangelogBadge.Latest,
            changes =
                listOf(
                    ChangelogChange(ChangelogChangeType.Added, "Energy Flow page with pack voltage and BMS status"),
                    ChangelogChange(ChangelogChangeType.Changed, "Fleet telemetry config uses the MQTT dispatcher"),
                    ChangelogChange(ChangelogChangeType.Fixed, "Disconnect now clears the stored token cleanly"),
                ),
        ),
        ChangelogRelease(
            version = "0.6.0",
            date = "2026-03-28",
            badge = ChangelogBadge.Stable,
            changes = listOf(ChangelogChange(ChangelogChangeType.Security, "Hardened the command whitelist")),
        ),
        ChangelogRelease(
            version = "1.0.0-beta.1",
            date = "2026-04-02",
            badge = ChangelogBadge.Beta,
            changes = listOf(ChangelogChange(ChangelogChangeType.Removed, "Dropped the deprecated v0 export route")),
        ),
    )

@Preview(name = "ReleaseNotes · accordion (first open)", showBackground = true)
@Composable
private fun ReleaseNotesContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReleaseNotesContent(releases = previewReleases(), strings = previewStrings())
    }
}

@Preview(name = "ReleaseNotes · empty", showBackground = true)
@Composable
private fun ReleaseNotesEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReleaseNotesContent(releases = emptyList(), strings = previewStrings())
    }
}
