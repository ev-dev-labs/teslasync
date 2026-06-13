// The native Jetpack Compose + Material 3 AchievementUnlockListener shared surface — a parity port of
// web/src/components/feedback/AchievementUnlockListener.tsx and the `AchievementUnlockedToastStack` it renders.
// The web surface mounts at the app root, subscribes to the realtime `achievement_unlocked` SSE stream, reads
// the celebration prefs, and pops one celebratory toast per unlock (a wide card: achievement badge + "Achievement
// Unlocked" eyebrow + name + description + View link + dismiss, with a confetti burst and an optional unlock
// chime). It renders nothing when toasts are disabled (but keeps draining the queue) or when nothing is pending.
//
// There is no native AchievementUnlockedToast atom (atomic feedback components are the out-of-scope P3
// component-library bundle), so the celebration card + stack are composed here from the shared atoms (Surface,
// Button, IconButton, typography, FadeIn) — the same approach the sibling AIDriveCoaching takes for its card. All
// data flows through the shared [AchievementUnlockListenerViewModel] (P1/S8); the view performs NO HTTP. Every
// visible string resolves through the i18n catalog (P1/S10) and the card carries a merged TalkBack description.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web surface's three observable branches
// (toasts disabled / nothing pending / one-or-more pending) are reproduced exactly via [classifyListener]; the
// two dormant branches render no overlay at all (an unlock listener is a fire-and-forget celebration layer, so a
// spinner/error/empty box at the app root would be a parity violation — see AchievementUnlockListenerModel.kt for
// the full loading/error/stale/offline mapping rationale). Motion honors reduced-motion ([rememberReducedMotion]):
// the confetti burst + slide-in are dropped to a plain fade. The opt-in chime is a procedural two-note triangle
// "ding" (E5 → B5) synthesized on the fly via [AudioTrack] (no audio asset — keeps the apk slim and works
// offline), the native analogue of the web WebAudio tone; it silently no-ops when audio is unavailable.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AchievementUnlockListener) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlocklistener

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.exp

/** Web toast `style={{ width: 'min(360px, calc(100vw - 2rem)) }}` — the celebration card's max width. */
private val TOAST_MAX_WIDTH: Dp = 360.dp

/** Web badge container size (`AchievementBadge size="md"` ring 72) — the emoji badge tile. */
private val BADGE_SIZE: Dp = 56.dp

/** Web `border-yellow-500/40` — the gold accent hairline around the card. */
private val TOAST_BORDER_WIDTH: Dp = 1.dp

/** Web `border-yellow-500/40` border alpha. */
private const val TOAST_BORDER_ALPHA: Float = 0.40f

/** Web `bg-white/[0.03]` translucent card fill, applied to the neutral surface. */
private const val TOAST_BG_ALPHA: Float = 0.96f

/** Web `AIBadge` low-alpha wash behind the gold badge tile. */
private const val BADGE_WASH_ALPHA: Float = 0.16f

/** Web `CONFETTI_COUNT = 24`, trimmed to keep app-root overdraw modest while staying a real burst. */
private const val CONFETTI_COUNT: Int = 14

/** Web `CONFETTI_DURATION_SEC = 2.5`. */
private const val CONFETTI_DURATION_MS: Int = 2_500

/**
 * Stateful entry point — the faithful port of the web `AchievementUnlockListener`. Binds the realtime unlock
 * stream + the live celebration prefs via [source] into an [AchievementUnlockListenerViewModel], records the
 * one-shot `view.opened` diagnostic, collects the live state + chime ticket, fires the opt-in chime when a new
 * unlock arrives, and renders the celebration stack. The surface performs no HTTP; [logger] defaults to the
 * process logger and [instanceKey] scopes the ViewModel per placement.
 *
 * @param onViewAchievement host hook for the toast's View affordance (web navigates to
 *   `/lifetime?achievement={id}`); the toast is always dismissed on View regardless. Defaults to a no-op so the
 *   surface is self-contained when no navigator is wired.
 */
