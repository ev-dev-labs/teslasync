// Pure, framework-free model + projection for the ShareDriveDialog modal/dialog surface — the native analogue of
// everything the web component derives before it returns JSX (web/src/features/driving/components/ShareDriveDialog.tsx).
// No Compose, no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is the "Share Drive" modal opened from a drive report. It owns a small create form (an optional
// title, an include-speed toggle defaulting ON, an include-telemetry toggle defaulting OFF, and a link-expiry select
// defaulting to 30 days), POSTs it through `useCreateShareLink`, then swaps to a result panel showing the freshly
// minted public URL (copy + open-in-browser + "create another"). Below it the modal lists the drive's existing share
// links (`useShareLinks`) — each row carries the share's title, view count, and an expiry status (expired / expires on
// a date / no expiry) plus copy + revoke (`useRevokeShareLink`) affordances. This file owns the data derivations behind
// that surface: the public-URL assembly (web `${origin}/s/${token}`), the create-payload assembly (web object literal —
// drop a blank title, map the "Never" expiry to no `expires_in_days`), the share-link token expiry parse + the
// is-expired guard (web `new Date(expires_at) < new Date()`). The localized labels + the platform date formatting are
// resolved at the Compose boundary, never here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/ShareDriveDialog — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling modal/dialog surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sharedrivedialog

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.sharing.CreateShareRequest
import io.teslasync.shared.core.presentation.sharing.CreateShareResponse
import io.teslasync.shared.core.presentation.sharing.ShareToken
import io.teslasync.shared.core.presentation.sharing.SharingStore
import kotlinx.coroutines.flow.StateFlow
import java.time.Instant

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ShareDriveDialogRegistration {
    /** Stable surface id. */
    const val ID: String = "share-drive-dialog"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ShareDriveDialog"
}

/**
 * The link-expiry options the web select offers (`7 | 30 | 90 | Never`, default `30`). [wire] is the exact value the
 * web `<Select>` carries (`'7' | '30' | '90' | '0'`); [days] is the matching `expires_in_days` magnitude, with [Never]
 * mapping to no expiry (web `Number('0') || undefined`). The human label is resolved at the Compose boundary (P1/S10).
 *
 * @property wire the raw select value (web `expiryDays` state).
 * @property days the day magnitude; `0` for [Never], which projects to a `null` `expires_in_days`.
 */
enum class ExpiryOption(
    val wire: String,
    val days: Int,
) {
    Days7("7", 7),
    Days30("30", 30),
    Days90("90", 90),
    Never("0", 0),
    ;

    companion object {
        /** The web default (`useState('30')`). */
        val Default: ExpiryOption = Days30

        /** Resolves a [wire] value back to its option (web select `onChange`); an unknown value falls back to [Default]. */
        fun fromWire(wire: String): ExpiryOption = entries.firstOrNull { it.wire == wire } ?: Default
    }
}

/**
 * The editable create-form draft the dialog owns — the native mirror of the web component's `useState` fields. Defaults
 * match the web `initialValues` (empty title, include-speed ON, include-telemetry OFF, 30-day expiry), so a freshly
 * opened dialog presents exactly the web's initial form.
 *
 * @property title the optional public title (web `title`).
 * @property includeSpeed whether speed data is shared (web `includeSpeed`, default `true`).
 * @property includeTelemetry whether detailed telemetry is shared (web `includeTelemetry`, default `false`).
 * @property expiry the selected link-expiry option (web `expiryDays`, default `'30'`).
 */
data class ShareDraft(
    val title: String = "",
    val includeSpeed: Boolean = true,
    val includeTelemetry: Boolean = false,
    val expiry: ExpiryOption = ExpiryOption.Default,
)

/**
 * The pure derivations the composable renders over — the native mirror of the web component's inline `handleCreate`
 * payload assembly + the per-row expiry logic. Stateless and side-effect-free, so it is fully covered by the off-device
 * unit gate.
 */
object ShareDriveDialogProjection {
    /** The public-report path segment the share URL is mounted under on the backend (web `/s/{token}`). */
    const val SHARE_PATH_PREFIX: String = "/s/"

    /**
     * Builds the public share URL for [token] — the native analogue of the web `${window.location.origin}/s/${token}`.
     * Native has no browser origin, so the host supplies the configured public [base] (e.g. `https://teslasync.example`);
     * a blank base yields the same-origin relative path the web origin would have prefixed. The [base] is trimmed of any
     * trailing slash so the join never produces a double slash.
     */
    fun shareUrl(
        base: String,
        token: String,
    ): String {
        val trimmed = base.trim().trimEnd('/')
        return if (trimmed.isEmpty()) "$SHARE_PATH_PREFIX$token" else "$trimmed$SHARE_PATH_PREFIX$token"
    }

