//
//  PageContainer.Previews.swift
//  TeslaSync — P4 shared surface · 0171 · PageContainer (Apple)
//
//  Xcode previews for each surface state (content / loading / error / empty) and the freshness chip
//  bands (fresh / stale / offline) plus the copy-link affordance. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    /// A representative page body (the parity of a feature page's children) for the previews.
    private struct PageContainerPreviewContent: View {
        var body: some View {
            TSCard {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    Text(verbatim: "Fleet overview")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: "3 vehicles · 412 kWh charged this week · 1,240 km driven")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @MainActor
    private func previewModel(_ input: PageContainerInput) -> PageContainerModel {
        let model = PageContainerModel(source: InMemoryPageContainerSource(initial: input))
        model.start()
        return model
    }

    private let freshNow = Date()

    #Preview("Content + fresh chip") {
        ScrollView {
            PageContainer(model: previewModel(PageContainerInput(
                title: "Dashboard",
                subtitle: "Your fleet at a glance",
                copyLink: true,
                shareLink: "teslasync://dashboard",
                query: PageContainerQuery(dataUpdatedAt: freshNow)
            ))) {
                PageContainerPreviewContent()
            }
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content + actions") {
        ScrollView {
            PageContainer(
                model: previewModel(PageContainerInput(title: "Drives", subtitle: "Last 30 days")),
                actions: {
                    TSButton("Export", variant: .secondary, size: .small) {}
                },
                content: { PageContainerPreviewContent() }
            )
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        PageContainer(model: previewModel(PageContainerInput(title: "Charging", isLoading: true))) {
            PageContainerPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        PageContainer(model: previewModel(PageContainerInput(
            title: "Analytics",
            errorMessage: "Request failed with status 503 (Service Unavailable)"
        ))) {
            PageContainerPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (default copy)") {
        PageContainer(model: previewModel(PageContainerInput(title: "Drives", isEmpty: true))) {
            PageContainerPreviewContent()
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            PageContainer(model: previewModel(PageContainerInput(
                title: "Battery",
                query: PageContainerQuery(isStale: true, dataUpdatedAt: freshNow.addingTimeInterval(-3600))
            ))) {
                PageContainerPreviewContent()
            }
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView {
            PageContainer(model: previewModel(PageContainerInput(
                title: "Telemetry",
                query: PageContainerQuery(isError: true)
            ))) {
                PageContainerPreviewContent()
            }
            .padding()
        }
        .background(Color.TS.bg)
    }
#endif