@Composable
fun AchievementUnlockListener(
    source: AchievementUnlockListenerSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ACHIEVEMENT_UNLOCK_LISTENER_SLUG,
    onViewAchievement: (String) -> Unit = {},
) {
    val viewModel: AchievementUnlockListenerViewModel =
        viewModel(key = instanceKey, factory = AchievementUnlockListenerViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val chimeNonce by viewModel.chimeNonce.collectAsStateWithLifecycle()

    val chime = rememberAchievementChime()
    LaunchedEffect(chimeNonce) {
        if (chimeNonce > 0L) chime.play()
    }

    AchievementUnlockListenerContent(
        state = state,
        modifier = modifier,
        onDismiss = viewModel::dismiss,
        onView = onViewAchievement,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Classifies [state] into a [ListenerSurface] and
 * renders the celebration stack, or renders nothing when toasts are disabled or nothing is pending (web returns
 * `null` / an empty stack — a dormant overlay, never a blank box).
 */
@Composable
fun AchievementUnlockListenerContent(
    state: AchievementListenerState,
    modifier: Modifier = Modifier,
    onDismiss: (String) -> Unit = {},
    onView: (String) -> Unit = {},
) {
    when (val surface = classifyListener(state)) {
        ListenerSurface.Disabled, ListenerSurface.Idle -> Unit
        is ListenerSurface.Celebrating ->
            AchievementToastStack(
                toasts = surface.toasts,
                modifier = modifier,
                onDismiss = onDismiss,
                onView = onView,
            )
    }
}

/**
 * The web `AchievementUnlockedToastStack`: a top-end column of one celebration toast per pending unlock,
 * newest-first. The host overlays this at the app root (web `fixed top-4 right-4`); the column is wrap-content
 * and right-aligns its cards so it drops cleanly into an overlay [Box].
 */
@Composable
private fun AchievementToastStack(
    toasts: List<AchievementToast>,
    modifier: Modifier = Modifier,
    onDismiss: (String) -> Unit,
    onView: (String) -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(Spacing.lg),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        toasts.forEach { toast ->
            key(toast.achievementId) {
                AchievementUnlockedToast(
                    toast = toast,
                    onDismiss = { onDismiss(toast.achievementId) },
                    onView = {
                        onView(toast.achievementId)
                        onDismiss(toast.achievementId)
                    },
                )
            }
        }
    }
}

/**
 * One celebration toast — the web `AchievementUnlockedToast`. A gold-accented glass card: a confetti burst
 * emanating from the badge (reduced-motion aware), the emoji badge tile, the "Achievement Unlocked" eyebrow with
 * a trophy glyph, the name + description, a View affordance, and a dismiss button. The whole card is one polite
 * live region announcing the eyebrow + name + description (web `role="status" aria-live="polite"`), while the
 * View / dismiss controls stay as separate, individually-labeled focus targets.
 */
@Composable
private fun AchievementUnlockedToast(
    toast: AchievementToast,
    onDismiss: () -> Unit,
    onView: () -> Unit,
) {
    val eyebrow = stringResource(R.string.translation_achievements_toastEyebrow)
    val dismissLabel = stringResource(R.string.translation_achievements_dismiss)
    val viewLabel = stringResource(R.string.translation_achievements_view)
    val announcement = achievementToastLabel(eyebrow, toast.name, toast.description)
    val accent = TeslaTokens.status.warning

    FadeIn(modifier = Modifier.widthIn(max = TOAST_MAX_WIDTH)) {
        Surface(
            modifier =
                Modifier
                    .widthIn(max = TOAST_MAX_WIDTH)
                    .semantics(mergeDescendants = true) {
                        liveRegion = LiveRegionMode.Polite
                        contentDescription = announcement
                    },
            shape = RoundedCornerShape(Radius.lg),
            color = MaterialTheme.colorScheme.surface.copy(alpha = TOAST_BG_ALPHA),
            contentColor = MaterialTheme.colorScheme.onSurface,
            border = BorderStroke(TOAST_BORDER_WIDTH, accent.copy(alpha = TOAST_BORDER_ALPHA)),
        ) {
            Box {
                AchievementConfetti(
                    icon = toast.icon,
                    modifier = Modifier.align(Alignment.TopStart).padding(start = Spacing.xl, top = Spacing.xl),
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    AchievementBadgeTile(icon = toast.icon, accent = accent)
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                    ) {
                        AchievementEyebrow(label = eyebrow, accent = accent)
                        Text(
                            text = toast.name,
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        BodyText(
                            text = toast.description,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                        )
                        Button(
                            label = viewLabel,
                            onClick = onView,
                            variant = ButtonVariant.Ghost,
                            size = ButtonSize.Sm,
                            leadingIcon = TeslaGlyphs.ChevronRight,
                        )
                    }
                    IconButton(
                        TeslaGlyphs.Close,
                        contentDescription = dismissLabel,
                        onClick = onDismiss,
                        size = IconSize.Sm,
                    )
                }
            }
        }
    }
}

/** The gold-washed emoji badge tile (web `AchievementBadge` for an unlocked achievement — no progress ring). */
@Composable
private fun AchievementBadgeTile(
    icon: String,
    accent: Color,
) {
    Surface(
        modifier = Modifier.size(BADGE_SIZE),
        shape = RoundedCornerShape(Radius.md),
        color = accent.copy(alpha = BADGE_WASH_ALPHA),
        contentColor = accent,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(text = icon, style = MaterialTheme.typography.headlineSmall)
        }
    }
}

/** The web eyebrow: a small trophy glyph + the uppercase-style gold "Achievement Unlocked" label. */
@Composable
private fun AchievementEyebrow(
    label: String,
    accent: Color,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(AchievementGlyphs.Trophy, contentDescription = null, size = IconSize.Xs, tint = accent)
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            color = accent,
        )
    }
}

