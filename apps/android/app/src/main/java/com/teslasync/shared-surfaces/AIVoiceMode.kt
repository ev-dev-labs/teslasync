// The native Jetpack Compose + Material 3 AIVoiceMode shared surface — a parity port of
// web/src/components/ai/AIVoiceMode.tsx. The web surface is the optional voice front-end for the chatbot: a
// SpeechRecognition transcript box with mic start/stop, a text-to-speech mute/unmute toggle, a stop-all control
// while a reply streams, and the shared AIFeatureCard scaffold whose "Speak to Helix" action POSTs the transcript
// to /ai/voice/chat and reads the streamed reply aloud. The whole panel is wrapped by withAiFeature('voice-mode',
// …), which renders nothing when the AI feature is gated off.
//
// This file is a thin render layer: it binds the [AIVoiceModeViewModel] (P1/S8 — no HTTP, no speech API in the
// view), resolves every visible string through the generated i18n catalog (P1/S10 — the `R.string.translation_*`
// references are the compile-time proof the keys exist), lays the surface out with platform tokens (P1/S9 — no
// ported Tailwind), and reuses the native AIFeatureCard scaffold (the native counterpart of the web
// `@/components/ai/AIFeatureCard`), which already renders every mandated output state — loading (Helix thinking),
// empty (idle card + hint), content (streamed reply), error (inline retry), stale (refreshing chip), and offline
// (cached reply + offline chip). The voice-specific input slot (transcript region + mic/TTS/stop controls) is
// composed here over the shared atoms; the lucide mic/volume/stop glyphs, absent from the shared TeslaGlyphs
// catalog, are authored locally as stroked vectors, exactly as the sibling AIFeatureCard authors its Helix mark.
//
// All pure derivation (the input-slot projection, the hint selection, the TTS chunking, the transcript
// accumulation, the a11y announcement, the i18n key inventory) lives in AIVoiceModeModel.kt and is unit-tested
// off-device, so this file only paints.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivoicemode

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.aifeaturecard.AIFeatureCard
import io.teslasync.android.sharedsurfaces.aifeaturecard.AiFeatureStream
import io.teslasync.android.sharedsurfaces.aifeaturecard.AiStreamPhase
import io.teslasync.android.sharedsurfaces.aifeaturecard.ButtonPlacement
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `border-cyan-400/20` transcript-box border tint, applied to the brand info accent. */
private const val TRANSCRIPT_BORDER_ALPHA: Float = 0.20f

/** Web `bg-cyan-500/5` transcript-box fill tint, applied to the brand info accent. */
private const val TRANSCRIPT_BG_ALPHA: Float = 0.05f

private val HAIRLINE: Dp = 1.dp

/** Web `min-h-[3.5rem]` on the transcript box. */
private val TRANSCRIPT_MIN_HEIGHT: Dp = 56.dp

/** The locally-authored glyph stroke width, matching the shared mark convention. */
private const val GLYPH_STROKE: Float = 1.75f

// ── Stateful host (binds the ViewModel — P1/S8) ──────────────────────────────────────────────────────────────

/**
 * Stateful entry point — the faithful port of the web `AIVoiceMode` surface. Binds the AI gate + connectivity +
 * voice-chat stream and the speech engines into an [AIVoiceModeViewModel], records the one-shot `view.opened`
 * diagnostic, tracks the device language for recognition + speech, collects the live state, and renders the card —
 * or nothing when the AI feature is gated off (web `withAiFeature` → `null`). The surface performs no HTTP and
 * touches no speech API directly; [logger] defaults to the process logger and [instanceKey] scopes the ViewModel
 * per placement.
 *
 * @param source the AI-gate + connectivity + chat-stream seam (host-wired to the shared AI layer).
 * @param recognizer the microphone-to-text engine (host-wired to android.speech.SpeechRecognizer).
 * @param synthesizer the text-to-speech engine (host-wired to android.speech.tts.TextToSpeech).
 */
