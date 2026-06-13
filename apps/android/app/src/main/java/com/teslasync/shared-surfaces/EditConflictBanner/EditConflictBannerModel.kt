// Pure, framework-free model + lease-election logic + render projection + PII-safe diagnostics for the
// EditConflictBanner shared surface — the native analogue of every decision the web component makes
// (web/src/components/feedback/EditConflictBanner.tsx) before it paints its alert. No Compose, no Android,
// no HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • An in-place "another browser tab is editing this" warning. It wraps `useEditLease(resourceKey)`
//     (web/src/hooks/useEditLease.ts) — a BroadcastChannel-backed, same-origin, tab-to-tab edit-lease
//     coordinator — and renders an `AlertBanner` ONLY when this view does NOT own the lease AND a peer has
//     been observed claiming it (`if (isOwner || otherTab === null) return null`). It exposes two
//     affordances: "Take over editing" (calls `claim()`, bumping `claimedAt` so the previous owner yields in
//     lockstep) and an informational "switch to your other tab" hint. It auto-disappears when the owning
//     view releases the lease. Its only other hook is `useTranslation`.
//   • So it has exactly ONE visible state (the conflict banner) and TWO invisible states (this view owns the
//     lease, or no peer has been observed yet) — both of which the web renders as `null`. This native port
//     reproduces all three: [EditConflictPhase.Conflict] (the banner) and [EditConflictPhase.Hidden]
//     (render nothing), decided by [EditConflictProjection.project] exactly as the web `if` does.
//
// How that maps onto the native shared state-holder layer (P1/S8, ADR-002): the web hook is a genuine
// stateful coordinator (an election with acquire/claim/release, a deterministic tiebreaker, and lockstep
// hand-off), so unlike a purely presentational banner this surface binds a real state holder. The native
// `useEditLease` analogue is an in-process edit-lease registry (EditConflictBannerSource.kt) that coordinates
// multiple in-app holders of the same `resourceKey` — the honest Android counterpart of the web's
// cross-tab BroadcastChannel bus, modelling the real multi-window / multi-instance scenario where the same
// resource is open in two places and a save in one would clobber the other. The view binds ONE holder through
// the [io.teslasync.android.sharedsurfaces.editconflictbanner.EditLeaseSource] seam via the ViewModel and
// performs NO HTTP. The election arithmetic + the render decision live here as pure functions so the whole
// contract is covered by the JVM unit gate without a Compose host or a live registry.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing and opens no stream — it is a same-process coordination signal, exactly as the web
// source is a same-origin one. There is no query whose freshness could go stale, no network that could go
// offline, and no request that could fail; modelling any of those would invent a fetch the web spec does not
// have (honesty covenant: no scope narrowing, no parity shortcuts, no silent drift). The surface's real,
// fully reproduced states are the Hidden surface (owner / no peer → web `null`) and the Conflict surface (a
// peer holds the lease → the banner), each reduced here and asserted off-device. The sibling AiLimitBanner
// records the same justification for the same reason.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/EditConflictBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as every sibling shared surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.editconflictbanner

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the EditConflictBanner surface — the native mirror of the web component's
 * contract. The diagnostics [SLUG] is emitted with the one-shot `view.opened` event (P1/S11) and is the
 * surface slug the prompt mandates (`EditConflictBanner`).
 */
object EditConflictBannerRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "EditConflictBanner"
}

/**
 * Information about a peer holder that currently owns the edit lease — the native port of the web
 * `OtherTabInfo` (`{ tabId, claimedAt }`, web/src/hooks/useEditLease.ts). Carried on a non-owner's snapshot so
 * the banner can flag the conflict and (for parity with the web `data-other-tab-id` attribute) identify the
 * peer. No vehicle id, no payload — only the opaque holder identity and its claim stamp.
 *
 * @property tabId the opaque, stable identity of the peer holder that owns the lease.
 * @property claimedAt the wall-clock stamp at which the peer claimed the lease (web `claimedAt`).
 */
data class OtherHolder(
    val tabId: String,
    val claimedAt: Long,
)

/**
 * The lease state for a single holder — the native port of the web `LeaseState` (`{ isOwner, otherTab }`,
 * web/src/hooks/useEditLease.ts). [otherTab] is `null` when this holder owns the lease OR no peer has been
 * observed claiming it yet; both collapse to the Hidden banner exactly like the web `isOwner || otherTab ===
 * null` guard.
 *
 * @property isOwner this holder currently owns the edit lease for the resource (web `isOwner`).
 * @property otherTab the peer holder that owns the lease, or `null` when this holder owns it / none observed.
 */
data class EditLeaseSnapshot(
    val isOwner: Boolean,
    val otherTab: OtherHolder?,
) {
    companion object {
        /**
         * The neutral, no-conflict snapshot: not the owner and no peer observed (web's freshly-mounted,
         * pre-election state). Renders the Hidden surface. Used as the cold-start seed for the holder's flow
         * so the first frame is never an artificial banner.
         */
        fun none(): EditLeaseSnapshot = EditLeaseSnapshot(isOwner = false, otherTab = null)
    }
}

