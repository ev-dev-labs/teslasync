// The native Jetpack Compose + Material 3 ChangelogModal surface — a parity port of
// web/src/components/feedback/ChangelogModal.tsx. The web component mounts at the app root and surfaces
// "what's new since last visit" via two activation paths: an auto-show (once per 24h, gated on unseen
// entries + completed onboarding + no active tour) and an imperative open (the command palette / status bar
// fire a global event). Closing via "Got it" / "View full changelog" marks the latest version seen; closing
// via Esc / backdrop only stamps the throttle. This surface reproduces that contract exactly, over the
// [ChangelogSource] state-holder seam (P1/S8): the imperative path is a [ChangelogModalController] (the
// native analogue of the OPEN_CHANGELOG_MODAL_EVENT), and the auto-show is a settle-delayed [LaunchedEffect]
// gated by the pure [ChangelogModalModel.shouldAutoShow] predicate with a [suppressAutoShow] seam standing
// in for the web `[data-tour-active]` probe.
//
// Built from native primitives + the shared @/components/ui library (Modal, Button, Badge) and design
// tokens (P1/S9), never ported Tailwind classes. All copy resolves through the P1/S10 i18n facade: the
// modal title, subtitles, action labels, badge labels, and section headings from their catalog keys
// (translation_changelog_*), the native-only empty hint by-name with an English fallback. `view.opened` is
// emitted through the sanctioned redacting logger each time the modal opens (P1/S11).
//
// Because useChangelog is a static-catalog + local-acknowledgement store rather than a remote query, there
// is no loading / error / stale / offline lifecycle — see the [ChangelogModalModel] header. The genuinely
// reachable states are FirstVisit (full history), SinceLastVisit (the delta), and Empty (a catalog with no
// releases → a friendly empty state, never a blank box), each rendered by the stateless
// [ChangelogModalContent] and exercised by the previews + UI test.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ChangelogModal) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.changelogmodal

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.motion.rememberMotionDurationMs
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

/**
 * Imperative open handle — the native analogue of the web `OPEN_CHANGELOG_MODAL_EVENT` / `openChangelogModal()`.
 * Remember one with [rememberChangelogModalController] and call [open] from the command palette, the footer
 * version segment, or any surface that needs to pop the modal. Each call re-opens the modal and stamps the
 * auto-show throttle (matching the web manual-open handler).
 */
@Stable
class ChangelogModalController {
    private val requests = mutableIntStateOf(0)

    /** Monotonic open-request counter; reading it in a composable subscribes to imperative opens. */
    val openRequests: Int get() = requests.intValue

    /** Requests the modal to open (web `window.dispatchEvent(OPEN_CHANGELOG_MODAL_EVENT)`). */
    fun open() {
        requests.intValue += 1
    }
}

/** Remembers a [ChangelogModalController] across recompositions. */
@Composable
fun rememberChangelogModalController(): ChangelogModalController = remember { ChangelogModalController() }

/**
 * Stateful entry point for the ChangelogModal surface. Owns the open/acknowledged state (the web
 * `useState`), wires both activation paths, applies the seen/throttle acknowledgement semantics, records the
 * PII-safe `view.opened` diagnostic each time it opens (P1/S11), and delegates rendering to the stateless
 * [ChangelogModalContent]. Performs no HTTP and no direct persistence — all data + writes flow through the
 * injected [source] (ADR-002).
 *
 * @param modifier applied to the modal surface.
 * @param controller optional imperative-open handle (web `OPEN_CHANGELOG_MODAL_EVENT`).
 * @param source the changelog state-holder seam; defaults to the embedded catalog over device storage.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param suppressAutoShow when true the auto-show is held back (native analogue of the web
 *   `[data-tour-active]` probe) so the modal never stacks on an active tour/onboarding overlay.
 */
