// Pure, framework-free model + projection + diagnostics for the WidgetShell widget primitive — the native
// analogue of every layout decision the web source makes (web/src/features/dashboard/widgets/WidgetShell.tsx)
// before Compose paints anything. No Compose, no Android framework, no HTTP: every declaration here is exercised
// off-device in the :android:testReleaseUnitTest gate, so the composable stays a thin render layer over these
// pure functions (the accepted sibling-surface contract — WidgetBigNumber / WidgetComparisonCard models).
//
// What the web source IS (and therefore the complete behaviour this primitive reproduces): the shared chrome that
// wraps every dashboard widget. It is purely presentational — it performs no query and owns no data of its own;
// every visible string (title, help text, actions) is handed in by the host. It plays three top-level branches in
// strict precedence:
//   1. `loading`  → a full-cell `Skeleton` (early return, no header, no children).
//   2. `error`    → a centered `QueryError` (early return). The web wraps the message in `new Error(error)`, which
//                   carries no HTTP status, so the web `QueryError` falls through to its generic "can't reach
//                   server" (network) branch and shows CANNED recovery copy — never the raw message. The `error`
//                   string is therefore a PRESENCE signal, not display text (honesty covenant: no silent drift —
//                   we reproduce exactly what the web renders, which is the classified panel, not the message).
//   3. content    → the header (icon + uppercase muted title + optional help "?" + freshness chip + optional pin +
//                   actions) over the body slot. When there is no title the header collapses to an overlay
//                   freshness chip (top-end) plus an optional right-aligned actions row, exactly as the web `title
//                   ? … : …` ternary does.
//
// Freshness: the web exposes two mutually-exclusive input modes — granular props (`updatedAt`/`isFetching`/
// `isStale`/`isError`) or an entire TanStack query (`query`). Granular wins when `updatedAt` is supplied; otherwise
// the query is unwrapped (the web `DataFreshnessAuto` does literally this: `updatedAt = dataUpdatedAt > 0 ?
// dataUpdatedAt : null`, then the same four flags). [WidgetShellModel.project] normalizes BOTH modes into one
// [WidgetShellFreshnessState] so the composable renders a single shared `DataFreshness` atom — the four data-surface
// states the prompt enumerates (fresh / fetching / stale / error→offline) are reproduced THROUGH that atom, with
// `compact = !title` mirroring the web `freshnessCompact`.
//
// Why "empty" is not a branch here: like the web shell, this primitive delegates the empty state to its `content`
// slot — the host passes an `EmptyState` as the body when it has no rows (honesty covenant: no scope narrowing —
// the empty surface is reproduced, just owned by the caller exactly as on the web). The "offline" state is the
// freshness atom's `isError` tier (web maps the error freshness to the offline chip), so it too is reproduced.
//
// `InvalidPackageDeclaration` is suppressed because this primitive's mandated directory
// (com/teslasync/widget-primitives/WidgetShell — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling widget / shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetshell

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the WidgetShell primitive. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`WidgetShell`).
 */
object WidgetShellRegistration {
    /** Stable primitive id (also the key a host would bind the primitive with). */
    const val ID: String = "widget-shell"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "WidgetShell"
}

/**
 * The web-default knobs kept as named constants so the composable and the unit gate agree on one source of truth —
 * no loose numerals drift between the render layer and its tests.
 */
object WidgetShellDefaults {
    /**
     * The green "just updated" glow hold in milliseconds — the web `setTimeout(…, 1500)` that clears the
     * `shadow-[…]` pulse 1.5s after the data timestamp changes.
     */
    const val PULSE_HOLD_MS: Long = 1_500L
}

/**
 * The three top-level branches the web shell plays, in strict precedence (loading wins over error wins over
 * content), so the composable renders exactly one and never paints children during loading/error.
 */
enum class WidgetShellPhase { Loading, Error, Content }

/**
 * The TanStack-query freshness input — the native analogue of the web `FreshnessQuery`
 * (`Pick<UseQueryResult, 'isFetching' | 'isStale' | 'isError' | 'dataUpdatedAt' | 'refetch'>`). The `refetch`
 * member is supplied separately as the composable's `onRefresh` lambda (a render concern), so this pure type
 * carries only the four data flags.
 *
 * @param dataUpdatedAtMillis ms timestamp of the last successful fetch (0 = never), web `dataUpdatedAt`.
 * @param isFetching whether a fetch is in flight (web `isFetching`).
 * @param isStale whether the data is past its staleTime (web `isStale`).
 * @param isError whether the query is in an error state (web `isError`).
 */