/**
 * The web confetti burst — [CONFETTI_COUNT] copies of the achievement glyph fired from the badge corner with
 * randomized velocity / rotation, fading as they fly (~[CONFETTI_DURATION_MS]). Renders nothing under reduced
 * motion ([rememberReducedMotion]) so users who opted out get a still card. Purely decorative — `null`
 * content-description keeps it out of the TalkBack tree.
 */
@Composable
private fun AchievementConfetti(
    icon: String,
    modifier: Modifier = Modifier,
) {
    if (rememberReducedMotion()) return
    val particles = remember(icon) { buildConfettiParticles(icon.hashCode()) }
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        progress.animateTo(1f, animationSpec = tween(CONFETTI_DURATION_MS, easing = LinearOutSlowInEasing))
    }
    Box(modifier = modifier) {
        particles.forEach { particle ->
            Text(
                text = icon,
                style = MaterialTheme.typography.labelMedium,
                modifier =
                    Modifier.graphicsLayer {
                        val raw = (progress.value - particle.delayFraction) / (1f - particle.delayFraction)
                        val t = raw.coerceIn(0f, 1f)
                        translationX = particle.dx.dp.toPx() * t
                        translationY = particle.dy.dp.toPx() * t
                        alpha = 1f - t
                        rotationZ = particle.rotation * t
                    },
            )
        }
    }
}

/** One confetti particle's final displacement (dp), spin (deg), and entrance delay (fraction of the burst). */
private data class ConfettiParticle(
    val dx: Float,
    val dy: Float,
    val rotation: Float,
    val delayFraction: Float,
)

/**
 * Builds the [CONFETTI_COUNT] particle set for one toast, seeded by the achievement so the burst is stable
 * across recompositions but varies per achievement (web uses `Math.random()`; a seeded PRNG keeps the spread
 * deterministic for snapshot/UI tests).
 */
private fun buildConfettiParticles(seed: Int): List<ConfettiParticle> {
    val random = kotlin.random.Random(seed)
    return List(CONFETTI_COUNT) {
        ConfettiParticle(
            dx = (random.nextFloat() - 0.5f) * 180f,
            dy = -(random.nextFloat() * 120f + 40f),
            rotation = (random.nextFloat() - 0.5f) * 540f,
            delayFraction = random.nextFloat() * 0.18f,
        )
    }
}

/**
 * A stable, composition-scoped procedural chime — the native analogue of the web component's WebAudio tone. Lazy
 * and side-effect-free until [play] is called (so no audio resource is allocated until the user opts into sound
 * and a new unlock arrives), then synthesizes + plays a two-note "ding" off the main thread, silently no-opping
 * when audio is unavailable (web parity for autoplay/locked-down failures).
 */
@Composable
private fun rememberAchievementChime(): AchievementChime {
    val scope = rememberCoroutineScope()
    return remember(scope) { AchievementChime(scope) }
}

private class AchievementChime(
    private val scope: CoroutineScope,
) {
    /** Fire the chime once; runs on a background dispatcher and swallows any audio failure (web no-op parity). */
    fun play() {
        scope.launch(Dispatchers.Default) {
            runCatching { renderChime() }
        }
    }
}

/** PCM sample rate for the synthesized chime. */
private const val CHIME_SAMPLE_RATE: Int = 44_100

