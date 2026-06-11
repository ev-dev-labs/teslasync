//
//  DraftRestorePrompt.Adapter.swift
//  TeslaSync — P4 shared surface · 0117 · DraftRestorePrompt (Apple)
//
//  The testable, dependency-light core for the draft-restore prompt — the SwiftUI parity of
//  `components/feedback/DraftRestorePrompt.tsx`. Everything here is pure (Foundation only): the draft
//  value type (web `DraftEntry`), the draft-index reducers (the port of the web mount-time evaluation +
//  the `subscribeDraftIndex` re-sync + the per-row `discardDraftEnvelope`), the relative-time formatter
//  (the port of the web `formatRelativeTime` used for the "Saved {when}" line), the count-pluralised
//  prompt body (the web i18next `_one` / `_other`), the `{{when}}` / `{{count}}` token substitution
//  (the web interpolation), the resume-route normaliser (web `navigate(entry.route)`), and the
//  VoiceOver label builders. No store, no bundle, no rendered view, so each piece is unit-tested in
//  isolation.
//
//  Parity note: the web surface is mounted once globally (in `Layout.tsx`). On mount it (1) collects
//  cross-tab `formDraft.acquired` / `released` / `committed` broadcasts during a 1.5 s grace period to
//  learn which draft keys are being actively edited in a sibling tab, (2) reads `getDrafts()` (the
//  localStorage draft index), (3) filters out the actively-edited keys, and (4) if anything remains,
//  surfaces a bottom-left card whose "Review" opens a modal listing every draft with per-row "Resume"
//  and "Discard". This core reproduces the surfacing filter + the discard/re-sync reducers + the row
//  derivations as values and functions; the SwiftUI chrome layers on top in the sibling view files.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias DraftRestoreResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Constants (web literals)

/// The surface's pure constants, lifted from the web source so they are asserted in one place.
public enum DraftRestoreConstants {
    /// Web `PROMPT_GRACE_MS = 1500` — the cross-tab broadcast collection window before evaluating.
    public static let graceSeconds: TimeInterval = 1.5
    /// Web `DEFAULT_FALLBACK.label = 'Unsaved draft'` — shown when an entry carries no label.
    public static let fallbackLabel = "Unsaved draft"
    /// Web `DEFAULT_FALLBACK.route = '/'` — the resume target when an entry carries no route.
    public static let fallbackRoute = "/"
}

// MARK: - Draft entry (web `DraftEntry`)

/// One recoverable draft as the prompt consumes it — the native mirror of the web `DraftEntry`
/// (`storageKey`, `label`, `route`, `savedAt`). `storageKey` is the full underlying localStorage key;
/// it is the identity used by the surfacing filter, the per-row discard, and SwiftUI's `ForEach`, so it
/// is exposed as `id`.
public struct DraftEntry: Sendable, Equatable, Identifiable {
    /// Web `storageKey` — the full localStorage key; identity + the `discardDraftEnvelope` target.
    public let storageKey: String
    /// Web `label` — the human-readable name shown in the row (may be empty → fallback).
    public let label: String
    /// Web `route` — the in-app pathname `navigate` resumes editing at (may be empty → fallback).
    public let route: String
    /// Web `savedAt` — when the draft was last persisted.
    public let savedAt: Date

    public var id: String {
        storageKey
    }

    public init(storageKey: String, label: String, route: String, savedAt: Date) {
        self.storageKey = storageKey
        self.label = label
        self.route = route
        self.savedAt = savedAt
    }

    /// Web `entry.label || t('draft.recovery.fallbackLabel', 'Unsaved draft')` — the label to render,
    /// falling back to the localized "Unsaved draft" when the entry carries no (or a blank) label.
    public func displayLabel(_ resolve: DraftRestoreResolve) -> String {
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return resolve("draft.recovery.fallbackLabel", DraftRestoreConstants.fallbackLabel)
        }
        return label
    }
}

// MARK: - Draft index reducers (web mount eval + re-sync + discard)

