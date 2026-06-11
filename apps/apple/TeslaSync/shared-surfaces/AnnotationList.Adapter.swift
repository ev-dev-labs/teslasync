//
//  AnnotationList.Adapter.swift
//  TeslaSync — P4 shared surface · 0063 · AnnotationList (Apple)
//
//  The testable, dependency-light core for the chart-annotation list — the SwiftUI parity of
//  `components/charts/AnnotationList.tsx`. Everything here is pure (Foundation only): the annotation
//  category (the verbatim port of the web `AnnotationCategory` union + its `ANNOTATION_COLORS`
//  swatch + `ANNOTATION_CATEGORY_LABELS` name), the projected display row, the data-availability +
//  P4 connectivity axes, the empty-collapse policy (the faithful port of the web
//  `annotations.length === 0 → null`), the surface metadata (diagnostics slug), the `#rrggbb`
//  decoder, and the VoiceOver label builders. No store, no bundle, no rendered view, so each piece
//  is unit tested in isolation.
//
//  Parity note: the web component takes the already-fetched `annotations` + an `onRemove` callback
//  (its only hook is `useTranslation`) and renders `null` when the list is empty. This core
//  reproduces that data contract — the rows, the per-category swatch, the remove affordance — and
//  adds the P4 leaf axes (loading / error / stale / offline) the native shared surface renders over
//  it so the surface is never a blank box.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core + projection have no dependency
/// on a bundle: the production app passes the P1/S10 facade (`AnnotationListStrings.string`), while
/// tests and the isolated harness pass the identity (fallback) resolver.
public typealias AnnotationListResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Category (web `AnnotationCategory` + `ANNOTATION_COLORS` + `ANNOTATION_CATEGORY_LABELS`)

/// One annotation category — the native parity of the web `AnnotationCategory` union. The order
/// mirrors the web type declaration so any category-keyed rendering stays identical.
public enum AnnotationListCategory: String, Sendable, Equatable, CaseIterable, Identifiable {
    case milestone
    case maintenance
    case trip
    case issue
    case upgrade
    case custom

    public var id: String {
        rawValue
    }

    /// The declaration order of the web `AnnotationCategory` union / `ANNOTATION_CATEGORY_LABELS`.
    public static let order: [AnnotationListCategory] = [
        .milestone, .maintenance, .trip, .issue, .upgrade, .custom
    ]

    /// The verbatim `ANNOTATION_COLORS[<id>]` swatch (web `web/src/types/annotations.ts`). Applied
    /// at the SwiftUI boundary as a dynamic, per-category dot tint — decoded by ``AnnotationListPalette``.
    public var colorHex: String {
        switch self {
        case .milestone: "#3b82f6"
        case .maintenance: "#f59e0b"
        case .trip: "#22c55e"
        case .issue: "#ef4444"
        case .upgrade: "#a855f7"
        case .custom: "#94a3b8"
        }
    }

    /// The i18n key for the human-readable category name (the native key for the web
    /// `ANNOTATION_CATEGORY_LABELS[<id>]` map). The web list renders only the colour swatch, so this
    /// name is spoken to VoiceOver users in place of the colour they cannot see.
    public var labelKey: String {
        "annotation.cat.\(rawValue)"
    }

    /// The English fallback for ``labelKey`` — the verbatim `ANNOTATION_CATEGORY_LABELS[<id>]` value.
    public var labelFallback: String {
        switch self {
        case .milestone: "Milestone"
        case .maintenance: "Maintenance"
        case .trip: "Trip"
        case .issue: "Issue"
        case .upgrade: "Upgrade"
        case .custom: "Custom"
        }
    }
}

// MARK: - Annotation row (web `DataAnnotation`, projected for display)

