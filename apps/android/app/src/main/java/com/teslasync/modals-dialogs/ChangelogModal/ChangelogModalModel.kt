// Pure, framework-free model + projection for the ChangelogModal surface — the native analogue of the data
// the web component derives before returning JSX (web/src/components/feedback/ChangelogModal.tsx, backed by
// web/src/hooks/useChangelog.ts + web/src/generated/changelog.ts). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web ChangelogModal surfaces "what's new since last visit". Its data source, useChangelog, is NOT a
// network query — it reads a build-time-generated static catalog (@/generated/changelog) and a small
// acknowledgement record persisted in localStorage (seen-version + last-shown throttle), exposed through a
// useSyncExternalStore. That contract is reproduced here by [ChangelogModalModel] (the derivations:
// new-since-seen filtering, first-visit detection, the 24h auto-show throttle, Keep-a-Changelog section
// grouping, the default-open rule, and the seen/throttle reducers) over the [ChangelogSource] state-holder
// seam (P1/S8). Because the feed is static + local rather than remote, there is NO loading / error / stale /
// offline lifecycle to model — inventing one would be fabricated state the web source never has (a "No
// silent drift" covenant violation), exactly as the sibling AccordionSection surface documents. The
// genuinely reachable render states are the three [ChangelogRender] branches: FirstVisit (full history),
// SinceLastVisit (the delta), and Empty (a catalog with no releases — a friendly empty state, never a blank
// box).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ChangelogModal — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path, exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.changelogmodal

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ChangelogRegistration {
    /** Stable surface id. */
    const val ID: String = "changelog-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChangelogModal"
}

/** Keep-a-Changelog change category — the web `ChangelogChangeType` union. */
enum class ChangelogChangeType { Added, Changed, Fixed, Removed, Deprecated, Security }

/** UI badge classification for a release — the web `ChangelogBadge` union. */
enum class ChangelogBadge { Latest, Stable, Beta }

/** One typed change line within a release — the web `ChangelogChange`. */
data class ChangelogChange(
    val type: ChangelogChangeType,
    val text: String,
)

/** One released version with its typed changes — the web `ChangelogEntry`. */
data class ChangelogRelease(
    val version: String,
    val date: String,
    val badge: ChangelogBadge,
    val changes: List<ChangelogChange>,
)

/** A non-empty group of same-typed changes within a release (the web modal's per-section grouping). */
data class ChangelogSection(
    val type: ChangelogChangeType,
    val items: List<ChangelogChange>,
)

/**
 * The user's changelog acknowledgement record — the native analogue of the two localStorage keys the web
 * useChangelog persists: the highest [seenVersion] the user dismissed the modal for, and the [lastShownAt]
 * epoch-ms stamp that throttles the auto-show to once per 24h regardless of seen-state.
 */
data class ChangelogAck(
    val seenVersion: String? = null,
    val lastShownAt: Long? = null,
)

/**
 * The reduced render state of the modal body — the three mutually-exclusive, genuinely reachable branches.
 * Mirrors the web component's first-visit vs since-last-visit subtitle split, plus the native empty branch
 * (a catalog with no releases) that renders a friendly empty state instead of a blank box.
 */
sealed interface ChangelogRender {
    /** The catalog resolved to no releases — show a friendly empty state, never a blank box. */
    data object Empty : ChangelogRender

    /** First visit (seen-version null / all entries new) — the web `subtitleFirstVisit` path. */
    data class FirstVisit(
        val count: Int,
    ) : ChangelogRender

    /** Returning visit — [count] releases since the last visit (the web `subtitleSinceLastVisit` path). */
    data class SinceLastVisit(
        val count: Int,
    ) : ChangelogRender
}

/**
 * The localized strings the composable renders — resolved once at the render boundary and handed to the
 * stateless content as a framework-free bundle so the view stays a thin render layer. The modal title,
 * subtitles, action labels, badge labels, and section labels all resolve from the P1/S10 catalog; the
 * native-only empty hint + close affordance fall back to English defaults when no catalog entry exists.
 */
