// Pure, framework-free model + projection + diagnostics for the PinButton shared surface — the native
// analogue of every value the web component derives before it returns JSX
// (web/src/components/ui/PinButton.tsx composed with web/src/api/hooks/usePinned.ts). No Compose, no
// Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer (ADR-002).
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a focusable,
// icon-only "pin" affordance for a single row. It reads the unified pin feed `usePinned(itemType,
// context)` (defaulting the list to `[]`), derives `isPinned = pins.some(p => String(p.item_id) ===
// String(itemId))`, and renders a button whose icon (lucide `Pin` ⇄ `PinOff`), amber-vs-muted tint,
// tooltip + `aria-label` ("Pin" ⇄ "Unpin"), and optional visible label ("Pin" ⇄ "Pinned") all flip with
// that flag. Tapping calls `useTogglePin(itemType).mutate({ itemId, context, pin: !isPinned })`, which
// POSTs to pin or resolves-then-DELETEs to unpin and raises a success/error toast; while the mutation is
// in flight the button is `disabled`. The click stops propagation so a pin toggle never also fires the
// surrounding row's navigation.
//
// Honest state set. The pin feed is a genuine cache-then-network read (ADR-013), but — exactly like the
// web, which defaults the list to `[]` and ALWAYS renders the button — its lifecycle never hides the
// affordance. So the projected [PinButtonData] is never "empty": a resolved EMPTY pin list simply means
// "this item is not pinned", which is the fully-interactive unpinned content state, not a blank box;
// modelling a separate empty surface here would fabricate behaviour the web never shows (covenant #9).
// The freshness envelope (loading / stale / offline / hard error) is preserved by
// [projectPinButtonResource] and surfaced ADDITIVELY at the render boundary (a button-sized busy
// indicator on first load, a freshness chip when stale / refreshing / offline, a Retry affordance on a
// hard read error) without ever replacing the toggle — the same "render every state, hide no region"
// contract the sibling VehiclePicker surface honours.
//
// The web `PinOff` glyph has no entry in the shared `TeslaGlyphs` set (and that set is outside this
// surface's allowed files), so the pinned state is conveyed exactly as the native atomic `PinButton`
// already does: the single `TeslaGlyphs.Pin` glyph tinted with the warning/amber status color plus the
// label/tooltip switch. The semantic flip (icon meaning + color + spoken name) is fully reproduced.
//
// `InvalidPackageDeclaration` / `MatchingDeclarationName` are suppressed because this surface's mandated
// directory (com/teslasync/shared-surfaces/PinButton — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling shared surfaces do, and this
// file co-locates several supporting declarations alongside the namesake registration object.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pinbutton

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import java.util.UUID

/**
 * Canonical registry metadata for the PinButton surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`PinButton`); [ID]
 * is the `viewModel` key prefix the composable binds its state holder with, and the test tags name the
 * nodes the on-device UI test drives. [ROOT_TEST_TAG] is present in EVERY render state.
 */
object PinButtonRegistration {
    /** Stable surface id, also the `viewModel` key prefix the composable binds its holder with. */
    const val ID: String = "pin-button"

    /** Diagnostics surface slug emitted with the `view.opened` / toggle events (P1/S11). */
    const val SLUG: String = "PinButton"

    /** Test tag on the surface root — present in loading, content, and error states. */
    const val ROOT_TEST_TAG: String = "pin-button"

    /** Test tag on the interactive toggle node (the icon / labelled button). */
    const val TOGGLE_TEST_TAG: String = "pin-button-toggle"

    /** Test tag on the Retry affordance shown when a hard read error left no cached pin state. */
    const val RETRY_TEST_TAG: String = "pin-button-retry"
}

/**
 * The icon scale — the native mirror of the web `size: 'sm' | 'md'` prop (`sm` = compact list/table cell,
 * `md` = card header). Maps to the shared [io.teslasync.android.components.ui.IconSize] at the render
 * boundary.
 */
