// Pure, framework-free model + fallback taxonomy + branch classifier for the SectionErrorBoundary shared
// surface — the native analogue of every decision the web component makes
// (web/src/components/feedback/SectionErrorBoundary.tsx) before it paints its fallback. No Compose, no Android,
// no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a STRUCTURAL guard
// that wraps an arbitrary `children` subtree in `./ErrorBoundary` so a render failure inside one section does
// not blank out the whole page. Its only own logic is selecting which fallback the wrapped boundary shows, in
// this precedence:
//   • `fallback` prop present        → render the host's own fallback node verbatim, NO retry  ([Custom]);
//   • else `fallbackTitle` non-empty → a danger-tinted card: an alert glyph + the host title + the localized
//                                      "Other parts of the page should still work." subtitle, NO retry ([Title]);
//   • else (the default)             → the underlying boundary's inline card: an alert glyph + a localized
//                                      title + the captured error detail + a working Retry ([Inline]).
// While healthy the boundary is transparent — it renders `children` and adds no chrome (the web
// `return children` path), reproduced natively by the composable rendering its `content` unchanged.
//
// The one hook the prompt lists, `useTranslation`, is the i18n catalog (P1/S10) — resolved at the render
// boundary by the composable, never here. There is NO data hook, NO fetch, and NO data port to bind (no P1/S8
// Source/ViewModel): modelling one would invent an async dependency the web spec does not have (honesty
// covenant: no scope narrowing, no silent drift). The closest sibling precedents are the equally presentational
// AlertBanner / InlineCallout surfaces (composable + model, no Source/ViewModel).
//
// Why the generic data-surface states (loading / empty / stale / offline) are intentionally absent: this surface
// fetches nothing — it guards whatever subtree the parent hands it and only ever shows one of two things, the
// healthy children or a fallback once a child has reported a failure. There is no query to be loading, to be
// empty, to go stale, or to be offline, so inventing those states would be dishonest. The owning screen that
// DOES fetch renders its own data surface (with those states) inside this boundary. The surface's REAL,
// fully-reproduced states are therefore: healthy pass-through, and the three fallback branches above — each
// reduced here in [classifyFallback] and asserted off-device, doubling as the per-state snapshot.
//
// Native error-capture note (ADR-002): Compose cannot intercept exceptions thrown during the composition phase
// the way a React error boundary can, so the native idiom — shared with the component-library
// `components/feedback/ErrorBoundary` atom this surface composes — is for failures caught in event handlers /
// effects / coroutine bodies to be reported into an `ErrorBoundaryState`, which flips the boundary to its
// fallback. That is a platform-faithful reproduction of the web boundary's behaviour, not a shortcut.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/SectionErrorBoundary — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AlertBanner / UserCell surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.sectionerrorboundary

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no boundary name, no error
 * message, and no stack — only this constant identifier — so a diagnostics line can never leak guarded content.
 */
const val SECTION_ERROR_BOUNDARY_SLUG: String = "SectionErrorBoundary"

/**
 * Canonical registry metadata for the SectionErrorBoundary surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`SectionErrorBoundary`).
 */
object SectionErrorBoundaryRegistration {
    /** Stable surface id (also the `viewModel`-style key prefix a host could bind the boundary with). */
    const val ID: String = "section-error-boundary"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = SECTION_ERROR_BOUNDARY_SLUG
}

/**
 * Which fallback the boundary paints once a child has reported a failure — the native mirror of the web
 * `SectionErrorBoundary`'s three-way branch on its `fallback` / `fallbackTitle` props. The healthy path renders
 * the children and is not a fallback kind, so this enum is consulted only when there is an error to show.
 */
enum class SectionFallbackKind {
    /** The host supplied its own `fallback` node — render it verbatim, no Retry (web `fallback !== undefined`). */
    Custom,

    /** The host gave a `fallbackTitle` — a danger card with that title + the subtitle, no Retry (web branch 2). */
    Title,

    /** The default — the boundary's inline card: a localized title, the captured detail, and a Retry (web `inline`). */
    Inline,
}

/**
 * Whether this fallback offers the Retry affordance. Only the [Inline] default does — the host-owned [Custom]
 * node and the message-only [Title] card both omit it, mirroring the web branches that render no Retry button.
 */
