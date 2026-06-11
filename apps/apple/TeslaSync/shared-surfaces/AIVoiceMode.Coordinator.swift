//
//  AIVoiceMode.Coordinator.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  The card's observable view-model — the native coordinator for the Helix voice-mode panel. It
//  subscribes to a `VoiceModeSource` (availability gate + connectivity axis + `useAiStream`
//  snapshot), owns the local dictation state (web `useState`), drives the speech + transcript-draft
//  seams, recomputes the pure projection, emits `view.opened` once the gate is open, and
//  auto-refreshes once on the stale transition. No networking and no speech engine code live in the
//  view — only in the injected seams.
//

import Foundation
import Observation

// MARK: - Observable model (P1/S8 binding)

@MainActor
@Observable
public final class VoiceModeModel {
    public private(set) var resolved: VoiceModeResolved = VoiceModeProjection.resolve(
        input: VoiceModeInput(availability: .loading),
        ui: VoiceModeUIState(),
        locale: .current
    )
    public private(set) var connection: VoiceModeConnection = .live

    public var phase: VoiceModeResolved.Phase {
        resolved.phase
    }

    public var ready: VoiceModeReady? {
        resolved.ready
    }

    /// Web `withAiFeature` off → the whole surface is withdrawn. The view renders nothing.
    public var isGated: Bool {
        resolved.phase == .gated
    }

    @ObservationIgnored private let source: any VoiceModeSource
    @ObservationIgnored private let speech: any VoiceModeSpeechControlling
    @ObservationIgnored private let draftStore: any VoiceModeDraftStoring
    @ObservationIgnored private let telemetry: any VoiceModeTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let sessionID: String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var ui = VoiceModeUIState()
    @ObservationIgnored private var lastInput = VoiceModeInput(availability: .loading)
    @ObservationIgnored private var listenBase = ""
    @ObservationIgnored private var ttsFeed = VoiceModeTtsFeed()

    public init(
        source: any VoiceModeSource,
        speech: any VoiceModeSpeechControlling = SystemVoiceModeSpeechController(),
        draftStore: any VoiceModeDraftStoring = UserDefaultsVoiceModeDraftStore(),
        telemetry: any VoiceModeTelemetry = OSLogVoiceModeTelemetry(),
        locale: Locale = .current,
        sessionID: String = VoiceModeSession.newID()
    ) {
        self.source = source
        self.speech = speech
        self.draftStore = draftStore
        self.telemetry = telemetry
        self.locale = locale
        self.sessionID = sessionID
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: Lifecycle

    /// Begins observing the upstream feed. Idempotent. Reads the persisted transcript draft + the
    /// dictation-support flag before the first snapshot so the initial render is complete.
    public func start() {
        guard !started else { return }
        started = true
        ui.speechSupported = speech.isListeningSupported
        ui.transcript = draftStore.read()
        listenBase = ui.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        source.start()
        recompute()
    }

    /// Stops observing, tears down dictation + playback, cancels any in-flight stream, and clears the
    /// transcript draft (web unmount: abort STT, cancel stream, cancel speech, clear draft).
    public func stop() {
        started = false
        speech.abortListening()
        speech.cancelSpeech()
        source.cancel()
        source.stop()
        ui.listening = false
        ttsFeed = VoiceModeTtsFeed()
        draftStore.clear()
        recompute()
    }

    /// Re-requests the availability snapshot (header refresh button + gate-error retry).
    public func refresh() {
        source.refresh()
    }

    // MARK: Dictation (web SpeechRecognition)

    /// Toggles dictation — web flips between the "Speak" and "Stop mic" buttons.
    public func toggleListening() {
        if ui.listening {
            stopListening()
        } else {
            startListening()
        }
    }

    /// Begins an utterance. When dictation is unsupported it surfaces the unsupported error instead
    /// (web `startListening` early return).
    public func startListening() {
        guard ui.speechSupported else {
            ui.sttError = VoiceModeStrings.string(
                "voiceMode.errors.unsupported",
                "Voice input isn\u{2019}t available on this device."
            )
            recompute()
            return
        }
        ui.sttError = nil
        listenBase = ui.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        ui.listening = true
        speech.startListening(
            locale: locale,
            onResult: { [weak self] text in self?.handleSttResult(text) },
            onError: { [weak self] reason in self?.handleSttError(reason) },
            onEnd: { [weak self] in self?.handleSttEnd() }
        )
        recompute()
    }

    /// Stops the current utterance gracefully (web `rec.stop()`).
    public func stopListening() {
        speech.stopListening()
        ui.listening = false
        recompute()
    }

    // MARK: Playback (web speechSynthesis)

    /// Toggles spoken replies — muting cancels any in-flight utterance and drops the unspoken buffer
    /// (web `toggleTts`), while keeping the consumed cursor so re-enabling speaks only new deltas.
    public func toggleTts() {
        ui.ttsEnabled.toggle()
        if !ui.ttsEnabled {
            speech.cancelSpeech()
            ttsFeed = VoiceModeTtsFeed(buffer: "", consumedLength: ttsFeed.consumedLength)
        }
        recompute()
    }

    // MARK: Send + stop-all (web AIFeatureCard action / Stop)

    /// Opens the voice-chat stream with the trimmed transcript (web `handleAction` → `stream.start()`).
    /// Resets the TTS buffer + cancels speech first so the previous reply does not bleed in.
    public func handleAction() {
        guard currentCanStart else { return }
        ttsFeed = VoiceModeTtsFeed()
        speech.cancelSpeech()
        source.send(
            message: ui.transcript.trimmingCharacters(in: .whitespacesAndNewlines),
            sessionID: sessionID
        )
    }

    /// Stops everything at once (web `handleStopAll`): dictation, the stream, and playback.
    public func handleStopAll() {
        stopListening()
        source.cancel()
        speech.cancelSpeech()
        ttsFeed = VoiceModeTtsFeed(buffer: "", consumedLength: ttsFeed.consumedLength)
        recompute()
    }
}

// MARK: - Private coordination

private extension VoiceModeModel {
    var currentCanStart: Bool {
        !ui.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !lastInput.stream.isBusy
    }

