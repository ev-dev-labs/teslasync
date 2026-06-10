//
//  AnnouncerRegion.Adapter.swift
//  TeslaSync — P4 shared surface · 0001 · AnnouncerRegion (Apple)
//
//  The testable, dependency-light core for the global screen-reader announcer — the
//  SwiftUI parity of `components/a11y/AnnouncerRegion.tsx`. Everything here is pure
//  (Foundation only): the live-region priority, one announcement value, the verbatim port
//  of the web duplicate-dedupe padding (`announceCounter % 4` rotating zero-width spaces),
//  and the VoiceOver summary builders. No store, no bundle, no rendered view, so each piece
//  is unit tested in isolation.
//
//  Parity note: the web `AnnouncerRegion` renders nothing visible — it mounts two
//  visually-hidden live regions (one polite, one assertive) that `subscribeAnnouncer`
//  writes into, and `announce(message, priority)` pushes a padded message into every
//  region. This core reproduces that exact data: the priority axis, the message identity +
//  rotating padding, and the polite/assertive routing the component performs at read time.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web
/// `useTranslation` `t(key, fallback)` call. Kept as a plain closure so the pure core has
/// no dependency on a bundle: the production app passes the P1/S10 facade, while tests pass
/// the identity-fallback resolver.
public typealias AnnouncerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Priority (web `AnnouncerPriority` — 'polite' | 'assertive')

/// Live-region urgency — the native mirror of the web `AnnouncerPriority`. `polite` waits
/// for the assistive technology to finish its current activity (web `role="status"
/// aria-live="polite"`); `assertive` interrupts (web `role="alert" aria-live="assertive"`),
/// reserved for genuine errors and security-sensitive messages.
public enum AnnouncerPriority: String, Sendable, Equatable, CaseIterable, Identifiable {
    case polite
    case assertive

    public var id: String {
        rawValue
    }

    /// The native VoiceOver announcement priority. `assertive` maps to `.high` so it
    /// interrupts; `polite` maps to `.default` so it queues — the platform equivalent of the
    /// web `aria-live` urgency.
    public var isInterrupting: Bool {
        self == .assertive
    }
}

// MARK: - Announcement (web region message)

/// One announcement — the native mirror of a single message routed through
/// `subscribeAnnouncer`. `id` is the monotonic sequence (web `announceCounter`); `text` is
/// the clean message shown in the inspector; `announcementText` is the padded form actually
/// posted to the assistive technology (web region `textContent`, with the rotating
/// zero-width-space suffix that forces re-announcement of duplicates); `priority` selects the
/// live region; `timestamp` orders the recent history.
public struct AnnouncerMessage: Sendable, Equatable, Identifiable {
    public let id: Int
    public let text: String
    public let announcementText: String
    public let priority: AnnouncerPriority
    public let timestamp: Date

    public init(
        id: Int,
        text: String,
        announcementText: String,
        priority: AnnouncerPriority,
        timestamp: Date
    ) {
        self.id = id
        self.text = text
        self.announcementText = announcementText
        self.priority = priority
        self.timestamp = timestamp
    }
}

// MARK: - Dedupe padding (verbatim port of the web `announceCounter % 4` zero-width suffix)

/// Reproduces the web announcer's duplicate-dedupe mechanism: each call appends a rotating
/// run of zero-width spaces (`'\u200B'.repeat(announceCounter % 4)`) so the region's text
/// content is a fresh string and the assistive technology re-reads identical consecutive
/// messages. Pure + deterministic so the rotation is asserted entry-for-entry.
public enum AnnouncerPadding {
    /// U+200B ZERO WIDTH SPACE — invisible on screen and not spoken, exactly as the web uses
    /// it.
    public static let zeroWidthSpace = "\u{200B}"

    /// The suffix for a given sequence number — `sequence mod 4` zero-width spaces. The
    /// modulo keeps the suffix bounded so the message length never grows unbounded.
    public static func suffix(for sequence: Int) -> String {
        let count = ((sequence % 4) + 4) % 4
        return String(repeating: zeroWidthSpace, count: count)
    }

    /// The padded announcement string — `message` with the rotating zero-width suffix
    /// appended (web `${message}${padding}`).
    public static func padded(_ message: String, sequence: Int) -> String {
        message + suffix(for: sequence)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken
/// content is asserted without rendering the view. Each live region reads its name then its
/// current message; each history row reads its priority then its message.
public enum AnnouncerRegionAccessibility {
    /// One live region's label: "{regionName}: {message}", or "{regionName}: {emptyWord}"
    /// when the region has not been written to yet — so VoiceOver never lands on an unlabelled
    /// element.
    public static func regionLabel(regionName: String, message: String, emptyWord: String) -> String {
        let body = message.isEmpty ? emptyWord : message
        return "\(regionName): \(body)"
    }

    /// One history row's label: "{priorityWord}: {message}", so the row reads as a sentence
    /// naming its urgency then its content.
    public static func historyLabel(priorityWord: String, message: String) -> String {
        "\(priorityWord): \(message)"
    }
}