val SectionFallbackKind.showsRetry: Boolean
    get() = this == SectionFallbackKind.Inline

/**
 * Reduce the host's props into the fallback branch the boundary shows on error — pure (no Compose), so every
 * branch is exhaustively covered and unit-tested off-device. Precedence matches the web component exactly: a
 * host [hasCustomFallback] node wins; otherwise a non-blank [fallbackTitle] selects the title card (a blank
 * title is treated as absent, mirroring the web falsy `fallbackTitle`); otherwise the inline default.
 */
fun classifyFallback(
    hasCustomFallback: Boolean,
    fallbackTitle: String?,
): SectionFallbackKind =
    when {
        hasCustomFallback -> SectionFallbackKind.Custom
        !fallbackTitle.isNullOrBlank() -> SectionFallbackKind.Title
        else -> SectionFallbackKind.Inline
    }

/**
 * The detail line the inline default card shows beneath its title — the native mirror of the web inline
 * boundary's `{error.message}` paragraph. The captured [message] is shown when present; a blank or absent
 * message degrades to the localized [subtitleFallback] ("Other parts of the page should still work.") so the
 * line is never empty. Pure so the choice is unit-tested without a Compose host.
 */
fun inlineDetail(
    message: String?,
    subtitleFallback: String,
): String = message?.trim()?.takeIf { it.isNotEmpty() } ?: subtitleFallback

/**
 * Build the merged accessibility announcement for a fallback card from its already-localized [title] and
 * [detail] (the composable resolves both through props / i18n). Kept pure so TalkBack-label presence is
 * unit-tested without a Compose host. Blank parts are skipped and joined into one sentence; when both are blank
 * the [emptyFallback] caption is announced so the alert region is never silent.
 */
fun boundaryAccessibilityLabel(
    title: String?,
    detail: String?,
    emptyFallback: String,
): String {
    val parts = listOfNotNull(title, detail).map { it.trim() }.filter { it.isNotEmpty() }
    return if (parts.isEmpty()) emptyFallback else parts.joinToString(separator = ". ")
}

/**
 * The PII-safe error label for diagnostics — the throwable's simple class name (e.g. `IllegalStateException`),
 * never its message or stack, so a diagnostics line can never leak why a child failed. Anonymous throwables
 * with no simple name collapse to a stable constant. Pure so it is unit-tested with a plain JVM throwable.
 */
fun errorTypeOf(throwable: Throwable): String = throwable::class.simpleName ?: UNKNOWN_ERROR_TYPE

/** Stable label for a throwable without a simple class name (anonymous / synthetic). */
const val UNKNOWN_ERROR_TYPE: String = "Throwable"

/**
 * The PII-safe diagnostics this surface emits (P1/S11). Every event carries only constant identifiers — the
 * surface [SLUG], the host-chosen boundary [name] correlation id (a developer string like
 * "BatteryDegradationChart", never user data), and the error TYPE — never the captured message or stack, so a
 * diagnostics line can never leak the guarded content or why it failed. Kept free of Compose so it is
 * unit-tested with a recording [Logger].
 */
object SectionErrorBoundaryDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SECTION_ERROR_BOUNDARY_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The event emitted (PII-free) whenever the boundary flips to a fallback (web `componentDidCatch`). */
    const val EVENT_CAUGHT: String = "sectionErrorBoundary.caught"

    /** The structured-field key carrying the surface slug on every diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /** The structured-field key carrying the host's boundary correlation id (web `name`). */
    const val FIELD_NAME: String = "name"

    /** The structured-field key carrying the PII-safe error type on a caught event. */
    const val FIELD_ERROR_TYPE: String = "errorType"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }

    /**
     * Emits the PII-safe caught diagnostic when the boundary flips to a fallback — the native analogue of the
     * web boundary's `componentDidCatch` log. Carries only the surface slug, the host [name] correlation id, and
     * the [errorType] class name — never the message or stack — so observability never leaks guarded content.
     */
    fun recordCaught(
        logger: Logger,
        name: String,
        errorType: String,
    ) {
        logger.warn(
            EVENT_CAUGHT,
            mapOf(
                FIELD_SURFACE to SLUG,
                FIELD_NAME to name,
                FIELD_ERROR_TYPE to errorType,
            ),
        )
    }
}