    func handleSttResult(_ text: String) {
        let recognized = text.trimmingCharacters(in: .whitespacesAndNewlines)
        ui.transcript = listenBase.isEmpty ? recognized : "\(listenBase) \(recognized)"
        persistDraft()
        recompute()
    }

    func handleSttError(_ reason: String) {
        ui.sttError = VoiceModeStrings.format(
            "voiceMode.errors.sttFailed",
            "Voice input failed: %@",
            reason
        )
        ui.listening = false
        recompute()
    }

    func handleSttEnd() {
        ui.listening = false
        recompute()
    }

    /// Applies one source snapshot: drives the TTS feed off the stream text, persists / clears the
    /// transcript draft per stream state, updates the connectivity axis, recomputes, then runs the
    /// telemetry + auto-refresh side effects.
    func apply(_ input: VoiceModeInput) {
        let step = VoiceModeTtsCoordinator.step(
            feed: ttsFeed,
            snapshot: input.stream,
            ttsEnabled: ui.ttsEnabled
        )
        ttsFeed = step.feed
        if step.cancelSpeech { speech.cancelSpeech() }
        for sentence in step.sentences {
            speech.speak(sentence, locale: locale)
        }
        handleDraft(for: input.stream)
        lastInput = input
        connection = input.connection
        recompute()
        maybeEmitOpen()
        handleAutoRefresh(for: input.connection)
    }

    /// Web draft effects: never persist mid-stream; clear the draft + transcript on a successful
    /// `done`; otherwise persist the current transcript.
    func handleDraft(for stream: VoiceModeStreamSnapshot) {
        switch stream.state {
        case .streaming, .pausedConfirm:
            break
        case .done:
            ui.transcript = ""
            listenBase = ""
            draftStore.clear()
        case .idle, .error:
            persistDraft()
        }
    }

    func persistDraft() {
        guard !lastInput.stream.isBusy else { return }
        draftStore.write(ui.transcript)
    }

    func recompute() {
        resolved = VoiceModeProjection.resolve(input: lastInput, ui: ui, locale: locale)
    }

    /// Emits `view.opened` exactly once, and only when the surface is actually presented (the gate is
    /// open) — mirroring the web `data-ai-feature` marker, which is absent in off mode.
    func maybeEmitOpen() {
        guard !didEmitOpen, resolved.phase != .gated else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: AIVoiceMode.surfaceSlug)
    }

    /// Stale → one guarded availability refresh; reset once live so a later stale episode re-triggers
    /// exactly once. Offline never auto-refreshes.
    func handleAutoRefresh(for connection: VoiceModeConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