    /**
     * Assembles the `POST /drives/{driveId}/share` body from [draft] — the web `createShare.mutateAsync({...})` object
     * literal. A blank title is dropped (web `title || undefined`); the two `include_*` booleans are always carried; the
     * "Never" expiry maps to no `expires_in_days` (web `Number('0') || undefined`). No `description` is sent — the web
     * dialog never collects one.
     */
    fun buildCreateRequest(draft: ShareDraft): CreateShareRequest =
        CreateShareRequest(
            title = draft.title.trim().ifBlank { null },
            includeSpeed = draft.includeSpeed,
            includeTelemetry = draft.includeTelemetry,
            expiresInDays = draft.expiry.days.takeIf { it > 0 },
        )

    /**
     * Parses an ISO-8601 instant string into epoch milliseconds, or `null` when [iso] is null/blank/unparseable — the
     * native analogue of the web `new Date(iso)` (which yields an invalid Date for garbage). Used by [isExpired] and by
     * the render boundary's expiry-date formatting.
     */
    fun parseInstantMillis(iso: String?): Long? =
        iso?.takeIf { it.isNotBlank() }?.let { raw -> runCatching { Instant.parse(raw).toEpochMilli() }.getOrNull() }

    /**
     * Whether the share link with [expiresAt] has expired as of [nowMillis] — the web
     * `share.expires_at ? new Date(share.expires_at) < new Date() : false`. A null `expires_at` (no expiry) is never
     * expired, and an unparseable timestamp is treated as not-expired (web `NaN < now` is `false`), so the row then
     * falls through to the "Expires …" branch exactly as the web does.
     */
    fun isExpired(
        expiresAt: String?,
        nowMillis: Long,
    ): Boolean {
        val millis = parseInstantMillis(expiresAt) ?: return false
        return millis < nowMillis
    }
}

/**
 * The narrow data + write seam the dialog binds to — the native analogue of the web `useShareLinks` /
 * `useCreateShareLink` / `useRevokeShareLink` hook trio, pre-scoped to one drive. A production binding routes to the
 * shared **S8** [SharingStore] (see [bindShareDriveDialogSource]); tests pass a fake. Keeping the seam this small means
 * the dialog never sees the store, the cache, or HTTP.
 */
interface ShareDriveDialogSource {
    /** The cache-then-network share-link feed for this drive (web `useShareLinks(driveId)`). */
    fun shareLinks(): StateFlow<Resource<List<ShareToken>>>

    /** Creates a share link, returning the non-throwing [Result] the store exposes (web `useCreateShareLink`). */
    suspend fun createShareLink(request: CreateShareRequest): Result<CreateShareResponse>

    /** Revokes the share link [token], returning the non-throwing [Result] (web `useRevokeShareLink`). */
    suspend fun revokeShareLink(token: String): Result<Unit>

    /** Re-fetches the share-link feed (the web `refetch` / the error-surface retry). */
    fun refresh()
}

/**
 * Binds the dialog's data + write seam to the shared **S8** [SharingStore] for one [driveId] (web `useSharing` hooks).
 * Reads route through [SharingStore.shareLinks]; the two mutations route through the store's per-drive create/revoke,
 * which each refresh ONLY this drive's feed on success (the web `invalidateQueries(sharingKeys.shares(driveId))`); the
 * retry routes through [SharingStore.refreshShareLinks]. The store owns all networking + cache invalidation, so the
 * dialog stays HTTP-free.
 */
fun bindShareDriveDialogSource(
    store: SharingStore,
    driveId: String,
): ShareDriveDialogSource =
    object : ShareDriveDialogSource {
        override fun shareLinks(): StateFlow<Resource<List<ShareToken>>> = store.shareLinks(driveId)

        override suspend fun createShareLink(request: CreateShareRequest): Result<CreateShareResponse> =
            store.createShareLink(driveId, request)

        override suspend fun revokeShareLink(token: String): Result<Unit> = store.revokeShareLink(driveId, token)

        override fun refresh() = store.refreshShareLinks(driveId)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ShareDriveDialogRegistration.SLUG] (P1/S11). Carries
 * only the slug — never the drive id, the share tokens, or the public URLs — so a diagnostics line can never leak what
 * is being shared. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it from the
 * composable's first-composition effect.
 */
fun recordShareDriveDialogOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ShareDriveDialogRegistration.SLUG))
}
