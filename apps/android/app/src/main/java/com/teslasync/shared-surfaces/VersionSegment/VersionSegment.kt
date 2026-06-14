// The native Jetpack Compose + Material 3 VersionSegment shared surface — a parity port of
// web/src/components/layout/status-bar/VersionSegment.tsx. The web file is the footer status-bar segment: an
// always-rendered button showing `v{appVersion}` (+ short SHA) with a status dot (amber when an update is
// available, else cyan when the changelog has unseen entries), and a click-opened "About this build" modal
// listing version provenance, an optional update banner, and the What's-new / Release-notes / Close actions.
//
// This surface is the native equivalent. All data flows through the shared [VersionSegmentViewModel] over the
// [VersionSegmentSource] seam (P1/S8) — the view performs NO HTTP and touches no persistence directly. Every
// derivation flows through the pure [VersionSegmentProjection]; the composable is a thin render layer that owns
// only the one-shot `view.opened` diagnostic (P1/S11), the open/close state, and the stale auto-refresh effect.
// The footer button is the always-rendered "content" surface (the version never blanks — it falls back to the
// build version exactly as the web button does); the cache-then-network lifecycle the web surfaces for the
// version query is reproduced INSIDE the About modal (the provenance/data view), where every phase renders a
// non-blank region with the build identity always visible:
//   • loading → skeleton chrome under the always-present build identity rows;
//   • empty   → a friendly "no data" hint under the build identity (the web `version.data == null` fallback);
//   • error   → the failure copy + a retry affordance, build identity still shown;
//   • stale   → a "Stale" chip over the last-known provenance + a quiet auto-refresh;
//   • offline → the cached provenance with an "offline" chip + retry.
// Every visible string resolves through the i18n catalog (P1/S10); the button carries the merged TalkBack
// description (the web `aria-label`) and the modal's interactive controls are each labelled.
//
// Built from native primitives + the shared @/components/ui library (Modal, Button, StatusPill, Icon, Badge-free
// typography) and design tokens (P1/S9), never ported Tailwind classes. The changelog is read from the shared
// ChangelogModal state holder; the What's-new action delegates to the host's changelog opener (the native
// analogue of the web `openChangelogModal()` global event).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VersionSegment) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path, exactly as the sibling shared surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderers + previews + glyphs.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.versionsegment

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogModalModel
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogSource
import io.teslasync.android.modalsdialogs.changelogmodal.rememberDefaultChangelogSource
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the always-rendered footer button (the web status-bar segment). */
const val VERSION_SEGMENT_BUTTON_TAG: String = "version-segment-button"

/** Test tag identifying the amber "update available" dot. */
const val VERSION_SEGMENT_UPDATE_DOT_TAG: String = "version-segment-update-dot"

/** Test tag identifying the cyan "unseen changelog" dot. */
const val VERSION_SEGMENT_UNSEEN_DOT_TAG: String = "version-segment-unseen-dot"

/** Test tag identifying the About-this-build modal surface. */
const val VERSION_SEGMENT_MODAL_TAG: String = "version-segment-modal"

/** Test tag identifying the "What's new" action (web `openChangelogModal`). */
const val VERSION_SEGMENT_WHATS_NEW_TAG: String = "version-segment-whats-new"

/** Test tag identifying the "Release notes" action (web releases link). */
const val VERSION_SEGMENT_RELEASE_NOTES_TAG: String = "version-segment-release-notes"

/** Test tag identifying the modal "Close" action. */
const val VERSION_SEGMENT_CLOSE_TAG: String = "version-segment-close"

/** Test tag identifying the retry control on the error + offline modal surfaces. */
const val VERSION_SEGMENT_RETRY_TAG: String = "version-segment-retry"

private val BUTTON_CORNER = 6.dp
private val DOT_SIZE = 6.dp
private val BANNER_CORNER = 10.dp
private val BANNER_BORDER = 1.dp
private val SKELETON_BAR_HEIGHT = 10.dp
private const val SKELETON_BAR_FRACTION = 0.6f
private const val BANNER_WASH_ALPHA = 0.12f
private const val BANNER_BORDER_ALPHA = 0.3f

