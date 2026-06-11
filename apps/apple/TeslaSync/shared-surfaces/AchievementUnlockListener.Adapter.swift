//
//  AchievementUnlockListener.Adapter.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  The testable, dependency-light core for the achievement-unlock listener — the SwiftUI parity of
//  `components/feedback/AchievementUnlockListener.tsx` (+ the `AchievementUnlockedToast` /
//  `AchievementUnlockedToastStack` it composes and the `useAchievementUnlocks` /
//  `useAchievementCelebrationPrefs` hooks it binds). Everything here is pure (Foundation only): the
//  domain value types (achievement / unlock event / celebration prefs), the fetch + connectivity
//  lifecycle, the unlock-queue truth table (the verbatim port of the web `useAchievementUnlocks`
//  de-dupe + bound + newest-first reducer), the deep-link builder (the port of the web
//  `navigate('/lifetime?achievement=' + encodeURIComponent(id))`), the celebration-chime spec (the
//  verbatim port of the web WebAudio two-note tone parameters), the surface metadata (diagnostics
//  slug), and the VoiceOver label builder. No store, no bundle, no rendered view, so each piece is
//  unit tested in isolation.
//
//  Parity note: every type is prefixed `AchievementUnlockListener` so the surface stays self-contained
//  in the single app module — the bare `AchievementUnlock` already belongs to the
//  RecentlyUnlockedAchievements widget and `AchievementCelebrationPrefs` is the web hook name reused in
//  other surfaces' comments. The web hooks arrive snake_case off the raw SSE stream; the native value
//  types use Swift camelCase and the projection reads them directly.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity resolver.
public typealias AchievementUnlockListenerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Domain value types (web `LifetimeAchievement` / `AchievementUnlockedEvent`)

/// One achievement — the subset of the web `LifetimeAchievement` the celebration toast renders: the
/// stable id (the deep-link target), the display name, the description, and the emoji icon. The web
/// badge also carries progress fields, but an *unlocked* celebration only needs these four.
public struct AchievementUnlockListenerAchievement: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let detail: String
    public let icon: String

    public init(id: String, name: String, detail: String, icon: String) {
        self.id = id
        self.name = name
        self.detail = detail
        self.icon = icon
    }
}

/// One `achievement_unlocked` event — the native mirror of the web `AchievementUnlockedEvent`
/// (`vehicle_id` / `unlocked_at` / `achievement`). `unlockedAt` is parsed off the wire `unlocked_at`
/// string; it is carried for data fidelity (and de-dupe ordering) though the toast itself does not
/// render a timestamp, exactly like the web toast.
public struct AchievementUnlockListenerEvent: Sendable, Equatable, Identifiable {
    public let vehicleID: Int
    public let unlockedAt: Date?
    public let achievement: AchievementUnlockListenerAchievement

    public init(vehicleID: Int, unlockedAt: Date?, achievement: AchievementUnlockListenerAchievement) {
        self.vehicleID = vehicleID
        self.unlockedAt = unlockedAt
        self.achievement = achievement
    }

    /// The queue identity is the achievement id — the web de-dupes by `achievement.id`.
    public var id: String {
        achievement.id
    }
}

/// The device-local celebration prefs — the subset of the web `useAchievementCelebrationPrefs` this
/// surface reads. `showToasts` gates the visible celebration (web `if (!prefs.showToasts) return null`)
/// and `playSound` gates the unlock chime (web `if (!prefs.playSound) return`). The web defaults are
/// reproduced: toasts on, sound off (opt-in).
public struct AchievementUnlockListenerPrefs: Sendable, Equatable {
    public var showToasts: Bool
    public var playSound: Bool

    public init(showToasts: Bool = true, playSound: Bool = false) {
        self.showToasts = showToasts
        self.playSound = playSound
    }

    /// The web default prefs (toasts on, sound off).
    public static let `default` = AchievementUnlockListenerPrefs()
}

// MARK: - Fetch + connectivity lifecycle (P4 leaf contract)

/// The resolution state of the unlock feed backing the surface — the native shape of the host's SSE
/// subscription lifecycle. `loading` shows the skeleton chrome, `failed` shows the retry chrome, and
/// `resolved` lets the queue + prefs decide between the toast stack and the friendly empty states.
public enum AchievementUnlockListenerStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case resolved
    case failed
}

/// The freshness of the bound unlock feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` (the SSE stream past its freshness window) and `offline` show
/// it, the latter over the cached toasts.
public enum AchievementUnlockListenerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Unlock queue (verbatim port of the web `useAchievementUnlocks` reducer)

/// Fixed limits ported from the web hooks: the queue is bounded to 25 (web `MAX_RECENT`) and each
/// celebration toast auto-dismisses after 6 seconds (web `AchievementUnlockedToast` `durationMs`
/// default of 6000).
public enum AchievementUnlockListenerLimits {
    /// Web `const MAX_RECENT = 25` — the unlock queue cap.
    public static let maxRecent = 25
    /// Web `durationMs = 6000` — the per-toast auto-dismiss lifetime, in whole seconds.
    public static let autoDismissSeconds = 6
}