enum class PinButtonSize { Sm, Md }

/**
 * The Android string-resource names the surface resolves through the i18n facade (P1/S10). The web
 * source's literals are the `t('pin.pin')` / `t('pin.unpin')` / `t('pin.pinned')` labels and the
 * `useTogglePin` toast copy (`toast.pin.*`); the freshness microcopy the always-rendered native surface
 * needs for the states the web defers reuses catalog keys that already ship in `values/`, `values-ar/`
 * and `values-he/` rather than inventing new ones (the same approach the sibling surfaces take). Each
 * name is asserted by value in the unit test; resource bytes are not read off-device.
 */
object PinButtonKeys {
    /** Pin action label — web `t('pin.pin', 'Pin')`. */
    const val PIN: String = "translation_pin_pin"

    /** Pinned state label — web `t('pin.pinned', 'Pinned')`. */
    const val PINNED: String = "translation_pin_pinned"

    /** Unpin action label — web `t('pin.unpin', 'Unpin')`. */
    const val UNPIN: String = "translation_pin_unpin"

    /** Stale chip — web `t('mqtt.stale', 'Stale')`. */
    const val STALE: String = "translation_mqtt_stale"

    /** Offline chip — web `t('common.offline', 'Offline')`. */
    const val OFFLINE: String = "translation_common_offline"

    /** Refreshing chip — web `t('freshness.updating', 'updating…')`. */
    const val UPDATING: String = "translation_freshness_updating"

    /** Retry affordance — web `t('common.retry', 'Retry')`. */
    const val RETRY: String = "translation_common_retry"

    /** Loading affordance label — web `t('common.loading', 'Loading...')`. */
    const val LOADING: String = "translation_common_loading"

    /** Pin-success toast — web `success('toast.pin.pinned.success', 'Pinned')`. */
    const val TOAST_PINNED_SUCCESS: String = "translation_toast_pin_pinned_success"

    /** Pin-failure toast — web `error(e, 'toast.pin.pinned.error', 'Failed to pin')`. */
    const val TOAST_PINNED_ERROR: String = "translation_toast_pin_pinned_error"

    /** Unpin-success toast — web `success('toast.pin.unpinned.success', 'Unpinned')`. */
    const val TOAST_UNPINNED_SUCCESS: String = "translation_toast_pin_unpinned_success"

    /** Unpin-failure toast — web `error(e, 'toast.pin.unpinned.error', 'Failed to unpin')`. */
    const val TOAST_UNPINNED_ERROR: String = "translation_toast_pin_unpinned_error"
}

/** The English source strings the web `t(key, default)` calls fall back to (off-device contract). */
object PinButtonDefaults {
    const val PIN: String = "Pin"
    const val PINNED: String = "Pinned"
    const val UNPIN: String = "Unpin"
}

/**
 * The three localized button labels resolved at the render boundary (P1/S10) and folded into the pure
 * label helpers. They travel together because a label decision needs all three: [pin] (the unpinned
 * action + unpinned visible text), [pinned] (the pinned visible text), and [unpin] (the pinned action /
 * tooltip / accessible name).
 *
 * @property pin web `t('pin.pin', 'Pin')`.
 * @property pinned web `t('pin.pinned', 'Pinned')`.
 * @property unpin web `t('pin.unpin', 'Unpin')`.
 */
data class PinButtonLabels(
    val pin: String,
    val pinned: String,
    val unpin: String,
)

/**
 * The already-localized toast copy resolved at the render boundary (P1/S10) and handed to the holder so
 * the framework-free state holder raises the right toast without touching the i18n catalog — the native
 * analogue of the `useTogglePin` `onSuccess`/`onError` messages. Carries all four branches the toggle can
 * resolve to ([pin] direction × success/failure), picked by [pinToggleToastTitle].
 *
 * @property pinnedSuccess web `success('toast.pin.pinned.success', 'Pinned')`.
 * @property pinnedError web `error(e, 'toast.pin.pinned.error', 'Failed to pin')`.
 * @property unpinnedSuccess web `success('toast.pin.unpinned.success', 'Unpinned')`.
 * @property unpinnedError web `error(e, 'toast.pin.unpinned.error', 'Failed to unpin')`.
 */