/**
 * Stateful entry point bound to the shared feeds — the faithful port of the web `VersionSegment`. Binds the
 * [VersionSegmentViewModel], records the one-shot `view.opened` diagnostic (P1/S11), collects the provenance +
 * update + changelog state, projects everything into the button + modal the stateless surface paints,
 * auto-refreshes a TTL-stale provenance, and wires What's-new / Release-notes / Retry to the view-model.
 *
 * @param modifier optional layout modifier for the surface container.
 * @param iconOnly when true the button renders only the tag icon (web `iconOnly`) — version/SHA/dot collapse.
 * @param source the three-feed seam; defaults to the shared Settings store + the embedded changelog holder
 *   ([rememberVersionSegmentSource]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 * @param buildVersion the build-time version fallback; defaults to [BuildConfig.VERSION_NAME] (web `BUILD_VERSION`).
 * @param buildSha the build-time short SHA fallback; defaults to `'dev'` (web `BUILD_SHA` when unset).
 * @param onOpenChangelog the host's changelog opener invoked by "What's new" — the native analogue of the web
 *   `openChangelogModal()` global event. Defaults to a no-op for hosts that do not mount the ChangelogModal.
 */
@Composable
fun VersionSegment(
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
    source: VersionSegmentSource = rememberVersionSegmentSource(),
    logger: Logger = LocalDataContainer.current.logger,
    buildVersion: String = BuildConfig.VERSION_NAME,
    buildSha: String = DEV_VERSION,
    onOpenChangelog: () -> Unit = {},
) {
    val viewModel: VersionSegmentViewModel =
        viewModel(
            key = VersionSegmentRegistration.ID,
            factory = VersionSegmentViewModel.factory(source, logger, buildVersion = buildVersion, buildSha = buildSha),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val update by viewModel.updateCheck.collectAsStateWithLifecycle()
    val changelog by viewModel.changelog.collectAsStateWithLifecycle()
    val strings = rememberVersionSegmentStrings()

    val fields = remember(state) { VersionSegmentProjection.parseVersion(state.data) }
    val build = remember(viewModel) { BuildIdentity(viewModel.buildVersion, viewModel.buildSha) }
    val button =
        remember(fields, update, changelog, state) {
            VersionSegmentProjection.buildButton(fields, update, changelog, state, build)
        }
    val modal =
        remember(fields, update, state, strings) {
            VersionSegmentProjection.buildModal(fields, update, state, strings, build)
        }

    val appVersion = VersionSegmentProjection.resolveAppVersion(fields?.appVersion, build.version)
    val sha = VersionSegmentProjection.resolveSha(build.sha)
    val uptimeText =
        VersionSegmentProjection
            .uptimeLabel(fields?.uptimeSeconds)
            ?.let { stringResource(R.string.translation_statusBar_version_uptime, it) }
    val unseenHintText =
        if (changelog.hasUnseen) stringResource(R.string.translation_changelog_unseenHint, changelog.newCount) else null
    val tooltip = VersionSegmentProjection.tooltipLabel(strings.tooltipWord, appVersion, sha, uptimeText, unseenHintText)
    val ariaLabel =
        VersionSegmentProjection.ariaLabel(strings.ariaWord, appVersion, sha, if (changelog.hasUnseen) strings.unseenAria else null)

    // Web `useVersionInfo` poll → a TTL-stale provenance quietly re-fetches; the offline/error surfaces keep
    // their explicit retry so a failed refresh is never auto-looped.
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) viewModel.refresh()
    }

    VersionSegmentContent(
        button = button,
        modal = modal,
        tooltip = tooltip,
        ariaLabel = ariaLabel,
        strings = strings,
        iconOnly = iconOnly,
        modifier = modifier,
        onOpen = viewModel::refreshChangelog,
        onWhatsNew = onOpenChangelog,
        onRetry = viewModel::refresh,
    )
}