/// The pure unlock-queue reducer — the verbatim port of the web `useAchievementUnlocks` state updates:
///   onUnlock: ignore a payload with no `achievement.id`; ignore a duplicate id; otherwise prepend
///             (newest-first) and cap at `MAX_RECENT`.
///   dismiss : drop the entry with the matching id.
/// Pure + public so the de-dupe / bound / order rules are unit-tested without a store.
public enum AchievementUnlockListenerQueue {
    /// Inserts a freshly-received unlock — the web `setRecent` reducer. A blank-id payload (web
    /// `!payload.achievement.id`) or an already-queued id (web `prev.some(...)`) returns the queue
    /// unchanged; otherwise the event is prepended and the queue is capped at `max`.
    public static func inserting(
        _ event: AchievementUnlockListenerEvent,
        into queue: [AchievementUnlockListenerEvent],
        max: Int = AchievementUnlockListenerLimits.maxRecent
    ) -> [AchievementUnlockListenerEvent] {
        guard !event.achievement.id.isEmpty else { return queue }
        guard !queue.contains(where: { $0.achievement.id == event.achievement.id }) else { return queue }
        return Array(([event] + queue).prefix(max))
    }

    /// Removes the entry with `id` — the web `dismiss(achievementId)` filter.
    public static func removing(
        id: String,
        from queue: [AchievementUnlockListenerEvent]
    ) -> [AchievementUnlockListenerEvent] {
        queue.filter { $0.achievement.id != id }
    }
}

// MARK: - Deep link (verbatim port of the web `navigate('/lifetime?achievement=…')`)

/// The deep-link builder — the verbatim port of the web
/// `navigate('/lifetime?achievement=' + encodeURIComponent(event.achievement.id))`. The id is escaped
/// with the same unreserved set as JavaScript's `encodeURIComponent` (alphanumerics plus
/// `-_.!~*'()`), so spaces, slashes, and non-ASCII bytes percent-encode identically.
public enum AchievementUnlockListenerRoute {
    /// The `encodeURIComponent` unreserved character set: `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
    public static let unreserved: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-_.!~*'()")
        return set
    }()

    /// Builds `/lifetime?achievement=<encoded id>` — the View affordance's navigation target.
    public static func lifetime(achievementID: String) -> String {
        let encoded = achievementID.addingPercentEncoding(withAllowedCharacters: unreserved) ?? achievementID
        return "/lifetime?achievement=\(encoded)"
    }
}

// MARK: - Celebration chime (verbatim port of the web WebAudio tone)

/// The procedural unlock-chime spec — the verbatim port of the web `AchievementUnlockListener` WebAudio
/// envelope: a two-note "ding" (a perfect fifth E5 → B5) on a triangle oscillator, each note 0.5 s
/// long and staggered 0.12 s apart, with a 0.02 s attack to a 0.18 peak gain and an exponential decay
/// to near-silence by 0.45 s. Pure data so the production synthesizer (`AchievementUnlockListenerChime`)
/// stays a thin player and the parameters are unit-asserted against the web source.
public struct AchievementUnlockListenerChimeSpec: Sendable, Equatable {
    /// Oscillator shape (web `osc.type`). The web tone is a triangle wave.
    public enum Waveform: String, Sendable, Equatable {
        case triangle
    }

    /// Note frequencies in Hz (web `noteFreqs = [659.25, 987.77]` — E5, B5).
    public let frequencies: [Double]
    public let waveform: Waveform
    /// Seconds between successive note onsets (web `i * 0.12`).
    public let staggerSeconds: Double
    /// Per-note sounding length in seconds (web `osc.stop(start + 0.5)`).
    public let noteDurationSeconds: Double
    /// Attack ramp to the peak gain in seconds (web `now + 0.02`).
    public let attackSeconds: Double
    /// Decay-to-silence time in seconds (web `now + 0.45`).
    public let decaySeconds: Double
    /// Peak linear gain (web `exponentialRampToValueAtTime(0.18, …)`).
    public let peakGain: Double

    public init(
        frequencies: [Double],
        waveform: Waveform,
        staggerSeconds: Double,
        noteDurationSeconds: Double,
        attackSeconds: Double,
        decaySeconds: Double,
        peakGain: Double
    ) {
        self.frequencies = frequencies
        self.waveform = waveform
        self.staggerSeconds = staggerSeconds
        self.noteDurationSeconds = noteDurationSeconds
        self.attackSeconds = attackSeconds
        self.decaySeconds = decaySeconds
        self.peakGain = peakGain
    }

    /// The web unlock chime (E5 → B5 perfect-fifth ding).
    public static let celebration = AchievementUnlockListenerChimeSpec(
        frequencies: [659.25, 987.77],
        waveform: .triangle,
        staggerSeconds: 0.12,
        noteDurationSeconds: 0.5,
        attackSeconds: 0.02,
        decaySeconds: 0.45,
        peakGain: 0.18
    )
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum AchievementUnlockListenerMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AchievementUnlockListener"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localized parts, so the spoken content is
/// asserted without rendering the view. A celebration toast voices its eyebrow, the achievement name,
/// and the description as one polite status announcement (the web `role="status"` / `aria-live`
/// region); the offline chip's note is appended to the stack summary when the feed is offline.
public enum AchievementUnlockListenerAccessibility {
    /// One toast's spoken label — "Achievement Unlocked. {name}. {detail}".
    public static func toastLabel(eyebrow: String, name: String, detail: String) -> String {
        [eyebrow, name, detail].filter { !$0.isEmpty }.joined(separator: ". ")
    }

    /// The stack's spoken summary — the count phrase, with the offline note appended when offline.
    public static func stackLabel(countPhrase: String, offlineNote: String?) -> String {
        guard let offlineNote, !offlineNote.isEmpty else { return countPhrase }
        return "\(countPhrase), \(offlineNote)"
    }
}
