// Pure, framework-free model + projection for the TagInput shared surface — the native analogue of the
// logic the web component owns before it returns JSX (web/src/components/forms/TagInput.tsx: the
// `normaliseTag` / `buildSplitRegex` helpers, the `tryAddOne` / `commitText` / `commitAll` reducers, the
// `removeAt` handler, and the derived `atMax` / `inputDisabled` / describedBy state). No Compose, no
// Android UI, no HTTP: every type here is exercised by the `:android:testReleaseUnitTest` gate so the
// composable stays a thin render layer (ADR-002).
//
// The web `TagInput` is a *controlled* free-text chip field: the parent owns the `value` list and is
// notified through `onChange`; the component owns only the pending text + the validation error. It commits
// on Enter / a configured separator / paste, trims + optionally lowercases, rejects empty + case-insensitive
// duplicates silently (announced via `useAnnouncer`), caps the list at `maxTags` (disabling the input), and
// surfaces a `validateTag` message under the field. This model reproduces that contract exactly and folds in
// the cache-then-network lifecycle of the seed list (the genuine async dependency a host that loads persisted
// tags supplies) so the surface can honestly render the prompt's loading / empty / error / stale / offline
// matrix without ever hiding a region.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/TagInput — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.taginput

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the default commit separator are pinned here so the native and web surfaces stay in
 * lockstep.
 */
object TagInputRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TagInput"

    /** Web default commit separator (`separators ?? [',']`); Enter / newline always commit too. */
    const val DEFAULT_SEPARATOR: Char = ','
}

/**
 * The immutable, value-type configuration the field is parameterised with — the native port of the web
 * `TagInputProps` knobs that influence parsing (`separators`, `lowercase`, `maxTags`, `disabled`). The
 * `validateTag` callback is intentionally NOT folded in here (a function has no value identity); it is passed
 * to the commit functions separately so this stays pure data the projection tests compare by equality.
 *
 * @property maxTags caps the list; once reached the input is disabled and the count helper shows (web `maxTags`).
 * @property separators additional in-text commit characters (web `separators`, default comma); CR/LF always split.
 * @property lowercase lower-cases every tag before commit (web `lowercase`).
 * @property disabled disables the input and the chip remove buttons (web `disabled`).
 */
data class TagInputConfig(
    val maxTags: Int? = null,
    val separators: Set<Char> = setOf(TagInputRegistration.DEFAULT_SEPARATOR),
    val lowercase: Boolean = false,
    val disabled: Boolean = false,
)

/** The outcome of trying to add one candidate — the native port of the web `tryAddOne` status union. */
enum class TagAddStatus { Added, Duplicate, Invalid, Empty, Full }

/**
 * The result of a single [TagInputProjection.tryAddOne] attempt: the resolved [status], the normalised [tag],
 * the validator [error] (only when [TagAddStatus.Invalid]), and the [next] list (unchanged unless added).
 */
data class TagAddResult(
    val status: TagAddStatus,
    val tag: String,
    val error: String? = null,
    val next: List<String>,
)

/**
 * A pending screen-reader announcement — the native, locale-stable port of the strings the web passes to
 * `useAnnouncer`. Carried as a structured value so [TagInputProjection] stays pure; the composable maps it to
 * the localized P1/S10 string at the render boundary and speaks it through a polite live region.
 */
sealed interface TagAnnouncement {
    /** Web `t('tagInput.addedOne')` — one tag accepted. */
    data object AddedOne : TagAnnouncement

    /** Web `t('tagInput.added', { count })` — several tags accepted in one commit. */
    data class AddedMany(
        val count: Int,
    ) : TagAnnouncement

    /** Web `t('tagInput.duplicate', { tag })` — a candidate already present was rejected. */
    data class Duplicate(
        val tag: String,
    ) : TagAnnouncement

    /** Web `t('tagInput.maxReachedAnnounce')` — the list is full. */
    data object MaxReached : TagAnnouncement

    /** Web `t('tagInput.removed', { tag })` — a chip was removed. */
    data class Removed(
        val tag: String,
    ) : TagAnnouncement
}

/**
 * The result of committing user text — the native port of the web `commitText` return plus the side effects
 * it applies via state setters. [tags] is the surviving list, [committed] the number accepted, [remainder]
 * the trailing fragment left in the field (web preserves it as the new pending text), [error] the first
 * validator failure (web `setError`), and [announcement] the polite message to speak (web `announce`).
 */
