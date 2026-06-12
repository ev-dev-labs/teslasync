// Pure, framework-free model + projection for the SubscribeCard feature view — the native analogue of everything
// the web component declares before returning JSX (web/src/features/system/components/status/SubscribeCard.tsx). No
// Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is a purely presentational discoverability tile on /system-status. It performs no data fetch
// and binds no hook (the parity manifest records hooks_count = 0, titles_count = 0); it simply renders a header and
// a fixed grid of five channel tiles, each a router <Link> to the existing channel-setup surfaces. This file owns
// exactly the parts the web component declares as data: the ordered set of channel tiles ([SubscribeChannelKind]),
// the navigation target each tile links to ([SubscribeDestination] + its route, mirroring the web `to` prop), and
// the verbatim copy the shared i18n catalog has no key for. The render layer resolves each kind to a concrete
// icon + the localized / verbatim label + description at the Compose boundary.
//
// i18n mapping (P1/S10). The web source is not internationalized — it hard-codes English literals that exist
// nowhere in the shared catalog, and this surface's allowed-files scope is limited to SubscribeCard.*, so it
// cannot extend the catalog. The native port therefore binds a region to a catalog key only when that key's value
// is a lossless match for the web text, and reproduces the web copy verbatim otherwise:
//   • title             -> R.string.translation_checklist_tasks_notify_title          (localized chrome)
//   • subtitle          -> R.string.translation_help_fields_settings_notificationChannels (localized chrome)
//   • Email label       -> R.string.translation_teslaAccount_email   ("Email", lossless)
//   • Browser-push label-> R.string.translation_webpush_title        ("Browser push", lossless)
//   • channel brand / protocol identifiers (Slack, Discord, Webhook) -> verbatim ([SubscribeCardCopy]); trademarks
//     and protocol names are not localized, and the catalog carries no key for them.
//   • delivery descriptors (SMTP / Webhook channel / Custom HTTP endpoint / Opt-in PWA notifications) -> verbatim
//     ([SubscribeCardCopy]); the catalog carries no key for these short technical descriptors.
// The composable reads the catalog-keyed regions through `stringResource`; the verbatim regions come from
// [SubscribeCardCopy]. Both are exercised by the on-device UI test.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SubscribeCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.subscribecard

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SubscribeCardRegistration {
    /** Stable surface id. */
    const val ID: String = "subscribe-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SubscribeCard"
}

/**
 * The five alert-channel tiles the web component renders, in source order. Each constant maps 1:1 to a web
 * `<ChannelTile>` and carries no Compose / Android types so the ordering is fully unit-testable; the render layer
 * resolves each to a concrete icon and the localized / verbatim label + description.
 */
enum class SubscribeChannelKind {
    /** Web `Mail` tile — SMTP email delivery. */
    Email,

    /** Web `MessageSquare` tile — Slack (delivered as a webhook channel). */
    Slack,

    /** Web `Hash` tile — Discord (delivered as a webhook channel). */
    Discord,

    /** Web `Webhook` tile — a generic custom HTTP endpoint. */
    Webhook,

    /** Web `Smartphone` tile — opt-in browser / PWA push. */
    BrowserPush,
}

/**
 * The navigation targets the tiles link to — the native analogue of the web `<Link to=…>` prop. [route] is the
 * exact web path so a host can map it onto the native nav graph and the projection can be verified against the web
 * source. The view itself never navigates; it surfaces the intent through [SubscribeCardActions] callbacks.
 */
enum class SubscribeDestination(
    val route: String,
) {
    /** Web `to="/notifications/channels"` — the email / Slack / Discord / webhook setup surface. */
    NotificationChannels("/notifications/channels"),

    /** Web `to="/settings/notifications"` — the browser-push opt-in in Settings. */
    BrowserPushSettings("/settings/notifications"),
}

