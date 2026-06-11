//
//  AchievementUnlockedToast.Adapter.swift
//  TeslaSync — P4 shared surface · 0111 · AchievementUnlockedToast (Apple)
//
//  The testable, dependency-light core for the achievement-unlocked celebration toast — the SwiftUI
//  parity of `components/feedback/AchievementUnlockedToast.tsx`. Everything here is pure (Foundation
//  only): the achievement + unlock-event value types (web `AchievementUnlockedEvent`), the queue
//  reducer (the port of the web `useAchievementUnlocks` de-dupe + bound), the confetti particle
//  builder (the port of the web `buildConfettiParticles`, made deterministic so it is unit-testable),
//  the auto-dismiss lifetime, the `/lifetime?achievement=…` deep link (web `navigate`), and the
//  VoiceOver label builder. No store, no bundle, no rendered view, so each piece is unit tested in
//  isolation.
//
//  Parity note: the web surface is two presentational components — `AchievementUnlockedToast` (one
//  celebratory toast: badge + eyebrow + name + description + "View" + dismiss, a confetti burst, and a
//  6s auto-dismiss) and `AchievementUnlockedToastStack` (one toast per pending unlock, stacked
//  top-right). The data is owned upstream by `useAchievementUnlocks`, which subscribes to the
//  `achievement_unlocked` SSE stream and exposes a newest-first, id-de-duped, 25-bounded queue plus a
//  `dismiss(id)`. This core reproduces that queue behaviour + the toast's pure derivations as values
//  and functions; the SwiftUI chrome layers on top in the sibling view files.
//
//  Self-contained badge: the web toast composes `<AchievementBadge size="md" />`, but per this
//  prompt's extraction (no shared-component dependency) the unlocked-badge presentation is reproduced
//  inline in the view layer — the toast only consumes the achievement's id / name / description / icon,
//  so a compact celebratory badge keeps the surface decoupled and independently testable.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias AchievementUnlockedResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Constants (web literals)

/// The surface's pure constants, lifted from the web source so they are asserted in one place.
public enum AchievementUnlockedConstants {
    /// Web `event.achievement.icon || '🎉'` — the icon shown when an unlock carries no emoji.
    public static let fallbackIcon = "🎉"
}

// MARK: - Achievement model (web `AchievementUnlockedEvent.achievement` subset)

/// One achievement as the toast consumes it — the native mirror of the subset of the web
/// `LifetimeAchievement` / `AchievementData` the toast renders (id, name, description, icon). The
/// remaining DTO fields (progress / target / current / unlocked) are not read by an *unlocked* toast,
/// so they are intentionally omitted to keep the surface decoupled.
public struct AchievementUnlockedAchievement: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    /// Web `achievement.description` — held as `detail` so it never shadows `CustomStringConvertible`.
    public let detail: String
    public let icon: String

    public init(id: String, name: String, detail: String, icon: String) {
        self.id = id
        self.name = name
        self.detail = detail
        self.icon = icon
    }

    /// Web `event.achievement.icon || '🎉'` — the emoji to render, falling back to the party popper.
    public var displayIcon: String {
        icon.isEmpty ? AchievementUnlockedConstants.fallbackIcon : icon
    }
}

// MARK: - Unlock event (web `AchievementUnlockedEvent`)

/// One `achievement_unlocked` SSE payload — the native mirror of the web `AchievementUnlockedEvent`
/// (`vehicle_id`, `unlocked_at`, `achievement`). `id` is the achievement id, which is the de-dupe key
/// the queue + the stack's per-toast identity use (web keys each toast by `e.achievement.id`).
public struct AchievementUnlockedEventData: Sendable, Equatable, Identifiable {
    public let achievement: AchievementUnlockedAchievement
    public let vehicleID: Int64
    public let unlockedAt: Date?

    public var id: String {
        achievement.id
    }

    public init(achievement: AchievementUnlockedAchievement, vehicleID: Int64, unlockedAt: Date?) {
        self.achievement = achievement
        self.vehicleID = vehicleID
        self.unlockedAt = unlockedAt
    }
}

