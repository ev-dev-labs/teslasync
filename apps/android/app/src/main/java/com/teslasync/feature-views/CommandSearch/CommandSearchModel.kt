// Pure, framework-free model for the CommandSearch feature view — the native analogue of everything the web
// component derives before returning JSX (web/src/features/system/components/CommandSearch.tsx). No Compose,
// no Android, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// CommandSearch is the Vehicle Command Center's command filter — a controlled text field whose only web hook
// is `useTranslation`. It owns no state of its own (the parent supplies `value` and receives every keystroke
// through `onChange`) and shows a localized ghost prompt while the field holds the empty string. This file
// owns the two derivations the composable switches on: the controlled field's empty-vs-active query state
// (the web ghost prompt is shown only while the value is the empty string), and the top-level lifecycle
// classifier the shared feature-view contract (P1/S8) carries — loading / error / ready — so the surface can
// render every state the prompt's matrix mandates even though the field itself fetches nothing.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/CommandSearch — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path, exactly as the sibling AddressInput / UrlEncoder surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.commandsearch

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the typed
 * query text — so a diagnostics line can never leak what the user is searching for.
 */
object CommandSearchDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "CommandSearch"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/**
 * The three mutually-exclusive top-level surfaces the composable renders. The field has no network feed, so a
 * host normally supplies [Ready]; [Loading] and [Error] are the lifecycle chrome the shared feature-view
 * contract (P1/S8) can still carry — reproduced for full state coverage, never faked from a fetch the field
 * does not perform.
 */
enum class CommandSearchSurfaceState { Loading, Error, Ready }

/**
 * Classifies the host lifecycle flags into the top-level [CommandSearchSurfaceState] — the pure mirror of the
 * composable's `when` (loading first, then a hard error, otherwise the ready field). Kept framework-free so
 * each branch is asserted off-device.
 */
fun commandSearchSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): CommandSearchSurfaceState =
    when {
        isLoading -> CommandSearchSurfaceState.Loading
        isError -> CommandSearchSurfaceState.Error
        else -> CommandSearchSurfaceState.Ready
    }

/**
 * Whether the controlled field currently holds a query. The web renders the ghost prompt only while the value
 * is the empty string (an HTML input shows its prompt for `value === ''`), so a single space already counts as
 * an [Active] query — hence [Empty] is decided with `isEmpty`, never `isBlank`, to match that exact contract.
 */
enum class CommandSearchQueryState { Empty, Active }

/**
 * Projects the raw controlled [value] to its [CommandSearchQueryState] — [Empty] for the empty string (the web
 * ghost-prompt branch), [Active] for any non-empty value. The pure mirror of the web controlled-input read.
 */
fun commandSearchQueryStateFor(value: String): CommandSearchQueryState =
    if (value.isEmpty()) CommandSearchQueryState.Empty else CommandSearchQueryState.Active
