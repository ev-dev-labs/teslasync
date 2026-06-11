//
//  AIVoiceMode.Speech.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  The on-device speech seams (P1/S8) for the Helix voice-mode panel — the native peers of the web
//  browser primitives the surface is built on:
//    • `VoiceModeSpeechControlling` ⇆ `SpeechRecognition` (dictation) + `speechSynthesis` (spoken
//      reply). Audio never leaves the device; only the transcribed text is sent through the stream.
//    • `VoiceModeDraftStoring`      ⇆ the `localStorage` transcript draft (ADR-015 §I12).
//
//  The view + model bind through these protocols; previews and tests inject the in-memory doubles
//  (AIVoiceMode.Fakes.swift). The production implementations here use `SFSpeechRecognizer` +
//  `AVAudioEngine` for dictation and `AVSpeechSynthesizer` for playback, mirroring the web
//  Web-Speech contract (interim results on, single-utterance dictation, reply read aloud sentence by
//  sentence). They are exercised only at runtime behind the seam — the tests never touch the system
//  engine — so the surface stays fully unit-testable without a microphone.
//

import AVFoundation
import Foundation
#if canImport(Speech)
    import Speech
#endif

// MARK: - Speech control seam (web SpeechRecognition + speechSynthesis)

/// The dictation + spoken-reply seam — the native peer of the browser `SpeechRecognition` /
/// `speechSynthesis` pair the web surface uses. `isListeningSupported` mirrors web
/// `getSpeechRecognitionCtor() !== null`; `startListening` streams interim transcripts through
/// `onResult` (cumulative best transcription for the utterance), reports failures through
/// `onError`, and signals the end of an utterance through `onEnd`. Speech callbacks are
/// main-actor-isolated so the bound model mutates its state without hopping.
@MainActor
public protocol VoiceModeSpeechControlling: AnyObject {
    /// Whether dictation is available on this device (web `sttSupported`).
    var isListeningSupported: Bool { get }

    /// Begins an utterance. `onResult` fires with the cumulative best transcription as the user
    /// speaks; `onError` carries a human-readable failure reason (web `ev.error`); `onEnd` fires
    /// once when recognition stops (web `rec.onend`).
    func startListening(
        locale: Locale,
        onResult: @escaping @MainActor (String) -> Void,
        onError: @escaping @MainActor (String) -> Void,
        onEnd: @escaping @MainActor () -> Void
    )

    /// Stops the current utterance gracefully (web `rec.stop()`).
    func stopListening()

    /// Aborts recognition immediately, e.g. on teardown (web `rec.abort()`).
    func abortListening()

    /// Speaks one sentence aloud (web `speakSentence`). Empty / whitespace text is ignored.
    func speak(_ text: String, locale: Locale)

    /// Cancels any in-flight utterance so the user is not talked over (web `speechSynthesis.cancel()`).
    func cancelSpeech()
}

// MARK: - Transcript draft store seam (web localStorage, ADR-015 §I12)

/// The transcript-draft persistence seam — the native peer of the web `localStorage` draft
/// (`ai.voiceMode.transcriptDraft`). Writing an empty string clears the draft, matching the web
/// `persistTranscriptDraft('')` semantics.
public protocol VoiceModeDraftStoring: AnyObject {
    func read() -> String
    func write(_ value: String)
    func clear()
}

/// `UserDefaults`-backed draft store — the production peer of the web `localStorage` draft. An empty
/// value removes the key (web `removeItem`) so a stale draft never repaints a just-sent prompt.
public final class UserDefaultsVoiceModeDraftStore: VoiceModeDraftStoring {
    public static let key = "ai.voiceMode.transcriptDraft"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func read() -> String {
        defaults.string(forKey: Self.key) ?? ""
    }

    public func write(_ value: String) {
        if value.isEmpty {
            defaults.removeObject(forKey: Self.key)
        } else {
            defaults.set(value, forKey: Self.key)
        }
    }

    public func clear() {
        defaults.removeObject(forKey: Self.key)
    }
}

// MARK: - System speech controller (production)

#if canImport(Speech)
    /// Forwards realtime audio buffers from the capture tap into the recognition request. The tap
    /// runs on a render thread, so the box is `@unchecked Sendable`; `append(_:)` is documented as
    /// safe to call off the main thread.
    private final class VoiceModeRecognitionRequestBox: @unchecked Sendable {
        let request: SFSpeechAudioBufferRecognitionRequest

        init(_ request: SFSpeechAudioBufferRecognitionRequest) {
            self.request = request
        }

        func append(_ buffer: AVAudioPCMBuffer) {
            request.append(buffer)
        }
    }
#endif