/// One annotation as the list needs it — the display-facing subset of the web `DataAnnotation`
/// (`id`, `label`, optional `description`, the pre-formatted `timestamp`, and the `category`). The
/// host projects its fetched rows onto this shape (the native peer of `toDataAnnotation`); the
/// `timestamp` is carried as a display string verbatim, exactly as the web renders `{ann.timestamp}`.
public struct AnnotationListItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let description: String?
    public let timestamp: String
    public let category: AnnotationListCategory

    public init(
        id: String,
        label: String,
        timestamp: String,
        category: AnnotationListCategory,
        description: String? = nil
    ) {
        self.id = id
        self.label = label
        self.timestamp = timestamp
        self.category = category
        self.description = description
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the annotation snapshot — the orthogonal connectivity axis the populated list
/// renders as a freshness chip. `live` shows the rows alone; `stale` adds a refresh affordance and
/// triggers a one-shot auto-refresh; `offline` keeps the last-known rows with an offline marker.
public enum AnnotationListConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Data availability (web parent fetch lifecycle)

/// The resolution state of the annotation data the web parent fetches before handing the list its
/// `annotations` prop. `loading` shows skeleton chrome; `failed` shows a retry affordance (the
/// `QueryError` peer); `resolved` carries the rows the web component would receive.
public enum AnnotationListAvailability: Sendable, Equatable {
    case loading
    case failed(String)
    case resolved([AnnotationListItem])
}

// MARK: - Empty-collapse policy (web `annotations.length === 0 → null`)

/// How the surface treats a resolved-but-empty list. `emptyState` (the P4 default) renders a
/// friendly empty state so the standalone shared surface is never a blank box; `withdraw` reproduces
/// the web component's exact `if (annotations.length === 0) return null` collapse for chart-embedded
/// use where an empty list should occupy no space.
public enum AnnotationListEmptyBehavior: String, Sendable, Equatable, CaseIterable {
    case emptyState
    case withdraw
}

// MARK: - Input snapshot (coalesced surface inputs)

/// One coalesced snapshot of the surface's inputs — the data availability (web parent fetch), the
/// P4 connectivity axis, and the empty-collapse policy. The view binds the model over this; the
/// projection is a pure function of it.
public struct AnnotationListInput: Sendable, Equatable {
    public var availability: AnnotationListAvailability
    public var connection: AnnotationListConnection
    public var emptyBehavior: AnnotationListEmptyBehavior

    public init(
        availability: AnnotationListAvailability = .loading,
        connection: AnnotationListConnection = .live,
        emptyBehavior: AnnotationListEmptyBehavior = .emptyState
    ) {
        self.availability = availability
        self.connection = connection
        self.emptyBehavior = emptyBehavior
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum AnnotationListMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AnnotationList"
}

// MARK: - Colour decoder (`#rrggbb` → sRGB components)

/// Decodes the `ANNOTATION_COLORS` `#rrggbb` swatch into linearised sRGB components in `0...1`. Pure
/// + bundle-free so the colour parity with the web palette is asserted without rendering a view; the
/// SwiftUI boundary builds a `Color(.sRGB, …)` from the result and falls back to the accent token
/// when a value is malformed.
public enum AnnotationListPalette {
    public struct Components: Sendable, Equatable {
        public let red: Double
        public let green: Double
        public let blue: Double

        public init(red: Double, green: Double, blue: Double) {
            self.red = red
            self.green = green
            self.blue = blue
        }
    }

    /// Parse a `#rrggbb` (or bare `rrggbb`) hex into sRGB components, or `nil` when malformed.
    public static func components(forHex hex: String) -> Components? {
        var value = hex.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("#") {
            value.removeFirst()
        }
        guard value.count == 6, let rgb = UInt32(value, radix: 16) else {
            return nil
        }
        return Components(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view. The web list shows the category only as a colour swatch and
/// gives the remove control the bare `aria-label`; the native labels fold in the category name and
/// the annotation label so a non-sighted user gets the same information a sighted one reads.
public enum AnnotationListAccessibility {
    /// A row's combined label: "{category}: {label}. {description}. {timestamp}" — the optional
    /// description segment is dropped when absent (the web hides it on small screens).
    public static func rowLabel(
        category: String,
        label: String,
        description: String?,
        timestamp: String
    ) -> String {
        var parts = ["\(category): \(label)"]
        if let description, !description.isEmpty {
            parts.append(description)
        }
        parts.append(timestamp)
        return parts.joined(separator: ". ")
    }

    /// The remove control's label: the web `aria-label` ("Remove annotation") plus the annotation
    /// label so VoiceOver announces which row the action targets.
    public static func removeLabel(base: String, label: String) -> String {
        label.isEmpty ? base : "\(base): \(label)"
    }
}