data class ChangelogStrings(
    val title: String,
    val viewFull: String,
    val gotIt: String,
    val closeLabel: String,
    val emptyMessage: String,
    val badgeLabels: Map<ChangelogBadge, String>,
    val sectionLabels: Map<ChangelogChangeType, String>,
) {
    /** The localized badge label for [badge], falling back to its enum name if unmapped. */
    fun badgeLabel(badge: ChangelogBadge): String = badgeLabels[badge] ?: badge.name

    /** The localized section heading for [type], falling back to its enum name if unmapped. */
    fun sectionLabel(type: ChangelogChangeType): String = sectionLabels[type] ?: type.name
}

/** Native-only microcopy defaults (no web catalog key ⇒ these English fallbacks are used). */
object ChangelogDefaults {
    /** Friendly empty-body hint shown when the catalog has no releases. */
    const val EMPTY_MESSAGE: String = "No release notes yet."

    /** Close affordance label for the modal (web relies on the DOM Esc/backdrop; TalkBack needs a label). */
    const val CLOSE_LABEL: String = "Close dialog"

    /** Action label announced for an entry header while collapsed (web relies on the DOM `aria-expanded`). */
    const val EXPAND_ACTION: String = "Expand"

    /** Action label announced for an entry header while expanded. */
    const val COLLAPSE_ACTION: String = "Collapse"

    /** State description announced while an entry is expanded — native equivalent of `aria-expanded="true"`. */
    const val EXPANDED_STATE: String = "Expanded"

    /** State description announced while an entry is collapsed — native equivalent of `aria-expanded="false"`. */
    const val COLLAPSED_STATE: String = "Collapsed"
}

/** Resource name for the native-only empty hint (by-name; absent ⇒ [ChangelogDefaults.EMPTY_MESSAGE]). */
const val KEY_EMPTY_MESSAGE: String = "translation_changelog_modal_empty"

/** Resource name for an entry's expand action label (by-name; absent ⇒ [ChangelogDefaults.EXPAND_ACTION]). */
const val KEY_EXPAND_ACTION: String = "translation_changelog_entry_expand"

/** Resource name for an entry's collapse action label (by-name; absent ⇒ [ChangelogDefaults.COLLAPSE_ACTION]). */
const val KEY_COLLAPSE_ACTION: String = "translation_changelog_entry_collapse"

/** Resource name for an entry's expanded state description (by-name; absent ⇒ default). */
const val KEY_EXPANDED_STATE: String = "translation_changelog_entry_expanded"

/** Resource name for an entry's collapsed state description (by-name; absent ⇒ default). */
const val KEY_COLLAPSED_STATE: String = "translation_changelog_entry_collapsed"

/**
 * The localized accessibility affordance strings for a collapsible entry header — resolved once at the
 * render boundary so the header's TalkBack action + state description track the open/closed toggle the way
 * the web `aria-expanded` does. The web source owns no text keys for these (it relies on the DOM), so they
 * resolve by-name with the English fallbacks above.
 */
data class ChangelogEntryAffordances(
    val expandAction: String,
    val collapseAction: String,
    val expandedState: String,
    val collapsedState: String,
) {
    /** The TalkBack action label for the toggle in its current [expanded] state. */
    fun actionLabel(expanded: Boolean): String = if (expanded) collapseAction else expandAction

    /** The TalkBack state description for the current [expanded] state (web `aria-expanded`). */
    fun stateLabel(expanded: Boolean): String = if (expanded) expandedState else collapsedState
}

/**
 * The state-holder seam the surface binds to — the native analogue of the web `useChangelog` hook (P1/S8).
 * The view performs no persistence or HTTP itself; it reads the catalog + acknowledgement through this port
 * and writes seen/throttle stamps back through it. A concrete implementation ([DefaultChangelogSource])
 * binds the embedded [ChangelogCatalog] to a platform-backed [ChangelogAckStore].
 */
interface ChangelogSource {
    /** All releases, newest first — the web `entries` / generated `CHANGELOG`. */
    val releases: List<ChangelogRelease>

    /** The highest released version — the web `latestVersion` / generated `LATEST_VERSION`. */
    val latestVersion: String

    /** Whether the user has finished onboarding (web `localStorage['teslasync-onboarded']`). */
    val hasCompletedOnboarding: Boolean

    /** The current acknowledgement record (seen-version + last-shown throttle stamp). */
    fun ack(): ChangelogAck

    /** Marks [latestVersion] as seen and stamps the throttle — the web `markSeen()`. */
    fun markSeen()

    /** Stamps the auto-show throttle WITHOUT marking seen — the web `stampShown()` (manual open). */
    fun stampShown()

