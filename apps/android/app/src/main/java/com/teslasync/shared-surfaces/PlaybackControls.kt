// The native Jetpack Compose + Material 3 PlaybackControls shared surface — a parity port of
// web/src/components/data-display/PlaybackControls.tsx. The web component is the trip-replay control bar:
// a Reset (SkipBack) / Play-Pause / Stop button group, a PlaybackSpeedMenu cycling {1,10,25,50,100}×, a
// TimelineScrubber (drag/click-to-seek with marker ticks), an `elapsed / total` readout, and — when
// `enableKeyboardShortcuts` is on — a hardware-keyboard handler (Space/K, ←/→ ±5/±30s, J/L ±10s, ,/.
// frame, Home/End, 0-9 percent, +/- speed) that flashes an inline toast plus a Tooltip cheatsheet.
//
// This port keeps that composition and contract end to end. The pure clock + shortcut + classification
// LOGIC lives in [PlaybackControlsModel] (off-device tested); the replay timeline is bound through the
// shared S8 [ReplayTimelineSource] into a [PlaybackControlsViewModel] (no HTTP touches the view); and the
// composable below is a thin, stateless render layer driven by the folded [PlaybackControlsState]. Every
// prompt state renders from the REAL positions-feed `Resource` lifecycle: loading → skeleton chrome,
// error (no cache) → QueryError + retry, empty (drive with no positions) → the bar with a friendly
// EmptyState (never a blank box), stale/offline → an Offline pill + retry over the still-seekable cached
// frames, content → the live interactive bar. Every visible string resolves through the i18n catalog
// (P1/S10); every control carries a TalkBack label; the toast is an `assertive`-free polite live region;
// the one mandated `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PlaybackControls) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, strings holder, glyphs,
// and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.playbackcontrols

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Slider
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

// ── Visual constants (detekt MagicNumber is off for this theme layer; named here for clarity). ──────────
private val GLYPH_SIZE: Dp = 24.dp
private const val GLYPH_VIEWPORT: Float = 24f
private val SCRUBBER_RAIL_HEIGHT: Dp = 8.dp
private val MARKER_WIDTH: Dp = 3.dp
private val TIME_MIN_WIDTH: Dp = 96.dp
private val HELP_KEY_COLUMN_WIDTH: Dp = 92.dp
private const val RAIL_BASE_ALPHA: Float = 0.18f

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------

/**
 * The content-level callbacks the stateless bar emits — hoisted so the renderer stays free of the
 * ViewModel and is fully preview-/screenshot-testable. The keyboard handler is wired separately on the
 * stateful root (it needs the live `isPlaying` to label the play/pause toast).
 */
class PlaybackControlsActions(
    val onTogglePlay: () -> Unit = {},
    val onStop: () -> Unit = {},
    val onCycleSpeed: () -> Unit = {},
    val onSeek: (Float) -> Unit = {},
    val onRetry: () -> Unit = {},
    val onToggleHelp: () -> Unit = {},
)

// ------------------------------------------------------------------
// Stateful entry point
// ------------------------------------------------------------------

/**
 * Stateful entry point — collects the [PlaybackControlsViewModel] state, emits the one-shot `view.opened`
 * diagnostic on first composition (P1/S11), wires the hardware-keyboard handler when shortcuts are
 * enabled (web `enableKeyboardShortcuts`), and renders the stateless content.
 */
@Composable
fun PlaybackControls(
    viewModel: PlaybackControlsViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberPlaybackControlsStrings()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }

    val focusRequester = remember { FocusRequester() }
    val keyModifier =
        if (state.shortcutsEnabled) {
            Modifier
                .focusRequester(focusRequester)
                .focusable()
                .onPreviewKeyEvent { event -> handleShortcutKey(event, state.isPlaying, viewModel::onShortcut) }
        } else {
            Modifier
        }
    LaunchedEffect(state.shortcutsEnabled) {
        if (state.shortcutsEnabled) runCatching { focusRequester.requestFocus() }
    }

    PlaybackControlsContent(
        state = state,
        strings = strings,
        actions =
            PlaybackControlsActions(
                onTogglePlay = viewModel::togglePlay,
                onStop = viewModel::stop,
                onCycleSpeed = viewModel::cycleSpeed,
                onSeek = { viewModel.seekToProgress(it * 1.0) },
                onRetry = viewModel::retry,
                onToggleHelp = { viewModel.setHelpVisible(!state.helpVisible) },
            ),
        modifier = modifier.then(keyModifier),
    )
}

// ------------------------------------------------------------------
// Stateless content
// ------------------------------------------------------------------