/**
 * Stateless surface — the unit/UI-test and preview entry point. Always renders the footer [VersionSegmentButton]
 * (the web's always-visible control) and, while opened, the [VersionAboutModal]. Owns only the open/close state
 * (web `useState(open)`); all data + actions are hoisted so each piece is preview- and screenshot-testable.
 *
 * @param onOpen invoked when the button opens the modal — re-reads the changelog summary so the dot tracks the
 *   acknowledgement (the native analogue of the web useSyncExternalStore re-render).
 * @param onWhatsNew the host's changelog opener (web `openChangelogModal`); the modal closes first.
 * @param onReleaseNotes optional extra hook; the release-notes action also opens the releases URL via the
 *   platform URI handler.
 * @param onRetry re-collects the provenance feed (the error + offline retry).
 */
@Composable
fun VersionSegmentContent(
    button: VersionButtonRender,
    modal: VersionModalRender,
    tooltip: String,
    ariaLabel: String,
    strings: VersionSegmentStrings,
    iconOnly: Boolean,
    modifier: Modifier = Modifier,
    onOpen: () -> Unit = {},
    onWhatsNew: () -> Unit = {},
    onReleaseNotes: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    var open by rememberSaveable { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current

    VersionSegmentButton(
        button = button,
        tooltip = tooltip,
        ariaLabel = ariaLabel,
        iconOnly = iconOnly,
        modifier = modifier,
        onClick = {
            onOpen()
            open = true
        },
    )

    if (open) {
        VersionAboutModal(
            modal = modal,
            strings = strings,
            onClose = { open = false },
            onWhatsNew = {
                open = false
                onWhatsNew()
            },
            onReleaseNotes = {
                onReleaseNotes()
                uriHandler.openUri(ChangelogModalModel.RELEASES_URL)
            },
            onRetry = onRetry,
        )
    }
}

/**
 * The footer status-bar button — the tag icon (tinted by the provenance freshness), the `v{version}` label, the
 * optional short SHA, and the amber/cyan status dot (web's colored dot). The whole control carries the merged
 * [ariaLabel] (the web `aria-label`) and opens the About modal on click; [tooltip] is shown on hover/long-press.
 */
@Composable
fun VersionSegmentButton(
    button: VersionButtonRender,
    tooltip: String,
    ariaLabel: String,
    iconOnly: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit = {},
) {
    Tooltip(text = tooltip) {
        Row(
            modifier =
                modifier
                    .clip(RoundedCornerShape(BUTTON_CORNER))
                    .clickable(role = Role.Button, onClick = onClick)
                    .semantics { contentDescription = ariaLabel }
                    .testTag(VERSION_SEGMENT_BUTTON_TAG)
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                VersionSegmentGlyphs.Tag,
                contentDescription = null,
                size = IconSize.Xs,
                tint = freshnessTint(button.freshness),
            )
            if (!iconOnly) {
                Caption(button.versionText)
                button.shaText?.let { Caption("· $it") }
                when (button.dot) {
                    SegmentDot.Update -> StatusDot(TeslaTokens.status.warning, VERSION_SEGMENT_UPDATE_DOT_TAG)
                    SegmentDot.Unseen -> StatusDot(TeslaTokens.status.info, VERSION_SEGMENT_UNSEEN_DOT_TAG)
                    SegmentDot.None -> Unit
                }
            }
        }
    }
}

/**
 * The "About this build" modal — the version provenance rows (always carrying the build identity), the freshness
 * chips, the lifecycle chrome (loading / error / empty), the optional update banner, and the What's-new /
 * Release-notes / Close actions. Stateless so the UI test + previews drive each [VersionModalRender] state.
 */