data class TagCommitOutcome(
    val tags: List<String>,
    val committed: Int,
    val remainder: String,
    val error: String?,
    val announcement: TagAnnouncement?,
)

/**
 * The mutually-exclusive render surface the TagInput card draws. [Content] and [Empty] reproduce the web's
 * has-chips vs no-chips branches; [Loading] and [Error] surface the genuine cold-start and hard-failure
 * states of the seed list a host that loads persisted tags supplies.
 */
enum class TagInputPhase {
    /** First seed load with nothing cached — render skeleton chrome (never a blank box). */
    Loading,

    /** The seed resolved and the working list has at least one tag — render the chips + field. */
    Content,

    /** The seed resolved but the working list is empty — render the friendly empty hint + the field. */
    Empty,

    /** The seed failed with nothing cached to fall back on — render a classified error with retry. */
    Error,
}

/**
 * The local editing state the surface owns on top of the seed — the native port of the web component's
 * `useState` (`pending`, `error`) plus the working `value` list it is seeded with. Bundled so the fold takes
 * a single value (keeping it under the parameter-count budget and trivially comparable in tests).
 *
 * @property tags the working list of committed tags (web `value`).
 * @property pending the in-progress text not yet committed (web `pending`).
 * @property error the active validator message under the field, or null (web `error`).
 * @property announcement the latest polite announcement to speak, or null once consumed.
 */
data class TagEditing(
    val tags: List<String> = emptyList(),
    val pending: String = "",
    val error: String? = null,
    val announcement: TagAnnouncement? = null,
)

/**
 * The immutable, render-ready state the composable draws — everything the web `TagInput` folds together: the
 * resolved [phase], the working [tags] + [pending] + validator [error], the [maxTags] cap + [disabled] flag,
 * and the cache-then-network freshness envelope ([stale] / [offline] / [refreshing] + [errorKind]) so the
 * surface honestly flags last-known data instead of presenting it as live. Pure data so it is unit-tested
 * without a UI host.
 *
 * @property stale cached tags are past their TTL and a refresh is in flight (no failure yet).
 * @property offline cached tags are shown because a refresh failed (network unreachable / "last known").
 * @property freshnessStamp the `fetchedAt` of the shown seed; keys the stale auto-refresh effect.
 */
data class TagInputState(
    val phase: TagInputPhase,
    val tags: List<String> = emptyList(),
    val pending: String = "",
    val error: String? = null,
    val maxTags: Int? = null,
    val disabled: Boolean = false,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
    val announcement: TagAnnouncement? = null,
) {
    /** Number of committed tags (web `value.length`). */
    val count: Int get() = tags.size

    /** True once the list reached its cap (web `value.length >= maxTags`). */
    val atMax: Boolean get() = maxTags != null && tags.size >= maxTags

    /** True when the input field should be non-editable (web `disabled || atMax`). */
    val inputDisabled: Boolean get() = disabled || atMax

    /** True while a first seed load is in flight with nothing to show. */
    val isLoading: Boolean get() = phase == TagInputPhase.Loading

    /** True when the interactive field + chips render. */
    val isContent: Boolean get() = phase == TagInputPhase.Content

    /** True when the field renders with the no-tags hint (web `value.length === 0`). */
    val isEmpty: Boolean get() = phase == TagInputPhase.Empty

    /** True on a hard seed failure with nothing cached to fall back on. */
    val isError: Boolean get() = phase == TagInputPhase.Error

    /** True when a freshness chip (stale or offline) should be shown over the cached seed. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == TagInputPhase.Error

    companion object {
        /** The pre-collection state: a first seed load with nothing cached. */
        fun loading(config: TagInputConfig = TagInputConfig()): TagInputState =
            TagInputState(phase = TagInputPhase.Loading, maxTags = config.maxTags, disabled = config.disabled)
    }
}

/**
 * Pure parsing + reduction + projection logic for the TagInput surface — the native port of the web
 * `normaliseTag` / `buildSplitRegex` / `tryAddOne` / `commitText` / `commitAll` plus the fold of the seed
 * list's cache-then-network lifecycle into the render-ready [TagInputState].
 */
object TagInputProjection {
    /** Regex metacharacters that must be escaped when embedded inside a `[...]` character class. */
    private val REGEX_META_IN_CLASS: Set<Char> = setOf('\\', ']', '^', '-')