/// The production speech controller: `SFSpeechRecognizer` + `AVAudioEngine` for dictation and
/// `AVSpeechSynthesizer` for the spoken reply. Authorization is requested lazily on the first
/// utterance; a single utterance is captured (web `continuous = false`) with interim results on
/// (web `interimResults = true`). All recognition callbacks hop back to the main actor before
/// touching the bound closures.
@MainActor
public final class SystemVoiceModeSpeechController: VoiceModeSpeechControlling {
    private let synthesizer = AVSpeechSynthesizer()
    #if canImport(Speech)
        private let audioEngine = AVAudioEngine()
        private var requestBox: VoiceModeRecognitionRequestBox?
        private var task: SFSpeechRecognitionTask?
    #endif

    public init() {}

    public var isListeningSupported: Bool {
        #if canImport(Speech)
            switch SFSpeechRecognizer.authorizationStatus() {
            case .denied, .restricted:
                return false
            default:
                return SFSpeechRecognizer() != nil
            }
        #else
            return false
        #endif
    }

    public func startListening(
        locale: Locale,
        onResult: @escaping @MainActor (String) -> Void,
        onError: @escaping @MainActor (String) -> Void,
        onEnd: @escaping @MainActor () -> Void
    ) {
        #if canImport(Speech)
            switch SFSpeechRecognizer.authorizationStatus() {
            case .authorized:
                begin(locale: locale, onResult: onResult, onError: onError, onEnd: onEnd)
            case .notDetermined:
                SFSpeechRecognizer.requestAuthorization { status in
                    Task { @MainActor in
                        if status == .authorized {
                            self.begin(locale: locale, onResult: onResult, onError: onError, onEnd: onEnd)
                        } else {
                            onError(Self.deniedReason)
                            onEnd()
                        }
                    }
                }
            default:
                onError(Self.deniedReason)
                onEnd()
            }
        #else
            onError(Self.deniedReason)
            onEnd()
        #endif
    }

    public func stopListening() {
        #if canImport(Speech)
            requestBox?.request.endAudio()
            teardownEngine()
            task?.finish()
            task = nil
        #endif
    }

    public func abortListening() {
        #if canImport(Speech)
            teardownEngine()
            task?.cancel()
            task = nil
            requestBox = nil
        #endif
    }

    public func speak(_ text: String, locale: Locale) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.voice = AVSpeechSynthesisVoice(language: locale.identifier)
            ?? AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(utterance)
    }

    public func cancelSpeech() {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
    }
}

#if canImport(Speech)
    private extension SystemVoiceModeSpeechController {
        static var deniedReason: String {
            "speech-recognition-unavailable"
        }

        func begin(
            locale: Locale,
            onResult: @escaping @MainActor (String) -> Void,
            onError: @escaping @MainActor (String) -> Void,
            onEnd: @escaping @MainActor () -> Void
        ) {
            guard let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(),
                  recognizer.isAvailable
            else {
                onError(Self.deniedReason)
                onEnd()
                return
            }
            abortListening()
            do {
                try activateSession()
                try startEngine()
            } catch {
                teardownEngine()
                onError((error as NSError).localizedDescription)
                onEnd()
                return
            }
            startTask(on: recognizer, onResult: onResult, onError: onError, onEnd: onEnd)
        }

        /// Installs the capture tap and starts the audio engine. The tap forwards buffers into the
        /// recognition request via the `@unchecked Sendable` box (off the main thread).
        func startEngine() throws {
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            let box = VoiceModeRecognitionRequestBox(request)
            requestBox = box
            let node = audioEngine.inputNode
            let format = node.outputFormat(forBus: 0)
            node.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                box.append(buffer)
            }
            audioEngine.prepare()
            try audioEngine.start()
        }

        func startTask(
            on recognizer: SFSpeechRecognizer,
            onResult: @escaping @MainActor (String) -> Void,
            onError: @escaping @MainActor (String) -> Void,
            onEnd: @escaping @MainActor () -> Void
        ) {
            guard let request = requestBox?.request else { return }
            task = recognizer.recognitionTask(with: request) { result, error in
                let text = result?.bestTranscription.formattedString
                let isFinal = result?.isFinal ?? false
                let message = error.map { ($0 as NSError).localizedDescription }
                Task { @MainActor in
                    if let text { onResult(text) }
                    if let message {
                        self.stopListening()
                        onError(message)
                        onEnd()
                    } else if isFinal {
                        self.stopListening()
                        onEnd()
                    }
                }
            }
        }

        func teardownEngine() {
            if audioEngine.isRunning {
                audioEngine.stop()
            }
            audioEngine.inputNode.removeTap(onBus: 0)
        }

        func activateSession() throws {
            #if os(iOS)
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(
                    .playAndRecord,
                    mode: .spokenAudio,
                    options: [.duckOthers, .defaultToSpeaker]
                )
                try session.setActive(true, options: .notifyOthersOnDeactivation)
            #endif
        }
    }
#endif