/**
 * Stateless control bar — renders every branch the web source does: a hard error → QueryError; a first
 * load → skeleton chrome; otherwise the interactive bar, plus a friendly EmptyState for a drive with no
 * positions, an Offline pill + retry for stale/last-known frames, and the keyboard cheatsheet when
 * toggled. Hoisted out of the ViewModel so each state is preview- and screenshot-testable.
 */
@Composable
fun PlaybackControlsContent(
    state: PlaybackControlsState,
    strings: PlaybackControlsStrings,
    modifier: Modifier = Modifier,
    actions: PlaybackControlsActions = PlaybackControlsActions(),
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            FreshnessAndToastRow(state = state, strings = strings, onRetry = actions.onRetry)
            when {
                state.isError ->
                    QueryError(
                        kind = PlaybackControlsProjection.queryErrorKindFor(state.errorKind, state.httpStatus),
                        resourceName = strings.resourceName,
                        onRetry = actions.onRetry,
                    )
                state.isLoading -> LoadingChrome(strings = strings)
                else -> {
                    PlaybackBar(state = state, strings = strings, actions = actions)
                    if (state.isEmpty) {
                        EmptyState(message = strings.emptyMessage, icon = FeedbackGlyphs.WifiOff, title = strings.resourceName)
                    }
                    if (state.shortcutsEnabled && state.helpVisible) {
                        HelpCheatsheet(strings = strings)
                    }
                }
            }
        }
    }
}

@Composable
private fun FreshnessAndToastRow(
    state: PlaybackControlsState,
    strings: PlaybackControlsStrings,
    onRetry: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.align(Alignment.CenterStart),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state.refreshing && !state.isOffline) {
                StatusPill(text = strings.loadingLabel, tone = StatusTone.Info, pulse = true)
            }
            if (state.isOffline) {
                StatusPill(text = strings.offlineLabel, tone = StatusTone.Warning)
                Button(label = strings.retryLabel, onClick = onRetry, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            }
        }
        state.toast?.let { toast ->
            ShortcutToastChip(toast = toast, modifier = Modifier.align(Alignment.CenterEnd))
        }
    }
}

@Composable
private fun PlaybackBar(
    state: PlaybackControlsState,
    strings: PlaybackControlsStrings,
    actions: PlaybackControlsActions,
) {
    val interactive = state.isContent
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                imageVector = ResetGlyph,
                contentDescription = strings.reset,
                onClick = actions.onStop,
                enabled = interactive,
                size = IconSize.Md,
            )
            IconButton(
                imageVector = if (state.isPlaying) PauseGlyph else PlayGlyph,
                contentDescription = if (state.isPlaying) strings.pause else strings.play,
                onClick = actions.onTogglePlay,
                enabled = interactive,
                variant = IconButtonVariant.Tonal,
                size = IconSize.Md,
            )
            IconButton(
                imageVector = StopGlyph,
                contentDescription = strings.stop,
                onClick = actions.onStop,
                enabled = interactive,
                size = IconSize.Md,
            )
            SpeedChip(speed = state.clock.speed, strings = strings, enabled = interactive, onClick = actions.onCycleSpeed)
            Spacer(modifier = Modifier.weight(1f))
            TimeReadout(state = state, strings = strings)
            if (state.shortcutsEnabled) {
                IconButton(
                    imageVector = FeedbackGlyphs.Keyboard,
                    contentDescription = strings.helpLabel,
                    onClick = actions.onToggleHelp,
                    size = IconSize.Sm,
                )
            }
        }
        ReplayScrubber(
            progress = state.progress.toFloat(),
            markers = state.markers,
            enabled = interactive,
            label = strings.progressLabel,
            stateText = PlaybackControlsProjection.formatClock(state.clock.elapsedMs),
            onSeek = actions.onSeek,
        )
    }
}

