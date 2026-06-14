//
//  ReleaseNotes.swift
//  TeslaSync — P4 shared surface · 0135 · ReleaseNotes (Apple)
//
//  The public API of the release-notes accordion — the SwiftUI parity of
//  `components/feedback/ReleaseNotes.tsx`. Like the web component it renders the newest `limit` releases
//  from the changelog as a vertical stack of collapsible cards (single-open: one release expanded at a
//  time, the first by default), each revealing its "What's New" change list on demand. The view binds
//  through ``ReleaseNotesModel`` for the open-state interaction + the once-only `view.opened` telemetry
//  (P1/S11), composes the token-driven chrome (P1/S9), honors Reduce Motion at the open/close boundary, and
//  pushes prop changes into the holder via `.onChange` so a reused / re-bound list re-renders faithfully.
//  No networking (the web reads a static generated module), no Tailwind ports.
//

import SwiftUI

/// The release-notes accordion — the SwiftUI parity of `components/feedback/ReleaseNotes.tsx`. Renders the
/// newest `limit` releases (default 3) as collapsible glass cards; the first is expanded on appear and
/// tapping a header opens that release while collapsing any other (the web single-open `expanded` state).
/// When there are no releases to show it renders a friendly empty state rather than a blank space. Mount it
/// in an About / Settings surface to show users what changed.
public struct ReleaseNotes: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        ReleaseNotesSurface.slug
    }

    private let input: ReleaseNotesInput
    @State private var model: ReleaseNotesModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<ReleaseNotes limit={3} />`. The changelog defaults to
    /// the built-in canonical snapshot (the native peer of the web static `@/generated/changelog` import);
    /// a host with the live generated changelog threads it in via `entries`. `limit` caps the rendered
    /// releases newest-first (web `CHANGELOG.slice(0, limit)`).
    public init(
        entries: [ReleaseNotesEntry] = ReleaseNotesData.canonical,
        limit: Int = ReleaseNotesProjector.defaultLimit,
        telemetry: any ReleaseNotesTelemetry = OSLogReleaseNotesTelemetry()
    ) {
        let resolved = ReleaseNotesInput(entries: entries, limit: limit)
        input = resolved
        _model = State(initialValue: ReleaseNotesModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded open state).
    public init(model: ReleaseNotesModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.projection.isEmpty {
                ReleaseNotesEmptyState()
            } else {
                VStack(spacing: TSSpacing.md) {
                    ForEach(model.projection.cards) { card in
                        ReleaseCard(
                            card: card,
                            onToggle: { model.toggle(version: card.version) },
                            reduceMotion: reduceMotion
                        )
                    }
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput)
        }
    }
}
