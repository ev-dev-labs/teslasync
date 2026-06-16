// Pure, framework-free metadata + seed data for the ActionBuilderPage automations surface — the native
// analogue of the cross-cutting concerns the web page owns (web/src/features/automations/pages/ActionBuilder.tsx).
// No Compose, no Android framework, no HTTP lives here, so the surface slug + the seed factories are exercised
// off-device and the composable stays a thin render layer.
//
// The web `ActionBuilder` is an UNROUTED, controlled sub-component of the automation editor: its only hook is
// `useTranslation` and its action list + per-field edits flow through props (`actions`/`channels`/`onChange`),
// so it binds no data feed and performs no async work. The faithful Android port of that contract already exists
// as the shared feature view io.teslasync.android.featureviews.actionbuilder.ActionBuilder (apps/android/app/
// src/main/java/com/teslasync/feature-views/ActionBuilder), which reproduces the four action kinds, the JSON
// command-params validation, the move/remove controls, and all 27 web i18n keys. This page surface promotes
// that controlled editor to a standalone screen by seeding it with a representative action of each kind plus a
// couple of notify channels, so every panel, data state and string is reachable without a parent supplying
// state (the same role the web AutomationBuilder page plays when it embeds <ActionBuilder/>).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 page surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located registration + recorder + seed factories.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.automations.actionbuilder

import io.teslasync.android.featureviews.actionbuilder.ActionChannel
import io.teslasync.android.featureviews.actionbuilder.ActionStepInput
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Canonical metadata for this surface. The web `ActionBuilder` is an unrouted, composed sub-component of the
 * automation editor (not a draggable widget and not its own route), so this object carries only the
 * cross-cutting concerns the surface owes: the diagnostics [SLUG] emitted with the one-shot `view.opened`
 * event (P1/S11) and the [WEB_SOURCE] it mirrors. There is no `ROUTE_ID`/`WEB_PATH` because the web source is
 * unrouted (manifest `route: (unrouted)`); the page is consumed by embedding, exactly as the web editor embeds
 * the controlled component.
 */
object ActionBuilderPageRegistration {
    /** Diagnostics surface slug emitted with the page's `view.opened` event (P1/S11). */
    const val SLUG: String = "ActionBuilderPage"

    /** The web source this surface mirrors. */
    const val WEB_SOURCE: String = "web/src/features/automations/pages/ActionBuilder.tsx"
}

/** Emits the one PII-safe `view.opened` diagnostic with the page slug (P1/S11); carries no action content. */
internal fun recordActionBuilderPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ActionBuilderPageRegistration.SLUG))
}

/**
 * One representative action of each of the four kinds so the promoted editor renders every field set, panel,
 * data state and string without a parent supplying state. The command seeds valid JSON params (the success
 * data state of the params editor; typing invalid JSON surfaces the error state), the notify targets the first
 * seeded channel, the set-setting uses a numeric value, and the call-automation references a target id. This is
 * the native analogue of the `actions` prop a host hands the web controlled component.
 */
fun actionBuilderSampleActions(): List<ActionStepInput> =
    listOf(
        ActionStepInput.Command(
            commandName = "set_charge_limit",
            commandParams =
                buildJsonObject {
                    put("percent", 80)
                },
        ),
        ActionStepInput.Notify(channelId = 1, template = "Car is warming up!"),
        ActionStepInput.SetSetting(settingKey = "charge_limit", valueNum = 80.0),
        ActionStepInput.CallAutomation(targetAutomationId = 12),
    )

/**
 * The notification channels the notify action can target — the native analogue of the web `channels` prop. One
 * enabled and one disabled channel so the notify Select renders both a selectable and a disabled row (web
 * `disabled: !channel.enabled`).
 */
fun actionBuilderSampleChannels(): List<ActionChannel> =
    listOf(
        ActionChannel(id = 1, name = "Family Telegram", kind = "telegram", enabled = true),
        ActionChannel(id = 2, name = "Ops Slack", kind = "slack", enabled = false),
    )

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