// MARK: - Queue (web `useAchievementUnlocks` reducer)

/// The transient unlock queue's pure reducer — the port of the web `useAchievementUnlocks` list
/// behaviour: newest-first, de-duped by `achievement.id` (a re-broadcast from a second SSE pod does
/// not double-fire), and bounded at `maxRecent` so a startup burst never grows unbounded. Pure +
/// public so every branch is unit tested without a store.
public enum AchievementUnlockedQueue {
    /// Web `const MAX_RECENT = 25`.
    public static let maxRecent = 25

    /// Web reducer: `if prev.some(id) return prev; next = [payload, ...prev]; cap to MAX_RECENT`.
    public static func inserting(
        _ event: AchievementUnlockedEventData,
        into queue: [AchievementUnlockedEventData]
    ) -> [AchievementUnlockedEventData] {
        guard !queue.contains(where: { $0.id == event.id }) else { return queue }
        let next = [event] + queue
        return next.count > maxRecent ? Array(next.prefix(maxRecent)) : next
    }

    /// Web `dismiss`: drop the entry whose `achievement.id` matches, leaving the rest in order.
    public static func removing(
        id: String,
        from queue: [AchievementUnlockedEventData]
    ) -> [AchievementUnlockedEventData] {
        queue.filter { $0.id != id }
    }

    /// Coalesces an upstream snapshot into a valid queue — preserves the incoming (newest-first)
    /// order, drops later duplicates by id, and caps at `maxRecent`. The source already emits a
    /// de-duped list, but normalising here keeps the model resilient to a noisy feed.
    public static func normalize(
        _ events: [AchievementUnlockedEventData]
    ) -> [AchievementUnlockedEventData] {
        var seen = Set<String>()
        var out: [AchievementUnlockedEventData] = []
        for event in events where !seen.contains(event.id) {
            seen.insert(event.id)
            out.append(event)
            if out.count == maxRecent { break }
        }
        return out
    }
}

// MARK: - Deep link (web `navigate('/lifetime?achievement=…')`)

/// Builds the "View" affordance's navigation target — the native port of the web
/// `navigate(`/lifetime?achievement=${encodeURIComponent(event.achievement.id)}`)`. The id is
/// percent-encoded with JavaScript `encodeURIComponent` semantics so a tag-style id with reserved
/// characters round-trips to the same URL the web app would push.
public enum AchievementUnlockedDeepLink {
    /// The unreserved set `encodeURIComponent` leaves untouched: `A–Z a–z 0–9 - _ . ! ~ * ' ( )`.
    private static let unreserved: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-_.!~*'()")
        return set
    }()

    /// Web `/lifetime?achievement=<encodeURIComponent(id)>`.
    public static func path(achievementID: String) -> String {
        let encoded = achievementID.addingPercentEncoding(withAllowedCharacters: unreserved) ?? achievementID
        return "/lifetime?achievement=\(encoded)"
    }
}

// MARK: - Auto-dismiss lifetime (web `durationMs`)

/// The toast's auto-dismiss arithmetic — the web `durationMs` prop (default 6000ms). Reduce Motion
/// keeps the same lifetime (the web comment: "just a fade-in and a 6s lifetime"); only the entry
/// animation + confetti change. Pure so the duration is asserted without a timer.
public enum AchievementUnlockedLifetime {
    /// Web `durationMs = 6000` → 6 seconds.
    public static let defaultSeconds: TimeInterval = 6.0

    /// Converts a web-style millisecond duration to seconds, clamped at zero.
    public static func seconds(durationMs: Int) -> TimeInterval {
        max(0, Double(durationMs) / 1000.0)
    }
}

// MARK: - Confetti (web `buildConfettiParticles`)

/// One confetti particle — the native mirror of the web `ConfettiParticle`: a final offset
/// (`velocityX` / `velocityY`, in points, the web `vx` / `vy`), a terminal `rotation`, and a launch
/// `delaySeconds`. A pure value so the burst is asserted (count, ranges, determinism) without
/// rendering.
public struct AchievementConfettiParticle: Sendable, Equatable, Identifiable {
    public let id: Int
    public let velocityX: Double
    public let velocityY: Double
    public let rotation: Double
    public let delaySeconds: Double