@Composable
fun VersionAboutModal(
    modal: VersionModalRender,
    strings: VersionSegmentStrings,
    onClose: () -> Unit,
    onWhatsNew: () -> Unit,
    onReleaseNotes: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Modal(
        onDismissRequest = onClose,
        modifier = modifier.testTag(VERSION_SEGMENT_MODAL_TAG),
        title = strings.modalTitle,
        closeLabel = strings.close,
    ) {
        AboutFreshnessRow(modal, strings, onRetry)
        ProvenanceList(modal.rows)
        when (modal.phase) {
            ModalPhase.Loading -> AboutLoading(strings)
            ModalPhase.Error -> AboutError(strings, onRetry)
            ModalPhase.Empty -> HelperText(strings.emptyMessage, modifier = Modifier.padding(top = Spacing.sm))
            ModalPhase.Content -> Unit
        }
        modal.updateBanner?.let { AboutUpdateBanner(it) }
        HorizontalDivider(
            modifier = Modifier.padding(top = Spacing.md),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        AboutActions(strings, onWhatsNew, onReleaseNotes, onClose)
    }
}

/** The provenance definition list — App version + Commit always, then the conditional rows (web `dl`). */
@Composable
private fun ProvenanceList(rows: List<VersionRow>) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        rows.forEach { row -> ProvenanceRow(row) }
    }
}

/** One provenance row: a muted label and its value (monospace for the version/commit cells, web `font-mono`). */
@Composable
private fun ProvenanceRow(row: VersionRow) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.Start),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(row.label, modifier = Modifier.weight(1f))
        if (row.mono) CodeText(row.value) else BodyText(row.value)
    }
}

/** The "Stale" / "offline + retry" freshness row shown over the provenance (web has no such chrome; we add it). */
@Composable
private fun AboutFreshnessRow(
    modal: VersionModalRender,
    strings: VersionSegmentStrings,
    onRetry: () -> Unit,
) {
    if (!modal.stale && !modal.offline) return
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (modal.offline) {
            StatusPill(text = strings.offline, tone = StatusTone.Danger)
            RetryButton(strings, onRetry)
        } else {
            StatusPill(text = strings.stale, tone = StatusTone.Warning)
        }
    }
}

/** The cold-start skeleton chrome announced to TalkBack as "Loading", under the always-present identity rows. */
@Composable
private fun AboutLoading(strings: VersionSegmentStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm).semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(height = SKELETON_BAR_HEIGHT)
        Skeleton(widthFraction = SKELETON_BAR_FRACTION, height = SKELETON_BAR_HEIGHT)
    }
}

/** The hard-error chrome — the failure copy + a retry affordance (web hides the query error; the platform shows). */
@Composable
private fun AboutError(
    strings: VersionSegmentStrings,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ErrorText(strings.errorMessage)
        RetryButton(strings, onRetry)
    }
}

/** The "update available" banner — a warning-toned card with the title (+ latest tag) and the optional message. */
@Composable
private fun AboutUpdateBanner(banner: UpdateBanner) {
    val accent = TeslaTokens.status.warning
    Surface(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
        shape = RoundedCornerShape(BANNER_CORNER),
        color = accent.copy(alpha = BANNER_WASH_ALPHA),
        border = BorderStroke(BANNER_BORDER, accent.copy(alpha = BANNER_BORDER_ALPHA)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            BodyText(banner.title, color = accent)
            banner.message?.let { Caption(it) }
        }
    }
}

/** The What's-new / Release-notes / Close action row (web modal footer). */
@Composable
private fun AboutActions(
    strings: VersionSegmentStrings,
    onWhatsNew: () -> Unit,
    onReleaseNotes: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = strings.whatsNew,
            onClick = onWhatsNew,
            modifier = Modifier.testTag(VERSION_SEGMENT_WHATS_NEW_TAG),
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = VersionSegmentGlyphs.Sparkles,
        )
        Button(
            label = strings.releaseNotes,
            onClick = onReleaseNotes,
            modifier = Modifier.testTag(VERSION_SEGMENT_RELEASE_NOTES_TAG),
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = VersionSegmentGlyphs.ExternalLink,
        )
        Button(
            label = strings.close,
            onClick = onClose,
            modifier = Modifier.testTag(VERSION_SEGMENT_CLOSE_TAG),
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.Close,
        )
    }
}

