// Pure, framework-free model + projection for the Vehicle Access dashboard widget — the native analogue
// of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/VehicleAccessWidget.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. The drivers / invitations rows + the mobile-access envelope arrive as plain (non-unit)
// JSON, so this file owns the decode (web optional-chaining → null-safe reads), the badge-tone mapping,
// and the short-date formatting (web `formatDateShort`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/VehicleAccessWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling SecurityStatus/MaintenanceTracker
// widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleaccess

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** Em dash shown for a missing reading — the web `'—'` fallback for an absent name / date. */
internal const val EM_DASH: String = "\u2014"

/** The `owner` driver role (web `d.role === 'owner'`). */
private const val ROLE_OWNER: String = "owner"

/** Invitation statuses the web branches on (`inv.status === 'pending' | 'accepted'`). */
private const val STATUS_PENDING: String = "pending"
private const val STATUS_ACCEPTED: String = "accepted"

// The `/vehicles/{id}/mobile-enabled` envelope keys (web `mobileData?.data?.enabled`).
private const val FIELD_DATA: String = "data"
private const val FIELD_ENABLED: String = "enabled"

// Locale-stable short month abbreviations — the en-US `toLocaleDateString({ month: 'short' })` output the
// web `formatDateShort` produces by default. Used by [VehicleAccessProjection.formatDateShort].
private val SHORT_MONTHS: List<String> =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

private const val ISO_DATE_PREFIX_LENGTH: Int = 10
private const val ISO_DATE_PARTS: Int = 3
private const val ISO_MONTH_INDEX: Int = 1
private const val ISO_DAY_INDEX: Int = 2

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * component reads `size.cols` to choose the compact (driver-count + mobile-dot) vs standard (mobile badge +
 * driver/invitation detail lists) layout, so this type carries the same axis the registry constrains.
 */
data class VehicleAccessSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact driver-count summary. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/security.ts (`vehicle-access`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object VehicleAccessRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "vehicle-access"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "security"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleAccessWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val DEFAULT_SIZE: VehicleAccessSize = VehicleAccessSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: VehicleAccessSize = VehicleAccessSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: VehicleAccessSize = VehicleAccessSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: VehicleAccessSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: VehicleAccessSize): VehicleAccessSize =
        VehicleAccessSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The tone of a detail-row [DetailBadge] — the native analogue of the web `DetailEntry.badge.variant` union
 * (`'success' | 'warning' | 'error' | 'neutral'`). The render layer maps each onto a theme badge variant.
 */
enum class DetailBadgeTone { Success, Warning, Error, Neutral }

/** One detail-row badge — the native analogue of the web `DetailEntry.badge` (`{ text, variant }`). */
data class DetailBadge(
    val text: String,
    val tone: DetailBadgeTone,
)

/**
 * One render-ready definition-list row — the native analogue of the web `DetailEntry` the `WidgetDetailCard`
 * renders. Pure data (no Compose types) so the projection is unit-tested directly.
 *
 * @property label the left-hand row label (web `entry.label`).
 * @property value the right-hand formatted value (web `entry.value ?? '—'`).
 * @property badge the optional trailing status chip (web `entry.badge`).
 */
data class DetailEntry(
    val label: String,
    val value: String,
    val badge: DetailBadge?,
)

/**
 * The three decoded cache-then-network feeds the widget composes (web `{ drivers, invitations, mobile }`).
 * [hasData] is the web `safeDrivers.length > 0 || safeInvitations.length > 0 || mobileEnabled !== null`
 * gate that selects content vs the top-level empty state.
 *
 * @property drivers the vehicle's shared-driver rows (web `safeDrivers`).
 * @property invitations the vehicle's access-invitation rows (web `safeInvitations`).
 * @property mobileEnabled the mobile-access flag, or `null` when unknown (web `mobileEnabled`).
 */
