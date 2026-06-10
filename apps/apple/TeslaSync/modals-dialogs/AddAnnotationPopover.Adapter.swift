//
//  AddAnnotationPopover.Adapter.swift
//  TeslaSync — P4 modal/dialog · 0002 · AddAnnotationPopover (Apple)
//
//  The testable projection core for the add-annotation dialog — the faithful port of
//  components/charts/AddAnnotationPopover.tsx. The web source is a `Modal` wrapping a small form:
//  an optional editable date (`<input type="date">`) or a read-only timestamp, a required label
//  input, a row of six category pills (milestone / maintenance / trip / issue / upgrade / custom)
//  each with its lucide glyph + `ANNOTATION_COLORS` tint, an optional description input, and the
//  Cancel / Add-Annotation actions. Everything here is pure and dependency-free (Foundation only)
//  so the projection — phase resolution, the category catalog + colors, the date normalisation
//  (`toDateInputValue` / `toIsoTimestamp`), the submit validation, and the draft assembly — can be
//  unit-tested without a store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • `toDateInputValue(timestamp)`  → `AddAnnotationDateValue.inputValue(fromTimestamp:)`.
//    • `toIsoTimestamp(date)`         → `AddAnnotationDateValue.isoTimestamp(fromInputValue:)`.
//    • `CATEGORY_OPTIONS` + `ANNOTATION_COLORS` → `AddAnnotationCategory` + `.option`.
//    • `handleSubmit` guard `if (!label.trim()) return` + `if (!occurredAt) return`
//      → `AddAnnotationProjection.canSubmit` / `.draft(...)`.
//    • The web always renders the form; `resolvePhase` widens that into the prompt-required
//      loading / empty / error envelopes so no state is ever a blank panel.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core
/// so the projection's unit tests can reach it.
public enum AddAnnotationSurface {
    public static let slug = "AddAnnotationPopover"
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the annotation draft context (the target timestamp + whether
/// the date is editable). The web reads its context synchronously from props; the native surface
/// models the load lifecycle here so every state renders.
public enum AddAnnotationLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the
/// dialog clearly labels when a saved annotation may not have synced yet.
public enum AddAnnotationConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render at the top level. The web only ever shows the form; the loading
/// + empty + error envelopes are added so the first-open, no-target, and context-failure cases
/// never render a blank panel.
public enum AddAnnotationPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Category (web `AnnotationCategory` + `CATEGORY_OPTIONS` + `ANNOTATION_COLORS`)

/// One annotation category — the native parity of the web `AnnotationCategory` union. Order matches
/// the web `CATEGORY_OPTIONS` array so the pill row renders identically.
public enum AddAnnotationCategory: String, Sendable, Equatable, CaseIterable, Identifiable {
    case milestone
    case maintenance
    case trip
    case issue
    case upgrade
    case custom

    public var id: String {
        rawValue
    }

    /// The display order (web `CATEGORY_OPTIONS`).
    public static let order: [AddAnnotationCategory] = [
        .milestone, .maintenance, .trip, .issue, .upgrade, .custom
    ]
}

/// A display-ready category descriptor: the i18n key + web English fallback for the pill label, the
/// SF Symbol that stands in for the web lucide glyph, and the `ANNOTATION_COLORS` hex used to tint
/// the selected pill (a dynamic, per-category value — applied at the SwiftUI boundary).
public struct AddAnnotationCategoryOption: Sendable, Equatable, Identifiable {
    public let category: AddAnnotationCategory
    public let labelKey: String
    public let labelFallback: String
    public let systemImage: String
    public let colorHex: String

    public var id: String {
        category.rawValue
    }

    public init(
        category: AddAnnotationCategory,
        labelKey: String,
        labelFallback: String,
        systemImage: String,
        colorHex: String
    ) {
        self.category = category
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.systemImage = systemImage
        self.colorHex = colorHex
    }
}

public extension AddAnnotationCategory {
    /// This category's display descriptor. Labels mirror `t('annotation.cat.<id>', '<Label>')`; the
    /// glyph maps the web lucide icon to its closest SF Symbol; the hex is the verbatim
    /// `ANNOTATION_COLORS[<id>]` value.
    var option: AddAnnotationCategoryOption {
        switch self {
        case .milestone:
            .init(
                category: .milestone,
                labelKey: "annotation.cat.milestone",
                labelFallback: "Milestone",
                systemImage: "flag.fill",
                colorHex: "#3b82f6"
            )
        case .maintenance:
            .init(
                category: .maintenance,
                labelKey: "annotation.cat.maintenance",
                labelFallback: "Maintenance",
                systemImage: "wrench.and.screwdriver.fill",
                colorHex: "#f59e0b"
            )
        case .trip:
            .init(
                category: .trip,
                labelKey: "annotation.cat.trip",
                labelFallback: "Trip",
                systemImage: "mappin.circle.fill",
                colorHex: "#22c55e"
            )
        case .issue:
            .init(
                category: .issue,
                labelKey: "annotation.cat.issue",
                labelFallback: "Issue",
                systemImage: "exclamationmark.triangle.fill",
                colorHex: "#ef4444"
            )
        case .upgrade:
            .init(
                category: .upgrade,
                labelKey: "annotation.cat.upgrade",
                labelFallback: "Upgrade",
                systemImage: "arrow.up.circle.fill",
                colorHex: "#a855f7"
            )
        case .custom:
            .init(
                category: .custom,
                labelKey: "annotation.cat.custom",
                labelFallback: "Custom",
                systemImage: "tag.fill",
                colorHex: "#94a3b8"
            )
        }
    }
}

// MARK: - Date normalisation (web `toDateInputValue` / `toIsoTimestamp`)

/// The pure date helpers the dialog uses, ported verbatim from the web source. All formatting is
/// UTC so the `YYYY-MM-DD` value matches the web `<input type="date">` (which is timezone-free).
public enum AddAnnotationDateValue {
    /// `^\d{4}-\d{2}-\d{2}$` — the web shape guard.
    public static func isDateOnly(_ value: String) -> Bool {
        guard value.count == 10 else { return false }
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return false }
        let widths = [4, 2, 2]
        for (part, width) in zip(parts, widths) {
            guard part.count == width, part.allSatisfy(\.isNumber) else { return false }
        }
        return true
    }

    /// Port of `toDateInputValue`: normalise any ISO-ish timestamp into the `YYYY-MM-DD` value the
    /// date field expects. Returns an empty string when parsing fails so the field renders empty.
    public static func inputValue(fromTimestamp timestamp: String) -> String {
        guard !timestamp.isEmpty else { return "" }
        if let date = parse(timestamp) {
            return formatDateOnly(date)
        }
        // Already in YYYY-MM-DD shape that the parser couldn't read — accept verbatim, else empty.
        return isDateOnly(timestamp) ? timestamp : ""
    }

    /// Inverse of `inputValue(fromTimestamp:)` — port of `toIsoTimestamp`: pin a `YYYY-MM-DD` value
    /// to UTC midnight. Returns an empty string for an empty or malformed value.
    public static func isoTimestamp(fromInputValue date: String) -> String {
        guard !date.isEmpty, isDateOnly(date) else { return "" }
        return "\(date)T00:00:00Z"
    }

    /// Parses a `YYYY-MM-DD` value into the `Date` the SwiftUI `DatePicker` binds to (UTC midnight),
    /// or `nil` when the value is malformed.
    public static func date(fromInputValue value: String) -> Date? {
        guard isDateOnly(value) else { return nil }
        return parse(value)
    }

    /// Formats a `Date` back to the `YYYY-MM-DD` value (UTC), for the `DatePicker` → field bridge.
    public static func inputValue(fromDate date: Date) -> String {
        formatDateOnly(date)
    }

    // MARK: Internals

    /// Accepts a full ISO-8601 timestamp (with/without fractional seconds) or a bare `YYYY-MM-DD`
    /// date, both interpreted in UTC — the realistic inputs the chart hands this dialog.
    private static func parse(_ value: String) -> Date? {
        let isoPlain = ISO8601DateFormatter()
        isoPlain.formatOptions = [.withInternetDateTime]
        if let date = isoPlain.date(from: value) { return date }
        let isoFractional = ISO8601DateFormatter()
        isoFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = isoFractional.date(from: value) { return date }
        return dateOnlyFormatter().date(from: value)
    }

    private static func formatDateOnly(_ date: Date) -> String {
        dateOnlyFormatter().string(from: date)
    }

    /// A fresh UTC `yyyy-MM-dd` formatter. Built per call rather than cached so the helper stays a
    /// pure value type under Swift 6 strict concurrency (`DateFormatter` is non-`Sendable`).
    private static func dateOnlyFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
}

// MARK: - Draft context + submitted draft

/// The draft context a source resolves: the timestamp the chart click anchored to (web `timestamp`
/// prop) and whether the date is user-editable (web `editableDate` prop). The native surface models
/// this as loadable so the dialog can show loading / empty / error before the form.
public struct AddAnnotationDraftContext: Sendable, Equatable {
    public let timestamp: String
    public let editableDate: Bool

