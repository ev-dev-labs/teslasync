// Pure, framework-free model + projection + diagnostics for the NoVehicleSelected feature view — the
// native analogue of web/src/features/onboarding/components/NoVehicleSelected.tsx. No Compose, no
// Android, no HTTP: every declaration here is exercised off-device in the :app:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// NoVehicleSelected is a defensive empty-state surface. The web component is presentational: given a
// localized `pageTitle` (and optional `title` / `description` overrides) it renders a PageContainer →
// GlassPanel → EmptyState with a Car icon, the localized "No vehicle selected" title + description,
// and a "Set up TeslaSync" CTA that navigates to `/onboarding`. Its genuine web hooks are
// `useTranslation` (→ the i18n facade) and `useNavigate` (→ the onboarding target, emitted to the host
// as a callback). `useSelectedVehicle` is the *contextual* hook named in the prompt: the web doc
// comment explains this surface is what a host page renders while `useSelectedVehicle().vehicleId` is
// null. That host guard is modeled here as the pure [shouldRender] projection (the shared
// SelectedVehicleStore — P1/S8 — is the holder a host observes); it is never re-read inside the
// presentational surface, exactly as the web component never reads it itself (honesty covenant: no
// silent drift).
//
// The surface binds no data feed, so there is no real loading/error/stale/offline fetch lifecycle. The
// [NoVehicleSelectedSurfaceState] classifier still maps the shared P1/S8 lifecycle the feature-view
// contract can carry — Empty is this surface's natural, default presentation (it *is* the empty
// state), while Loading/Error are honest lifecycle chrome a host may supply, never faked from a fetch
// the surface does not perform.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/NoVehicleSelected — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package identifier (a hyphen segment is illegal), so the package intentionally diverges
// from the path — exactly as the sibling LegacyAlertRulesRedirect / UrlEncoder surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.novehicleselected

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object NoVehicleSelectedRegistration {
    /** Stable surface id. */
    const val ID: String = "no-vehicle-selected"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "NoVehicleSelected"
}

/**
 * The canonical onboarding navigation target — the native analogue of the web `navigate('/onboarding')`.
 * The surface never touches the NavController; it emits this intent through its `onSetUp` callback and
 * the host navigates (the same decoupling the sibling LegacyAlertRulesRedirect port uses). The constants
 * are cross-checked against [io.teslasync.android.navigation.Destinations] in the unit test, so the port
 * can never drift from the canonical navigation graph.
 */
object NoVehicleSelectedNavigation {
    /** The canonical onboarding destination id (web `to: '/onboarding'`). */
    const val ONBOARDING_DESTINATION_ID: String = "onboarding"

    /** The Navigation-Compose route of the onboarding destination (web path without its leading slash). */
    const val ONBOARDING_ROUTE: String = "onboarding"

    /** The web-path form, asserted against the destination's `webPath` in tests. */
    const val ONBOARDING_WEB_PATH: String = "/onboarding"
}

/**
 * The web `t(key, default)` fallback strings. The web calls `t('common.noVehicleSelected.title', …)`,
 * `t('common.noVehicleSelected.desc', …)`, and `t('common.noVehicleSelected.action', …)`; these keys
 * exist in the generated i18n catalog (en/ar/he), so the values below are the English source strings the
 * composable shows via `stringResource`, reproduced here for the off-device contract test.
 */
object NoVehicleSelectedDefaults {
    /** Web `t('common.noVehicleSelected.title', 'No vehicle selected')`. */
    const val TITLE: String = "No vehicle selected"

    /** Web `t('common.noVehicleSelected.desc', 'Add a vehicle to your fleet to see data on this page.')`. */
    const val DESCRIPTION: String = "Add a vehicle to your fleet to see data on this page."

    /** Web `t('common.noVehicleSelected.action', 'Set up TeslaSync')`. */
    const val ACTION: String = "Set up TeslaSync"
}

/** Android resource name for the web `common.noVehicleSelected.title` key (catalog presence asserted in tests). */
const val KEY_TITLE: String = "translation_common_noVehicleSelected_title"

/** Android resource name for the web `common.noVehicleSelected.desc` key. */
const val KEY_DESCRIPTION: String = "translation_common_noVehicleSelected_desc"

/** Android resource name for the web `common.noVehicleSelected.action` key. */
const val KEY_ACTION: String = "translation_common_noVehicleSelected_action"

/**
 * The three top-level surfaces the composable renders. The surface binds no network feed, so [Empty] is
 * its natural, default presentation (it *is* the "no vehicle selected" empty state); [Loading] and
 * [Error] are the lifecycle chrome the shared feature-view contract (P1/S8) can still carry — reproduced
 * for full state coverage, never faked from a fetch the surface does not perform.
 */
enum class NoVehicleSelectedSurfaceState { Loading, Error, Empty }

/**
 * Classifies the shared lifecycle flags into the top-level [NoVehicleSelectedSurfaceState] — the pure
 * mirror of the composable's `when` (loading first, then a hard error, otherwise the empty presentation).
 * A stale/offline value (cached content shown after a failed refresh) is neither loading nor a hard
 * error, so it resolves to [NoVehicleSelectedSurfaceState.Empty] — this surface holds no cached payload
 * of its own to label stale. Kept framework-free so each branch is asserted off-device.
 */
fun noVehicleSelectedSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): NoVehicleSelectedSurfaceState =
    when {
        isLoading -> NoVehicleSelectedSurfaceState.Loading
        isError -> NoVehicleSelectedSurfaceState.Error
        else -> NoVehicleSelectedSurfaceState.Empty
    }

/**
 * The host-side guard — the native analogue of the web doc comment's `useSelectedVehicle().vehicleId`
 * null check that decides whether a page renders this defensive surface. Returns true when no vehicle is
 * selected ([selectedVehicleId] is null). The shared `SelectedVehicleStore` (P1/S8) is the holder a host
 * observes; the surface itself, once mounted, always renders its presentation (web parity), so this
 * projection lives here for hosts + tests rather than being re-read inside the view.
 */
fun shouldRender(selectedVehicleId: Long?): Boolean = selectedVehicleId == null

/**
 * Resolves the web `override ?? default` null-coalescing for the optional `title` / `description` props:
 * returns [override] when the caller supplied one, otherwise the localized [fallback]. Mirrors JS `??`
 * (only a null override falls back), keeping caller-supplied text verbatim.
 */
fun resolveOverride(
    override: String?,
    fallback: String,
): String = override ?: fallback

/**
 * Folds the empty state's [title] and [message] into a single TalkBack content description
 * ("<title>. <message>") — the combined accessible summary of the no-vehicle region. The action CTA
 * stays a separately-labeled control. Pure so the a11y label is asserted off-device.
 */
fun emptyStateContentDescription(
    title: String,
    message: String,
): String = "$title. $message"

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [NoVehicleSelectedRegistration.SLUG]
 * (P1/S11). Carries no vehicle id or VIN, so a diagnostics line can never leak the fleet's posture. Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordNoVehicleSelectedOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to NoVehicleSelectedRegistration.SLUG))
}