@Composable
fun AIVoiceMode(
    source: AIVoiceModeSource,
    recognizer: VoiceRecognizer,
    synthesizer: VoiceSynthesizer,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AI_VOICE_MODE_SLUG,
) {
    val languageTag = currentLanguageTag()
    val viewModel: AIVoiceModeViewModel =
        viewModel(
            key = instanceKey,
            factory = AIVoiceModeViewModel.factory(source, recognizer, synthesizer, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(languageTag) { viewModel.setLanguage(languageTag) }

    val state by viewModel.state.collectAsStateWithLifecycle()
    if (!state.gated) return

    AIVoiceModeContent(
        state = state,
        onStartListening = viewModel::startListening,
        onStopListening = viewModel::stopListening,
        onToggleTts = viewModel::toggleTts,
        onSend = viewModel::send,
        onStopAll = viewModel::stopAll,
        modifier = modifier,
    )
}

/** The current device language as a BCP-47 tag (web `i18n.language || 'en-US'`); falls back to `en-US`. */
@Composable
private fun currentLanguageTag(): String {
    val locale = LocalConfiguration.current.locales.get(0)
    return locale?.toLanguageTag() ?: "en-US"
}

// ── Stateless renderer (preview / UI-test entry point) ───────────────────────────────────────────────────────

/**
 * Stateless renderer of the surface — the preview entry point. Reproduces the web AIVoiceMode layout: the shared
 * AIFeatureCard scaffold (title + Helix badge + description + the "Speak to Helix" action + the streamed-output
 * panel) wrapping the voice input slot (transcript region + mic/TTS/stop controls). The card is always present
 * when the gate is on; the output region switches per stream state inside the reused AIFeatureCard.
 */
@Composable
fun AIVoiceModeContent(
    state: VoiceModeState,
    onStartListening: () -> Unit,
    onStopListening: () -> Unit,
    onToggleTts: () -> Unit,
    onSend: () -> Unit,
    onStopAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val emptyHint = if (state.inputView.hasTranscript) null else stringResource(R.string.translation_voiceMode_emptyHint)
    AIFeatureCard(
        title = stringResource(R.string.translation_voiceMode_title),
        description = stringResource(R.string.translation_voiceMode_description),
        buttonLabel = stringResource(R.string.translation_voiceMode_button),
        stream = state.stream,
        canStart = state.canStart,
        onAction = onSend,
        modifier = modifier,
        emptyHint = emptyHint,
        online = state.online,
        buttonPlacement = ButtonPlacement.Below,
        inputSlot = {
            VoiceInputSlot(
                view = state.inputView,
                onStartListening = onStartListening,
                onStopListening = onStopListening,
                onToggleTts = onToggleTts,
                onStopAll = onStopAll,
            )
        },
    )
}

// ── Voice input slot (web inputSlot: transcript region + controls) ───────────────────────────────────────────

/**
 * The voice input slot — the native port of the web `inputSlot`: a polite live-region transcript box (showing the
 * transcript or the idle/listening hint), the mic start/stop control, the spoken-replies mute/unmute toggle, the
 * stop-all control while a reply streams, and the speech-to-text error + "not available" hints. Every interactive
 * control carries a TalkBack content description that conveys its purpose + state (web `aria-label`).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VoiceInputSlot(
    view: VoiceInputView,
    onStartListening: () -> Unit,
    onStopListening: () -> Unit,
    onToggleTts: () -> Unit,
    onStopAll: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        TranscriptRegion(view)
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            MicControl(view, onStartListening, onStopListening)
            TtsControl(view, onToggleTts)
            if (view.showStop) StopControl(onStopAll)
        }
        view.error?.let { ErrorText(voiceErrorText(it)) }
        if (view.showUnsupportedHint) {
            HelperText(stringResource(R.string.translation_voiceMode_unsupportedHint))
        }
    }
}

/**
 * The transcript box — a bordered, info-tinted, polite live region (web `aria-live="polite"` +
 * `aria-label="Voice transcript"`) showing the dictated transcript, or the idle/listening hint when empty. Its
 * merged content description announces the label + current content as one utterance.
 */
@Composable
private fun TranscriptRegion(view: VoiceInputView) {
    val label = stringResource(R.string.translation_voiceMode_transcriptLabel)
    val hint = transcriptHintText(transcriptHintFor(view))
    val body = if (view.hasTranscript) view.transcript else hint
    val accent = TeslaTokens.status.info
    Surface(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = TRANSCRIPT_MIN_HEIGHT)
                .semantics(mergeDescendants = true) {
                    contentDescription = transcriptAnnouncement(label, body)
                    liveRegion = LiveRegionMode.Polite
                },
        shape = RoundedCornerShape(Radius.md),
        color = accent.copy(alpha = TRANSCRIPT_BG_ALPHA),
        contentColor = accent,
        border = BorderStroke(HAIRLINE, accent.copy(alpha = TRANSCRIPT_BORDER_ALPHA)),
    ) {
        Column(modifier = Modifier.padding(Spacing.md)) {
            if (view.hasTranscript) BodyText(view.transcript) else HelperText(hint)
        }
    }
}

/** The mic control — "Speak" (start) or "Stop mic" (stop) — web's listening-conditional mic button. */
@Composable
private fun MicControl(
    view: VoiceInputView,
    onStartListening: () -> Unit,
    onStopListening: () -> Unit,
) {
    if (view.listening) {
        val accessibleName = stopListeningName()
        Button(
            label = stringResource(R.string.translation_voiceMode_actions_stopListeningShort),
            onClick = onStopListening,
            modifier = Modifier.semantics { contentDescription = accessibleName },
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            leadingIcon = AIVoiceModeGlyphs.MicOff,
        )
    } else {
        val accessibleName = startListeningName()
        Button(
            label = stringResource(R.string.translation_voiceMode_actions_startListeningShort),
            onClick = onStartListening,
            modifier = Modifier.semantics { contentDescription = accessibleName },
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            enabled = view.micEnabled,
            leadingIcon = AIVoiceModeGlyphs.Mic,
        )
    }
}

/** The spoken-replies toggle — "Mute Helix" / "Unmute Helix" with the matching speaker glyph (web `toggleTts`). */
@Composable
private fun TtsControl(
    view: VoiceInputView,
    onToggleTts: () -> Unit,
) {
    val accessibleName = ttsToggleName(view.ttsEnabled)
    Button(
        label =
            if (view.ttsEnabled) {
                stringResource(R.string.translation_voiceMode_actions_muteTtsShort)
            } else {
                stringResource(R.string.translation_voiceMode_actions_unmuteTtsShort)
            },
        onClick = onToggleTts,
        modifier = Modifier.semantics { contentDescription = accessibleName },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = if (view.ttsEnabled) AIVoiceModeGlyphs.Volume else AIVoiceModeGlyphs.VolumeOff,
    )
}

/** The stop-all control — "Stop" — shown only while a reply streams (web `{isBusy && …}`). */
@Composable
private fun StopControl(onStopAll: () -> Unit) {
    val accessibleName = stopAllName()
    Button(
        label = stringResource(R.string.translation_voiceMode_actions_stopAllShort),
        onClick = onStopAll,
        modifier = Modifier.semantics { contentDescription = accessibleName },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = AIVoiceModeGlyphs.Square,
    )
}

// ── Localized helpers (kept @Composable so they resolve through the catalog at the render edge) ──────────────

/** The localized transcript hint for [hint], or empty when the transcript itself is shown. */
@Composable
private fun transcriptHintText(hint: TranscriptHint): String =
    when (hint) {
        TranscriptHint.Idle -> stringResource(R.string.translation_voiceMode_idleHint)
        TranscriptHint.Listening -> stringResource(R.string.translation_voiceMode_listeningHint)
        TranscriptHint.None -> ""
    }

/** The localized speech-to-text error message — the "unsupported" copy or the "failed: {{reason}}" interpolation. */
@Composable
private fun voiceErrorText(error: VoiceInputError): String =
    when (error) {
        VoiceInputError.Unsupported -> stringResource(R.string.translation_voiceMode_errors_unsupported)
        is VoiceInputError.Failed -> stringResource(R.string.translation_voiceMode_errors_sttFailed, error.reason)
    }

@Composable
private fun startListeningName(): String = stringResource(R.string.translation_voiceMode_actions_startListening)

@Composable
private fun stopListeningName(): String = stringResource(R.string.translation_voiceMode_actions_stopListening)

@Composable
private fun stopAllName(): String = stringResource(R.string.translation_voiceMode_actions_stopAll)

@Composable
private fun ttsToggleName(ttsEnabled: Boolean): String =
    if (ttsEnabled) {
        stringResource(R.string.translation_voiceMode_actions_muteTts)
    } else {
        stringResource(R.string.translation_voiceMode_actions_unmuteTts)
    }

// ── Locally-authored control glyphs (lucide mic / volume / square, absent from TeslaGlyphs) ──────────────────

/**
 * The lucide mic / mic-off / volume / volume-off / square marks, absent from the shared
 * [io.teslasync.android.components.ui.TeslaGlyphs] catalog, drawn as 24×24 stroked [ImageVector]s recolored at
 * render time by the [io.teslasync.android.components.ui.Icon] tint — exactly as the sibling AIFeatureCard authors
 * its Helix mark. The geometry reproduces each lucide icon's silhouette (the capsule + cradle + stand mic, the
 * speaker trapezoid with sound waves / mute cross, and the stop square).
 */
private object AIVoiceModeGlyphs {
    val Mic: ImageVector =
        stroked("AIVoiceModeMic") {
            micCapsule()
            micCradle()
        }

    val MicOff: ImageVector =
        stroked("AIVoiceModeMicOff") {
            micCapsule()
            micCradle()
            // The "muted" diagonal slash across the mic (web mic-off).
            moveTo(3f, 3f)
            lineTo(21f, 21f)
        }

    val Volume: ImageVector =
        stroked("AIVoiceModeVolume") {
            speaker()
            // Two sound waves to the right of the speaker (web volume-2).
            moveTo(16f, 9f)
            quadTo(18f, 12f, 16f, 15f)
            moveTo(18.5f, 7f)
            quadTo(22f, 12f, 18.5f, 17f)
        }

    val VolumeOff: ImageVector =
        stroked("AIVoiceModeVolumeOff") {
            speaker()
            // The mute cross to the right of the speaker (web volume-x).
            moveTo(16f, 9.5f)
            lineTo(21f, 14.5f)
            moveTo(21f, 9.5f)
            lineTo(16f, 14.5f)
        }

    val Square: ImageVector =
        stroked("AIVoiceModeSquare") {
            // A rounded stop square (web square).
            moveTo(7f, 5f)
            lineTo(17f, 5f)
            quadTo(19f, 5f, 19f, 7f)
            lineTo(19f, 17f)
            quadTo(19f, 19f, 17f, 19f)
            lineTo(7f, 19f)
            quadTo(5f, 19f, 5f, 17f)
            lineTo(5f, 7f)
            quadTo(5f, 5f, 7f, 5f)
            close()
        }

    /** The mic body — a vertical capsule centred on x=12 (web mic body rounded-rect). */
    private fun PathBuilder.micCapsule() {
        moveTo(9f, 6f)
        quadTo(9f, 3f, 12f, 3f)
        quadTo(15f, 3f, 15f, 6f)
        lineTo(15f, 10f)
        quadTo(15f, 13f, 12f, 13f)
        quadTo(9f, 13f, 9f, 10f)
        close()
    }

    /** The mic cradle + stand + base (web mic arc + stand + foot). */
    private fun PathBuilder.micCradle() {
        moveTo(5f, 10f)
        quadTo(5f, 17f, 12f, 17f)
        quadTo(19f, 17f, 19f, 10f)
        moveTo(12f, 17f)
        lineTo(12f, 21f)
        moveTo(8f, 21f)
        lineTo(16f, 21f)
    }

    /** The speaker trapezoid (web volume speaker body). */
    private fun PathBuilder.speaker() {
        moveTo(4f, 9.5f)
        lineTo(8f, 9.5f)
        lineTo(12f, 5f)
        lineTo(12f, 19f)
        lineTo(8f, 14.5f)
        lineTo(4f, 14.5f)
        close()
    }

    private fun stroked(
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
                    strokeLineWidth = GLYPH_STROKE,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (sample state per render branch; tooling-only) ──────────────────────────────────────────────────

private const val SAMPLE_TRANSCRIPT = "How efficient was my last drive?"
private const val SAMPLE_REPLY =
    "Your last drive averaged 248 Wh/mi — about 8% better than your 30-day mean. No charging or thermal anomalies."

@Composable
private fun PreviewSurface(state: VoiceModeState) {
    TeslaSyncTheme(dynamicColor = false) {
        AIVoiceModeContent(
            state = state,
            onStartListening = {},
            onStopListening = {},
            onToggleTts = {},
            onSend = {},
            onStopAll = {},
        )
    }
}

@Preview(name = "Empty — idle/ready", showBackground = true)
@Composable
private fun AIVoiceModeEmptyPreview() {
    PreviewSurface(VoiceModeState())
}

@Preview(name = "Listening — live capture", showBackground = true)
@Composable
private fun AIVoiceModeListeningPreview() {
    PreviewSurface(VoiceModeState(listening = true, interim = "How efficient was"))
}

@Preview(name = "Loading — Helix thinking", showBackground = true)
@Composable
private fun AIVoiceModeThinkingPreview() {
    PreviewSurface(
        VoiceModeState(committedTranscript = SAMPLE_TRANSCRIPT, stream = AiFeatureStream(phase = AiStreamPhase.Streaming)),
    )
}

@Preview(name = "Content — streamed reply", showBackground = true)
@Composable
private fun AIVoiceModeContentPreview() {
    PreviewSurface(
        VoiceModeState(stream = AiFeatureStream(phase = AiStreamPhase.Done, text = SAMPLE_REPLY)),
    )
}

@Preview(name = "Error — stream failed", showBackground = true)
@Composable
private fun AIVoiceModeErrorPreview() {
    PreviewSurface(
        VoiceModeState(
            committedTranscript = SAMPLE_TRANSCRIPT,
            stream = AiFeatureStream(phase = AiStreamPhase.Error, error = "stream_http_503"),
        ),
    )
}

@Preview(name = "Offline — cached + chip", showBackground = true)
@Composable
private fun AIVoiceModeOfflinePreview() {
    PreviewSurface(
        VoiceModeState(online = false, stream = AiFeatureStream(phase = AiStreamPhase.Done, text = SAMPLE_REPLY)),
    )
}

@Preview(name = "Unsupported — no recognizer", showBackground = true)
@Composable
private fun AIVoiceModeUnsupportedPreview() {
    PreviewSurface(VoiceModeState(sttSupported = false))
}