data class WidgetShellFreshnessQuery(
    val dataUpdatedAtMillis: Long,
    val isFetching: Boolean = false,
    val isStale: Boolean = false,
    val isError: Boolean = false,
)

/**
 * Optional contextual help for the widget title — the native analogue of the web `help?: WidgetHelp`. Native i18n
 * resolves at the call site (`stringResource`), so the host hands in the already-localized [text]; the shell
 * forwards it to the `HelpIcon` atom together with a title-derived screen-reader label (the web "More info about
 * {title}" `ariaLabel`). The web `WidgetHelp.learnMore` is a capability of the out-of-scope HelpTooltip atom (the
 * P3 component-library bundle), not of this shell, so it is not part of the primitive's surface.
 *
 * @param text the resolved help body shown in the tooltip (web `help.text` / resolved `help.i18nKey`).
 */
data class WidgetShellHelp(
    val text: String,
)

/**
 * The normalized freshness the composable paints — the single shape both web input modes (granular props and the
 * `query`) collapse into, so one `DataFreshness` atom serves every caller.
 *
 * @param updatedAtMillis the last-fetch timestamp, or `null` when never fetched (web `updatedAt > 0 ? … : null`).
 * @param isFetching whether a fetch is in flight (animated chip).
 * @param isStale whether the data is past its staleTime (amber chip).
 * @param isError whether the fetch failed (the web error→offline chip).
 * @param compact dot-only chip with no relative-time text — the web `freshnessCompact = !title`.
 */
data class WidgetShellFreshnessState(
    val updatedAtMillis: Long?,
    val isFetching: Boolean,
    val isStale: Boolean,
    val isError: Boolean,
    val compact: Boolean,
)

/**
 * The presentational inputs the pure [WidgetShellModel.project] reduces — the native analogue of the web
 * `WidgetShellProps` minus the render-only slots (`icon`/`actions`/`children` Compose lambdas) and the `onRefresh`
 * callback, which live on the composable. Grouped into one spec so the projection stays under the parameter budget
 * and the composable has a single value to derive from.
 *
 * @param title the widget title; blank collapses to no header (web `title`).
 * @param loading whether the first fetch is in flight (web `loading`).
 * @param error the error PRESENCE signal; non-empty triggers the error branch (web `error`).
 * @param updatedAtMillis granular last-fetch timestamp, or `null` when the caller uses the [query] mode instead
 *   (web `updatedAt` — `undefined` ⇒ not the granular mode).
 * @param isFetching granular fetching flag (web `isFetching`, default `false`).
 * @param isStale granular stale flag (web `isStale`, default `false`).
 * @param isError granular error flag (web `isError`, default `false`).
 * @param query the TanStack-query freshness mode, used when [updatedAtMillis] is `null` (web `query`).
 * @param hasHelp whether contextual help was supplied (web `help != null`); the "?" shows only WITH a title.
 * @param widgetId the stable widget id; with [dashboardId] it gates the pin affordance (web `widgetId`).
 * @param dashboardId the per-dashboard pin context (web `dashboardId`).
 */
data class WidgetShellSpec(
    val title: String? = null,
    val loading: Boolean = false,
    val error: String? = null,
    val updatedAtMillis: Long? = null,
    val isFetching: Boolean = false,
    val isStale: Boolean = false,
    val isError: Boolean = false,
    val query: WidgetShellFreshnessQuery? = null,
    val hasHelp: Boolean = false,
    val widgetId: String? = null,
    val dashboardId: String? = null,
)

/**
 * The render-ready projection of a [WidgetShellSpec] — the pure data the composable paints. The title is
 * normalized (blank collapses to `null` so a stray empty prop never reserves the header), the freshness is
 * resolved from whichever input mode the caller used, and the pin/help gates are pre-computed so the render layer
 * is a flat `when`.
 *
 * @param phase the single branch to render (web's `loading` / `error` early returns vs the content body).
 * @param title the normalized title, or `null` for a title-less (overlay-freshness) widget.
 * @param showHelp whether the help "?" renders — web `help && title` (help shows only alongside a title).
 * @param freshness the normalized freshness chip, or `null` when the caller supplied neither mode.
 * @param showPin whether the pin renders — web `widgetId && dashboardId`.
 * @param effectiveUpdatedAtMillis the timestamp the pulse-on-change effect watches — web
 *   `updatedAt ?? query?.dataUpdatedAt` (the RAW value, before the `> 0` normalization).
 */