data class VehicleAccessData(
    val drivers: List<VehicleDriver>,
    val invitations: List<VehicleInvitation>,
    val mobileEnabled: Boolean?,
) {
    /** Web `safeDrivers.length > 0 || safeInvitations.length > 0 || mobileEnabled !== null`. */
    val hasData: Boolean
        get() = drivers.isNotEmpty() || invitations.isNotEmpty() || mobileEnabled != null

    companion object {
        /** The no-drivers / no-invitations / unknown-mobile snapshot, surfaced for an empty payload. */
        val EMPTY: VehicleAccessData = VehicleAccessData(emptyList(), emptyList(), null)
    }
}

/**
 * The localized strings this surface needs — the native mirror of the nineteen `t('widget.vehicleAccess*')`
 * calls the web component makes. Resolved once at the render boundary (P1/S10) and passed into
 * [VehicleAccessProjection] so the projection stays framework-free yet fully localized, exactly as the
 * sibling SecurityStatus/MaintenanceTracker widgets do.
 */
data class VehicleAccessStrings(
    val title: String,
    val drivers: String,
    val mobileOn: String,
    val mobileOff: String,
    val mobileUnknown: String,
    val mobile: String,
    val enabled: String,
    val disabled: String,
    val unknown: String,
    val authorized: String,
    val noDrivers: String,
    val pending: String,
    val noInvitations: String,
    val owner: String,
    val driver: String,
    val pendingStatus: String,
    val accepted: String,
    val expired: String,
    val noData: String,
)

/**
 * The fully projected, render-ready view of the vehicle-access snapshot — the native analogue of everything
 * the web component computes before returning JSX. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host. Carries both the compact-summary fields and the standard-layout fields;
 * the composable renders one set per [VehicleAccessSize.isCompact].
 *
 * @property hasData web `hasData` — false ⇒ the body shows the top-level empty state.
 * @property driverCount the number of authorized drivers (web `safeDrivers.length`).
 * @property driversText the compact summary text "{n} Drivers" (web `${driverCount} ${t('Drivers')}`).
 * @property mobileEnabled the mobile flag (web `mobileEnabled`); drives the compact dot + standard badge.
 * @property mobileStatusLabel the compact dot's localized a11y label (web `title` on the status dot).
 * @property mobileBadgeText the standard mobile badge label (web Enabled / Disabled / Unknown).
 * @property mobileBadgeTone the standard mobile badge tone (web success / danger / neutral).
 * @property driverEntries the authorized-driver detail rows (web `driverEntries`).
 * @property invitationEntries the pending-invitation detail rows (web `invitationEntries`).
 * @property compactContentDescription folded TalkBack phrase for the compact summary.
 */
data class VehicleAccessDisplay(
    val hasData: Boolean,
    val driverCount: Int,
    val driversText: String,
    val mobileEnabled: Boolean?,
    val mobileStatusLabel: String,
    val mobileBadgeText: String,
    val mobileBadgeTone: DetailBadgeTone,
    val driverEntries: List<DetailEntry>,
    val invitationEntries: List<DetailEntry>,
    val compactContentDescription: String,
)

/**
 * Pure projection + state-fold for the Vehicle Access surface — the native port of the inline `useMemo`
 * derivations + JSX formatting in `VehicleAccessWidget.tsx`. [project] turns a decoded [VehicleAccessData]
 * into the render-ready [VehicleAccessDisplay]; [foldState] composes the three cache-then-network feeds
 * (`useVehicleDrivers` + `useVehicleInvitations` + `useVehicleMobileEnabled`) onto the shared [UiState]
 * surface, and [foldNoVehicle] covers the "no vehicle resolved yet" branch.
 */