@Composable
private fun SpeedChip(
    speed: Int,
    strings: PlaybackControlsStrings,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = Modifier.semantics { contentDescription = "${strings.speedLabel}: ${speed}x" },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        enabled = enabled,
    ) {
        CodeText("${speed}x")
        Icon(
            imageVector = TeslaGlyphs.ChevronDown,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun TimeReadout(
    state: PlaybackControlsState,
    strings: PlaybackControlsStrings,
) {
    val elapsed = PlaybackControlsProjection.formatClock(state.clock.elapsedMs)
    val total = PlaybackControlsProjection.formatClock(state.timeline.totalMs)
    CodeText(
        text = "$elapsed / $total",
        modifier =
            Modifier
                .widthIn(min = TIME_MIN_WIDTH)
                .semantics { contentDescription = "${strings.progressLabel}: $elapsed / $total" },
    )
}

@Composable
private fun ReplayScrubber(
    progress: Float,
    markers: List<ReplayMarker>,
    enabled: Boolean,
    label: String,
    stateText: String,
    onSeek: (Float) -> Unit,
) {
    val tickColors = markers.map { it.at.toFloat() to markerColor(it.kind) }
    val baseColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = RAIL_BASE_ALPHA)
    Column(modifier = Modifier.fillMaxWidth()) {
        Canvas(modifier = Modifier.fillMaxWidth().height(SCRUBBER_RAIL_HEIGHT)) {
            val midY = size.height / 2f
            drawRoundRect(
                color = baseColor,
                topLeft = Offset(0f, midY - 1f),
                size = Size(size.width, 2f),
                cornerRadius = CornerRadius(1f, 1f),
            )
            val tickWidthPx = MARKER_WIDTH.toPx()
            tickColors.forEach { (at, color) ->
                val x = (at.coerceIn(0f, 1f) * (size.width - tickWidthPx))
                drawRoundRect(
                    color = color,
                    topLeft = Offset(x, 0f),
                    size = Size(tickWidthPx, size.height),
                    cornerRadius = CornerRadius(tickWidthPx, tickWidthPx),
                )
            }
        }
        Slider(
            value = progress.coerceIn(0f, 1f),
            onValueChange = onSeek,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics {
                        contentDescription = label
                        stateDescription = stateText
                    },
            enabled = enabled,
        )
    }
}

@Composable
private fun ShortcutToastChip(
    toast: ShortcutToast,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        CodeText(
            text = shortcutToastLabel(toast),
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        )
    }
}

@Composable
private fun HelpCheatsheet(strings: PlaybackControlsStrings) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = RAIL_BASE_ALPHA * 2),
    ) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PanelTitle(strings.helpTitle)
            HelpRow(keys = "Space / K", description = strings.rowPlayPause)
            HelpRow(keys = "← / →", description = strings.rowSkip5)
            HelpRow(keys = "J / L", description = strings.rowSkip10)
            HelpRow(keys = ", / .", description = strings.rowFrame)
            HelpRow(keys = "Home / End", description = strings.rowStartEnd)
            HelpRow(keys = "0 – 9", description = strings.rowPercent)
            HelpRow(keys = "+ / −", description = strings.rowSpeed)
        }
    }
}

@Composable
private fun HelpRow(
    keys: String,
    description: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.width(HELP_KEY_COLUMN_WIDTH),
            shape = RoundedCornerShape(Radius.sm),
            color = MaterialTheme.colorScheme.surface,
        ) {
            CodeText(keys, modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs))
        }
        BodyText(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LoadingChrome(strings: PlaybackControlsStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
            Skeleton(widthFraction = LOADING_HEADER_FRACTION, height = LOADING_BAR_HEIGHT, rounded = true)
        }
        Skeleton(widthFraction = 1f, height = SCRUBBER_RAIL_HEIGHT, rounded = true)
        Caption(strings.loadingLabel)
    }
}

// ------------------------------------------------------------------
// Strings + label resolution
// ------------------------------------------------------------------

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberPlaybackControlsStrings(): PlaybackControlsStrings =
    PlaybackControlsStrings(
        reset = stringResource(R.string.translation_replay_controls_reset),
        play = stringResource(R.string.translation_replay_controls_play),
        pause = stringResource(R.string.translation_replay_controls_pause),
        stop = stringResource(R.string.translation_replay_controls_stop),
        speedLabel = stringResource(R.string.translation_replay_controls_speed),
        progressLabel = stringResource(R.string.translation_replay_controls_progress),
        helpLabel = stringResource(R.string.translation_replay_shortcuts_help),
        helpTitle = stringResource(R.string.translation_replay_shortcuts_title),
        rowPlayPause = stringResource(R.string.translation_replay_shortcuts_playPause),
        rowSkip5 = stringResource(R.string.translation_replay_shortcuts_skip5),
        rowSkip10 = stringResource(R.string.translation_replay_shortcuts_skip10),
        rowFrame = stringResource(R.string.translation_replay_shortcuts_frame),
        rowStartEnd = stringResource(R.string.translation_replay_shortcuts_startEnd),
        rowPercent = stringResource(R.string.translation_replay_shortcuts_percent),
        rowSpeed = stringResource(R.string.translation_replay_shortcuts_speed),
        emptyMessage = stringResource(R.string.translation_replay_map_noPositions),
        resourceName = stringResource(R.string.translation_replay_title),
        offlineLabel = stringResource(R.string.translation_common_offline),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        retryLabel = stringResource(R.string.translation_common_retry),
    )

