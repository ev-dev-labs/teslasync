// The native Jetpack Compose + Material 3 AchievementUnlockedToast shared surface — a parity port of
// web/src/components/feedback/AchievementUnlockedToast.tsx (and its AchievementUnlockedToastStack). The web
// source is a celebratory, role="status" toast stack fed by the realtime `useAchievementUnlocks` queue: each
// toast pairs an AchievementBadge with an "Achievement Unlocked" eyebrow, the name, the description, a
// "View →" deep link, and a dismiss control, plus a confetti burst (suppressed under reduced motion) and a
// per-toast auto-dismiss.
//
// This surface is the native equivalent. All data flows through the shared [AchievementUnlockedToastViewModel]
// over the [AchievementUnlockedToastSource] seam (P1/S8) — the view performs NO HTTP and opens no stream
// directly. Every derivation flows through the pure [AchievementUnlockedToastProjection]; the composable is a
// thin render layer. The faithful mapping of the web behaviour:
//   • `useAchievementUnlocks()` (the queue) → the injected [source], folded by the ViewModel into the toast
//     stack (never HTTP from the view);
//   • each toast's `<AchievementBadge size="md" />` → the native [AchievementBadgeContent];
//   • the `t('achievements.toastEyebrow' | 'view' | 'dismiss')` strings → the generated i18n catalog (P1/S10);
//   • the `handleView` deep link (`navigate('/lifetime?achievement=…')`) → the host-routed [onOpenAchievement]
//     callback (the `useNavigate` seam);
//   • the confetti burst + spring entry → a one-shot native burst/entry, both suppressed under reduced motion
//     (web `useMotionPreference().reduce`, native `rememberReducedMotion`);
//   • the `role="status"` / `aria-live="polite"` toast → a merged polite live region carrying the toast text.
//
// States reproduced (every one renders a non-blank surface): the toast stack (content), the connected-but-
// silent stale chip + auto-refresh, the degraded-wire offline chip over cached toasts, the "listening"
// loading skeleton, the friendly empty state, and the reconnect/retry error surface. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AchievementUnlockedToast) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlockedtoast

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.achievementbadge.AchievementBadgeContent
import io.teslasync.android.featureviews.achievementbadge.AchievementBadgeSize
import io.teslasync.android.featureviews.achievementbadge.AchievementData
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.random.Random

/** Test tag identifying one rendered toast card — used by the instrumented per-state + a11y UI tests. */
const val ACHIEVEMENT_TOAST_TEST_TAG: String = "achievement-unlocked-toast"

/** Test tag identifying the surface container in every state — so each state asserts a non-blank surface. */
const val ACHIEVEMENT_TOAST_SURFACE_TEST_TAG: String = "achievement-unlocked-toast-surface"

private val TOAST_MAX_WIDTH = 360.dp
private const val BORDER_ALPHA = 0.40f
private const val CONTAINER_ALPHA = 0.06f
private val EYEBROW_ICON: Dp = 14.dp
private const val DESCRIPTION_MAX_LINES = 2
private const val VIEW_ARROW = " \u2192"

// ── Confetti (web buildConfettiParticles: 24 emoji, ~2.5s, randomised velocities) ───────────────────────
private const val CONFETTI_COUNT = 24
private const val CONFETTI_DURATION_MS = 2_500
private const val CONFETTI_SPREAD_X = 280f
private const val CONFETTI_RISE = 160f
private const val CONFETTI_RISE_MIN = 60f
private const val CONFETTI_ROTATE = 720f
private const val CONFETTI_MAX_DELAY = 0.25f
private const val CONFETTI_SEED = 0x7E51A
private val CONFETTI_GLYPH_SIZE: TextUnit = 16.sp
private const val CONFETTI_FALLBACK = "\uD83C\uDF89"

// ── Entry (web spring: y 20→0, scale .95→1; reduced motion → fade only) ─────────────────────────────────
private const val ENTRY_DURATION_MS = 450
private const val ENTRY_SCALE_FROM = 0.95f
private val ENTRY_SLIDE_FROM: Dp = 12.dp

