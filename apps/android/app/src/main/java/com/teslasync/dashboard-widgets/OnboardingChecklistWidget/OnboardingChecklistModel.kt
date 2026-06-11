// Pure, framework-free model + projection for the Onboarding Checklist dashboard widget — the native
// analogue of the data + composition the web component derives before returning JSX
// (web/src/features/dashboard/widgets/OnboardingChecklistWidget.tsx, backed by the
// web/src/features/onboarding/checklist.ts `useChecklistTasks` + `shouldHideChecklist` logic). No
// Compose, no Android, no HTTP: every type here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer. The widget reads no
// unit-bearing telemetry (the checklist is configuration-state booleans + counts), so there is no
// display-unit conversion at this boundary — only completion derivation, visibility, and i18n.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/OnboardingChecklistWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.onboardingchecklist

import io.teslasync.android.components.datadisplay.FreshnessAge
import kotlin.math.roundToInt

/**
 * The widget's grid footprint (columns x rows). Mirrors the web `WidgetProps.size`. The onboarding
 * checklist composition is footprint-invariant (it always lists every visible task), so this carries no
 * compact/wide branching — it exists only so the dashboard host can clamp the surface to its registry
 * min/max via [OnboardingChecklistRegistration].
 */
data class OnboardingChecklistSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/system.ts (`onboarding-checklist`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object OnboardingChecklistRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "onboarding-checklist"

    /** Widget category (matches the web registry `system` category). */
    const val CATEGORY = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "OnboardingChecklistWidget"

    /** Default footprint: 2 columns x 4 rows. */
    val defaultSize = OnboardingChecklistSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns x 3 rows. */
    val minSize = OnboardingChecklistSize(cols = 2, rows = 3)

    /** Maximum footprint: 4 columns x 8 rows. */
    val maxSize = OnboardingChecklistSize(cols = 4, rows = 8)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: OnboardingChecklistSize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: OnboardingChecklistSize): OnboardingChecklistSize =
        OnboardingChecklistSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Sentinel `ctaTo` value the host intercepts to open the command palette rather than navigate — the
 * native mirror of the web `COMMAND_PALETTE_CTA` (`#open-command-palette`) from
 * web/src/features/onboarding/checklist.ts.
 */
const val COMMAND_PALETTE_CTA = "#open-command-palette"

/** Glyph family for a task row; mapped to a concrete `ImageVector` at the render boundary. */
enum class OnboardingTaskGlyph { Car, Palette, Bell, Send, Command, BellPlus, Grid }

/**
 * The seven onboarding tasks, in the web source's order
 * (web/src/features/onboarding/checklist.ts `tasks`). [slug] is the stable analytics id (web `task.id`),
 * [ctaTo] is the navigation target (web `task.ctaTo`, with [COMMAND_PALETTE_CTA] reproduced verbatim), and
 * [glyph] drives the render boundary. The localized title/description/CTA labels are resolved through
 * [OnboardingChecklistStrings]; the per-task `complete` boolean is derived by
 * [OnboardingChecklistProjection] from the live inputs.
 */
enum class OnboardingTaskId(
    val slug: String,
    val ctaTo: String,
    val glyph: OnboardingTaskGlyph,
) {
    ConnectVehicle("connect-vehicle", "/tesla-account", OnboardingTaskGlyph.Car),
    PickTheme("pick-theme", "/settings#appearance", OnboardingTaskGlyph.Palette),
    FirstAlert("first-alert", "/notifications/alerts", OnboardingTaskGlyph.Bell),
    NotificationChannel("notification-channel", "/notifications/channels", OnboardingTaskGlyph.Send),
    CommandPalette("try-command-palette", COMMAND_PALETTE_CTA, OnboardingTaskGlyph.Command),
    EnablePush("enable-push", "/notifications/browser", OnboardingTaskGlyph.BellPlus),
    CustomizeDashboard("customize-dashboard", "/dashboard", OnboardingTaskGlyph.Grid),
}

/**
 * The raw, framework-free inputs the checklist derives from — the native union of everything the web
 * `useChecklistTasks` reads: the enrolled-vehicle / alert-rule / notification-channel counts and the
 * theme id (the web `useVehicles` / `useAlertRules` / `useNotificationChannels` / `useTheme` hooks), plus
 * the five client-persisted flags (the web localStorage helpers): command-palette discovery, web-push
 * grant, dashboard-customisation, dismissal, and the 100%-complete timestamp. Pure data so the projection
 * is unit-tested without a network, cache, or clock.
 */
data class OnboardingChecklistInputs(
    val vehicleCount: Int,
    val alertRuleCount: Int,
    val channelCount: Int,
    val themeId: String,
    val commandPaletteDiscovered: Boolean,
    val webPushGranted: Boolean,
    val customizeDashboardCompleted: Boolean,
    val dismissed: Boolean,
    val completedAt: Long?,
)

/**
 * One render-ready checklist row — the native counterpart of a web `task` after `t()` resolution. [id] is
 * the stable slug (web `task.id`), [ctaTo] is the navigation target the row's CTA invokes, [complete]
 * drives the check icon + strikethrough + CTA visibility (web `task.complete`), and [glyph] selects the
 * leading icon. Pure data — no Compose types.
 */
data class OnboardingTask(
    val id: String,
    val title: String,
    val description: String,
    val ctaLabel: String,
    val ctaTo: String,
    val complete: Boolean,
    val glyph: OnboardingTaskGlyph,
)

/**
 * The fully projected, render-ready view of the checklist — the native analogue of everything the web
 * component computes before returning JSX (the `visibleTasks`, `completeCount`, `totalCount`,
 * `allComplete`, `progressPct`, and the `shouldHideChecklist` result). Pure data so the projection is
 * unit-tested without a UI host.
 */