/**
 * Resolves a [ShortcutToast] to its label: the named cases through the P1/S10 catalog (web `t()` calls),
 * the [ShortcutToast.Skip]/[ShortcutToast.Percent] cases as the web's language-neutral symbolic strings
 * (`⏪ −5s` / `30%`).
 */
@Composable
private fun shortcutToastLabel(toast: ShortcutToast): String =
    when (toast) {
        ShortcutToast.Play -> stringResource(R.string.translation_replay_shortcuts_play)
        ShortcutToast.Pause -> stringResource(R.string.translation_replay_shortcuts_pause)
        ShortcutToast.PrevFrame -> stringResource(R.string.translation_replay_shortcuts_prevFrame)
        ShortcutToast.NextFrame -> stringResource(R.string.translation_replay_shortcuts_nextFrame)
        ShortcutToast.Start -> stringResource(R.string.translation_replay_shortcuts_start)
        ShortcutToast.End -> stringResource(R.string.translation_replay_shortcuts_end)
        ShortcutToast.Faster -> stringResource(R.string.translation_replay_shortcuts_speedUp)
        ShortcutToast.Slower -> stringResource(R.string.translation_replay_shortcuts_speedDown)
        is ShortcutToast.Skip -> if (toast.deltaSeconds < 0) "⏪ −${-toast.deltaSeconds}s" else "⏩ +${toast.deltaSeconds}s"
        is ShortcutToast.Percent -> "${toast.percent}%"
    }

@Composable
private fun markerColor(kind: ReplayMarkerKind): Color =
    when (kind) {
        ReplayMarkerKind.Start, ReplayMarkerKind.ChargeStart -> TeslaTokens.status.success
        ReplayMarkerKind.Stop, ReplayMarkerKind.LowSoc -> TeslaTokens.status.danger
        ReplayMarkerKind.ChargeStop, ReplayMarkerKind.FastSegment -> TeslaTokens.status.warning
        ReplayMarkerKind.RegenPeak -> TeslaTokens.status.info
        ReplayMarkerKind.Event -> MaterialTheme.colorScheme.onSurfaceVariant
    }

// ------------------------------------------------------------------
// Keyboard mapping (web enableKeyboardShortcuts)
// ------------------------------------------------------------------

private val shortcutKeys: Map<Key, ShortcutKey> =
    mapOf(
        Key.Spacebar to ShortcutKey.Space,
        Key.K to ShortcutKey.K,
        Key.DirectionLeft to ShortcutKey.ArrowLeft,
        Key.DirectionRight to ShortcutKey.ArrowRight,
        Key.J to ShortcutKey.J,
        Key.L to ShortcutKey.L,
        Key.Comma to ShortcutKey.Comma,
        Key.Period to ShortcutKey.Period,
        Key.MoveHome to ShortcutKey.Home,
        Key.MoveEnd to ShortcutKey.End,
        Key.Plus to ShortcutKey.Plus,
        Key.Equals to ShortcutKey.Plus,
        Key.Minus to ShortcutKey.Minus,
    )

private val digitKeys: Map<Key, Int> =
    mapOf(
        Key.Zero to 0,
        Key.One to 1,
        Key.Two to 2,
        Key.Three to 3,
        Key.Four to 4,
        Key.Five to 5,
        Key.Six to 6,
        Key.Seven to 7,
        Key.Eight to 8,
        Key.Nine to 9,
    )

/** Maps a Compose [Key] onto the framework-free [ShortcutKey] vocabulary, or null when unbound. */
private fun keyToShortcutKey(key: Key): ShortcutKey? = shortcutKeys[key] ?: digitKeys[key]?.let { ShortcutKey.Digit(it) }

/**
 * Translates a key-down [KeyEvent] into a [ShortcutAction] and dispatches it (web `keydown` handler).
 * Returns whether the event was consumed so unrelated keys keep bubbling.
 */
private fun handleShortcutKey(
    event: KeyEvent,
    wasPlaying: Boolean,
    onShortcut: (ShortcutAction) -> Unit,
): Boolean {
    if (event.type != KeyEventType.KeyDown) return false
    val action =
        keyToShortcutKey(event.key)?.let { key ->
            PlaybackControlsProjection.actionForKey(key, event.isShiftPressed, wasPlaying)
        }
    action?.let(onShortcut)
    return action != null
}

// ------------------------------------------------------------------
// Authored glyphs (the data-display layer has no transport icons)
// ------------------------------------------------------------------

private fun transportGlyph(
    name: String,
    block: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(fill = SolidColor(Color.Black), pathBuilder = block)
        }.build()