@Composable
fun ChangelogModal(
    modifier: Modifier = Modifier,
    controller: ChangelogModalController? = null,
    source: ChangelogSource = rememberDefaultChangelogSource(),
    logger: Logger = LocalDataContainer.current.logger,
    suppressAutoShow: Boolean = false,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    // Tracks whether the user explicitly acknowledged so the dismiss handler knows whether to mark seen.
    var acknowledged by rememberSaveable { mutableStateOf(false) }

    // Auto-show once the gating predicate flips true, after a settle delay (web AUTO_SHOW_DELAY_MS) that
    // lets any tour/onboarding overlay assert itself before the eligibility re-check fires.
    LaunchedEffect(source, suppressAutoShow, open) {
        if (open) return@LaunchedEffect
        val ack = source.ack()
        val unseen = ChangelogModalModel.hasUnseen(ChangelogModalModel.newReleases(source.releases, ack.seenVersion))
        val eligible =
            ChangelogModalModel.shouldAutoShow(
                hasUnseen = unseen,
                hasCompletedOnboarding = source.hasCompletedOnboarding,
                canAutoShow = ChangelogModalModel.canAutoShow(unseen, ack.lastShownAt, source.now()),
                suppressed = suppressAutoShow,
            )
        if (!eligible) return@LaunchedEffect
        delay(ChangelogModalModel.AUTO_SHOW_DELAY_MS)
        if (suppressAutoShow) return@LaunchedEffect
        acknowledged = false
        source.stampShown()
        open = true
    }

    // Imperative open via the controller (web custom-event listener).
    LaunchedEffect(controller, controller?.openRequests) {
        if (controller != null && controller.openRequests > 0) {
            acknowledged = false
            source.stampShown()
            open = true
        }
    }

    // One PII-safe diagnostic per open (P1/S11).
    LaunchedEffect(open) {
        if (open) {
            logger.info("view.opened", mapOf("surface" to ChangelogRegistration.SLUG))
        }
    }

    if (!open) return

    val uriHandler = LocalUriHandler.current
    val strings = rememberChangelogStrings()
    val newReleases = ChangelogModalModel.newReleases(source.releases, source.ack().seenVersion)
    val visible = ChangelogModalModel.visibleReleases(newReleases, source.releases)
    val firstVisit = ChangelogModalModel.isFirstVisit(newReleases.size, source.releases.size)
    val subtitle =
        if (firstVisit) {
            stringResource(R.string.translation_changelog_modal_subtitleFirstVisit)
        } else {
            stringResource(R.string.translation_changelog_modal_subtitleSinceLastVisit, visible.size)
        }

    ChangelogModalContent(
        releases = visible,
        subtitle = subtitle,
        strings = strings,
        onClose = {
            if (acknowledged) source.markSeen()
            acknowledged = false
            open = false
        },
        onViewFull = {
            acknowledged = true
            source.markSeen()
            open = false
            uriHandler.openUri(ChangelogModalModel.RELEASES_URL)
        },
        onGotIt = {
            acknowledged = true
            source.markSeen()
            open = false
        },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the UI-test and preview entry point. Draws the shared [Modal] (title + close +
 * scrollable body) with the first-visit / since-last-visit [subtitle], the list of collapsible
 * [ChangelogEntryCard]s (or a friendly [EmptyState] when the catalog is empty), and the View-full / Got-it
 * actions. The render state is classified by the pure [ChangelogModalModel] so every branch is exercised
 * off-device.
 */
@Composable
fun ChangelogModalContent(
    releases: List<ChangelogRelease>,
    subtitle: String,
    strings: ChangelogStrings,
    onClose: () -> Unit,
    onViewFull: () -> Unit,
    onGotIt: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = strings.title,
        closeLabel = strings.closeLabel,
    ) {
        HelperText(subtitle)
        Column(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (releases.isEmpty()) {
                EmptyState(message = strings.emptyMessage, icon = FeedbackGlyphs.Rocket)
            } else {
                releases.forEachIndexed { index, entry ->
                    ChangelogEntryCard(
                        entry = entry,
                        defaultOpen = ChangelogModalModel.defaultExpanded(index),
                        strings = strings,
                    )
                }
            }
        }
        HorizontalDivider(
            modifier = Modifier.padding(top = Spacing.md),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(label = strings.viewFull, onClick = onViewFull, variant = ButtonVariant.Ghost)
            Button(label = strings.gotIt, onClick = onGotIt)
        }
    }
}

/**
 * One collapsible release entry — the web `ChangelogModalEntry`. An always-present clickable header (version
 * + badge + date + a chevron that rotates 180° when open) over a body, revealed only while expanded, that
 * lists the release's changes grouped into non-empty [ChangelogSection]s with a type-colored leading dot.
 * The header is a single merged TalkBack button carrying the expand/collapse action + open/closed state.
 */
@Composable
private fun ChangelogEntryCard(
    entry: ChangelogRelease,
    defaultOpen: Boolean,
    strings: ChangelogStrings,
) {
    var expanded by rememberSaveable(entry.version) { mutableStateOf(defaultOpen) }
    val durationMs = rememberMotionDurationMs(MotionDurations.normal)
    val rotation by animateFloatAsState(
        targetValue = if (expanded) CHEVRON_OPEN_DEGREES else CHEVRON_CLOSED_DEGREES,
        animationSpec = tween(durationMs),
        label = "changelogEntryChevron",
    )
    val affordances = rememberChangelogEntryAffordances()
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(CARD_BORDER, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable(
                            role = Role.Button,
                            onClickLabel = affordances.actionLabel(expanded),
                        ) { expanded = !expanded }
                        .padding(horizontal = Spacing.lg, vertical = Spacing.md)
                        .semantics(mergeDescendants = true) {
                            stateDescription = affordances.stateLabel(expanded)
                        },
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CodeText("v${entry.version}")
                Badge(text = strings.badgeLabel(entry.badge), variant = badgeVariant(entry.badge))
                Caption(entry.date, modifier = Modifier.weight(1f))
                Icon(
                    imageVector = TeslaGlyphs.ChevronDown,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.rotate(rotation),
                )
            }
            if (expanded) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ChangelogEntryBody(entry = entry, strings = strings)
            }
        }
    }
}