data class PinButtonToastCopy(
    val pinnedSuccess: String,
    val pinnedError: String,
    val unpinnedSuccess: String,
    val unpinnedError: String,
)

/**
 * The projected surface payload: whether the bound item is currently pinned — the native mirror of the
 * web `const isPinned = pinned.some(...)`. A single boolean is all the view needs to choose the icon
 * tint, the labels, and the toggle direction. Never "empty" (see file header): both pinned and unpinned
 * are fully-rendered content states.
 */
data class PinButtonData(
    val isPinned: Boolean,
) {
    companion object {
        /** The neutral payload before any pin list has loaded — the web `[]` default (unpinned). */
        val UNPINNED: PinButtonData = PinButtonData(isPinned = false)
    }
}

/**
 * Whether [itemId] appears in [pins] — the native mirror of the web
 * `pins.some(p => String(p.item_id) === String(itemId))`. The pin's [PinnedItem.itemId] is the
 * stringified row id (the wire contract); [itemId] is compared verbatim (callers stringify a numeric id
 * the same way the web `String(itemId)` does).
 */
fun isItemPinned(
    pins: List<PinnedItem>,
    itemId: String,
): Boolean = pins.any { it.itemId == itemId }

/**
 * Projects the current [pins] for the bound bucket onto the [PinButtonData] the view renders — the
 * native analogue of the web `isPinned` derivation. This is the "cached → projection" adapter the unit
 * gate exercises.
 */
fun projectPinButton(
    pins: List<PinnedItem>,
    itemId: String,
): PinButtonData = PinButtonData(isPinned = isItemPinned(pins, itemId))

/**
 * Maps a raw `GET /pinned` [Resource] onto a typed [Resource] of the projected [PinButtonData],
 * preserving the cache-then-network envelope (cached value, freshness stamp, staleness, error) so the
 * downstream [io.teslasync.android.data.UiState] projection still resolves loading / content / stale /
 * offline / error correctly while the always-present button reflects the best-known pin state.
 */
