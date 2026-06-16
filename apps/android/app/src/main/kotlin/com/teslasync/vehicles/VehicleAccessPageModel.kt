// Pure, framework-free model + projections for the VehicleAccessPage vehicles surface (P3/A7) — the native
// analogue of everything web/src/features/vehicles/pages/VehicleAccessPage.tsx derives before composing its two
// GlassPanels. No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the
// Android UiState surface, the shared-core Logger, and java.time), so the composable stays a thin render layer and
// all of this stays unit-testable off-device by the :android:testDebugUnitTest gate.
//
// The web page reads drivers + invitations (per vehicle) and the parent vehicle (for the breadcrumb label), then
// renders the Drivers DataTable (name / email / role / remove) and the Invitations DataTable (status / createdBy /
// expires / link / revoke). This file ports the page's value derivations the render layer needs: the invitation
// `status` → web StatusBadge token fold (pending → online, revoked → offline, else → asleep), the `expires_at` →
// absolute timestamp fold (web `<TimeStamp>`, "—" fallback for null/unparseable), the breadcrumb label fold
// (web `vehicle?.display_name ?? \`Vehicle #${vehicleId}\``), and the page-level loading predicate (web
// `isLoading = driversLoading || invitationsLoading`). Visible labels stay at the Compose boundary (they resolve
// from the i18n catalog), so this model produces only the non-string folds.
//
// No field here is unit-bearing (ids, emails, roles, urls, statuses, ISO stamps), so there is no SI conversion at
// this layer (S5).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
// `MatchingDeclarationName` is suppressed: this is the surface's Model file (named after its primary surface, like
// the sibling A7 *PageModel files), whose single class-like declaration is the co-located Registration object.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehicles.vehicleaccess

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics — the native mirror of the web
 * `VehicleAccessPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `hidden("vehicleAccess", "/vehicles/:id/access", NavGroup.Vehicles, listOf("id"))`, so
 * [io.teslasync.android.navigation.PageHosts] binds this surface to that destination (and its
 * `/vehicles/{id}/access` deep link) without the nav module depending on it.
 */
object VehicleAccessPageRegistration {
    /** The navigation destination id (Destinations.kt `hidden("vehicleAccess", "/vehicles/:id/access", …)`). */
    const val ROUTE_ID: String = "vehicleAccess"

    /** The route argument carrying the vehicle id (web `useParams().id`). */
    const val ARG_ID: String = "id"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/vehicles/:id/access"

    /** The parent vehicle-detail route whose breadcrumb label this page overrides (web `'/vehicles/:id'`). */
    const val PARENT_WEB_PATH: String = "/vehicles/:id"

    /** Diagnostics surface slug (P1/S11). Carries no vehicle id or user data. */
    const val SLUG: String = "VehicleAccessPage"
}

/** The universal "—" fallback the web page renders for missing values (web `'—'`). */
const val VEHICLE_ACCESS_EM_DASH: String = "\u2014"

/* ------------------------------------------------------------------ */
/*  Invitation status                                                  */
/* ------------------------------------------------------------------ */

/** Web invitation statuses the page special-cases. */
private const val STATUS_PENDING = "pending"
private const val STATUS_REVOKED = "revoked"

/** The web StatusBadge status tokens an invitation status folds onto. */
private const val TOKEN_ONLINE = "online"
private const val TOKEN_OFFLINE = "offline"
private const val TOKEN_ASLEEP = "asleep"

/**
 * Folds an invitation [status] onto the web StatusBadge token the page passes
 * (`row.status === 'pending' ? 'online' : row.status === 'revoked' ? 'offline' : 'asleep'`). The native
 * `StatusBadge` colours its leading dot from this token and capitalizes it as the visible label, reproducing
 * the web `StatusBadge` (a neutral pill + a state-colored dot + the capitalized token).
 */
fun invitationStatusToken(status: String): String =
    when (status) {
        STATUS_PENDING -> TOKEN_ONLINE
        STATUS_REVOKED -> TOKEN_OFFLINE
        else -> TOKEN_ASLEEP
    }

/** Whether an invitation can still be revoked (web `row.status === 'pending'` → the revoke action shows). */
fun invitationIsRevocable(status: String): Boolean = status == STATUS_PENDING

/* ------------------------------------------------------------------ */
/*  Timestamp                                                          */
/* ------------------------------------------------------------------ */

/** Absolute medium date + short time, mirroring the web `<TimeStamp>` absolute body ("Apr 4, 2:30 AM"). */
private val EXPIRY_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(Locale.getDefault())

/**
 * Formats an invitation `expires_at` ISO stamp for display, mirroring the web `<TimeStamp value={expires_at} />`:
 * an absolute localized date-time for a parseable value, or the universal "—" fallback for a null/blank/
 * unparseable one (the web TimeStamp renders "—" for `null`/`NaN`). Parsing is offset-tolerant (an offset stamp,
 * a `Z`/UTC stamp, or an offset-less local stamp all resolve).
 */
fun formatInvitationExpiry(expiresAt: String?): String {
    val parsed = expiresAt?.takeIf(String::isNotBlank)?.let(::parseTimestamp)
    return parsed?.format(EXPIRY_FORMATTER) ?: VEHICLE_ACCESS_EM_DASH
}

private fun parseTimestamp(raw: String): LocalDateTime? =
    runCatching { OffsetDateTime.parse(raw).toLocalDateTime() }
        .recoverCatching { LocalDateTime.parse(raw) }
        .getOrNull()

/* ------------------------------------------------------------------ */
/*  Header + breadcrumb folds                                          */
/* ------------------------------------------------------------------ */

/**
 * The breadcrumb label override for the parent vehicle row, mirroring the web
 * `vehicle?.display_name ?? \`Vehicle #${vehicleId}\``: the resolved vehicle display name, or the
 * "Vehicle #id" fallback while it loads / when it is blank.
 */
fun vehicleBreadcrumbLabel(
    displayName: String?,
    vehicleId: String,
): String = displayName?.takeIf { it.isNotBlank() } ?: "Vehicle #$vehicleId"

/**
 * The page-level loading flag handed to the PageContainer chrome — the web `isLoading = driversLoading ||
 * invitationsLoading` (the spinner shows only on a first load with nothing cached for either feed).
 */
fun pageIsLoading(
    drivers: UiState<*>,
    invitations: UiState<*>,
): Boolean = drivers.isLoading || invitations.isLoading

/** A non-null, non-blank row value or the "—" fallback (web `value ?? '—'`). */
fun orDash(value: String?): String = value?.takeIf { it.isNotBlank() } ?: VEHICLE_ACCESS_EM_DASH

/* ------------------------------------------------------------------ */
/*  Diagnostics (P1/S11)                                               */
/* ------------------------------------------------------------------ */

/** The one-shot PII-safe `view.opened` diagnostic, carrying only the surface slug (no vehicle id / user data). */
fun recordVehicleAccessPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to VehicleAccessPageRegistration.SLUG))
}

internal const val EVENT_VIEW_OPENED = "view.opened"
internal const val EVENT_REFRESH_DRIVERS = "vehicleAccess.refreshDrivers"
internal const val EVENT_REFRESH_INVITATIONS = "vehicleAccess.refreshInvitations"
internal const val EVENT_CREATE_INVITATION = "vehicleAccess.createInvitation"
internal const val EVENT_REMOVE_DRIVER = "vehicleAccess.removeDriver"
internal const val EVENT_REVOKE_INVITATION = "vehicleAccess.revokeInvitation"
internal const val FIELD_SURFACE = "surface"