    /** Normalise a candidate before validation / dedupe: trim + optional lowercase (web `normaliseTag`). */
    fun normalise(
        raw: String,
        lowercase: Boolean,
    ): String {
        val trimmed = raw.trim()
        return if (lowercase) trimmed.lowercase(Locale.ROOT) else trimmed
    }

    /**
     * Splits [raw] on any configured separator PLUS CR/LF (web `buildSplitRegex`), collapsing runs of
     * separators so a multi-line / multi-separator paste splits per token. The separator set is escaped so it
     * is safe to forward without further sanitisation, exactly like the web factory.
     */
    fun splitParts(
        raw: String,
        separators: Set<Char>,
    ): List<String> = raw.split(splitRegex(separators))

    /**
     * Tries to add a single normalised candidate to [accumulated] — the native port of the web `tryAddOne`.
     * Resolution order matches the web exactly: empty → full → validator → duplicate → added. The duplicate
     * check is always case-insensitive (so "FOO" and "foo" never coexist) regardless of the [config]
     * lowercase storage flag.
     */
    fun tryAddOne(
        raw: String,
        accumulated: List<String>,
        config: TagInputConfig,
        validate: ((String) -> String?)?,
    ): TagAddResult {
        val tag = normalise(raw, config.lowercase)
        val validationError = if (tag.isNotEmpty()) validate?.invoke(tag) else null
        val lower = tag.lowercase(Locale.ROOT)
        val duplicate = accumulated.any { it.lowercase(Locale.ROOT) == lower }
        val full = config.maxTags != null && accumulated.size >= config.maxTags
        return when {
            tag.isEmpty() -> TagAddResult(TagAddStatus.Empty, tag, next = accumulated)
            full -> TagAddResult(TagAddStatus.Full, tag, next = accumulated)
            validationError != null -> TagAddResult(TagAddStatus.Invalid, tag, error = validationError, next = accumulated)
            duplicate -> TagAddResult(TagAddStatus.Duplicate, tag, next = accumulated)
            else -> TagAddResult(TagAddStatus.Added, tag, next = accumulated + tag)
        }
    }

    /**
     * Commits user [raw] text against the [current] list — the native port of the web `commitText`. Every
     * fragment up to the LAST separator is run through [tryAddOne]; the trailing fragment is returned as the
     * [TagCommitOutcome.remainder] so a mid-typing separator keeps the in-progress text. Pass [consumeLast] =
     * true (the web `commitAll` path: Enter / blur / paste) to append a synthetic separator so the whole
     * input is treated as fully-terminated and nothing is left pending.
     */
    fun commitText(
        raw: String,
        current: List<String>,
        config: TagInputConfig,
        validate: ((String) -> String?)?,
        consumeLast: Boolean,
    ): TagCommitOutcome {
        val text = if (consumeLast) raw + primarySeparator(config) else raw
        val parts = splitParts(text, config.separators)
        val remainder = parts.lastOrNull().orEmpty()
        val candidates = if (parts.isEmpty()) emptyList() else parts.dropLast(1)
        var acc = current
        var firstError: String? = null
        var added = 0
        var lastDuplicate: String? = null
        var hitMax = false
        for (candidate in candidates) {
            val result = tryAddOne(candidate, acc, config, validate)
            when (result.status) {
                TagAddStatus.Added -> {
                    acc = result.next
                    added += 1
                }
                TagAddStatus.Invalid -> if (firstError == null) firstError = result.error
                TagAddStatus.Duplicate -> lastDuplicate = result.tag
                TagAddStatus.Full -> {
                    hitMax = true
                    break
                }
                TagAddStatus.Empty -> Unit
            }
        }
        return TagCommitOutcome(
            tags = acc,
            committed = added,
            remainder = remainder,
            error = firstError,
            announcement = announcementFor(firstError, added, lastDuplicate, hitMax),
        )
    }

    /**
     * Resolves the [phase] from the seed lifecycle and the working list: a hard seed failure with no cache →
     * [TagInputPhase.Error]; a first load with nothing cached → [TagInputPhase.Loading]; otherwise the seed is
     * available (fresh or cached) and the WORKING list decides empty vs content — so adding the first tag
     * flips Empty → Content live, and clearing the last flips back, exactly like the web `value.length`.
     */
    fun phase(
        seed: UiState<List<String>>,
        tags: List<String>,
    ): TagInputPhase =
        when {
            seed.isError -> TagInputPhase.Error
            seed.isLoading -> TagInputPhase.Loading
            tags.isEmpty() -> TagInputPhase.Empty
            else -> TagInputPhase.Content
        }