/** Web `noteFreqs = [659.25, 987.77]` — the E5 → B5 perfect-fifth "ding". */
private val CHIME_NOTE_HZ: FloatArray = floatArrayOf(659.25f, 987.77f)

/** Per-note duration (web staggers the two notes ~0.12 s apart with a ~0.45 s tail). */
private const val CHIME_NOTE_SECONDS: Float = 0.18f

/** Web peak gain `exponentialRampToValueAtTime(0.18, …)`. */
private const val CHIME_GAIN: Float = 0.18f

/** Synthesizes the two-note triangle "ding" into a mono 16-bit PCM buffer (web's procedural WebAudio tone). */
private fun synthesizeChimeSamples(): ShortArray {
    val perNote = (CHIME_SAMPLE_RATE * CHIME_NOTE_SECONDS).toInt()
    val samples = ShortArray(perNote * CHIME_NOTE_HZ.size)
    var index = 0
    for (frequency in CHIME_NOTE_HZ) {
        for (n in 0 until perNote) {
            val time = n.toFloat() / CHIME_SAMPLE_RATE
            val phase = (time * frequency) % 1f
            val triangle = 4f * abs(phase - 0.5f) - 1f
            val envelope = exp(-5f * n.toFloat() / perNote)
            samples[index++] = (triangle * envelope * CHIME_GAIN * Short.MAX_VALUE).toInt().toShort()
        }
    }
    return samples
}

/** Builds, plays (blocking until drained), and releases a one-shot [AudioTrack] for the synthesized chime. */
private fun renderChime() {
    val samples = synthesizeChimeSamples()
    val track =
        AudioTrack
            .Builder()
            .setAudioAttributes(
                AudioAttributes
                    .Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            ).setAudioFormat(
                AudioFormat
                    .Builder()
                    .setSampleRate(CHIME_SAMPLE_RATE)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            ).setBufferSizeInBytes(samples.size * Short.SIZE_BYTES)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
    try {
        track.play()
        track.write(samples, 0, samples.size)
        track.stop()
    } finally {
        track.release()
    }
}

/** Co-located trophy glyph for the eyebrow (no bundled lucide `Trophy`); recolored at render by [Icon]'s tint. */
private object AchievementGlyphs {
    val Trophy: ImageVector =
        ImageVector
            .Builder(
                name = "Trophy",
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
                ) {
                    moveTo(7f, 4f)
                    lineTo(17f, 4f)
                    lineTo(17f, 8f)
                    curveTo(17f, 11f, 15f, 13f, 12f, 13f)
                    curveTo(9f, 13f, 7f, 11f, 7f, 8f)
                    close()
                    moveTo(7f, 5f)
                    curveTo(4.5f, 5f, 4.5f, 9f, 7.3f, 9.3f)
                    moveTo(17f, 5f)
                    curveTo(19.5f, 5f, 19.5f, 9f, 16.7f, 9.3f)
                    moveTo(12f, 13f)
                    lineTo(12f, 17f)
                    moveTo(9.5f, 20f)
                    lineTo(14.5f, 20f)
                    moveTo(10.5f, 17f)
                    lineTo(13.5f, 17f)
                }
            }.build()
}

// ── Previews (tooling-only; UnusedPrivateMember ignores @Preview) ──────────────────────────────────────────

private fun previewToast(
    id: String,
    icon: String,
    name: String,
    description: String,
): AchievementUnlock =
    AchievementUnlock(
        vehicleId = 1L,
        unlockedAt = "2026-01-01T00:00:00Z",
        achievement = Achievement(id = id, name = name, description = description, icon = icon),
    )

@Preview(name = "Celebrating — single", showBackground = true)
@Composable
private fun AchievementUnlockListenerSinglePreview() {
    TeslaSyncTheme {
        AchievementUnlockListenerContent(
            state =
                AchievementListenerState(
                    queue = listOf(previewToast("road_warrior", "🏆", "Road Warrior", "Drove 10,000 km total")),
                ),
        )
    }
}

@Preview(name = "Celebrating — stack", showBackground = true)
@Composable
private fun AchievementUnlockListenerStackPreview() {
    TeslaSyncTheme {
        AchievementUnlockListenerContent(
            state =
                AchievementListenerState(
                    queue =
                        listOf(
                            previewToast("night_owl", "🦉", "Night Owl", "Completed a drive after midnight"),
                            previewToast("road_warrior", "🏆", "Road Warrior", "Drove 10,000 km total"),
                        ),
                ),
        )
    }
}