/**
 * Stateful entry point bound to the shared unlock queue + live wire — the faithful port of the web
 * `AchievementUnlockedToastStack` reading `useAchievementUnlocks`. Binds the
 * [AchievementUnlockedToastViewModel], records the one-shot `view.opened` diagnostic (P1/S11), collects the
 * folded toast-stack state, auto-refreshes while the wire is stale, and renders the stateless surface.
 *
 * @param source the unlock-queue + wire-health seam; a host builds it from the shared `AchievementUnlocksStore`
 *   + `LiveSessionStore` (`achievementUnlockedToastSource(unlocks, live)`).
 * @param modifier optional layout modifier for the surface container.
 * @param onOpenAchievement invoked with an achievement id when its "View" is tapped; the host routes it to the
 *   Lifetime Stats deep link (web `navigate('/lifetime?achievement=…')`). Defaults to a no-op so the surface is
 *   safe to host before nav is wired.
 * @param durationMs the per-toast auto-dismiss lifetime (web `durationMs`, default 6s).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun AchievementUnlockedToast(
    source: AchievementUnlockedToastSource,
    modifier: Modifier = Modifier,
    onOpenAchievement: (String) -> Unit = {},
    durationMs: Long = AchievementUnlockedToastRegistration.DEFAULT_DURATION_MS,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: AchievementUnlockedToastViewModel =
        viewModel(
            key = AchievementUnlockedToastRegistration.ID,
            factory = AchievementUnlockedToastViewModel.factory(source, logger, durationMs),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val reducedMotion = rememberReducedMotion()

    // Stale wire while showing cached toasts → reconnect (web freshness auto-refresh).
    LaunchedEffect(state.stale) { if (state.stale) viewModel.retry() }

    AchievementUnlockedToastContent(
        state = state,
        reducedMotion = reducedMotion,
        onView = { id -> viewModel.view(id, onOpenAchievement) },
        onDismiss = viewModel::dismiss,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Dispatches on the
 * folded [AchievementToastFeed.phase]: the toast stack (content), the "listening" loading skeleton, the
 * friendly empty state, or the reconnect/retry error surface. [reducedMotion] gates the confetti + entry
 * animation exactly as the web `useMotionPreference().reduce` does.
 */
@Composable
fun AchievementUnlockedToastContent(
    state: AchievementToastFeed,
    reducedMotion: Boolean,
    onView: (String) -> Unit,
    onDismiss: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.testTag(ACHIEVEMENT_TOAST_SURFACE_TEST_TAG)) {
        when (state.phase) {
            AchievementToastPhase.Content ->
                AchievementToastStack(
                    state = state,
                    reducedMotion = reducedMotion,
                    onView = onView,
                    onDismiss = onDismiss,
                )
            AchievementToastPhase.Loading -> AchievementToastLoading()
            AchievementToastPhase.Empty -> AchievementToastEmptyState()
            AchievementToastPhase.Error -> AchievementToastErrorState(onRetry = onRetry)
        }
    }
}

/**
 * The populated stack — a vertical column of one [AchievementToastCard] per queued unlock (web stack
 * `events.map(...)`), preceded by a freshness chip only while the wire is degraded (stale/offline) so cached
 * toasts are honestly flagged "last known" rather than presented as live.
 */
@Composable
private fun AchievementToastStack(
    state: AchievementToastFeed,
    reducedMotion: Boolean,
    onView: (String) -> Unit,
    onDismiss: (String) -> Unit,
) {
    Column(
        modifier = Modifier.widthIn(max = TOAST_MAX_WIDTH),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (state.showFreshnessChip) {
            DataFreshness(
                updatedAtMillis = state.lastMessageAtMillis?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.offline,
                modifier = Modifier.padding(horizontal = Spacing.xs),
            )
        }
        state.toasts.forEach { toast ->
            AchievementToastCard(
                toast = toast,
                reducedMotion = reducedMotion,
                onView = { onView(toast.id) },
                onDismiss = { onDismiss(toast.id) },
            )
        }
    }
}

/**
 * One celebratory toast — the native mirror of a single web `<AchievementUnlockedToast>`: the
 * [AchievementBadgeContent] on the left, the "Achievement Unlocked" eyebrow + name + description + "View →"
 * deep link in the middle, and the dismiss control on the right, gold-accented and wrapped in a polite live
 * region. A confetti burst plays over the badge unless reduced motion is requested; the whole card fades/
 * scales in on first composition (a plain fade under reduced motion).
 */
@Composable
private fun AchievementToastCard(
    toast: AchievementToast,
    reducedMotion: Boolean,
    onView: () -> Unit,
    onDismiss: () -> Unit,
) {
    val accent = MaterialTheme.colorScheme.tertiary
    val entry = rememberEntryProgress(reducedMotion)

    Surface(
        modifier =
            Modifier
                .widthIn(max = TOAST_MAX_WIDTH)
                .testTag(ACHIEVEMENT_TOAST_TEST_TAG)
                .graphicsLayer {
                    alpha = entry
                    scaleX = entryScale(entry, reducedMotion)
                    scaleY = entryScale(entry, reducedMotion)
                    translationY = (1f - entry) * if (reducedMotion) 0f else ENTRY_SLIDE_FROM.toPx()
                }.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        shape = MaterialTheme.shapes.large,
        color = accent.copy(alpha = CONTAINER_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, accent.copy(alpha = BORDER_ALPHA)),
    ) {
        Box {
            Row(
                modifier = Modifier.padding(Spacing.md),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                AchievementBadgeContent(achievement = toast.achievement, size = AchievementBadgeSize.Md)
                ToastBody(toast = toast, accent = accent, onView = onView, modifier = Modifier.weight(1f))
                AchievementDismissButton(onDismiss = onDismiss)
            }
            if (!reducedMotion) {
                ConfettiOverlay(
                    icon = toast.achievement.icon,
                    modifier = Modifier.align(Alignment.CenterStart).padding(start = Spacing.xl3),
                )
            }
        }
    }
}