object VehicleAccessProjection {
    /**
     * Project [data] into the render model using the localized [strings]. The driver / invitation row
     * mapping, the mobile badge tone, and the short-date formatting all reproduce the web derivations
     * verbatim against the snake_case wire contract.
     */
    fun project(
        data: VehicleAccessData,
        strings: VehicleAccessStrings,
    ): VehicleAccessDisplay {
        val driversText = "${data.drivers.size} ${strings.drivers}"
        val mobileStatusLabel = mobileStatusLabel(data.mobileEnabled, strings)
        return VehicleAccessDisplay(
            hasData = data.hasData,
            driverCount = data.drivers.size,
            driversText = driversText,
            mobileEnabled = data.mobileEnabled,
            mobileStatusLabel = mobileStatusLabel,
            mobileBadgeText = mobileBadgeText(data.mobileEnabled, strings),
            mobileBadgeTone = mobileBadgeTone(data.mobileEnabled),
            driverEntries = data.drivers.map { it.toEntry(strings) },
            invitationEntries = data.invitations.map { it.toEntry(strings) },
            compactContentDescription = "${strings.title}: $driversText, $mobileStatusLabel",
        )
    }

    /**
     * Folds the drivers ([driversRes]), invitations ([invitationsRes]) and mobile-access ([mobileRes])
     * cache-then-network feeds onto one lifecycle-aware [UiState]. Mirrors the web shell precedence: a first
     * load of ANY feed renders the skeleton (web `isLoading = driversLoading || invitationsLoading ||
     * mobileLoading`); otherwise the content / empty surface is chosen by `hasData`. The web passes only
     * `isError` (not `error`) to `WidgetShell`, so a hard failure is never a blank panel — it is surfaced
     * through the freshness chip (offline / stale) + the refresh control, and a cached value stays visible.
     */
    fun foldState(
        driversRes: Resource<List<VehicleDriver>>,
        invitationsRes: Resource<List<VehicleInvitation>>,
        mobileRes: Resource<JsonElement>,
    ): UiState<VehicleAccessData> {
        val all: List<Resource<*>> = listOf(driversRes, invitationsRes, mobileRes)
        if (all.any { it is Resource.Loading && it.cached == null }) return UiState.loading()

        val data =
            VehicleAccessData(
                drivers = driversRes.cached ?: emptyList(),
                invitations = invitationsRes.cached ?: emptyList(),
                mobileEnabled = parseMobileEnabled(mobileRes.cached),
            )
        return contentState(data, all)
    }

    /**
     * The fold for the "no vehicle resolved" branch (web `vid` undefined ⇒ the three feeds stay disabled ⇒
     * no data). While the fleet list is still loading with nothing cached the surface shows its skeleton;
     * once the fleet resolves to no vehicle (or fails) the surface shows its empty state, flagging the
     * freshness chip stale / offline when the fleet read itself errored — never a blank panel.
     */
    fun foldNoVehicle(vehiclesRes: Resource<List<Vehicle>>): UiState<VehicleAccessData> {
        if (vehiclesRes is Resource.Loading && vehiclesRes.cached == null) return UiState.loading()
        val errorRes = vehiclesRes as? Resource.Error<*>
        return UiState(
            phase = UiPhase.Empty,
            data = VehicleAccessData.EMPTY,
            fetchedAt = fetchedAtOf(vehiclesRes)?.takeIf { it > 0L },
            stale = vehiclesRes.stale || errorRes != null,
            refreshing = vehiclesRes is Resource.Loading,
            errorKind = errorRes?.let { errorKindOf(it.error) },
            httpStatus = errorRes?.let { httpStatusOf(it.error) },
        )
    }

    /**
     * Decodes the mobile-access flag from the `/vehicles/{id}/mobile-enabled` envelope — the native port of
     * the web `mobileData?.data?.enabled ?? null`. A missing envelope / `data` object / non-boolean
     * `enabled` reads as `null` (unknown).
     */
    fun parseMobileEnabled(json: JsonElement?): Boolean? {
        val data = (json as? JsonObject)?.get(FIELD_DATA) as? JsonObject
        return (data?.get(FIELD_ENABLED) as? JsonPrimitive)?.booleanOrNull
    }