/** The shared retry control (the error + offline affordance), carrying the retry test tag. */
@Composable
private fun RetryButton(
    strings: VersionSegmentStrings,
    onRetry: () -> Unit,
) {
    Button(
        label = strings.retry,
        onClick = onRetry,
        modifier = Modifier.testTag(VERSION_SEGMENT_RETRY_TAG),
        variant = ButtonVariant.Outline,
        size = ButtonSize.Sm,
    )
}

/** A small status dot — the web `inline-block h-1.5 w-1.5 rounded-full` colored pip; decorative, tagged for tests. */
@Composable
private fun StatusDot(
    color: Color,
    tag: String,
) {
    Spacer(
        modifier =
            Modifier
                .padding(start = Spacing.xs)
                .size(DOT_SIZE)
                .clip(CircleShape)
                .background(color)
                .testTag(tag),
    )
}

/** The leading tag-icon tint reflects provenance freshness so offline/stale is visible without opening the modal. */
@Composable
private fun freshnessTint(freshness: SegmentFreshness): Color =
    when (freshness) {
        SegmentFreshness.Offline -> TeslaTokens.status.danger
        SegmentFreshness.Stale -> TeslaTokens.status.warning
        SegmentFreshness.Fresh -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Builds the production [VersionSegmentSource] from the shared S8 Settings store (the provenance feed) and the
 * embedded ChangelogModal holder (the unseen summary). Memoized so the surface binds once; tests inject a fake
 * source instead. The update-check leg defaults to "no update" until a host wires `/system/update-check`.
 */
@Composable
fun rememberVersionSegmentSource(changelogSource: ChangelogSource = rememberDefaultChangelogSource()): VersionSegmentSource {
    val settingsStore = LocalDataContainer.current.settingsStore
    return remember(settingsStore, changelogSource) {
        settingsStore.asVersionSegmentSource(changelog = { changelogSource.toVersionSegmentStatus() })
    }
}

/** Resolves the localized strings once at the render boundary; tests pass a deterministic instance. */
@Composable
private fun rememberVersionSegmentStrings(): VersionSegmentStrings {
    val tooltipWord = stringResource(R.string.translation_statusBar_version_tooltip)
    val ariaWord = stringResource(R.string.translation_statusBar_version_aria)
    val updateAvailable = stringResource(R.string.translation_statusBar_version_updateAvailable)
    val unseenAria = stringResource(R.string.translation_changelog_unseenAria)
    val appVersionLabel = stringResource(R.string.translation_statusBar_version_appVersion)
    val commitLabel = stringResource(R.string.translation_statusBar_version_commit)
    val chartLabel = stringResource(R.string.translation_statusBar_version_chart)
    val goLabel = stringResource(R.string.translation_statusBar_version_go)
    val platformLabel = stringResource(R.string.translation_statusBar_version_platform)
    val uptimeRowLabel = stringResource(R.string.translation_statusBar_version_uptimeLabel)
    val modalTitle = stringResource(R.string.translation_statusBar_version_modalTitle)
    val updateBannerTitle = stringResource(R.string.translation_statusBar_version_updateBanner)
    val whatsNew = stringResource(R.string.translation_changelog_openModal)
    val releaseNotes = stringResource(R.string.translation_statusBar_version_changelog)
    val close = stringResource(R.string.translation_statusBar_version_close)
    val loading = stringResource(R.string.translation_a11y_loading)
    val stale = stringResource(R.string.translation_mqtt_stale)
    val offline = stringResource(R.string.translation_error_network_offlineTitle)
    val retry = stringResource(R.string.translation_common_retry)
    val errorMessage = stringResource(R.string.translation_error_loadFailed)
    val emptyMessage = stringResource(R.string.translation_common_noData)
    return remember(tooltipWord, ariaWord, updateAvailable, unseenAria, whatsNew, releaseNotes, close, loading) {
        VersionSegmentStrings(
            tooltipWord = tooltipWord,
            ariaWord = ariaWord,
            updateAvailable = updateAvailable,
            unseenAria = unseenAria,
            appVersionLabel = appVersionLabel,
            commitLabel = commitLabel,
            chartLabel = chartLabel,
            goLabel = goLabel,
            platformLabel = platformLabel,
            uptimeRowLabel = uptimeRowLabel,
            modalTitle = modalTitle,
            updateBannerTitle = updateBannerTitle,
            whatsNew = whatsNew,
            releaseNotes = releaseNotes,
            close = close,
            loading = loading,
            stale = stale,
            offline = offline,
            retry = retry,
            errorMessage = errorMessage,
            emptyMessage = emptyMessage,
        )
    }
}

// ── Decorative glyphs — authored locally (the shared TeslaGlyphs set has no Tag / Sparkles / ExternalLink). ───
// Each is a 24×24 stroked vector recolored by [Icon]'s tint; the enclosing controls carry the content
// descriptions, so the glyphs themselves are decorative.
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val SPARKLE_OUTER = 8.5f
private const val SPARKLE_INNER = 3.0f

/** The locally-authored decorative glyphs the surface renders. */
object VersionSegmentGlyphs {
    /** A label/tag outline with its punch-hole — the web lucide `Tag`. */
    val Tag: ImageVector =
        strokedGlyph("VersionSegmentTag") {
            moveTo(2f, 2f)
            lineTo(11f, 2f)
            lineTo(21f, 12f)
            lineTo(12f, 21f)
            lineTo(2f, 11f)
            close()
            moveTo(6.5f, 6.5f)
            lineTo(6.6f, 6.6f)
        }

    /** A four-point twinkle plus two small sparkles — the web lucide `Sparkles`. */
    val Sparkles: ImageVector =
        strokedGlyph("VersionSegmentSparkles") {
            fourPointStar(cx = 11f, cy = 11f, outer = SPARKLE_OUTER, inner = SPARKLE_INNER)
            plus(cx = 19f, cy = 5f, arm = 1.5f)
            plus(cx = 5f, cy = 19f, arm = 1.5f)
        }

    /** A framed box with an out-pointing arrow — the web lucide `ExternalLink`. */
    val ExternalLink: ImageVector =
        strokedGlyph("VersionSegmentExternalLink") {
            moveTo(15f, 3f)
            lineTo(21f, 3f)
            lineTo(21f, 9f)
            moveTo(21f, 3f)
            lineTo(10f, 14f)
            moveTo(18f, 13f)
            lineTo(18f, 19f)
            lineTo(5f, 19f)
            lineTo(5f, 6f)
            lineTo(11f, 6f)
        }
}

private fun strokedGlyph(
    name: String,
    builder: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = builder,
            )
        }.build()