    public init(timestamp: String, editableDate: Bool) {
        self.timestamp = timestamp
        self.editableDate = editableDate
    }
}

/// The validated payload handed to the controller on submit — the native parity of the web
/// `onAdd(label, category, description?, occurredAt)` call.
public struct AddAnnotationDraft: Sendable, Equatable {
    public let label: String
    public let category: AddAnnotationCategory
    public let description: String?
    public let occurredAt: String

    public init(label: String, category: AddAnnotationCategory, description: String?, occurredAt: String) {
        self.label = label
        self.category = category
        self.description = description
        self.occurredAt = occurredAt
    }
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: phase resolution, the resolved
/// `occurredAt`, the submit-enabled predicate, and the validated draft assembly.
public enum AddAnnotationProjection {
    /// Resolves the render phase. Loading shows only before the context resolves; a resolved context
    /// with no usable target (no editable date and no valid timestamp) shows the empty state; a
    /// failure with no cached context shows the error state; once a context is on hand the form
    /// stays on screen (freshness shown by the chip/banner).
    public static func resolvePhase(
        status: AddAnnotationLoadStatus,
        context: AddAnnotationDraftContext?
    ) -> AddAnnotationPhase {
        switch status {
        case .loading:
            return context == nil ? .loading : .content
        case .loaded:
            guard let context else { return .empty }
            return hasUsableTarget(context) ? .content : .empty
        case let .failed(message):
            return context == nil ? .error(message) : .content
        }
    }