/** The eyebrow + name + description + "View →" column (web toast body). */
@Composable
private fun ToastBody(
    toast: AchievementToast,
    accent: Color,
    onView: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                AchievementToastGlyphs.Trophy,
                contentDescription = null,
                size = IconSize.Sm,
                tint = accent,
            )
            Text(
                text = stringResource(R.string.translation_achievements_toastEyebrow),
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                color = accent,
            )
        }
        Text(
            text = toast.achievement.name,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
        )
        BodyText(
            text = toast.achievement.description,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = DESCRIPTION_MAX_LINES,
        )
        Button(
            label = stringResource(R.string.translation_achievements_view) + VIEW_ARROW,
            onClick = onView,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/** The dismiss control — the web `<button aria-label="Dismiss achievement notification"><X/></button>`. */
@Composable
private fun AchievementDismissButton(onDismiss: () -> Unit) {
    IconButton(
        imageVector = TeslaGlyphs.Close,
        contentDescription = stringResource(R.string.translation_achievements_dismiss),
        onClick = onDismiss,
        variant = IconButtonVariant.Standard,
        size = IconSize.Sm,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/**
 * The confetti burst — the native mirror of the web emoji-confetti overlay: [CONFETTI_COUNT] copies of the
 * achievement glyph fly outward from the badge with randomised velocities over ~2.5s and fade out. The
 * particle set is seeded so previews/tests are deterministic; the burst is decorative (cleared from
 * accessibility) and only ever composed when reduced motion is off.
 */
@Composable
private fun ConfettiOverlay(
    icon: String,
    modifier: Modifier = Modifier,
) {
    val particles = remember { buildConfettiParticles() }
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        progress.animateTo(1f, tween(durationMillis = CONFETTI_DURATION_MS, easing = ConfettiEasing))
    }
    val glyph = icon.ifBlank { CONFETTI_FALLBACK }
    Box(modifier = modifier.clearAndSetSemantics {}) {
        particles.forEach { particle ->
            val local = ((progress.value - particle.delay) / (1f - particle.delay)).coerceIn(0f, 1f)
            Text(
                text = glyph,
                fontSize = CONFETTI_GLYPH_SIZE,
                modifier =
                    Modifier.graphicsLayer {
                        translationX = particle.vx * local
                        translationY = particle.vy * local
                        rotationZ = particle.rotate * local
                        alpha = 1f - local
                    },
            )
        }
    }
}

/** The "listening for achievements" loading surface — a non-blank shimmering toast skeleton (web parity). */
@Composable
private fun AchievementToastLoading() {
    GlassPanel(modifier = Modifier.widthIn(max = TOAST_MAX_WIDTH), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Skeleton(widthFraction = 0.5f, height = 12.dp)
            Skeleton(widthFraction = 0.8f, height = 16.dp)
            Skeleton(widthFraction = 1f, height = 12.dp)
        }
    }
}

/** The friendly empty state — the wire is live but no unlock has arrived this session (web `noneYet`). */
@Composable
private fun AchievementToastEmptyState() {
    GlassPanel(modifier = Modifier.widthIn(max = TOAST_MAX_WIDTH), padding = PanelPadding.Md) {
        EmptyState(
            message = stringResource(R.string.translation_achievements_noneYet),
            icon = AchievementToastGlyphs.Trophy,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The error surface — the wire is down with nothing cached; offers a reconnect/retry (web freshness retry). */
@Composable
private fun AchievementToastErrorState(onRetry: () -> Unit) {
    GlassPanel(modifier = Modifier.widthIn(max = TOAST_MAX_WIDTH), padding = PanelPadding.Md) {
        QueryError(kind = QueryErrorKind.Network, onRetry = onRetry, modifier = Modifier.fillMaxWidth())
    }
}

// ── Motion helpers ──────────────────────────────────────────────────────────────────────────────────────

private val ConfettiEasing = CubicBezierEasing(0.16f, 0.84f, 0.44f, 1f)

@Composable
private fun rememberEntryProgress(reducedMotion: Boolean): Float {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(reducedMotion) {
        progress.snapTo(0f)
        progress.animateTo(1f, tween(durationMillis = if (reducedMotion) 0 else ENTRY_DURATION_MS))
    }
    return progress.value
}

private fun entryScale(
    entry: Float,
    reducedMotion: Boolean,
): Float = if (reducedMotion) 1f else ENTRY_SCALE_FROM + (1f - ENTRY_SCALE_FROM) * entry

private class ConfettiParticle(
    val vx: Float,
    val vy: Float,
    val rotate: Float,
    val delay: Float,
)

private fun buildConfettiParticles(): List<ConfettiParticle> {
    val rng = Random(CONFETTI_SEED)
    return List(CONFETTI_COUNT) {
        ConfettiParticle(
            vx = (rng.nextFloat() - 0.5f) * CONFETTI_SPREAD_X,
            vy = -(rng.nextFloat() * CONFETTI_RISE + CONFETTI_RISE_MIN),
            rotate = (rng.nextFloat() - 0.5f) * CONFETTI_ROTATE,
            delay = rng.nextFloat() * CONFETTI_MAX_DELAY,
        )
    }
}

// ── Trophy glyph (the curated icon sets ship no trophy; authored here as the RecentlyUnlocked surface does) ─

private object AchievementToastGlyphs {
    val Trophy: ImageVector =
        glyph("Trophy") {
            moveTo(7f, 4f)
            lineTo(17f, 4f)
            lineTo(17f, 9f)
            curveTo(17f, 12.3f, 14.8f, 14f, 12f, 14f)
            curveTo(9.2f, 14f, 7f, 12.3f, 7f, 9f)
            close()
            moveTo(7f, 5f)
            lineTo(4.5f, 5f)
            curveTo(2.8f, 5f, 2.8f, 8.5f, 5f, 8.5f)
            lineTo(7f, 8.5f)
            moveTo(17f, 5f)
            lineTo(19.5f, 5f)
            curveTo(21.2f, 5f, 21.2f, 8.5f, 19f, 8.5f)
            lineTo(17f, 8.5f)
            moveTo(12f, 14f)
            lineTo(12f, 18f)
            moveTo(8.5f, 20f)
            lineTo(15.5f, 20f)
            moveTo(10f, 18f)
            lineTo(14f, 18f)
        }
}

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

private fun glyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = EYEBROW_ICON,
            defaultHeight = EYEBROW_ICON,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews (tooling-only; sample unlocks are never shipped UI) ────────────────────────────────────────

private val PREVIEW_TOAST =
    AchievementToast(
        id = "first-drive",
        achievement =
            AchievementData(
                id = "first-drive",
                name = "First Drive",
                description = "Complete your first recorded drive",
                icon = "\uD83C\uDFC1",
                unlocked = true,
                unlockedAt = "2026-01-01T00:00:00Z",
                progress = 1.0,
                target = 1.0,
                current = 1.0,
            ),
    )

private fun previewFeed(
    phase: AchievementToastPhase,
    toasts: List<AchievementToast> = emptyList(),
    stale: Boolean = false,
    offline: Boolean = false,
): AchievementToastFeed =
    AchievementToastFeed(
        phase = phase,
        toasts = toasts,
        connection = LiveConnectionStatus.Connected,
        stale = stale,
        offline = offline,
        refreshing = false,
        lastMessageAtMillis = 0L,
    )

@Composable
private fun previewSurface(state: AchievementToastFeed) {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            AchievementUnlockedToastContent(
                state = state,
                reducedMotion = true,
                onView = {},
                onDismiss = {},
                onRetry = {},
            )
        }
    }
}

@Preview(name = "Content — single unlock", showBackground = true)
@Composable
private fun AchievementToastContentPreview() {
    previewSurface(previewFeed(AchievementToastPhase.Content, toasts = listOf(PREVIEW_TOAST)))
}

@Preview(name = "Content — offline (cached)", showBackground = true)
@Composable
private fun AchievementToastOfflinePreview() {
    previewSurface(previewFeed(AchievementToastPhase.Content, toasts = listOf(PREVIEW_TOAST), offline = true))
}

@Preview(name = "Empty — none yet", showBackground = true)
@Composable
private fun AchievementToastEmptyPreview() {
    previewSurface(previewFeed(AchievementToastPhase.Empty))
}

@Preview(name = "Loading — listening", showBackground = true)
@Composable
private fun AchievementToastLoadingPreview() {
    previewSurface(previewFeed(AchievementToastPhase.Loading))
}

@Preview(name = "Error — reconnect", showBackground = true)
@Composable
private fun AchievementToastErrorPreview() {
    previewSurface(previewFeed(AchievementToastPhase.Error))
}
