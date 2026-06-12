// The native Jetpack Compose + Material 3 SubscribeCard feature view — a parity port of
// web/src/features/system/components/status/SubscribeCard.tsx. The web component is a purely presentational
// discoverability tile on /system-status: a GlassPanel holding a bell-iconed heading, a one-line subtitle, and a
// responsive grid of five channel tiles (Email, Slack, Discord, Webhook, Browser push), each a router <Link> to the
// existing channel-setup surfaces. It deliberately does not reimplement subscription management.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// dependency is the router <Link>, mapped here to host callbacks); the host owns navigation and wires it through
// [SubscribeCardActions], exactly like the web `to` targets. Because the surface acceptance gate requires every
// lifecycle state to render, the stateful entry takes a cache-then-network [UiState] and draws each state the
// shared state-holder layer (P1/S8) can carry — a loading skeleton, a hard-error retry surface, a friendly empty
// state, the loaded card, and stale/offline ("last known") with a freshness chip + auto-refresh — without ever
// fetching. A web-parity overload taking no data is provided for hosts that simply render the fixed tile list.
//
// The five web Lucide glyphs (Mail, MessageSquare, Hash, Webhook, Smartphone) are not in the shared icon library,
// so they are authored here as 24×24 round-capped stroked vectors in the shared monochrome style — a feature view
// may not expand the shared icon library from a surface prompt (allowed-files), exactly as the sibling
// feature-view surfaces do. The bell heading glyph reuses the shared FeedbackGlyphs.Bell. Icon and text colors map
// to the Material scheme so light / dark / high-contrast all stay correct (never raw hex in render code).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SubscribeCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.subscribecard

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Minimum panel width at which the tile grid switches to two columns — the web `sm:grid-cols-2` breakpoint. */
private val TWO_COLUMN_MIN_WIDTH: Dp = 560.dp

/** Loading skeleton dimensions, sized so the card never first-paints as a blank box. */
private val SKELETON_TITLE_HEIGHT: Dp = 18.dp
private val SKELETON_LINE_HEIGHT: Dp = 12.dp
private val SKELETON_TILE_HEIGHT: Dp = 52.dp
private const val SKELETON_TITLE_FRACTION: Float = 0.6f
private const val SKELETON_SUBTITLE_FRACTION: Float = 0.85f
private const val SKELETON_TILE_COUNT: Int = 4

/** Em dash shown when a freshness age is unknown — the "no value" fallback for the freshness chip. */
private const val EM_DASH: String = "\u2014"

/**
 * The host-supplied navigation callbacks — the native analogue of the web component's router `<Link to=…>` targets.
 * Both default to no-ops so previews and the empty / loading / error states (which render no tile) need not supply
 * them.
 *
 * @property onOpenChannels open the notification-channel setup surface — the web `to="/notifications/channels"`
 *  links shared by the Email, Slack, Discord, and Webhook tiles.
 * @property onOpenBrowserPush open the browser-push opt-in in Settings — the web `to="/settings/notifications"`
 *  link on the Browser-push tile.
 */
class SubscribeCardActions(
    val onOpenChannels: () -> Unit = {},
    val onOpenBrowserPush: () -> Unit = {},
)

/**
 * Stateful entry point for the card. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and renders
 * every lifecycle [state] the shared state holder can carry. The host owns navigation (P1/S8) and supplies
 * [onRetry] (its `refetch`) plus the [actions]; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the channel tiles (typically [SubscribeCardProjection.channels]).
 * @param actions the navigation callbacks — wired by the host to the channel-setup surfaces.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SubscribeCard(
    state: UiState<List<SubscribeChannel>>,
    actions: SubscribeCardActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordSubscribeCardOpened(logger) }
    SubscribeCardContent(state = state, actions = actions, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's prop-less signature, for hosts that simply render the fixed
 * tile list. Wraps [SubscribeCardProjection.channels] in a content [UiState] and renders the card — no fetch sits
 * behind it, so it offers no retry affordance. Records `view.opened` like the stateful entry.
 */
@Composable
fun SubscribeCard(
    actions: SubscribeCardActions,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember { UiState(phase = UiPhase.Content, data = SubscribeCardProjection.channels()) }
    SubscribeCard(state = state, actions = actions, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's card
 * exactly for the loaded state and adds the lifecycle chrome the host's state holder implies: a loading skeleton, a
 * hard-error retry surface, a friendly empty state, and a freshness chip that reflects refreshing / stale /
 * offline. Stale (non-error) data auto-refreshes, mirroring the freshness contract the sibling surfaces use.
 */
@Composable
fun SubscribeCardContent(
    state: UiState<List<SubscribeChannel>>,
    actions: SubscribeCardActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: SubscribeCardStrings = rememberSubscribeCardStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val channels = state.data ?: emptyList()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> SubscribeCardLoading()
            state.isError -> SubscribeCardError(onRetry = onRetry)
            channels.isEmpty() -> SubscribeCardEmpty(strings = strings)
            else -> {
                if (state.stale || state.refreshing || state.hasError) {
                    SubscribeCardFreshnessRow(state = state)
                }
                SubscribeCardBody(channels = channels, actions = actions, strings = strings)
            }
        }
    }
}