    /// Whether a resolved context can be annotated: an editable date always can (the user picks the
    /// day), else the fixed timestamp must normalise to a real `YYYY-MM-DD` (web guard).
    public static func hasUsableTarget(_ context: AddAnnotationDraftContext) -> Bool {
        if context.editableDate { return true }
        return !AddAnnotationDateValue.inputValue(fromTimestamp: context.timestamp).isEmpty
    }

    /// The `occurredAt` the web `handleSubmit` computes: the edited date pinned to UTC midnight when
    /// editable, else the fixed timestamp verbatim.
    public static func occurredAt(
        editableDate: Bool,
        editedDate: String,
        timestamp: String
    ) -> String {
        editableDate ? AddAnnotationDateValue.isoTimestamp(fromInputValue: editedDate) : timestamp
    }

    /// The web submit guard: a non-empty trimmed label AND a non-empty resolved `occurredAt`.
    public static func canSubmit(label: String, occurredAt: String) -> Bool {
        !label.trimmed.isEmpty && !occurredAt.isEmpty
    }

    /// Assembles the validated draft, or `nil` when the guard fails. Mirrors the web
    /// `onAdd(label.trim(), category, description.trim() || undefined, occurredAt)`.
    public static func draft(
        label: String,
        category: AddAnnotationCategory,
        description: String,
        occurredAt: String
    ) -> AddAnnotationDraft? {
        let trimmedLabel = label.trimmed
        guard !trimmedLabel.isEmpty, !occurredAt.isEmpty else { return nil }
        let trimmedDescription = description.trimmed
        return AddAnnotationDraft(
            label: trimmedLabel,
            category: category,
            description: trimmedDescription.isEmpty ? nil : trimmedDescription,
            occurredAt: occurredAt
        )
    }
}

// MARK: - Small helpers

extension String {
    /// Whitespace/newline-trimmed copy (web `String.prototype.trim`).
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
