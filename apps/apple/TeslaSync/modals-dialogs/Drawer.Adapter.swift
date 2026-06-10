//
//  Drawer.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0013 · Drawer (Apple)
//
//  The testable projection core for the slide-in side panel — the faithful port of
//  components/ui/Drawer.tsx. The web source is a portal-rendered, purely-presentational drawer:
//  `role="dialog" aria-modal` over a tap-to-dismiss backdrop, a spring panel that slides in from a
//  side (`side` 'left' | 'right', default 'right'), an optional titled header with a close "×", a
//  scrollable body (`children`), and an optional footer. It has no data lifecycle of its own — the
//  loading / empty / error / stale / offline states belong to whatever `children` it hosts. This
//  surface widens that web children-delegated lifecycle into the prompt-mandated state envelope so the
//  panel ALWAYS renders something (never a blank box), driven by the `DrawerSource` seam (P1/S8).
//
//  Everything here is pure and dependency-free (Foundation only) so the projection — the `side` → edge
//  mapping (web 'left' | 'right' default 'right'), the phase resolution (keeping cached rows visible
//  through a failed reload), the reload-failure banner, and the `aria-label` (web `title || 'Panel'`)
//  — can be unit-tested without a store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • `side` ('left' | 'right', default 'right')   → `DrawerEdge.leading` / `.trailing`.
//    • `children` (ReactNode body)                  → `[DrawerContentItem]` label/value rows.
//    • `aria-label={title || 'Panel'}`              → `DrawerProjection.dialogLabel`.
//    • the children's own load lifecycle            → `DrawerLoadStatus` / `DrawerPhase` envelope.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it without a bundle.
public enum DrawerSurface {
    public static let slug = "Drawer"
}

// MARK: - Edge (web `side`)

/// The side the panel anchors to and slides from — the native parity of the web `side` prop. The web
/// default is `'right'`; any value that is not `'left'` resolves to `.trailing` (the web `||` default).
public enum DrawerEdge: String, Sendable, Equatable, CaseIterable {
    case leading
    case trailing

    /// Maps the web `side` string ('left' | 'right', default 'right') onto a layout edge. Mirrors the
    /// web default `side = 'right'` and its `side === 'right' ? … : …` fork: only an explicit, case-
    /// insensitive `'left'` anchors leading; everything else (incl. an unknown value) anchors trailing.
    public static func from(web side: String?) -> DrawerEdge {
        side?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "left" ? .leading : .trailing
    }
}

// MARK: - Content row (web `children`)

/// One label/value row in the panel body — the native, concretely-rendered stand-in for the web
/// `children` slot. The web container hosts arbitrary content; the surface binds a representative
/// detail body so every state has something real to render (and the empty / loading / error envelopes
/// have a shape to replace).
public struct DrawerContentItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String

    public init(id: String, label: String, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the panel body. The web container has no load state of its own;
/// the native surface models the hosted body's lifecycle here so every state renders.
public enum DrawerLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the header freshness chip + the cached-data banner so the
/// panel clearly labels when its body may be momentarily out of date.
public enum DrawerConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the panel body should render. The loading / empty / error envelopes are added on top of the
/// web container so the first-resolve, no-rows, and load-failure cases never render a blank panel.
public enum DrawerPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: the `side` → edge mapping, the phase
/// resolution (keeping cached rows visible through a failed reload), the reload-failure banner, the
/// `aria-label` (`title || 'Panel'`), and the footer count copy. Copy resolves through an injected
/// localizer so it stays bundle-free.
public enum DrawerProjection {
    /// Resolves the body phase. Loading shows only before the first rows resolve; a resolved no-rows
    /// state shows the empty envelope; a load failure with no cached rows shows the error state; once
    /// rows are on hand they stay on screen through a reload (freshness shown by the chip / banner) so
    /// a transient failure never blanks the body — the web "keep showing children" behaviour widened.
    public static func resolvePhase(status: DrawerLoadStatus, hasItems: Bool) -> DrawerPhase {
        switch status {
        case .loading:
            hasItems ? .content : .loading
        case .loaded:
            hasItems ? .content : .empty
        case let .failed(message):
            hasItems ? .content : .error(message)
        }
    }

    /// The reload-failure message kept while cached rows remain on screen, so the content branch can
    /// surface the inline banner above the body (web reload-failure-with-cached-children). `nil` unless
    /// the latest status failed AND rows are still shown.
    public static func reloadFailure(status: DrawerLoadStatus, hasItems: Bool) -> String? {
        guard hasItems, case let .failed(message) = status else { return nil }
        return message
    }

    /// The dialog's accessible label — the verbatim port of the web `aria-label={title || 'Panel'}`:
    /// a non-empty title labels the dialog, else the localized `'Panel'` fallback.
    public static func dialogLabel(title: String?, localize: (String, String) -> String) -> String {
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return title
        }
        return localize("drawer.panel", "Panel")
    }

    /// The footer's item-count summary (web a footer slot; here a real count line). Singular/plural
    /// resolved through the catalog so it translates.
    public static func countSummary(_ count: Int, localize: (String, String) -> String) -> String {
        let key = count == 1 ? "drawer.summary.countOne" : "drawer.summary.countOther"
        let fallback = count == 1 ? "{{count}} item" : "{{count}} items"
        return localize(key, fallback).replacingOccurrences(of: "{{count}}", with: String(count))
    }
}