/** Traces an eight-vertex four-point star ("twinkle") centered at ([cx], [cy]). */
private fun PathBuilder.fourPointStar(
    cx: Float,
    cy: Float,
    outer: Float,
    inner: Float,
) {
    val diagonal = inner * DIAGONAL
    moveTo(cx, cy - outer)
    lineTo(cx + diagonal, cy - diagonal)
    lineTo(cx + outer, cy)
    lineTo(cx + diagonal, cy + diagonal)
    lineTo(cx, cy + outer)
    lineTo(cx - diagonal, cy + diagonal)
    lineTo(cx - outer, cy)
    lineTo(cx - diagonal, cy - diagonal)
    close()
}

/** Traces a small plus ("+") sparkle centered at ([cx], [cy]) with the given [arm] half-length. */
private fun PathBuilder.plus(
    cx: Float,
    cy: Float,
    arm: Float,
) {
    moveTo(cx, cy - arm)
    lineTo(cx, cy + arm)
    moveTo(cx - arm, cy)
    lineTo(cx + arm, cy)
}

// Diagonal projection of an inner valley: r / sqrt(2), so a valley sits at (cx ± d, cy ± d).
private const val DIAGONAL = 0.70710677f

// ── Previews — one per genuinely reachable surface state ─────────────────────────────────────────────────────