data class OnboardingChecklistData(
    val tasks: List<OnboardingTask>,
    val completeCount: Int,
    val totalCount: Int,
    val allComplete: Boolean,
    val progressPct: Int,
    val dismissed: Boolean,
    val completedAt: Long?,
    val hidden: Boolean,
)

/** Localized title/description/CTA copy for one task (web `t(task.titleKey, …)` triple). */
data class OnboardingTaskCopy(
    val title: String,
    val description: String,
    val cta: String,
)

/**
 * Localized strings the surface folds into its output. The composable builds this from `stringResource`
 * (P1/S10 catalog); tests pass a deterministic instance. Keeping i18n out of the projection lets the
 * projection stay a pure, locale-stable function. [progress] formats the web `{{done}}/{{total}} complete`
 * template; [formatRelative] localizes the optional freshness chip shared with the data-display layer.
 */
data class OnboardingChecklistStrings(
    val title: String,
    val dismiss: String,
    val completeMessage: String,
    val dismissedTitle: String,
    val dismissedMessage: String,
    val restart: String,
    val emptyMessage: String,
    val offlineLabel: String,
    val refreshingLabel: String,
    val progress: (Int, Int) -> String,
    val formatRelative: (FreshnessAge) -> String,
    val tasks: Map<OnboardingTaskId, OnboardingTaskCopy>,
) {
    /** The localized copy for [id], falling back to the stable slug so a missing key never crashes. */
    fun copyFor(id: OnboardingTaskId): OnboardingTaskCopy = tasks[id] ?: OnboardingTaskCopy(title = id.slug, description = "", cta = "")
}

/**
 * Pure projection from the raw [OnboardingChecklistInputs] (+ localized strings + a clock) to the
 * render-ready [OnboardingChecklistData] — the native port of the web component's `useChecklistTasks`
 * derivation and its `shouldHideChecklist` visibility rule. No Compose, no platform clock; unit-tested
 * end to end.
 */
object OnboardingChecklistProjection {
    /** Default theme id — selecting any other theme counts as "picked a theme" (web `DEFAULT_THEME_ID`). */
    const val DEFAULT_THEME_ID = "neon-cyan"

    /** Keep the celebratory "all set" state for 24h after 100% (web `CELEBRATION_WINDOW_MS`). */
    const val CELEBRATION_WINDOW_MS = 24L * 60L * 60L * 1000L

    private const val PERCENT = 100

    /** The web per-task `complete` predicate, derived from the live inputs alone (no strings needed). */
    fun isComplete(
        task: OnboardingTaskId,
        inputs: OnboardingChecklistInputs,
    ): Boolean =
        when (task) {
            OnboardingTaskId.ConnectVehicle -> inputs.vehicleCount > 0
            OnboardingTaskId.PickTheme -> inputs.themeId != DEFAULT_THEME_ID
            OnboardingTaskId.FirstAlert -> inputs.alertRuleCount > 0
            OnboardingTaskId.NotificationChannel -> inputs.channelCount > 0
            OnboardingTaskId.CommandPalette -> inputs.commandPaletteDiscovered
            OnboardingTaskId.EnablePush -> inputs.webPushGranted
            OnboardingTaskId.CustomizeDashboard -> inputs.customizeDashboardCompleted
        }

    /** Count of complete tasks (web `completeCount`). */
    fun completeCount(inputs: OnboardingChecklistInputs): Int = OnboardingTaskId.entries.count { isComplete(it, inputs) }

    /** True once every task is complete (web `allComplete = totalCount > 0 && completeCount === totalCount`). */
    fun allComplete(inputs: OnboardingChecklistInputs): Boolean {
        val total = OnboardingTaskId.entries.size
        return total > 0 && completeCount(inputs) == total
    }

    /**
     * Whether the widget should hide its checklist entirely — the verbatim web `shouldHideChecklist`:
     * dismissed, or completed long enough ago that the 24h celebration window has elapsed.
     */
    fun shouldHide(
        dismissed: Boolean,
        allComplete: Boolean,
        completedAt: Long?,
        nowMs: Long,
    ): Boolean =
        when {
            dismissed -> true
            allComplete && completedAt != null -> nowMs - completedAt > CELEBRATION_WINDOW_MS
            else -> false
        }

    /**
     * Projects [inputs] + localized [strings] + the wall clock [nowMs] into the render-ready
     * [OnboardingChecklistData]. Reproduces the web `visibleTasks` map, the `completeCount`/`totalCount`
     * tally, the rounded `progressPct`, and the `shouldHideChecklist` gate.
     */
    fun project(
        inputs: OnboardingChecklistInputs,
        strings: OnboardingChecklistStrings,
        nowMs: Long,
    ): OnboardingChecklistData {
        val tasks =
            OnboardingTaskId.entries.map { id ->
                val copy = strings.copyFor(id)
                OnboardingTask(
                    id = id.slug,
                    title = copy.title,
                    description = copy.description,
                    ctaLabel = copy.cta,
                    ctaTo = id.ctaTo,
                    complete = isComplete(id, inputs),
                    glyph = id.glyph,
                )
            }
        val total = tasks.size
        val complete = tasks.count { it.complete }
        val all = total > 0 && complete == total
        val pct = if (total == 0) 0 else (complete.toFloat() / total * PERCENT).roundToInt()
        return OnboardingChecklistData(
            tasks = tasks,
            completeCount = complete,
            totalCount = total,
            allComplete = all,
            progressPct = pct,
            dismissed = inputs.dismissed,
            completedAt = inputs.completedAt,
            hidden = shouldHide(inputs.dismissed, all, inputs.completedAt, nowMs),
        )
    }
}