/** The loaded card — the faithful render of the web component: the bell heading + subtitle, then the tile grid. */
@Composable
private fun SubscribeCardBody(
    channels: List<SubscribeChannel>,
    actions: SubscribeCardActions,
    strings: SubscribeCardStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SubscribeCardHeader(strings = strings)
        SubscribeChannelGrid(channels = channels, actions = actions, strings = strings)
    }
}

/** The bell-iconed heading + one-line subtitle — the web `<h3><Bell/> …</h3>` followed by the `<p>` subtitle. */
@Composable
private fun SubscribeCardHeader(strings: SubscribeCardStrings) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(FeedbackGlyphs.Bell, contentDescription = null, size = IconSize.Md)
            PanelTitle(strings.title)
        }
        HelperText(strings.subtitle)
    }
}

/**
 * The responsive tile grid — the web `grid-cols-1 sm:grid-cols-2`. One column on a compact panel, two once the
 * panel is at least [TWO_COLUMN_MIN_WIDTH] wide; an odd final row pads with a flexible spacer so tiles keep equal
 * widths. Tiles render in [SubscribeCardProjection] order.
 */
@Composable
private fun SubscribeChannelGrid(
    channels: List<SubscribeChannel>,
    actions: SubscribeCardActions,
    strings: SubscribeCardStrings,
) {
    val tiles = channels.mapNotNull { channel -> strings.channelText[channel.kind]?.let { channel to it } }
    BoxWithConstraints {
        val columns = if (maxWidth >= TWO_COLUMN_MIN_WIDTH) 2 else 1
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            tiles.chunked(columns).forEach { rowTiles ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    rowTiles.forEach { (channel, text) ->
                        ChannelTile(
                            channel = channel,
                            text = text,
                            actions = actions,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(columns - rowTiles.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * One channel tile — the web `<ChannelTile>`: a bordered, rounded, tappable row of an accent icon, the channel
 * label, and the one-line delivery descriptor. The whole tile is a single merged, button-roled accessibility node
 * carrying the label + description text and an "open" action label, mirroring the web `<Link>` target.
 */
@Composable
private fun ChannelTile(
    channel: SubscribeChannel,
    text: SubscribeChannelText,
    actions: SubscribeCardActions,
    modifier: Modifier = Modifier,
) {
    val onClick =
        when (channel.destination) {
            SubscribeDestination.NotificationChannels -> actions.onOpenChannels
            SubscribeDestination.BrowserPushSettings -> actions.onOpenBrowserPush
        }
    Row(
        modifier =
            modifier
                .clip(RoundedCornerShape(Radius.md))
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(Radius.md))
                .clickable(role = Role.Button, onClickLabel = text.label, onClick = onClick)
                .semantics(mergeDescendants = true) {}
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            glyphFor(channel.kind),
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.primary,
        )
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(text.label, color = MaterialTheme.colorScheme.onSurface)
            Caption(text.description)
        }
    }
}

/** First-load skeleton — a heading + subtitle bar plus tile bars so the card is never blank while loading. */
@Composable
private fun SubscribeCardLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        Skeleton(widthFraction = SKELETON_SUBTITLE_FRACTION, height = SKELETON_LINE_HEIGHT)
        repeat(SKELETON_TILE_COUNT) { Skeleton(height = SKELETON_TILE_HEIGHT, rounded = true) }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SubscribeCardError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty surface — a friendly state shown when the host resolved no channels, never a blank box. */
@Composable
private fun SubscribeCardEmpty(strings: SubscribeCardStrings) {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = FeedbackGlyphs.Bell,
        title = strings.title,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The stale / refreshing / offline freshness chip, right-aligned above the card body. */
@Composable
private fun SubscribeCardFreshnessRow(state: UiState<List<SubscribeChannel>>) {
    val formatAge = rememberSubscribeCardFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/** The concrete vector for a [SubscribeChannelKind] — the native counterpart of each web Lucide tile glyph. */
private fun glyphFor(kind: SubscribeChannelKind): ImageVector =
    when (kind) {
        SubscribeChannelKind.Email -> MailGlyph
        SubscribeChannelKind.Slack -> MessageSquareGlyph
        SubscribeChannelKind.Discord -> HashGlyph
        SubscribeChannelKind.Webhook -> WebhookGlyph
        SubscribeChannelKind.BrowserPush -> SmartphoneGlyph
    }

// ── i18n facade (P1/S10) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Builds the [SubscribeCardStrings] for the surface (P1/S10). Catalog-keyed regions (the heading, subtitle, the
 * "Email" and "Browser push" labels — all lossless matches) resolve through `stringResource`; the channel
 * brand / protocol identifiers and the short delivery descriptors come verbatim from [SubscribeCardCopy], since the
 * shared catalog has no key for them and this surface may not extend it (see the model's i18n mapping note).
 */
@Composable
private fun rememberSubscribeCardStrings(): SubscribeCardStrings {
    val title = stringResource(R.string.translation_checklist_tasks_notify_title)
    val subtitle = stringResource(R.string.translation_help_fields_settings_notificationChannels)
    val emailLabel = stringResource(R.string.translation_teslaAccount_email)
    val browserPushLabel = stringResource(R.string.translation_webpush_title)
    return remember(title, subtitle, emailLabel, browserPushLabel) {
        SubscribeCardStrings(
            title = title,
            subtitle = subtitle,
            channelText =
                mapOf(
                    SubscribeChannelKind.Email to
                        SubscribeChannelText(emailLabel, SubscribeCardCopy.EMAIL_DESCRIPTION),
                    SubscribeChannelKind.Slack to
                        SubscribeChannelText(
                            SubscribeCardCopy.SLACK_LABEL,
                            SubscribeCardCopy.WEBHOOK_CHANNEL_DESCRIPTION,
                        ),
                    SubscribeChannelKind.Discord to
                        SubscribeChannelText(
                            SubscribeCardCopy.DISCORD_LABEL,
                            SubscribeCardCopy.WEBHOOK_CHANNEL_DESCRIPTION,
                        ),
                    SubscribeChannelKind.Webhook to
                        SubscribeChannelText(
                            SubscribeCardCopy.WEBHOOK_LABEL,
                            SubscribeCardCopy.CUSTOM_HTTP_DESCRIPTION,
                        ),
                    SubscribeChannelKind.BrowserPush to
                        SubscribeChannelText(browserPushLabel, SubscribeCardCopy.BROWSER_PUSH_DESCRIPTION),
                ),
        )
    }
}

/** Localized relative-age formatter for the freshness chip — the same render-only concern the siblings resolve. */
@Composable
private fun rememberSubscribeCardFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Local Lucide glyphs ───────────────────────────────────────────────────────────────────────────────────────
// The five web tile glyphs the shared icon libraries do not provide, authored as 24×24 round-capped stroked
// vectors in the shared monochrome style and recolored at render time by the `Icon` tint.

/** Web `Mail` (lucide `Mail`) — an envelope body with a flap. */
private val MailGlyph: ImageVector =
    strokedGlyph("Mail") {
        rect(3f, 5f, 21f, 19f)
        moveTo(3f, 6f)
        lineTo(12f, 12.5f)
        lineTo(21f, 6f)
    }

/** Web `MessageSquare` (lucide `MessageSquare`) — a speech bubble with a bottom-left tail. */
private val MessageSquareGlyph: ImageVector =
    strokedGlyph("MessageSquare") {
        moveTo(4f, 4f)
        lineTo(20f, 4f)
        lineTo(20f, 15f)
        lineTo(8f, 15f)
        lineTo(4f, 19f)
        close()
    }

/** Web `Hash` (lucide `Hash`) — two slanted verticals crossed by two horizontals. */
private val HashGlyph: ImageVector =
    strokedGlyph("Hash") {
        moveTo(8f, 3f)
        lineTo(6.5f, 21f)
        moveTo(16f, 3f)
        lineTo(14.5f, 21f)
        moveTo(4f, 9f)
        lineTo(20f, 9f)
        moveTo(3.5f, 15f)
        lineTo(19.5f, 15f)
    }

/** Web `Webhook` (lucide `Webhook`) — three connected nodes (the webhook fan-out motif). */
private val WebhookGlyph: ImageVector =
    strokedGlyph("Webhook") {
        circle(8.5f, 7.5f, 2.3f)
        circle(16.5f, 14.5f, 2.3f)
        circle(7.5f, 16.5f, 2.3f)
        moveTo(9.9f, 9.4f)
        lineTo(14.6f, 12.7f)
        moveTo(14.2f, 15.6f)
        lineTo(9.7f, 16.4f)
    }

/** Web `Smartphone` (lucide `Smartphone`) — a phone body with a home indicator. */
private val SmartphoneGlyph: ImageVector =
    strokedGlyph("Smartphone") {
        rect(7f, 2.5f, 17f, 21.5f)
        moveTo(11f, 18.5f)
        lineTo(13f, 18.5f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

// ── Previews ──────────────────────────────────────────────────────────────────────────────────────────────────

private val previewActions = SubscribeCardActions()

@Preview(showBackground = true)
@Composable
private fun SubscribeCardLoadedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SubscribeCardContent(
            state = UiState(phase = UiPhase.Content, data = SubscribeCardProjection.channels()),
            actions = previewActions,
            onRetry = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SubscribeCardLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SubscribeCardContent(
            state = UiState(phase = UiPhase.Loading),
            actions = previewActions,
            onRetry = {},
        )
    }
}
