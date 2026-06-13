// Pure, framework-free model + projection for the DashboardSettingsModal surface — the native analogue of everything
// the web component derives before it returns JSX (web/src/features/dashboard/components/DashboardSettingsModal.tsx).
// No Compose, no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is a controlled settings dialog for a single saved dashboard. It receives the target dashboard,
// the vehicle list, and four callbacks (onUpdate / onRename / onChangeIcon / onClose) as props — it performs no data
// fetching of its own (its only hook is useTranslation). It owns three pieces of local form state seeded from the
// dashboard (the editable name, the chosen icon emoji, and the DashboardSettings block), and on Save it fires, in
// order: onRename (only when the trimmed name is non-empty AND differs), onChangeIcon (only when the icon differs),
// onUpdate (always, with the edited settings), then onClose. This file owns those pure derivations: the initial-draft
// seeding (web `useState(dashboard.settings ?? DEFAULT)` + name + `icon ?? '📊'`), the rename guard
// (web `name.trim() && name.trim() !== dashboard.name`), the icon-change guard (web `icon !== dashboard.icon`), the
// assembled save result (the conditional onRename/onChangeIcon + always-onUpdate fan-out), and the select-value
// parsing (refresh seconds + the optional vehicle filter id). Localized labels and glyphs are resolved at the Compose
// boundary, never here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a hyphen is
// illegal in a package identifier), so the package intentionally diverges from the path — exactly as the sibling
// FeedbackModal surface does. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.dashboardsettingsmodal

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object DashboardSettingsModalRegistration {
    /** Stable surface id. */
    const val ID: String = "dashboard-settings-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DashboardSettingsModal"
}

/** The icon used when a dashboard has no saved emoji (web `dashboard.icon ?? '📊'`). */
const val DEFAULT_DASHBOARD_ICON: String = "📊"

/**
 * The fixed emoji palette the picker offers, in the exact order the web component lists them
 * (web `DASHBOARD_EMOJIS`). Kept as data here so the off-device test can assert the vocabulary; the picker grid is
 * rendered at the Compose boundary.
 */
val DASHBOARD_EMOJIS: List<String> =
    listOf("📊", "🔋", "🚗", "⚡", "🛡️", "🗺️", "📈", "🎯", "🔧", "🏠", "🌡️", "🎮", "📱", "🖥️", "🔔", "⭐")

/**
 * The editable per-dashboard settings block — the native mirror of the web `DashboardSettings` interface
 * (web/src/features/dashboard/widgets/types.ts). [refreshInterval] is the auto-refresh period in seconds
 * (`0` = use each widget's own default); [vehicleId] scopes every widget to one vehicle (`null` = all vehicles);
 * [showWidgetBorders] and [compactMode] are the two display toggles.
 */
data class DashboardSettingsValues(
    val refreshInterval: Int = 0,
    val vehicleId: Int? = null,
    val showWidgetBorders: Boolean = false,
    val compactMode: Boolean = false,
)

/** The settings a freshly created dashboard starts with (web `DEFAULT_DASHBOARD_SETTINGS`). */
val DEFAULT_DASHBOARD_SETTINGS: DashboardSettingsValues = DashboardSettingsValues()

/**
 * The slice of the web `SavedDashboard` this dialog actually edits — its [id] (identity, used to re-seed the form when
 * the target changes), its [name], its optional [icon] emoji (`null` = none saved yet), and its optional [settings]
 * block (`null` = never customized → seeded from [DEFAULT_DASHBOARD_SETTINGS]). The widgets/layouts/timestamps the web
 * type also carries are irrelevant to this dialog and intentionally omitted.
 */
data class DashboardSummary(
    val id: String,
    val name: String,
    val icon: String? = null,
    val settings: DashboardSettingsValues? = null,
)

/**
 * One selectable vehicle for the vehicle-filter dropdown — the native mirror of the web `VehicleOption`
 * (`{ id, display_name }`). [id] is the numeric vehicle id used as the option wire value; [displayName] is the label.
 */
data class VehicleOption(
    val id: Int,
    val displayName: String,
)

/**
 * The fixed auto-refresh choices the dropdown offers (web `REFRESH_OPTIONS`). [seconds] is both the stored value and
 * the option wire token (web `settings.refreshInterval.toString()`); [i18nSuffix] selects the localized label key
 * (web ``t(`dashSettings.refresh${o.value}`)``). [Default] (`0`) means "use each widget's own refresh rate".
 */
enum class RefreshIntervalOption(
    val seconds: Int,
    val i18nSuffix: String,
) {
    Default(0, "refresh0"),
    FiveSeconds(5, "refresh5"),
    TenSeconds(10, "refresh10"),
    ThirtySeconds(30, "refresh30"),
    OneMinute(60, "refresh60"),
    FiveMinutes(300, "refresh300"),
    ;

    /** The option's wire token (web option `value`), the stringified [seconds]. */
    val wire: String get() = seconds.toString()
}