    /**
     * Folds the seed [UiState] (the persisted-tags source) and the local [editing] state into the render-ready
     * [TagInputState], honouring the web's visible branches and the seed's async lifecycle. The freshness
     * envelope mirrors the shared `Resource → UiState` contract: `stale` = past-TTL refresh with no failure;
     * `offline` = cached value shown after a failed refresh.
     */
    fun fold(
        seed: UiState<List<String>>,
        editing: TagEditing,
        config: TagInputConfig,
    ): TagInputState =
        TagInputState(
            phase = phase(seed, editing.tags),
            tags = editing.tags,
            pending = editing.pending,
            error = editing.error,
            maxTags = config.maxTags,
            disabled = config.disabled,
            stale = seed.stale && seed.errorKind == null,
            offline = seed.stale && seed.hasData && seed.errorKind != null,
            refreshing = seed.refreshing,
            errorKind = seed.errorKind,
            httpStatus = seed.httpStatus,
            freshnessStamp = seed.fetchedAt,
            announcement = editing.announcement,
        )

    /**
     * Maps the hard-error [state] onto the shared [QueryErrorKind] recovery bucket (web `QueryError`): an open
     * breaker → transient "waiting"; a network/timeout fault → "offline"; otherwise the HTTP status decides.
     */
    fun queryErrorKind(state: TagInputState): QueryErrorKind =
        classifyQueryError(
            status = state.httpStatus,
            online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
            transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
        )

    /** The web `effectiveSeparators[0] ?? ','` — the synthetic terminator appended on a full commit. */
    private fun primarySeparator(config: TagInputConfig): Char = config.separators.firstOrNull() ?: TagInputRegistration.DEFAULT_SEPARATOR

    /** The polite announcement for a commit (web's `added` / `duplicate` / `maxReached` branch order). */
    private fun announcementFor(
        firstError: String?,
        added: Int,
        lastDuplicate: String?,
        hitMax: Boolean,
    ): TagAnnouncement? =
        when {
            firstError != null -> null
            added == 1 -> TagAnnouncement.AddedOne
            added > 1 -> TagAnnouncement.AddedMany(added)
            lastDuplicate != null -> TagAnnouncement.Duplicate(lastDuplicate)
            hitMax -> TagAnnouncement.MaxReached
            else -> null
        }

    /** Builds the `[separators\r\n]+` split regex, escaping any class-meta separator (web `buildSplitRegex`). */
    private fun splitRegex(separators: Set<Char>): Regex {
        val charClass =
            buildString {
                separators.forEach { ch ->
                    if (ch in REGEX_META_IN_CLASS) append('\\')
                    append(ch)
                }
                append("\\r\\n")
            }
        return Regex("[$charClass]+")
    }
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). Every event carries ONLY the surface [SLUG] — never a
 * tag value, the pending text, or the list contents — so a diagnostics line can never leak what the user is
 * tagging. Mirrors the sibling surfaces' slug-only diagnostics objects.
 */
object TagInputDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = TagInputRegistration.SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val ADDED: String = "tagInput.added"
    private const val REMOVED: String = "tagInput.removed"
    private const val REFRESH: String = "tagInput.refresh"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one mandated `view.opened` diagnostic for this surface (P1/S11). Call once on first composition. */
    fun recordViewOpened(logger: Logger) = logger.info(VIEW_OPENED, surfaceFields())

    /** Records that one or more tags were committed (web `onChange` add path). Slug only — never the tag. */
    fun recordAdded(logger: Logger) = logger.info(ADDED, surfaceFields())

    /** Records that a chip was removed (web `onChange` remove path). Slug only — never the tag. */
    fun recordRemoved(logger: Logger) = logger.info(REMOVED, surfaceFields())

    /** Records a manual seed re-fetch behind the error-retry affordance (web `refetch`). Slug only. */
    fun recordRefresh(logger: Logger) = logger.info(REFRESH, surfaceFields())

    private fun surfaceFields(): Map<String, String> = mapOf(SURFACE_KEY to SLUG)
}