fun projectPinButtonResource(
    resource: Resource<List<PinnedItem>>,
    itemId: String,
): Resource<PinButtonData> =
    when (resource) {
        is Resource.Loading ->
            Resource.Loading(
                cached = resource.cached?.let { projectPinButton(it, itemId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = projectPinButton(resource.data, itemId),
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = resource.cached?.let { projectPinButton(it, itemId) },
                fetchedAt = resource.fetchedAt,
                stale = resource.stale,
                error = resource.error,
            )
    }

/**
 * The toggle DIRECTION for a tap — the native mirror of the web `pin: !isPinned`. A pinned item unpins
 * (`false`), an unpinned item pins (`true`).
 */
fun pinToggleTarget(isPinned: Boolean): Boolean = !isPinned

/**
 * The action label for the current state — the web `tooltipLabel` and `aria-label`
 * (`isPinned ? t('pin.unpin') : t('pin.pin')`). Used for the tooltip AND the accessible name in both the
 * icon-only and labelled variants (the web sets `aria-label={tooltipLabel}` regardless of the visible
 * text). Kept pure so the decision is unit-tested off-device.
 */
fun pinActionLabel(
    isPinned: Boolean,
    labels: PinButtonLabels,
): String = if (isPinned) labels.unpin else labels.pin

/**
 * The visible text label for the labelled (`showLabel`) variant — the web
 * `isPinned ? t('pin.pinned') : t('pin.pin')`. Note this differs from [pinActionLabel] when pinned: the
 * visible word is the STATE ("Pinned") while the spoken/tooltip word is the ACTION ("Unpin"), exactly as
 * the web source separates them.
 */
fun pinStateLabel(
    isPinned: Boolean,
    labels: PinButtonLabels,
): String = if (isPinned) labels.pinned else labels.pin

/**
 * Picks the localized toast title for a resolved toggle — the native mirror of the `useTogglePin`
 * `onSuccess`/`onError` branches: pinning yields "Pinned" / "Failed to pin", unpinning yields
 * "Unpinned" / "Failed to unpin". Pure so the mapping is unit-tested without enqueuing a toast.
 */
fun pinToggleToastTitle(
    pin: Boolean,
    succeeded: Boolean,
    copy: PinButtonToastCopy,
): String =
    when {
        pin && succeeded -> copy.pinnedSuccess
        pin -> copy.pinnedError
        succeeded -> copy.unpinnedSuccess
        else -> copy.unpinnedError
    }

/**
 * The PII-safe resolved outcome of a toggle, emitted as a diagnostics field so a pin action can be
 * observed without ever recording the item id (which can carry a domain identifier). A failed toggle is
 * [Failed] regardless of direction.
 */
enum class PinToggleOutcome {
    /** The item was successfully pinned (web pin POST resolved). */
    Pinned,

    /** The item was successfully unpinned (web unpin DELETE / no-op resolved). */
    Unpinned,

    /** The pin/unpin network call failed (web `onError`). */
    Failed,
}

/** Maps a resolved toggle onto its diagnostics [PinToggleOutcome] (direction + success). */
fun pinToggleOutcome(
    pin: Boolean,
    succeeded: Boolean,
): PinToggleOutcome =
    when {
        !succeeded -> PinToggleOutcome.Failed
        pin -> PinToggleOutcome.Pinned
        else -> PinToggleOutcome.Unpinned
    }

/**
 * Classifies a `/pinned` read failure into the recovery-oriented [QueryErrorKind] the Retry affordance
 * renders — the same fold the sibling surfaces use: an offline/timeout failure is treated as not-online;
 * a circuit-open failure is the transient "waiting" state; otherwise the HTTP status selects the copy.
 */
fun pinButtonErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

/**
 * A fresh per-placement instance id — used as the `viewModel` key suffix so the many pin buttons a dense
 * list / table renders each track their own holder instead of colliding. The native analogue of React
 * giving every `usePinned`/`useTogglePin` call site its own cell.
 */
fun randomPinButtonInstanceId(): String = UUID.randomUUID().toString()

/** The stable, dot-namespaced diagnostics event emitted once when the surface is first composed (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever a pin toggle resolves. */
const val EVENT_TOGGLE: String = "pinButton.toggle"

/** The diagnostics event emitted when the read feed is retried after a hard error. */
const val EVENT_RETRY: String = "pinButton.retry"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the toggle outcome (never the item id). */
const val FIELD_OUTCOME: String = "outcome"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [PinButtonRegistration.SLUG]
 * (P1/S11) — never the item id, type, or context, so a diagnostics line can never leak what a user
 * pinned. Kept free of Compose so it is unit-tested with a recording [Logger]; the holder calls it once
 * per placement open.
 */
fun recordPinButtonOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to PinButtonRegistration.SLUG))
}

/**
 * Emits the PII-safe toggle diagnostic carrying only the surface slug and the resolved [outcome] — never
 * the item id, so a diagnostics line can never leak which row a user pinned.
 */
fun recordPinButtonToggle(
    logger: Logger,
    outcome: PinToggleOutcome,
) {
    logger.info(
        EVENT_TOGGLE,
        mapOf(FIELD_SURFACE to PinButtonRegistration.SLUG, FIELD_OUTCOME to outcome.name.lowercase()),
    )
}

/** Emits the PII-safe retry diagnostic (slug only) when the read feed is re-fetched after an error. */
fun recordPinButtonRetry(logger: Logger) {
    logger.info(EVENT_RETRY, mapOf(FIELD_SURFACE to PinButtonRegistration.SLUG))
}
