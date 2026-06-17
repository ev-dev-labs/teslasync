//
//  QuietHoursPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/QuietHours (Apple) — View Model
//
//  The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
//
//  The web `QuietHoursPage` (`web/src/features/notifications/pages/QuietHoursPage.tsx`) owns no
//  fetch of its own: it is a `PageContainer` (title + subtitle + `copyLink`) wrapper that hosts the
//  `<AIQuietHoursSuggestion/>` advisor above the `<QuietHoursPanel/>` schedule editor, and threads a
//  single piece of local state between them — the AI advisor's "Apply to form" hands a proposed
//  window to the panel's draft form via `seedDraft`/`onSeedConsumed` (the propose-only contract,
//  ADR-015 §I8 — the panel's own Save button stays the sole write path).
//
//  This model mirrors that exactly. It exposes the two web i18n keys the page renders and owns the
//  two already-shipped child surfaces' `@Observable` models (their own Apple parity units, reused not
//  re-implemented — DRY): the `QuietHoursSuggestionModel` advisor and the `QuietHoursModel` panel.
//  The seed hand-off is wired at construction — the advisor's `onApply` callback (web `onApplyDraft`)
//  forwards the captured `QuietHoursWindowPatch` straight into `panel.seed(from:)`, so a fresh model
//  reference replaces the web `pendingSeed` round-trip without any networking in the view.
//

import Observation
import SwiftUI

@MainActor
@Observable
public final class QuietHoursPageModel {
    /// Web route `/notifications/quiet-hours` (`web/src/App.tsx`). Kept as a constant so the
    /// copy-link share URL and the navigation registration agree on one canonical path.
    public static let routePath = "/notifications/quiet-hours"

    /// Web `t('notifications.quietHours.title', 'Quiet hours')`.
    public let titleKey: LocalizedStringKey = "notifications.quietHours.title"

    /// Web `t('notifications.quietHours.subtitle', 'Suppress non-critical notifications …')`.
    public let subtitleKey: LocalizedStringKey = "notifications.quietHours.subtitle"

    /// The "Suggest a quiet-hours window" Helix advisor (web `<AIQuietHoursSuggestion/>`).
    public let advisor: QuietHoursSuggestionModel

    /// The quiet-hours / Do-Not-Disturb schedule editor (web `<QuietHoursPanel/>`).
    public let panel: QuietHoursModel

    public init(
        panelSource: (any QuietHoursSource)? = nil,
        suggestionSource: (any QuietHoursSuggestionSource)? = nil,
        writer: any QuietHoursWriter = OSLogQuietHoursWriter()
    ) {
        let panelModel = QuietHoursModel(
            source: panelSource ?? Self.makeSampleSource(),
            writer: writer
        )
        panel = panelModel
        advisor = QuietHoursSuggestionModel(
            source: suggestionSource ?? InMemoryQuietHoursSuggestionSource(
                initial: QuietHoursSuggestionInputSnapshot(gate: .on)
            ),
            onApply: { [weak panelModel] patch in panelModel?.seed(from: patch) }
        )
    }

    /// The shareable deep link the copy-link affordance copies — the native parity of the web
    /// `copyLink` (`window.location.href`); here the page's canonical route path.
    public var shareURL: String {
        Self.routePath
    }

    /// The page has no fetch of its own (the hosted surfaces own their query lifecycles via
    /// `start()`/`stop()` on appear/disappear); exposed for the page-scaffold async contract, it
    /// re-runs both child queries (web refetch).
    public func load() async {
        panel.refresh()
        advisor.refresh()
    }

    /// Re-runs both hosted surfaces' queries (web refetch).
    public func refresh() {
        panel.refresh()
        advisor.refresh()
    }

    /// A representative in-memory panel source so the route-registration default screen + the
    /// "Loaded" preview render a populated schedule out of the box. Production injects the shared
    /// KMP `useQuietHours` binding through the seam (ADR-004).
    private static func makeSampleSource() -> any QuietHoursSource {
        InMemoryQuietHoursSource(initial: QuietHoursUpdate(
            status: .loaded,
            items: [
                QuietHoursWindowItem(
                    id: 1,
                    enabled: true,
                    startLocal: "23:00",
                    endLocal: "07:00",
                    timezone: "Europe/London",
                    weekdays: QuietHoursWeekdays.all,
                    bypassSeverities: ["critical"]
                )
            ],
            connection: .live
        ))
    }
}

// MARK: - Seed hand-off (web `seedDraft`)

extension QuietHoursModel {
    /// Pre-fills the panel's add/edit form from the AI advisor's proposed window — the native parity
    /// of the web `QuietHoursPanel` `seedDraft` effect, driven by the advisor's "Apply to form"
    /// (`onApplyDraft` → `onApply`). Propose-only: this only opens + populates the form; the panel's
    /// own Save button stays the sole write path (ADR-015 §I8). Reproduces `startCreate()`'s
    /// open-form sequence (set draft + clear validation + recompute phase) so an open draft suppresses
    /// the empty state exactly as the web `windows.length === 0 && !draft` ladder does.
    func seed(from patch: QuietHoursWindowPatch) {
        draft = QuietHoursDraft(
            enabled: patch.enabled,
            startLocal: patch.startLocal,
            endLocal: patch.endLocal,
            timezone: patch.timezone,
            weekdays: patch.weekdays,
            bypassSeverities: patch.bypassSeverities
        )
        validationError = nil
        recomputePhase()
    }
}