/// The pure reducers over the draft index — the port of the web surface's list behaviour:
///   • `surfaced(all:activeKeys:)` — the mount-time `all.filter(d => !activeKeys.has(d.storageKey))`:
///     drop any draft whose key a sibling tab announced it is actively editing, leaving the rest in
///     order. De-dupes by `storageKey` so a noisy index can never double-list a draft.
///   • `removing(storageKey:from:)` — the per-row `handleDiscard`: drop the discarded entry, keep order.
///   • `reconcile(previous:fresh:)` — the `subscribeDraftIndex` handler: project the currently-shown
///     rows onto a fresh index snapshot, dropping rows that vanished (e.g. discarded in a sibling tab)
///     while preserving the on-screen order. Pure + public so every branch is unit-tested without a
///     store.
public enum DraftIndex {
    /// Web mount filter: keep drafts whose key is NOT in the actively-edited set; de-dupe by key.
    public static func surfaced(
        all: [DraftEntry],
        activeKeys: Set<String>
    ) -> [DraftEntry] {
        var seen = Set<String>()
        var out: [DraftEntry] = []
        for entry in all where !activeKeys.contains(entry.storageKey) && !seen.contains(entry.storageKey) {
            seen.insert(entry.storageKey)
            out.append(entry)
        }
        return out
    }

    /// Web `handleDiscard`: drop the entry whose `storageKey` matches, leaving the rest in order.
    public static func removing(
        storageKey: String,
        from drafts: [DraftEntry]
    ) -> [DraftEntry] {
        drafts.filter { $0.storageKey != storageKey }
    }

    /// Web `subscribeDraftIndex` handler: map the currently-shown rows onto the fresh index snapshot,
    /// dropping any row no longer present (keeping on-screen order). When the fresh snapshot has a newer
    /// copy of a still-present row (e.g. re-saved), the fresh copy is used.
    public static func reconcile(
        previous: [DraftEntry],
        fresh: [DraftEntry]
    ) -> [DraftEntry] {
        let freshByKey = Dictionary(fresh.map { ($0.storageKey, $0) }, uniquingKeysWith: { first, _ in first })
        return previous.compactMap { freshByKey[$0.storageKey] }
    }

    /// Coalesces an index snapshot into a valid list — preserves order, drops later duplicates by key.
    /// The source already emits a de-duped list, but normalising here keeps the model resilient.
    public static func normalize(_ drafts: [DraftEntry]) -> [DraftEntry] {
        surfaced(all: drafts, activeKeys: [])
    }
}

// MARK: - Relative time (verbatim port of the web `formatRelativeTime`)

/// The "Saved {when}" relative-time string — the faithful port of the web `formatRelativeTime` used by
/// the row (`web/src/lib/dateFormat.ts`): "Just now" under a minute, "{n}m ago" under an hour, "{n}h
/// ago" under a day, else a localized "MMM d, hh:mm a" absolute date. Pure (takes `now` + a resolver +
/// a locale) so every bucket is asserted without the wall clock, and every relative label resolves
/// through the P1/S10 facade rather than a hardcoded literal.
public enum DraftRestoreRelativeTime {
    public static func string(
        for savedAt: Date,
        now: Date,
        resolve: DraftRestoreResolve,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let diffSeconds = now.timeIntervalSince(savedAt)
        let diffMinutes = Int(floor(diffSeconds / 60))

        if diffMinutes < 1 {
            return resolve("draft.recovery.justNow", "Just now")
        }
        if diffMinutes < 60 {
            return tokenized(resolve("draft.recovery.minutesAgo", "{{count}}m ago"), count: diffMinutes)
        }
        let diffHours = diffMinutes / 60
        if diffHours < 24 {
            return tokenized(resolve("draft.recovery.hoursAgo", "{{count}}h ago"), count: diffHours)
        }
        return absolute(savedAt, locale: locale, timeZone: timeZone)
    }

    /// Web else-branch: `toLocaleDateString(locale, { month:'short', day:'numeric', hour:'2-digit',
    /// minute:'2-digit' })` — e.g. "Apr 4, 02:30 AM".
    private static func absolute(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMdhhmma")
        return formatter.string(from: date)
    }

    private static func tokenized(_ template: String, count: Int) -> String {
        DraftRestoreInterpolation.substitute(template, token: "count", value: String(count))
    }
}

// MARK: - Interpolation (web i18next `{{token}}`)