/** The expanded body of an entry — the grouped, dotted change list (web `grouped.map(...)`). */
@Composable
private fun ChangelogEntryBody(
    entry: ChangelogRelease,
    strings: ChangelogStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.lg, vertical = Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        ChangelogModalModel.groupChanges(entry.changes).forEach { section ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                MetricLabel(strings.sectionLabel(section.type).uppercase())
                section.items.forEach { change ->
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        Box(
                            modifier =
                                Modifier
                                    .padding(top = Spacing.xs)
                                    .size(DOT_SIZE)
                                    .clip(CircleShape)
                                    .background(sectionDotColor(section.type)),
                        )
                        BodyText(change.text, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * Resolves the localized strings once at the render boundary. The modal title, subtitles, action labels,
 * badge labels, and section headings come from their P1/S10 catalog keys; the native-only empty hint
 * resolves by-name with the English fallback (the web source owns no empty-state key for this surface).
 */
@Composable
private fun rememberChangelogStrings(): ChangelogStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_changelog_modal_title)
    val viewFull = stringResource(R.string.translation_changelog_modal_viewFull)
    val gotIt = stringResource(R.string.translation_changelog_modal_gotIt)
    val closeLabel = stringResource(R.string.translation_a11y_closeDialog)
    val emptyMessage =
        resolveOptional({ context.optionalString(it) }, KEY_EMPTY_MESSAGE, ChangelogDefaults.EMPTY_MESSAGE)
    val badgeLabels =
        mapOf(
            ChangelogBadge.Latest to stringResource(R.string.translation_changelog_badges_latest),
            ChangelogBadge.Stable to stringResource(R.string.translation_changelog_badges_stable),
            ChangelogBadge.Beta to stringResource(R.string.translation_changelog_badges_beta),
        )
    val sectionLabels =
        mapOf(
            ChangelogChangeType.Added to stringResource(R.string.translation_changelog_sections_added),
            ChangelogChangeType.Changed to stringResource(R.string.translation_changelog_sections_changed),
            ChangelogChangeType.Fixed to stringResource(R.string.translation_changelog_sections_fixed),
            ChangelogChangeType.Removed to stringResource(R.string.translation_changelog_sections_removed),
            ChangelogChangeType.Deprecated to stringResource(R.string.translation_changelog_sections_deprecated),
            ChangelogChangeType.Security to stringResource(R.string.translation_changelog_sections_security),
        )
    return remember(title, viewFull, gotIt, closeLabel, emptyMessage, badgeLabels, sectionLabels) {
        ChangelogStrings(
            title = title,
            viewFull = viewFull,
            gotIt = gotIt,
            closeLabel = closeLabel,
            emptyMessage = emptyMessage,
            badgeLabels = badgeLabels,
            sectionLabels = sectionLabels,
        )
    }
}

/**
 * The default [ChangelogSource]: the embedded [ChangelogCatalog] over device [SharedPreferences] (the native
 * analogue of the web localStorage acknowledgement store). The onboarding probe reads the same
 * `teslasync-onboarded` flag the web checks; a host that tracks onboarding elsewhere can supply its own
 * [ChangelogSource].
 */
@Composable
fun rememberDefaultChangelogSource(): ChangelogSource {
    val context = LocalContext.current
    return remember(context) {
        val prefs = context.getSharedPreferences(CHANGELOG_PREFS, Context.MODE_PRIVATE)
        DefaultChangelogSource(
            store = SharedPrefsChangelogAckStore(prefs),
            onboardingProbe = { prefs.getBoolean(ONBOARDED_KEY, false) },
        )
    }
}

/** [SharedPreferences]-backed [ChangelogAckStore] — the native analogue of the web localStorage writes. */
private class SharedPrefsChangelogAckStore(
    private val prefs: SharedPreferences,
) : ChangelogAckStore {
    override fun read(): ChangelogAck {
        val seen = prefs.getString(SEEN_VERSION_KEY, null)?.takeIf { it.isNotBlank() }
        val shown = if (prefs.contains(LAST_SHOWN_KEY)) prefs.getLong(LAST_SHOWN_KEY, 0L) else null
        return ChangelogAck(seenVersion = seen, lastShownAt = shown)
    }

    override fun write(ack: ChangelogAck) {
        val editor = prefs.edit()
        val seen = ack.seenVersion
        if (seen == null) editor.remove(SEEN_VERSION_KEY) else editor.putString(SEEN_VERSION_KEY, seen)
        val shown = ack.lastShownAt
        if (shown == null) editor.remove(LAST_SHOWN_KEY) else editor.putLong(LAST_SHOWN_KEY, shown)
        editor.apply()
    }
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)` for the native-only empty hint. `getIdentifier` is the only way to attempt a key that
 * may be absent, so `DiscouragedApi` is suppressed; release builds keep resource names so the lookup stays
 * stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

private fun badgeVariant(badge: ChangelogBadge): BadgeVariant =
    when (badge) {
        ChangelogBadge.Latest -> BadgeVariant.Success
        ChangelogBadge.Stable -> BadgeVariant.Info
        ChangelogBadge.Beta -> BadgeVariant.Warning
    }

@Composable
private fun sectionDotColor(type: ChangelogChangeType): Color =
    when (type) {
        ChangelogChangeType.Added -> TeslaTokens.status.success
        ChangelogChangeType.Changed -> TeslaTokens.status.info
        ChangelogChangeType.Fixed -> TeslaTokens.status.warning
        ChangelogChangeType.Removed -> TeslaTokens.status.danger
        ChangelogChangeType.Deprecated -> MaterialTheme.colorScheme.tertiary
        ChangelogChangeType.Security -> TeslaTokens.status.danger
    }

/**
 * Resolves the native-only accessibility affordance strings for a collapsible entry header. The web source
 * owns no text keys for these (it relies on the DOM `aria-expanded`), so each resolves by-name through the
 * i18n facade with the English [ChangelogDefaults] fallback.
 */
@Composable
private fun rememberChangelogEntryAffordances(): ChangelogEntryAffordances {
    val context = LocalContext.current
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val expand = resolveOptional(lookup, KEY_EXPAND_ACTION, ChangelogDefaults.EXPAND_ACTION)
    val collapse = resolveOptional(lookup, KEY_COLLAPSE_ACTION, ChangelogDefaults.COLLAPSE_ACTION)
    val expanded = resolveOptional(lookup, KEY_EXPANDED_STATE, ChangelogDefaults.EXPANDED_STATE)
    val collapsed = resolveOptional(lookup, KEY_COLLAPSED_STATE, ChangelogDefaults.COLLAPSED_STATE)
    return remember(expand, collapse, expanded, collapsed) {
        ChangelogEntryAffordances(expand, collapse, expanded, collapsed)
    }
}

private const val CHANGELOG_PREFS = "teslasync.changelog"
private const val SEEN_VERSION_KEY = "changelog.seen-version"
private const val LAST_SHOWN_KEY = "changelog.last-shown"
private const val ONBOARDED_KEY = "teslasync-onboarded"

private const val CHEVRON_OPEN_DEGREES = 180f
private const val CHEVRON_CLOSED_DEGREES = 0f

private val DOT_SIZE = 6.dp
private val CARD_BORDER = 1.dp

// ── Previews — one per genuinely reachable render state ──────────────────────────────────────────────────

private fun previewStrings(): ChangelogStrings =
    ChangelogStrings(
        title = "What's new in TeslaSync",
        viewFull = "View full changelog",
        gotIt = "Got it",
        closeLabel = "Close dialog",
        emptyMessage = ChangelogDefaults.EMPTY_MESSAGE,
        badgeLabels =
            mapOf(
                ChangelogBadge.Latest to "Latest",
                ChangelogBadge.Stable to "Stable",
                ChangelogBadge.Beta to "Beta",
            ),
        sectionLabels =
            mapOf(
                ChangelogChangeType.Added to "Added",
                ChangelogChangeType.Changed to "Changed",
                ChangelogChangeType.Fixed to "Fixed",
                ChangelogChangeType.Removed to "Removed",
                ChangelogChangeType.Deprecated to "Deprecated",
                ChangelogChangeType.Security to "Security",
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
            changes =
                listOf(
                    ChangelogChange(ChangelogChangeType.Added, "Driving Dynamics page with real-time torque gauges"),
                    ChangelogChange(ChangelogChangeType.Security, "Hardened the command whitelist"),
                ),
        ),
    )

@Preview(name = "ChangelogModal \u00b7 first visit", showBackground = true)
@Composable
private fun ChangelogModalFirstVisitPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChangelogModalContent(
            releases = previewReleases(),
            subtitle = "Welcome! Here's a quick tour of what TeslaSync ships with right now.",
            strings = previewStrings(),
            onClose = {},
            onViewFull = {},
            onGotIt = {},
        )
    }
}

@Preview(name = "ChangelogModal \u00b7 since last visit", showBackground = true)
@Composable
private fun ChangelogModalSinceLastVisitPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChangelogModalContent(
            releases = previewReleases(),
            subtitle = "2 new release(s) since your last visit.",
            strings = previewStrings(),
            onClose = {},
            onViewFull = {},
            onGotIt = {},
        )
    }
}

@Preview(name = "ChangelogModal \u00b7 empty", showBackground = true)
@Composable
private fun ChangelogModalEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChangelogModalContent(
            releases = emptyList(),
            subtitle = "0 new release(s) since your last visit.",
            strings = previewStrings(),
            onClose = {},
            onViewFull = {},
            onGotIt = {},
        )
    }
}