private fun previewStrings(): VersionSegmentStrings =
    VersionSegmentStrings(
        tooltipWord = "TeslaSync version",
        ariaWord = "TeslaSync version",
        updateAvailable = "Update available",
        unseenAria = "unseen changelog",
        appVersionLabel = "App version",
        commitLabel = "Commit",
        chartLabel = "Helm chart",
        goLabel = "Go runtime",
        platformLabel = "Platform",
        uptimeRowLabel = "Server uptime",
        modalTitle = "About this build",
        updateBannerTitle = "A newer release is available",
        whatsNew = "What's new",
        releaseNotes = "Release notes",
        close = "Close",
        loading = "Loading",
        stale = "Stale",
        offline = "You're offline",
        retry = "Retry",
        errorMessage = "Failed to load data",
        emptyMessage = "No data available",
    )

private fun previewModal(
    phase: ModalPhase,
    banner: UpdateBanner? = null,
    stale: Boolean = false,
    offline: Boolean = false,
): VersionModalRender =
    VersionModalRender(
        phase = phase,
        rows =
            listOf(
                VersionRow("App version", "v0.1.0", mono = true),
                VersionRow("Commit", "abc1234", mono = true),
                VersionRow("Helm chart", "v0.1.0", mono = true),
                VersionRow("Go runtime", "go1.25.0", mono = true),
                VersionRow("Platform", "linux/amd64", mono = true),
                VersionRow("Server uptime", "3d 2h", mono = false),
            ),
        updateBanner = banner,
        stale = stale,
        offline = offline,
        canRetry = offline,
        chromeMessage = null,
    )

@Preview(name = "Button — update available", showBackground = true)
@Composable
private fun PreviewButtonUpdate() {
    TeslaSyncTheme(dynamicColor = false) {
        VersionSegmentButton(
            button = VersionButtonRender("v0.1.0", "abc1234", SegmentDot.Update, SegmentFreshness.Fresh),
            tooltip = "TeslaSync version · v0.1.0 · abc1234",
            ariaLabel = "TeslaSync version: v0.1.0 (abc1234)",
            iconOnly = false,
        )
    }
}

@Preview(name = "Button — unseen changelog", showBackground = true)
@Composable
private fun PreviewButtonUnseen() {
    TeslaSyncTheme(dynamicColor = false) {
        VersionSegmentButton(
            button = VersionButtonRender("v0.1.0", null, SegmentDot.Unseen, SegmentFreshness.Stale),
            tooltip = "TeslaSync version · v0.1.0 · 2 new release(s)",
            ariaLabel = "TeslaSync version: v0.1.0, unseen changelog",
            iconOnly = false,
        )
    }
}

@Preview(name = "Modal — content + update", showBackground = true)
@Composable
private fun PreviewModalContent() {
    TeslaSyncTheme(dynamicColor = false) {
        VersionAboutModal(
            modal = previewModal(ModalPhase.Content, banner = UpdateBanner("A newer release is available: v0.2.0", "Security fixes.")),
            strings = previewStrings(),
            onClose = {},
            onWhatsNew = {},
            onReleaseNotes = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Modal — offline", showBackground = true)
@Composable
private fun PreviewModalOffline() {
    TeslaSyncTheme(dynamicColor = false) {
        VersionAboutModal(
            modal = previewModal(ModalPhase.Content, stale = true, offline = true),
            strings = previewStrings(),
            onClose = {},
            onWhatsNew = {},
            onReleaseNotes = {},
            onRetry = {},
        )
    }
}
