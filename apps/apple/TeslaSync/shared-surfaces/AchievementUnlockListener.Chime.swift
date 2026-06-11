//
//  AchievementUnlockListener.Chime.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  The production unlock-chime player — the native parity of the web `AchievementUnlockListener`
//  WebAudio "ding". Like the web (which synthesizes the tone procedurally so no audio asset ships and
//  it works offline), this synthesizes a short two-note triangle-wave tone from the pure
//  `AchievementUnlockListenerChimeSpec` via AVAudioEngine — no bundled sound file. All work runs on a
//  private serial queue (off the main actor) and every step is wrapped so any failure silently
//  no-ops, exactly like the web `try { … } catch {}` fallback when WebAudio is unavailable.
//

import AVFoundation
import Foundation
import OSLog

/// The AVFoundation procedural chime. Synthesizes the spec's notes into a single PCM buffer (each note
/// an enveloped triangle wave started at its stagger offset) and plays it through a retained
/// `AVAudioEngine` graph. `@unchecked Sendable`: all mutable state is confined to `queue`, the single
/// serial actor for the audio graph, so the type is safe to share across the strict-concurrency model
/// seam.
public final class AchievementUnlockListenerSystemChime: AchievementUnlockListenerChime, @unchecked Sendable {
    private let queue = DispatchQueue(label: "io.teslasync.achievement-unlock-listener.chime")
    private let logger = Logger(subsystem: "io.teslasync.app", category: "achievement-chime")

    // Retained across plays so the node graph is built once and the tone isn't cut off when `play`
    // returns. Touched only on `queue`.
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?

    public init() {}

    /// Plays the chime. Returns immediately; synthesis + playback happen on the serial audio queue.
    public func play(_ spec: AchievementUnlockListenerChimeSpec) {
        queue.async { [weak self] in
            self?.synthesizeAndPlay(spec)
        }
    }

    private func synthesizeAndPlay(_ spec: AchievementUnlockListenerChimeSpec) {
        do {
            activateSessionIfNeeded()
            let (engine, player) = try graph()
            let format = player.outputFormat(forBus: 0)
            let sampleRate = format.sampleRate > 0 ? format.sampleRate : 44100
            guard
                let bufferFormat = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
                let buffer = makeBuffer(spec: spec, sampleRate: sampleRate, format: bufferFormat)
            else { return }
            if !engine.isRunning {
                engine.prepare()
                try engine.start()
            }
            player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: nil)
            player.play()
        } catch {
            // WebAudio-parity: the visual celebration is the primary affordance; a sound failure
            // (no output route, denied session, engine error) is swallowed.
            logger.debug("unlock chime suppressed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Lazily builds (once) the engine → player → mixer graph, connecting the player with a mono float
    /// format the mixer upmixes to the output.
    private func graph() throws -> (AVAudioEngine, AVAudioPlayerNode) {
        if let engine, let player { return (engine, player) }
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        let mixerFormat = engine.mainMixerNode.outputFormat(forBus: 0)
        let sampleRate = mixerFormat.sampleRate > 0 ? mixerFormat.sampleRate : 44100
        guard let connectFormat = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else {
            throw ChimeError.formatUnavailable
        }
        engine.connect(player, to: engine.mainMixerNode, format: connectFormat)
        self.engine = engine
        self.player = player
        return (engine, player)
    }

    /// Fills one PCM buffer with the summed, enveloped triangle notes — the verbatim shape of the web
    /// envelope: a linear attack to the peak gain over `attackSeconds`, then an exponential decay to
    /// near-silence by `decaySeconds`, per note, each started at its `staggerSeconds` offset.
    private func makeBuffer(
        spec: AchievementUnlockListenerChimeSpec,
        sampleRate: Double,
        format: AVAudioFormat
    ) -> AVAudioPCMBuffer? {
        let noteCount = spec.frequencies.count
        guard noteCount > 0 else { return nil }
        let totalSeconds = spec.staggerSeconds * Double(noteCount - 1) + spec.noteDurationSeconds
        let frameCount = AVAudioFrameCount((totalSeconds * sampleRate).rounded(.up))
        guard
            frameCount > 0,
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount),
            let channel = buffer.floatChannelData?[0]
        else { return nil }
        buffer.frameLength = frameCount

        let decayRate = -log(0.0001) / max(spec.decaySeconds, 0.0001)
        let attack = max(spec.attackSeconds, 0.0001)
        for frame in 0 ..< Int(frameCount) {
            let time = Double(frame) / sampleRate
            var sample = 0.0
            for (index, frequency) in spec.frequencies.enumerated() {
                let offset = spec.staggerSeconds * Double(index)
                let local = time - offset
                guard local >= 0, local < spec.noteDurationSeconds else { continue }
                let envelope = local < attack
                    ? local / attack
                    : exp(-(local - attack) * decayRate)
                let phase = (frequency * local).truncatingRemainder(dividingBy: 1)
                let triangle = 4 * abs(phase - 0.5) - 1
                sample += triangle * envelope * spec.peakGain
            }
            channel[frame] = Float(min(1, max(-1, sample)))
        }
        return buffer
    }

    private func activateSessionIfNeeded() {
        #if os(iOS)
            // Mix with other audio and never duck/interrupt — the chime is a courtesy, not media.
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.ambient, options: [.mixWithOthers])
            try? session.setActive(true)
        #endif
    }

    private enum ChimeError: Error {
        case formatUnavailable
    }
}
