//
//  ScrollRestoration.Previews.swift
//  TeslaSync — P4 shared surface · 0173 · ScrollRestoration (Apple)
//
//  Xcode previews for the scroll-restoration surface. Because the production behavior is invisible (the
//  web component renders `return null`), the previews stage the NATIVE status surface in EVERY phase
//  (preparing / restored / freshTop / noSavedTop / unavailable), a chip gallery, plus a live, interactive
//  demo wiring the transparent ``ScrollRestoration`` companion + the ``SwiftUI/View/scrollRestoration(_:)``
//  modifier over one model and a real `ScrollView`, so the save-on-scroll + restore-on-POP behavior is
//  exercisable in the canvas. DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import SwiftUI

#if DEBUG

    /// A faux page card hosting the status surface so each phase reads in context against the app
    /// background.
    private struct ScrollRestorationPreviewStage<Content: View>: View {
        @ViewBuilder let content: Content

        var body: some View {
            content
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Color.TS.bg)
        }
    }

    #Preview("Phase — preparing") {
        ScrollRestorationPreviewStage {
            ScrollRestorationStatusView(phase: .preparing)
        }
    }

    #Preview("Phase — restored") {
        ScrollRestorationPreviewStage {
            ScrollRestorationStatusView(phase: .restored, restoreOffset: 1240)
        }
    }

    #Preview("Phase — freshTop") {
        ScrollRestorationPreviewStage {
            ScrollRestorationStatusView(phase: .freshTop, restoreOffset: 0)
        }
    }

    #Preview("Phase — noSavedTop") {
        ScrollRestorationPreviewStage {
            ScrollRestorationStatusView(phase: .noSavedTop, restoreOffset: 0)
        }
    }

    #Preview("Phase — unavailable") {
        ScrollRestorationPreviewStage {
            ScrollRestorationStatusView(phase: .unavailable, restoreOffset: 0, storeAvailable: false)
        }
    }

    #Preview("Status chips") {
        ScrollRestorationPreviewStage {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(ScrollRestorationPhase.allCases, id: \.self) { phase in
                    ScrollRestorationStatusChip(phase: phase)
                }
            }
        }
    }

    // MARK: - Live demo (scroll + navigate over a shared model)

    /// A live, interactive demo: a real `ScrollView` carrying the ``SwiftUI/View/scrollRestoration(_:)``
    /// modifier, the transparent ``ScrollRestoration`` companion driving the navigation seam, and PUSH /
    /// POP controls over a ``StaticScrollRestorationSource``. Scroll down, PUSH to another route (saves
    /// the offset), then POP back to watch the position restore.
    private struct ScrollRestorationLiveDemo: View {
        @State private var source: StaticScrollRestorationSource
        @State private var model: ScrollRestorationModel

        init() {
            let source = StaticScrollRestorationSource(
                location: ScrollRestorationLocation(path: "/dashboard")
            )
            _source = State(initialValue: source)
            _model = State(initialValue: ScrollRestorationModel(source: source))
        }

        var body: some View {
            VStack(spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    TSButton("Push /trips", variant: .secondary, size: .small) {
                        source.push(path: "/trips")
                    }
                    TSButton("Pop /dashboard", variant: .secondary, size: .small) {
                        source.pop(path: "/dashboard")
                    }
                }

                ScrollRestorationStatusView(model: model)

                ScrollView {
                    VStack(spacing: TSSpacing.sm) {
                        ForEach(0 ..< 40, id: \.self) { index in
                            HStack {
                                Text(verbatim: "Row \(index + 1)")
                                    .font(Font.TS.body)
                                    .foregroundStyle(Color.TS.textSecondary)
                                Spacer()
                            }
                            .padding(TSSpacing.md)
                            .background(
                                Color.TS.surfaceGlass,
                                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                            )
                        }
                    }
                    .padding(.vertical, TSSpacing.sm)
                }
                .scrollRestoration(model)
                .background(ScrollRestoration(model: model))
            }
            .padding(TSSpacing.lg)
            .background(Color.TS.bg)
        }
    }

    #Preview("Live demo (scroll + navigate)") {
        ScrollRestorationLiveDemo()
    }
#endif
