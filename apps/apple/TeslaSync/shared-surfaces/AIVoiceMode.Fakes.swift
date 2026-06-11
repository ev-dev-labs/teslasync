//
//  AIVoiceMode.Fakes.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  In-memory doubles for the speech + transcript-draft seams, used by the previews and the unit /
//  UI tests so the surface is exercised without a microphone, a speech synthesizer, or persistent
//  storage. The recognition double exposes `emitResult` / `emitError` / `emitEnd` so a test can play
//  back a dictation session deterministically; the call counters + spoken-sentence capture let the
//  coordinator's delegation be asserted. Production uses the system implementations in
//  AIVoiceMode.Speech.swift.
//

import Foundation

// MARK: - In-memory speech controller (previews + tests)

/// Records dictation + playback calls and lets a test drive recognition callbacks directly. Set
/// `supported` to model a device without dictation (web `sttSupported === false`).
@MainActor
public final class InMemoryVoiceModeSpeechController: VoiceModeSpeechControlling {
    public var supported: Bool
    public private(set) var startListeningCount = 0
    public private(set) var stopListeningCount = 0
    public private(set) var abortListeningCount = 0
    public private(set) var cancelSpeechCount = 0
    public private(set) var spokenSentences: [String] = []
    public private(set) var lastSpeakLocale: Locale?

    private var onResult: (@MainActor (String) -> Void)?
    private var onError: (@MainActor (String) -> Void)?
    private var onEnd: (@MainActor () -> Void)?

    public init(supported: Bool = true) {
        self.supported = supported
    }

    public var isListeningSupported: Bool {
        supported
    }

    public func startListening(
        locale _: Locale,
        onResult: @escaping @MainActor (String) -> Void,
        onError: @escaping @MainActor (String) -> Void,
        onEnd: @escaping @MainActor () -> Void
    ) {
        startListeningCount += 1
        self.onResult = onResult
        self.onError = onError
        self.onEnd = onEnd
    }

    public func stopListening() {
        stopListeningCount += 1
    }

    public func abortListening() {
        abortListeningCount += 1
    }

    public func speak(_ text: String, locale: Locale) {
        spokenSentences.append(text)
        lastSpeakLocale = locale
    }

    public func cancelSpeech() {
        cancelSpeechCount += 1
    }

    // Test affordances — play back a dictation session.

    /// Delivers a cumulative best-transcription update (web `rec.onresult`).
    public func emitResult(_ text: String) {
        onResult?(text)
    }

    /// Delivers a dictation failure (web `rec.onerror` → `ev.error`).
    public func emitError(_ reason: String) {
        onError?(reason)
    }

    /// Signals the end of an utterance (web `rec.onend`).
    public func emitEnd() {
        onEnd?()
    }
}

// MARK: - In-memory transcript draft store (previews + tests)

/// In-memory peer of the `localStorage` draft. Writing an empty string clears the value, matching
/// the production `UserDefaults` store + the web `persistTranscriptDraft('')` semantics.
public final class InMemoryVoiceModeDraftStore: VoiceModeDraftStoring {
    public private(set) var value: String
    public private(set) var writeCount = 0
    public private(set) var clearCount = 0

    public init(value: String = "") {
        self.value = value
    }

    public func read() -> String {
        value
    }

    public func write(_ value: String) {
        writeCount += 1
        self.value = value
    }

    public func clear() {
        clearCount += 1
        value = ""
    }
}