/** A filled play triangle (web lucide `Play`). */
private val PlayGlyph: ImageVector =
    transportGlyph("PlaybackPlay") {
        moveTo(8f, 5f)
        lineTo(19f, 12f)
        lineTo(8f, 19f)
        close()
    }

/** Two filled pause bars (web lucide `Pause`). */
private val PauseGlyph: ImageVector =
    transportGlyph("PlaybackPause") {
        moveTo(6f, 5f)
        horizontalLineToRelative(4f)
        verticalLineToRelative(14f)
        horizontalLineToRelative(-4f)
        close()
        moveTo(14f, 5f)
        horizontalLineToRelative(4f)
        verticalLineToRelative(14f)
        horizontalLineToRelative(-4f)
        close()
    }

/** A filled square (web lucide `Square`). */
private val StopGlyph: ImageVector =
    transportGlyph("PlaybackStop") {
        moveTo(6f, 6f)
        horizontalLineToRelative(12f)
        verticalLineToRelative(12f)
        horizontalLineToRelative(-12f)
        close()
    }

/** A bar + left-pointing triangle — rewind-to-start (web lucide `SkipBack`). */
private val ResetGlyph: ImageVector =
    transportGlyph("PlaybackReset") {
        moveTo(6f, 5f)
        horizontalLineToRelative(2.5f)
        verticalLineToRelative(14f)
        horizontalLineToRelative(-2.5f)
        close()
        moveTo(20f, 5f)
        lineTo(9.5f, 12f)
        lineTo(20f, 19f)
        close()
    }

private const val LOADING_HEADER_FRACTION: Float = 0.55f
private val LOADING_BAR_HEIGHT: Dp = 16.dp

// ------------------------------------------------------------------
// Previews — one per rendered state.
// ------------------------------------------------------------------

private fun sampleTimeline(): ReplayTimeline = ReplayTimeline((0..60).map { it * 1_000L })

private fun contentState(
    isPlaying: Boolean,
    elapsedMs: Long,
    stale: Boolean = false,
): PlaybackControlsState {
    val timeline = sampleTimeline()
    return PlaybackControlsState(
        phase = PlaybackPhase.Content,
        timeline = timeline,
        clock = ReplayClockState(isPlaying = isPlaying, speed = if (isPlaying) 10 else 1, elapsedMs = elapsedMs),
        markers = timeline.defaultMarkers(),
        stale = stale,
        errorKind = if (stale) ErrorKind.Network else null,
        shortcutsEnabled = true,
    )
}

@Preview(name = "Playback · content idle", showBackground = true)
@Composable
private fun PlaybackContentIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PlaybackControlsContent(state = contentState(isPlaying = false, elapsedMs = 12_000L), strings = rememberPlaybackControlsStrings())
    }
}

@Preview(name = "Playback · playing", showBackground = true)
@Composable
private fun PlaybackPlayingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PlaybackControlsContent(
            state = contentState(isPlaying = true, elapsedMs = 33_000L).copy(toast = ShortcutToast.Skip(10)),
            strings = rememberPlaybackControlsStrings(),
        )
    }
}

@Preview(name = "Playback · help open", showBackground = true)
@Composable
private fun PlaybackHelpPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PlaybackControlsContent(
            state = contentState(isPlaying = false, elapsedMs = 0L).copy(helpVisible = true),
            strings = rememberPlaybackControlsStrings(),
        )
    }
}

@Preview(name = "Playback · offline (stale)", showBackground = true)
@Composable
private fun PlaybackOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PlaybackControlsContent(
            state = contentState(isPlaying = false, elapsedMs = 5_000L, stale = true),
            strings = rememberPlaybackControlsStrings(),
        )
    }
}

@Preview(name = "Playback · empty", showBackground = true)
@Composable
private fun PlaybackEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PlaybackControlsContent(
            state = PlaybackControlsState(phase = PlaybackPhase.Empty, shortcutsEnabled = true),
            strings = rememberPlaybackControlsStrings(),
        )
    }
}

@Preview(name = "Playback · loading", showBackground = true)
@Composable
private fun PlaybackLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PlaybackControlsContent(state = PlaybackControlsState.loading(shortcutsEnabled = true), strings = rememberPlaybackControlsStrings())
    }
}

@Preview(name = "Playback · error", showBackground = true)
@Composable
private fun PlaybackErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PlaybackControlsContent(
            state =
                PlaybackControlsState(
                    phase = PlaybackPhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = 503,
                    shortcutsEnabled = true,
                ),
            strings = rememberPlaybackControlsStrings(),
        )
    }
}