/**
 * One fully projected, render-ready channel tile — the native analogue of a web `<ChannelTile>`. Pure data (no
 * Compose types): the composable maps [kind] to an icon and a label + description, and routes a tap through the
 * callback selected by [destination].
 *
 * @property kind the channel this tile configures (drives the icon + label + description at the render boundary).
 * @property destination the surface the tile opens — the web `to` target.
 */
data class SubscribeChannel(
    val kind: SubscribeChannelKind,
    val destination: SubscribeDestination,
)

/**
 * Verbatim copy reproduced from the web source for the regions the shared P1/S10 catalog has no matching key for
 * (channel brand / protocol identifiers and the short delivery descriptors). Kept here, free of Android resource
 * lookups, so the projection stays unit-testable and the render layer reads one canonical source. See the
 * file-header i18n mapping for which regions are catalog-keyed instead.
 */
object SubscribeCardCopy {
    /** Web `label="Slack"` — a trademark, rendered verbatim (not localized). */
    const val SLACK_LABEL: String = "Slack"

    /** Web `label="Discord"` — a trademark, rendered verbatim (not localized). */
    const val DISCORD_LABEL: String = "Discord"

    /** Web `label="Webhook"` — a protocol identifier, rendered verbatim (catalog has only the plural form). */
    const val WEBHOOK_LABEL: String = "Webhook"

    /** Web `description="SMTP-based delivery"` for the email tile. */
    const val EMAIL_DESCRIPTION: String = "SMTP-based delivery"

    /** Web `description="Webhook channel"` shared by the Slack and Discord tiles. */
    const val WEBHOOK_CHANNEL_DESCRIPTION: String = "Webhook channel"

    /** Web `description="Custom HTTP endpoint"` for the generic webhook tile. */
    const val CUSTOM_HTTP_DESCRIPTION: String = "Custom HTTP endpoint"

    /** Web `description="Opt-in PWA notifications"` for the browser-push tile. */
    const val BROWSER_PUSH_DESCRIPTION: String = "Opt-in PWA notifications"
}

/**
 * The localized + verbatim microcopy the surface renders (P1/S10), resolved at the Compose boundary and passed to
 * the render layer. [channelText] is keyed by [SubscribeChannelKind] so each tile reads its own label + description.
 * Mirrors the web component's per-tile `label` / `description` props.
 *
 * @property title the card heading — web "Get notified about incidents".
 * @property subtitle the card subheading — web "Self-hosted: configure your own channels for status events.".
 * @property channelText the per-channel label + description, one entry per [SubscribeChannelKind].
 */
data class SubscribeCardStrings(
    val title: String,
    val subtitle: String,
    val channelText: Map<SubscribeChannelKind, SubscribeChannelText>,
)

/**
 * The label + description for a single channel tile — the web `<ChannelTile label=… description=…>` pair.
 *
 * @property label the channel name shown in the tile (e.g. "Email").
 * @property description the one-line delivery descriptor beneath the label (e.g. "SMTP-based delivery").
 */
data class SubscribeChannelText(
    val label: String,
    val description: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's fixed tile list. Stateless
 * and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SubscribeCardProjection {
    /**
     * The five channel tiles in web source order, each paired with the surface it opens — the native analogue of
     * the web component's five `<ChannelTile to=…>` declarations. The list is fixed (the web component takes no
     * props), so a host renders it directly; an empty list is still handled by the render layer's empty state.
     */
    fun channels(): List<SubscribeChannel> =
        listOf(
            SubscribeChannel(SubscribeChannelKind.Email, SubscribeDestination.NotificationChannels),
            SubscribeChannel(SubscribeChannelKind.Slack, SubscribeDestination.NotificationChannels),
            SubscribeChannel(SubscribeChannelKind.Discord, SubscribeDestination.NotificationChannels),
            SubscribeChannel(SubscribeChannelKind.Webhook, SubscribeDestination.NotificationChannels),
            SubscribeChannel(SubscribeChannelKind.BrowserPush, SubscribeDestination.BrowserPushSettings),
        )
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SubscribeCardRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordSubscribeCardOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SubscribeCardRegistration.SLUG))
}