/**
 * The editable form draft the dialog owns — the native mirror of the web component's three `useState` fields seeded
 * from the target dashboard. A fresh draft is produced by [DashboardSettingsModalProjection.initialDraft].
 */
data class DashboardSettingsDraft(
    val name: String,
    val icon: String,
    val settings: DashboardSettingsValues,
)

/**
 * The resolved outcome of pressing Save — the native analogue of the web `handleSave` fan-out. [rename] is non-null
 * only when the host should call `onRename(rename)` (web `name.trim() && name.trim() !== dashboard.name`); [icon] is
 * non-null only when the host should call `onChangeIcon(icon)` (web `icon !== dashboard.icon`); [settings] is always
 * applied (web always calls `onUpdate(settings)`). The host fires them in this order, then closes.
 */
data class DashboardSettingsSaveResult(
    val rename: String?,
    val icon: String?,
    val settings: DashboardSettingsValues,
)

/**
 * The pure derivations the composable renders over — the native mirror of the web component's local-state seeding and
 * `handleSave` logic. Stateless and side-effect-free, so it is fully covered by the off-device unit gate.
 */
object DashboardSettingsModalProjection {
    /** The auto-refresh choices, in display order (web `REFRESH_OPTIONS`). */
    val refreshOptions: List<RefreshIntervalOption> = RefreshIntervalOption.entries.toList()

    /**
     * Seeds a fresh form draft from [dashboard] — the web open-effect that resets name / icon / settings. A missing
     * settings block falls back to [DEFAULT_DASHBOARD_SETTINGS]; a missing icon falls back to [DEFAULT_DASHBOARD_ICON]
     * (web `dashboard.icon ?? '📊'`).
     */
    fun initialDraft(dashboard: DashboardSummary): DashboardSettingsDraft =
        DashboardSettingsDraft(
            name = dashboard.name,
            icon = dashboard.icon ?: DEFAULT_DASHBOARD_ICON,
            settings = dashboard.settings ?: DEFAULT_DASHBOARD_SETTINGS,
        )

    /**
     * Whether Save should rename the dashboard — the web guard `name.trim() && name.trim() !== dashboard.name`. A
     * blank or whitespace-only edit, or one equal to the current name once trimmed, leaves the name untouched.
     */
    fun shouldRename(
        dashboard: DashboardSummary,
        draftName: String,
    ): Boolean {
        val trimmed = draftName.trim()
        return trimmed.isNotEmpty() && trimmed != dashboard.name
    }

    /**
     * Whether Save should change the icon — the web guard `icon !== dashboard.icon`. Because the draft icon is never
     * null (it defaults to [DEFAULT_DASHBOARD_ICON]), a dashboard that had no saved icon will adopt the default on the
     * first save, exactly as the web does.
     */
    fun shouldChangeIcon(
        dashboard: DashboardSummary,
        draftIcon: String,
    ): Boolean = draftIcon != dashboard.icon

    /**
     * Assembles the Save outcome from [dashboard] + [draft] — the web `handleSave` object. The trimmed name is carried
     * only when [shouldRename]; the icon only when [shouldChangeIcon]; the settings are always carried (web always
     * calls `onUpdate`).
     */
    fun resolveSave(
        dashboard: DashboardSummary,
        draft: DashboardSettingsDraft,
    ): DashboardSettingsSaveResult =
        DashboardSettingsSaveResult(
            rename = draft.name.trim().takeIf { shouldRename(dashboard, draft.name) },
            icon = draft.icon.takeIf { shouldChangeIcon(dashboard, draft.icon) },
            settings = draft.settings,
        )

    /**
     * Parses a refresh dropdown selection back to a seconds value (web select `onChange` →
     * `Number(e.target.value)`). An unrecognized token falls back to `0` ("use per-widget default").
     */
    fun parseRefresh(value: String): Int = value.toIntOrNull() ?: 0

    /**
     * Parses a vehicle-filter dropdown selection back to an optional id (web `e.target.value ? Number(...) :
     * undefined`). The empty-string option ("All Vehicles") and any unparseable token resolve to `null`.
     */
    fun parseVehicleId(value: String): Int? = if (value.isEmpty()) null else value.toIntOrNull()
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DashboardSettingsModalRegistration.SLUG]
 * (P1/S11). It carries no dashboard name, icon, or vehicle id, so a diagnostics line can never leak what the operator
 * is editing. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordDashboardSettingsModalOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DashboardSettingsModalRegistration.SLUG))
}