    public init(id: Int, velocityX: Double, velocityY: Double, rotation: Double, delaySeconds: Double) {
        self.id = id
        self.velocityX = velocityX
        self.velocityY = velocityY
        self.rotation = rotation
        self.delaySeconds = delaySeconds
    }
}

/// Builds the confetti burst — the port of the web `buildConfettiParticles` (24 particles, ~2.5s).
/// The web uses `Math.random`; this core threads a deterministic `SplitMix64` so the layout is
/// reproducible across runs (the web comment: "spread is purely visual"), which lets the burst be
/// unit-tested and keeps snapshots stable. Reduce Motion yields an empty burst (web
/// `reduce ? [] : buildConfettiParticles()`).
public enum AchievementConfetti {
    /// Web `CONFETTI_COUNT = 24`.
    public static let count = 24
    /// Web `CONFETTI_DURATION_SEC = 2.5`.
    public static let durationSeconds: TimeInterval = 2.5

    public static func particles(
        reduceMotion: Bool,
        seed: UInt64 = 0x9E37_79B9_7F4A_7C15
    ) -> [AchievementConfettiParticle] {
        guard !reduceMotion else { return [] }
        var rng = AchievementConfettiRandom(seed: seed)
        return (0 ..< count).map { index in
            AchievementConfettiParticle(
                id: index,
                velocityX: (rng.nextUnit() - 0.5) * 280, // web (Math.random() - 0.5) * 280
                velocityY: -(rng.nextUnit() * 160 + 60), // web -(Math.random() * 160 + 60)
                rotation: (rng.nextUnit() - 0.5) * 720, // web (Math.random() - 0.5) * 720
                delaySeconds: rng.nextUnit() * 0.25 // web Math.random() * 0.25
            )
        }
    }

    /// A stable, content-derived seed (FNV-1a over the id's UTF-8) so a toast's burst is fixed for its
    /// mount and reproducible in tests — different unlocks get visibly different spreads, the same
    /// unlock always gets the same one.
    public static func seed(for id: String) -> UInt64 {
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325
        for byte in id.utf8 {
            hash = (hash ^ UInt64(byte)) &* 0x0000_0100_0000_01B3
        }
        return hash
    }
}

/// A small, deterministic SplitMix64 generator — used purely to lay out the confetti spread so the
/// burst is reproducible (and therefore testable) without depending on the system RNG. Not for any
/// security-sensitive use.
struct AchievementConfettiRandom {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state = state &+ 0x9E37_79B9_7F4A_7C15
        var mixed = state
        mixed = (mixed ^ (mixed >> 30)) &* 0xBF58_476D_1CE4_E5B9
        mixed = (mixed ^ (mixed >> 27)) &* 0x94D0_49BB_1331_11EB
        return mixed ^ (mixed >> 31)
    }

    /// A double in `[0, 1)` from the top 53 bits — the parity of JavaScript `Math.random`'s range.
    mutating func nextUnit() -> Double {
        Double(next() >> 11) * (1.0 / 9_007_199_254_740_992.0)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the toast's combined VoiceOver label from already-localised parts, so the spoken content is
/// asserted without rendering. Mirrors the web `role="status"` / `aria-live="polite"` announcement:
/// the eyebrow ("Achievement Unlocked"), the achievement name, and its description, read in one pass.
public enum AchievementUnlockedAccessibility {
    /// "{eyebrow}: {name}. {detail}" — joined so a terminal period is never doubled and empty parts
    /// are skipped.
    public static func toastLabel(eyebrow: String, name: String, detail: String) -> String {
        var label = eyebrow
        if !name.isEmpty {
            label += label.isEmpty ? name : ": \(name)"
        }
        if !detail.isEmpty {
            if label.isEmpty {
                label = detail
            } else {
                let endsWithTerminal = label.last.map { ".!?".contains($0) } ?? false
                label += (endsWithTerminal ? " " : ". ") + detail
            }
        }
        return label
    }
}