/// The web i18next `{{token}}` substitution — replaces `{{name}}` (with optional surrounding spaces,
/// `{{ name }}`) in a resolved template. Used for the "Saved {{when}}" line and the "{{count}} unsaved
/// draft(s)" body so the native facade strings carry the same placeholders the web catalog does.
public enum DraftRestoreInterpolation {
    public static func substitute(_ template: String, token: String, value: String) -> String {
        var out = template
        for candidate in ["{{\(token)}}", "{{ \(token) }}"] {
            out = out.replacingOccurrences(of: candidate, with: value)
        }
        return out
    }
}

// MARK: - Prompt body (web count-pluralised `draft.recovery.promptBody`)

/// The toast's body line — the port of the web i18next count plural
/// (`defaultValue_one` / `defaultValue_other`): one draft → "You have 1 unsaved draft from a previous
/// session."; otherwise "…drafts…". Selects the `.one` / `.other` key by count and substitutes the
/// `{{count}}` placeholder. Pure so both branches are asserted.
public enum DraftRestorePromptBody {
    public static func text(count: Int, resolve: DraftRestoreResolve) -> String {
        let template = count == 1
            ? resolve(
                "draft.recovery.promptBody.one",
                "You have {{count}} unsaved draft from a previous session."
            )
            : resolve(
                "draft.recovery.promptBody.other",
                "You have {{count}} unsaved drafts from a previous session."
            )
        return DraftRestoreInterpolation.substitute(template, token: "count", value: String(count))
    }
}

// MARK: - Saved-at line (web `t('draft.recovery.savedAt', 'Saved {{when}}', { when })`)

/// Builds the row's "Saved {when}" caption — the web `t('draft.recovery.savedAt', 'Saved {{when}}',
/// { when: formatRelativeTime(savedAt) })`. Resolves the relative-time `when`, then substitutes it into
/// the localized "Saved {{when}}" template.
public enum DraftRestoreSavedAt {
    public static func text(
        for savedAt: Date,
        now: Date,
        resolve: DraftRestoreResolve,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let when = DraftRestoreRelativeTime.string(
            for: savedAt,
            now: now,
            resolve: resolve,
            locale: locale,
            timeZone: timeZone
        )
        let template = resolve("draft.recovery.savedAt", "Saved {{when}}")
        return DraftRestoreInterpolation.substitute(template, token: "when", value: when)
    }
}

// MARK: - Resume route (web `navigate(entry.route)`)

/// Normalises a draft's resume target — the native port of the web `navigate(entry.route)` (with its
/// `DEFAULT_FALLBACK.route = '/'` for a missing route). Returns the entry's route, or "/" when it is
/// empty/blank, so the host always receives a valid in-app pathname to route to.
public enum DraftRestoreResumeRoute {
    public static func normalize(_ route: String) -> String {
        let trimmed = route.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? DraftRestoreConstants.fallbackRoute : trimmed
    }

    public static func normalize(for entry: DraftEntry) -> String {
        normalize(entry.route)
    }
}

// MARK: - Accessibility (testable seams)

/// Builds the surface's VoiceOver labels from already-localised parts, so the spoken content is
/// asserted without rendering. The toast mirrors the web `role="status"` / `aria-live="polite"` region
/// (title + body, read in one pass); the row controls mirror the web per-row `<button>`s, naming the
/// draft they act on ("Resume {label}" / "Discard {label}") so a screen-reader user knows which draft a
/// control affects.
public enum DraftRestoreAccessibility {
    /// "{title}. {body}" — joined so a terminal period is never doubled and empty parts are skipped.
    public static func promptLabel(title: String, body: String) -> String {
        join(title, body)
    }

    /// "{action} {label}" — e.g. "Resume Alert rule draft". Falls back to the bare action when the
    /// label is empty so the control is never unlabelled.
    public static func actionLabel(action: String, label: String) -> String {
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedLabel.isEmpty {
            return action
        }
        return "\(action) \(trimmedLabel)"
    }

    private static func join(_ lhs: String, _ rhs: String) -> String {
        guard !rhs.isEmpty else { return lhs }
        guard !lhs.isEmpty else { return rhs }
        let endsWithTerminal = lhs.last.map { ".!?".contains($0) } ?? false
        return lhs + (endsWithTerminal ? " " : ". ") + rhs
    }
}