data class WidgetShellContent(
    val phase: WidgetShellPhase,
    val title: String?,
    val showHelp: Boolean,
    val freshness: WidgetShellFreshnessState?,
    val showPin: Boolean,
    val effectiveUpdatedAtMillis: Long?,
)

/**
 * The pure projection the composable renders — a 1:1 port of the layout decisions the web `WidgetShell` makes.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only drives
 * the pulse animation clock, resolves i18n strings, and slots the host's `icon`/`actions`/`children`.
 */
object WidgetShellModel {
    /**
     * Reduce a [spec] to its render-ready [WidgetShellContent].
     *
     * Precedence mirrors the web early-returns exactly: `loading` wins over a non-empty `error`, which wins over
     * the content body. The title is trimmed and blank-normalized to `null`. Freshness resolves from the granular
     * props when [WidgetShellSpec.updatedAtMillis] is supplied, otherwise from [WidgetShellSpec.query], otherwise
     * to `null`; either way the timestamp is `> 0`-normalized so a never-fetched widget reads "never updated"
     * rather than the epoch. `compact` follows the web `!title`. The pin and help gates match the web truthiness
     * checks (`widgetId && dashboardId`, `help && title`).
     */
    fun project(spec: WidgetShellSpec): WidgetShellContent {
        val title = spec.title?.trim()?.takeIf { it.isNotEmpty() }
        val phase =
            when {
                spec.loading -> WidgetShellPhase.Loading
                // Web `if (error)` — JS string truthiness: "" is falsy, any non-empty string (incl. whitespace) is
                // truthy. isNullOrEmpty reproduces that exactly.
                !spec.error.isNullOrEmpty() -> WidgetShellPhase.Error
                else -> WidgetShellPhase.Content
            }

        val freshness = resolveFreshness(spec, compact = title == null)

        return WidgetShellContent(
            phase = phase,
            title = title,
            showHelp = spec.hasHelp && title != null,
            freshness = freshness,
            showPin = !spec.widgetId.isNullOrEmpty() && !spec.dashboardId.isNullOrEmpty(),
            effectiveUpdatedAtMillis = spec.updatedAtMillis ?: spec.query?.dataUpdatedAtMillis,
        )
    }

    /**
     * Resolve the single normalized freshness chip from whichever input mode the caller used. Granular props win
     * when [WidgetShellSpec.updatedAtMillis] is non-null (web `updatedAt !== undefined`); otherwise the
     * [WidgetShellSpec.query] is unwrapped (the web `DataFreshnessAuto` derivation); otherwise there is no chip.
     */
    private fun resolveFreshness(
        spec: WidgetShellSpec,
        compact: Boolean,
    ): WidgetShellFreshnessState? =
        when {
            spec.updatedAtMillis != null ->
                WidgetShellFreshnessState(
                    updatedAtMillis = spec.updatedAtMillis.takeIf { it > 0 },
                    isFetching = spec.isFetching,
                    isStale = spec.isStale,
                    isError = spec.isError,
                    compact = compact,
                )

            spec.query != null ->
                WidgetShellFreshnessState(
                    updatedAtMillis = spec.query.dataUpdatedAtMillis.takeIf { it > 0 },
                    isFetching = spec.query.isFetching,
                    isStale = spec.query.isStale,
                    isError = spec.query.isError,
                    compact = compact,
                )

            else -> null
        }

    /**
     * Whether the green "just updated" glow should fire — the web pulse effect condition. Pulses only when the
     * effective timestamp moved to a NEW positive value AND a previous value was already observed (the web
     * `prevUpdatedAt.current !== undefined`), so the very first observation never flashes.
     *
     * @param previousMillis the last observed effective timestamp, or `null` when none has been seen yet.
     * @param currentMillis the current effective timestamp.
     */
    fun shouldPulse(
        previousMillis: Long?,
        currentMillis: Long?,
    ): Boolean =
        currentMillis != null &&
            currentMillis > 0 &&
            previousMillis != null &&
            previousMillis != currentMillis
}

/**
 * PII-safe diagnostics for the primitive (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [WidgetShellRegistration.SLUG] — never the title, help text, freshness timestamp, or any
 * host-supplied copy — so a diagnostics line can never leak what the shell wraps. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it once per open.
 */
object WidgetShellDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to WidgetShellRegistration.SLUG))
    }
}