/**
 * One participant in the edit-lease election — the native analogue of a single browser tab in the web
 * BroadcastChannel protocol. [claimedAt] is `null` while the holder has joined but never granted itself
 * ownership (a pure observer that yields to an existing owner, web's "a new tab does not claim on mount"); a
 * non-null stamp means the holder has claimed the lease at that wall-clock time.
 *
 * @property id the opaque, stable identity of this holder (web `tabId`).
 * @property claimedAt the time this holder claimed ownership, or `null` if it has never claimed.
 */
data class HolderInput(
    val id: String,
    val claimedAt: Long?,
)

/**
 * Pure election arithmetic — the native port of the web `useEditLease` owner resolution + tiebreaker, lifted
 * out of the registry so it is unit-tested off-device without any coordination machinery.
 */
object EditLeaseElection {
    /**
     * The current owner among [holders]: the claimer (a holder with a non-null `claimedAt`) with the newest
     * claim; ties are broken by the lexicographically lower [HolderInput.id]. This is the exact web tiebreaker
     * (`peer.claimedAt > mine || (peer.claimedAt === mine && peer.tabId < mine)` — newer claim wins, equal
     * claim falls back to the lower id). Returns `null` when no holder has claimed (an empty or all-observer
     * group), which the projection renders as the Hidden surface.
     */
    fun ownerOf(holders: List<HolderInput>): HolderInput? =
        holders
            .asSequence()
            .filter { it.claimedAt != null }
            .maxWithOrNull(compareBy<HolderInput> { it.claimedAt }.thenByDescending { it.id })

    /**
     * Projects the lease state for the holder identified by [holderId] given the full [holders] roster — the
     * native mirror of what the web hook returns to a single `useEditLease` caller. The holder owns the lease
     * when it is the elected owner; otherwise it observes the owner as its [OtherHolder] peer (the web
     * `otherTab`). A roster with no claimer yields the neutral [EditLeaseSnapshot.none].
     */
    fun snapshotFor(
        holderId: String,
        holders: List<HolderInput>,
    ): EditLeaseSnapshot {
        val owner = ownerOf(holders) ?: return EditLeaseSnapshot.none()
        val isOwner = owner.id == holderId
        return EditLeaseSnapshot(
            isOwner = isOwner,
            otherTab = if (isOwner) null else OtherHolder(owner.id, owner.claimedAt ?: 0L),
        )
    }
}

/**
 * The mutually-exclusive render surface the banner draws — the native mirror of the web component's two
 * outcomes. [Conflict] reproduces the visible `AlertBanner`; [Hidden] reproduces the web `return null` for
 * both the owner and the no-peer-observed states.
 */
enum class EditConflictPhase {
    /** This holder owns the lease, or no peer has been observed — render nothing (web `null`). */
    Hidden,

    /** A peer holds the lease while this holder does not — render the warning banner (web `AlertBanner`). */
    Conflict,
}

/**
 * The immutable, render-ready projection the composable draws — everything the web `EditConflictBanner`
 * decides between `useEditLease` and the rendered JSX. Pure data so [EditConflictProjection] is unit-tested
 * without a UI host; the composable only resolves localized strings + design tokens from it.
 *
 * @property phase whether the banner is shown (web `isOwner || otherTab === null ? null : <banner/>`).
 * @property otherTabId the peer holder's id when in conflict (web `data-other-tab-id`), else `null`. Carried
 *   for the banner's parity test tag + TalkBack identity, never rendered as visible copy.
 */
data class EditConflictDisplay(
    val phase: EditConflictPhase,
    val otherTabId: String? = null,
) {
    /** True when the warning banner should be rendered (web's non-null render path). */
    val visible: Boolean get() = phase == EditConflictPhase.Conflict
}

/**
 * Pure projection of a holder's [EditLeaseSnapshot] into the render decision — the native port of the web
 * component's `if (isOwner || otherTab === null) return null` guard. Framework-free so the contract is
 * covered by the JVM unit gate.
 */
object EditConflictProjection {
    /**
     * Folds the holder's [snapshot] into the render-ready [EditConflictDisplay]. The banner is shown only when
     * this holder is NOT the owner AND a peer has been observed — exactly the web guard. The body-copy variant
     * (labeled vs generic) is a pure function of whether the caller supplied a `resourceLabel`, resolved at
     * the string boundary in the composable, so it is not carried here.
     */
    fun project(snapshot: EditLeaseSnapshot): EditConflictDisplay {
        val peer = snapshot.otherTab
        return if (!snapshot.isOwner && peer != null) {
            EditConflictDisplay(phase = EditConflictPhase.Conflict, otherTabId = peer.tabId)
        } else {
            EditConflictDisplay(phase = EditConflictPhase.Hidden)
        }
    }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [EditConflictBannerRegistration.SLUG] (P1/S11) — never a `resourceKey`, peer id, or lease payload, so a
 * diagnostics line can never leak which resource a user was editing. Kept free of Compose so it is unit-tested
 * with a recording [Logger]; the ViewModel calls it once per surface open.
 */
fun recordEditConflictBannerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to EditConflictBannerRegistration.SLUG))
}
