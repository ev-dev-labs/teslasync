// File named after its primary @Composable; the co-located enum/data class are supporting types.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant

/** FSM machine family, driving the badge tone + label. */
enum class FsmVariant { Info, Success, Warning, Danger, Neutral }

/** Resolved badge configuration for an FSM machine type. */
data class FsmBadgeConfig(
    val variant: FsmVariant,
    val label: String,
)

/**
 * Maps an FSM machine [type] to its badge tone + default label — the Android counterpart of the
 * web `FSM_COLORS` table. Unknown types fall back to a neutral badge labelled with the raw type.
 */
fun fsmBadgeConfig(type: String): FsmBadgeConfig =
    when (type) {
        "vehicle" -> FsmBadgeConfig(FsmVariant.Info, "Vehicle")
        "drive_session" -> FsmBadgeConfig(FsmVariant.Success, "Drive")
        "charge_session" -> FsmBadgeConfig(FsmVariant.Warning, "Charge")
        "command" -> FsmBadgeConfig(FsmVariant.Danger, "Command")
        "notification" -> FsmBadgeConfig(FsmVariant.Neutral, "Notify")
        "alert_cooldown" -> FsmBadgeConfig(FsmVariant.Neutral, "Cooldown")
        "automation" -> FsmBadgeConfig(FsmVariant.Info, "Automation")
        else -> FsmBadgeConfig(FsmVariant.Neutral, type)
    }

/**
 * Badge naming the FSM machine that owns a transition — the Android counterpart of the web
 * `FSMBadge`. Built on the shared `components/ui/Badge`; pass [label] to override the default.
 */
@Composable
fun FSMBadge(
    type: String,
    modifier: Modifier = Modifier,
    label: String? = null,
) {
    val config = fsmBadgeConfig(type)
    Badge(text = label ?: config.label, modifier = modifier, variant = fsmBadgeVariant(config.variant))
}

private fun fsmBadgeVariant(variant: FsmVariant): BadgeVariant =
    when (variant) {
        FsmVariant.Info -> BadgeVariant.Info
        FsmVariant.Success -> BadgeVariant.Success
        FsmVariant.Warning -> BadgeVariant.Warning
        FsmVariant.Danger -> BadgeVariant.Danger
        FsmVariant.Neutral -> BadgeVariant.Neutral
    }