    /**
     * Formats an ISO timestamp as the web `formatDateShort` does by default — `MMM d` (en-US short month +
     * numeric day, no leading zero), e.g. `Apr 4`. A null / blank / unparseable value yields the em dash
     * (web `if (!iso || isNaN) return '—'`). Locale-stable + API-safe (no java.time): the ISO calendar-date
     * prefix is read directly, mirroring the sibling MaintenanceTracker date port.
     */
    fun formatDateShort(iso: String?): String {
        val parts = iso?.takeIf { it.isNotBlank() }?.take(ISO_DATE_PREFIX_LENGTH)?.split("-")
        if (parts == null || parts.size != ISO_DATE_PARTS) return EM_DASH
        val month = parts[ISO_MONTH_INDEX].toIntOrNull()?.let { SHORT_MONTHS.getOrNull(it - 1) }
        val day = parts[ISO_DAY_INDEX].toIntOrNull()
        return if (month != null && day != null) "$month $day" else EM_DASH
    }

    private fun VehicleDriver.toEntry(strings: VehicleAccessStrings): DetailEntry {
        val isOwner = role == ROLE_OWNER
        return DetailEntry(
            label = driverName ?: driverEmail ?: EM_DASH,
            value = formatDateShort(fetchedAt),
            badge =
                DetailBadge(
                    text = if (isOwner) strings.owner else strings.driver,
                    tone = if (isOwner) DetailBadgeTone.Success else DetailBadgeTone.Neutral,
                ),
        )
    }

    private fun VehicleInvitation.toEntry(strings: VehicleAccessStrings): DetailEntry {
        val text =
            when (status) {
                STATUS_PENDING -> strings.pendingStatus
                STATUS_ACCEPTED -> strings.accepted
                else -> strings.expired
            }
        val tone =
            when (status) {
                STATUS_PENDING -> DetailBadgeTone.Warning
                STATUS_ACCEPTED -> DetailBadgeTone.Success
                else -> DetailBadgeTone.Error
            }
        return DetailEntry(
            label = createdBy ?: EM_DASH,
            value = formatDateShort(createdAt),
            badge = DetailBadge(text = text, tone = tone),
        )
    }

    private fun mobileStatusLabel(
        enabled: Boolean?,
        strings: VehicleAccessStrings,
    ): String =
        when (enabled) {
            true -> strings.mobileOn
            false -> strings.mobileOff
            null -> strings.mobileUnknown
        }

    private fun mobileBadgeText(
        enabled: Boolean?,
        strings: VehicleAccessStrings,
    ): String =
        when (enabled) {
            true -> strings.enabled
            false -> strings.disabled
            null -> strings.unknown
        }

    private fun mobileBadgeTone(enabled: Boolean?): DetailBadgeTone =
        when (enabled) {
            true -> DetailBadgeTone.Success
            false -> DetailBadgeTone.Error
            null -> DetailBadgeTone.Neutral
        }

    private fun contentState(
        data: VehicleAccessData,
        all: List<Resource<*>>,
    ): UiState<VehicleAccessData> {
        val errorRes = all.firstNotNullOfOrNull { it as? Resource.Error<*> }
        return UiState(
            phase = if (data.hasData) UiPhase.Content else UiPhase.Empty,
            data = data,
            fetchedAt = all.mapNotNull(::fetchedAtOf).maxOrNull()?.takeIf { it > 0L },
            stale = all.any { it.stale } || errorRes != null,
            refreshing = all.any { it is Resource.Loading },
            errorKind = errorRes?.let { errorKindOf(it.error) },
            httpStatus = errorRes?.let { httpStatusOf(it.error) },
        )
    }

    private fun fetchedAtOf(res: Resource<*>): Long? =
        when (res) {
            is Resource.Loading -> res.fetchedAt
            is Resource.Success -> res.fetchedAt
            is Resource.Error -> res.fetchedAt
        }
}

/**
 * The first enrolled vehicle's id, or `null` when the fleet list is absent or empty — the native port of
 * the web `vehicles?.[0]?.id`. A positive id wins; a non-positive id reads as absent.
 */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