    /** Wall-clock epoch-ms seam, injectable for tests — the web `Date.now()`. */
    fun now(): Long
}

/** Persistence seam for the acknowledgement record (a thin platform store backs it in production). */
interface ChangelogAckStore {
    /** Reads the persisted acknowledgement, or a blank record on first run. */
    fun read(): ChangelogAck

    /** Persists [ack] (seen-version + last-shown). */
    fun write(ack: ChangelogAck)
}

/**
 * The default [ChangelogSource]: the embedded [ChangelogCatalog] over a platform-backed [ChangelogAckStore],
 * with the seen/throttle reducers delegated to the pure [ChangelogModalModel]. Framework-free (the clock +
 * onboarding probe are injectable seams), so the binding logic is exercised off-device.
 */
class DefaultChangelogSource(
    private val store: ChangelogAckStore,
    private val onboardingProbe: () -> Boolean,
    override val releases: List<ChangelogRelease> = ChangelogCatalog.releases,
    override val latestVersion: String = ChangelogCatalog.LATEST_VERSION,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : ChangelogSource {
    override val hasCompletedOnboarding: Boolean get() = onboardingProbe()

    override fun ack(): ChangelogAck = store.read()

    override fun markSeen() {
        store.write(ChangelogModalModel.markSeen(store.read(), latestVersion, now()))
    }

    override fun stampShown() {
        store.write(ChangelogModalModel.stampShown(store.read(), now()))
    }

    override fun now(): Long = clock()
}

/**
 * Pure, side-effect-free reducer — the native port of useChangelog's derivations + the web component's
 * prop-and-state to render mapping. Stateless so it is fully covered by the off-device unit gate.
 */
object ChangelogModalModel {
    /** Auto-show throttle window — the web `AUTO_SHOW_THROTTLE_MS` (once per 24h). */
    const val AUTO_SHOW_THROTTLE_MS: Long = 24L * 60L * 60L * 1000L

    /** Settle delay before the auto-show eligibility re-check fires — the web `AUTO_SHOW_DELAY_MS`. */
    const val AUTO_SHOW_DELAY_MS: Long = 2_000L

    /** Number of leading entries expanded by default — the web `defaultOpen={idx < 2}`. */
    const val DEFAULT_OPEN_COUNT: Int = 2

    /** External "view full changelog" target — the web `github.com/.../releases` link. */
    const val RELEASES_URL: String = "https://github.com/ev-dev-labs/teslasync/releases"

    /** Canonical section order — the web `SECTION_ORDER`. */
    val SECTION_ORDER: List<ChangelogChangeType> =
        listOf(
            ChangelogChangeType.Added,
            ChangelogChangeType.Changed,
            ChangelogChangeType.Fixed,
            ChangelogChangeType.Removed,
            ChangelogChangeType.Deprecated,
            ChangelogChangeType.Security,
        )

    /**
     * Compares two semver strings the way the web `compareVersions` does: numeric MAJOR.MINOR.PATCH, with
     * pre-release tags (`-beta.N`) sorting BEFORE the corresponding release, and a lexicographic fallback
     * for anything that fails to parse. Returns -1, 0, or 1.
     */
    fun compareVersions(
        a: String,
        b: String,
    ): Int {
        if (a == b) return 0
        val pa = parseSemver(a)
        val pb = parseSemver(b)
        return if (pa == null || pb == null) sign(a.compareTo(b)) else compareSemver(pa, pb)
    }

    /**
     * Releases that shipped after [seenVersion] — the web `newEntries`. A null seen-version (first visit)
     * yields the entire history, which is also the right onboarding behaviour.
     */
    fun newReleases(
        all: List<ChangelogRelease>,
        seenVersion: String?,
    ): List<ChangelogRelease> =
        if (seenVersion == null) {
            all
        } else {
            all.filter { compareVersions(it.version, seenVersion) > 0 }
        }

    /** Whether there are any unseen releases — the web `hasUnseen`. */
    fun hasUnseen(newReleases: List<ChangelogRelease>): Boolean = newReleases.isNotEmpty()

    /**
     * The list shown inside the modal — the unseen subset when there is one, otherwise the full history
     * (web `visibleEntries = newEntries.length > 0 ? newEntries : entries`).
     */
    fun visibleReleases(
        newReleases: List<ChangelogRelease>,
        all: List<ChangelogRelease>,
    ): List<ChangelogRelease> = if (newReleases.isNotEmpty()) newReleases else all

    /** First visit when every release is new — the web `isFirstVisit = newEntries.length === entries.length`. */
    fun isFirstVisit(
        newCount: Int,
        totalCount: Int,
    ): Boolean = newCount == totalCount

    /**
     * Whether enough time has passed since the last auto-show — the web `canAutoShow`. False when there is
     * nothing unseen; true on the first eligible run; otherwise gated by the 24h throttle window.
     */
    fun canAutoShow(
        hasUnseen: Boolean,
        lastShownAt: Long?,
        nowMs: Long,
        throttleMs: Long = AUTO_SHOW_THROTTLE_MS,
    ): Boolean =
        when {
            !hasUnseen -> false
            lastShownAt == null -> true
            else -> nowMs - lastShownAt >= throttleMs
        }

    /**
     * The full auto-show gating predicate — the web effect's guard (`hasUnseen && hasCompletedOnboarding &&
     * canAutoShow`), plus a [suppressed] seam for the native equivalent of the `[data-tour-active]` probe so
     * the modal never stacks on top of an active tour/onboarding overlay.
     */
    fun shouldAutoShow(
        hasUnseen: Boolean,
        hasCompletedOnboarding: Boolean,
        canAutoShow: Boolean,
        suppressed: Boolean,
    ): Boolean = hasUnseen && hasCompletedOnboarding && canAutoShow && !suppressed

    /**
     * Groups a release's changes by canonical type, dropping empty sections — the web modal's per-entry
     * `SECTION_ORDER.map(...).filter(g => g.items.length > 0)`.
     */
    fun groupChanges(changes: List<ChangelogChange>): List<ChangelogSection> =
        SECTION_ORDER.mapNotNull { type ->
            val items = changes.filter { it.type == type }
            if (items.isEmpty()) null else ChangelogSection(type, items)
        }

    /** Whether the entry at [index] starts expanded — the web `defaultOpen={idx < 2}`. */
    fun defaultExpanded(index: Int): Boolean = index < DEFAULT_OPEN_COUNT

    /** Marks [latestVersion] as seen and stamps the throttle at [nowMs] — the web `markSeen()`. */
    fun markSeen(
        ack: ChangelogAck,
        latestVersion: String,
        nowMs: Long,
    ): ChangelogAck = ack.copy(seenVersion = latestVersion, lastShownAt = nowMs)

    /** Stamps the throttle at [nowMs] without marking seen — the web `stampShown()`. */
    fun stampShown(
        ack: ChangelogAck,
        nowMs: Long,
    ): ChangelogAck = ack.copy(lastShownAt = nowMs)

    /**
     * Classifies the modal body into its [ChangelogRender] state from the visible-entry count and the
     * first-visit flag. An empty catalog renders the friendly empty state instead of a blank box.
     */
    fun classify(
        visibleCount: Int,
        isFirstVisit: Boolean,
    ): ChangelogRender =
        when {
            visibleCount == 0 -> ChangelogRender.Empty
            isFirstVisit -> ChangelogRender.FirstVisit(visibleCount)
            else -> ChangelogRender.SinceLastVisit(visibleCount)
        }

    // ── Internal semver helpers (web `compareVersions`) ──────────────────────────

    private val SEMVER = Regex("""^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$""")

    private fun parseSemver(value: String): Semver? {
        val match = SEMVER.matchEntire(value) ?: return null
        val groups = match.groupValues
        val core = listOf(groups[1].toInt(), groups[2].toInt(), groups[3].toInt())
        return Semver(core, groups[4].ifEmpty { null })
    }

    private fun compareSemver(
        a: Semver,
        b: Semver,
    ): Int {
        val coreDiff =
            (0..2)
                .asSequence()
                .map { sign(a.core[it].compareTo(b.core[it])) }
                .firstOrNull { it != 0 }
        return coreDiff ?: comparePre(a.pre, b.pre)
    }

    private fun comparePre(
        a: String?,
        b: String?,
    ): Int =
        when {
            a == null && b == null -> 0
            a == null -> 1
            b == null -> -1
            else -> sign(a.compareTo(b))
        }

    private fun sign(value: Int): Int = value.coerceIn(-1, 1)

    private data class Semver(
        val core: List<Int>,
        val pre: String?,
    )
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (an optional by-name resource read) and a map in
 * tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback
