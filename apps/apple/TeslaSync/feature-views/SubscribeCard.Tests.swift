//
//  SubscribeCard.Tests.swift
//  TeslaSync — P4 feature view · 0255 · SubscribeCard (Apple)
//
//  Unit coverage for the SubscribeCard surface:
//    • Adapter (catalog → projection) — `SubscribeChannel` catalog parity with
//      the web inline `<ChannelTile>` list (order, i18n keys, fallbacks, icons,
//      web `to` paths, native route mapping), the `SubscribeChannelTileBuilder`
//      localization, and the responsive `SubscribeCardLayout` column math.
//    • Projection — `SubscribeCardProjection.resolvePhase` across loading / empty
//      / error / content, including the cached-items-keep-content branches.
//    • State holder — `SubscribeCardViewModel` phase + connection resolution, the
//      guarded stale auto-refresh, the offline-keeps-cache behavior, and the
//      P1/S11 `view.opened` telemetry + source wiring (incl.
//      `StaticSubscribeCardChannelSource`).
//    • Accessibility — the VoiceOver label / hint / card / connection copy.
//    • Per-state render smoke — every state rasterizes (snapshot) without crashing.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySubscribeCardChannelSource`.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Adapter: catalog parity (port of the web inline `<ChannelTile>` list)

@MainActor final class SubscribeChannelCatalogTests: XCTestCase {
    func testCatalogMatchesWebOrder() {
        XCTAssertEqual(SubscribeChannel.catalog, [.email, .slack, .discord, .webhook, .browserPush])
    }

    func testI18nKeysMatchSubscribeNamespace() {
        XCTAssertEqual(SubscribeChannel.email.labelKey, "subscribe.channel.email.label")
        XCTAssertEqual(SubscribeChannel.email.descriptionKey, "subscribe.channel.email.description")
        XCTAssertEqual(SubscribeChannel.browserPush.labelKey, "subscribe.channel.browserPush.label")
        XCTAssertEqual(SubscribeChannel.webhook.descriptionKey, "subscribe.channel.webhook.description")
    }

    func testEnglishFallbacksMatchWebLiterals() {
        XCTAssertEqual(SubscribeChannel.email.labelFallback, "Email")
        XCTAssertEqual(SubscribeChannel.email.descriptionFallback, "SMTP-based delivery")
        XCTAssertEqual(SubscribeChannel.slack.descriptionFallback, "Webhook channel")
        XCTAssertEqual(SubscribeChannel.discord.descriptionFallback, "Webhook channel")
        XCTAssertEqual(SubscribeChannel.webhook.descriptionFallback, "Custom HTTP endpoint")
        XCTAssertEqual(SubscribeChannel.browserPush.labelFallback, "Browser push")
        XCTAssertEqual(SubscribeChannel.browserPush.descriptionFallback, "Opt-in PWA notifications")
    }

    func testWebPathsMatchSource() {
        XCTAssertEqual(
            SubscribeChannel.catalog.map(\.webPath),
            [
                "/notifications/channels",
                "/notifications/channels",
                "/notifications/channels",
                "/notifications/channels",
                "/settings/notifications"
            ]
        )
    }

    func testNativeRoutePathsResolveToCanonicalAppRoutes() {
        // Parity with AppRouteParser: the first path segment resolves the route.
        for channel in SubscribeChannel.catalog {
            XCTAssertEqual(AppRouteParser.parse(path: channel.webPath)?.path, channel.routePath)
        }
        XCTAssertEqual(SubscribeChannel.email.routePath, "/notifications")
        XCTAssertEqual(SubscribeChannel.browserPush.routePath, "/settings")
    }

    func testEachChannelHasDistinctNonEmptyIcon() {
        let icons = Set(SubscribeChannel.catalog.map(\.systemImage))
        XCTAssertEqual(icons.count, SubscribeChannel.catalog.count)
        for channel in SubscribeChannel.catalog {
            XCTAssertFalse(channel.systemImage.isEmpty)
        }
    }
}

// MARK: - Adapter: tile builder + layout

@MainActor final class SubscribeChannelTileBuilderTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the builder tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }
    /// Key-revealing localizer so tests can assert the exact i18n key used.
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testBuildPreservesCatalogOrderAndCount() {
        let items = SubscribeChannelTileBuilder.build(localize: echo)
        XCTAssertEqual(items.map(\.channel), [.email, .slack, .discord, .webhook, .browserPush])
        XCTAssertEqual(items.count, 5)
    }

    func testBuildResolvesLabelAndDetailViaLocalizer() {
        let items = SubscribeChannelTileBuilder.build(channels: [.email], localize: keyTap)
        let email = items.first
        XCTAssertEqual(email?.label, "L:subscribe.channel.email.label")
        XCTAssertEqual(email?.detail, "L:subscribe.channel.email.description")
    }

    func testBuildCarriesIconAndChannel() {
        let items = SubscribeChannelTileBuilder.build(channels: [.webhook], localize: echo)
        let webhook = items[0]
        XCTAssertEqual(webhook.id, "webhook")
        XCTAssertEqual(webhook.channel, .webhook)
        XCTAssertEqual(webhook.systemImage, SubscribeChannel.webhook.systemImage)
    }

    func testBuildHandlesEmptyChannels() {
        XCTAssertTrue(SubscribeChannelTileBuilder.build(channels: [], localize: echo).isEmpty)
    }

    func testLayoutColumnsMatchResponsiveBreakpoints() {
        XCTAssertEqual(SubscribeCardLayout.columns(forWidth: 0), 1)
        XCTAssertEqual(SubscribeCardLayout.columns(forWidth: 320), 1)
        XCTAssertEqual(SubscribeCardLayout.columns(forWidth: 639), 1)
        XCTAssertEqual(SubscribeCardLayout.columns(forWidth: 640), 2)
        XCTAssertEqual(SubscribeCardLayout.columns(forWidth: 1024), 2)
    }
}

// MARK: - Projection: phase resolution

@MainActor final class SubscribeCardProjectionTests: XCTestCase {
    func testLoadingWithoutItemsShowsLoading() {
        XCTAssertEqual(SubscribeCardProjection.resolvePhase(.loading, count: 0), .loading)
    }

    func testLoadingWithCachedItemsKeepsContent() {
        XCTAssertEqual(SubscribeCardProjection.resolvePhase(.loading, count: 5), .content)
    }

    func testLoadedWithItemsShowsContent() {
        XCTAssertEqual(SubscribeCardProjection.resolvePhase(.loaded, count: 5), .content)
    }

    func testLoadedWithoutItemsShowsEmpty() {
        XCTAssertEqual(SubscribeCardProjection.resolvePhase(.loaded, count: 0), .empty)
    }

    func testFailedWithoutItemsShowsError() {
        XCTAssertEqual(SubscribeCardProjection.resolvePhase(.failed("boom"), count: 0), .error("boom"))
    }

    func testFailedWithCachedItemsKeepsContent() {
        XCTAssertEqual(SubscribeCardProjection.resolvePhase(.failed("net"), count: 5), .content)
    }
}

// MARK: - Accessibility content

@MainActor final class SubscribeCardAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testTileLabelCombinesLabelAndDetail() {
        XCTAssertEqual(
            SubscribeCardAccessibility.tileLabel(label: "Email", detail: "SMTP-based delivery"),
            "Email. SMTP-based delivery"
        )
    }

    func testTileLabelOmitsEmptyDetail() {
        XCTAssertEqual(SubscribeCardAccessibility.tileLabel(label: "Email", detail: ""), "Email")
    }

    func testTileHintFormatsOpensLabel() {
        XCTAssertEqual(SubscribeCardAccessibility.tileHint(label: "Slack", localize: echo), "Opens Slack")
    }

    func testCardLabelResolvesViaLocalizer() {
        XCTAssertEqual(
            SubscribeCardAccessibility.cardLabel(localize: echo),
            "Get notified about incidents"
        )
    }

    func testConnectionLabelsResolveViaLocalizer() {
        XCTAssertEqual(SubscribeCardAccessibility.connectionLabel(.live, localize: echo), "Live")
        XCTAssertEqual(SubscribeCardAccessibility.connectionLabel(.stale, localize: echo), "Stale")
        XCTAssertEqual(SubscribeCardAccessibility.connectionLabel(.offline, localize: echo), "Offline")
    }

    func testBuiltItemsCarryAccessibilityCopy() {
        let items = SubscribeChannelTileBuilder.build(channels: [.discord], localize: echo)
        let discord = items[0]
        XCTAssertEqual(discord.accessibilityLabel, "Discord. Webhook channel")
        XCTAssertEqual(discord.accessibilityHint, "Opens Discord")
    }
}

// MARK: - Surface identity

@MainActor final class SubscribeCardSurfaceTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(SubscribeCardSurface.slug, "SubscribeCard")
        XCTAssertEqual(SubscribeCard.surfaceSlug, "SubscribeCard")
    }
}

// MARK: - State holder: phases + connection + telemetry + source wiring

@MainActor final class SubscribeCardViewModelTests: XCTestCase {
    private func makeModel(
        _ update: SubscribeCardCatalogUpdate,
        telemetry: SubscribeCardViewTelemetry = OSLogSubscribeCardViewTelemetry()
    ) -> (SubscribeCardViewModel, InMemorySubscribeCardChannelSource) {
        let source = InMemorySubscribeCardChannelSource(initial: update)
        let model = SubscribeCardViewModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutItemsShowsLoading() {
        let (model, _) = makeModel(SubscribeCardCatalogUpdate(status: .loading, channels: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.items.isEmpty)
    }

    func testLoadedWithItemsShowsContent() {
        let (model, _) = makeModel(SubscribeCardCatalogUpdate(status: .loaded, channels: SubscribeChannel.catalog))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 5)
        XCTAssertEqual(model.connection, .live)
    }

    func testLoadedWithoutItemsShowsEmpty() {
        let (model, _) = makeModel(SubscribeCardCatalogUpdate(status: .loaded, channels: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutItemsShowsError() {
        let (model, _) = makeModel(SubscribeCardCatalogUpdate(status: .failed("boom"), channels: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySubscribeCardViewTelemetry()
        let (model, source) = makeModel(
            SubscribeCardCatalogUpdate(status: .loaded, channels: SubscribeChannel.catalog),
            telemetry: spy
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SubscribeCard.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStaleConnectionTriggersExactlyOneAutoRefresh() {
        let (model, source) = makeModel(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: SubscribeChannel.catalog,
            connection: .live
        ))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)

        source.push(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: SubscribeChannel.catalog,
            connection: .stale
        ))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 1)

        // Still stale → guarded, no second auto-refresh.
        source.push(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: SubscribeChannel.catalog,
            connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testLiveResetsStaleGuardSoStaleRetriggers() {
        let (model, source) = makeModel(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: SubscribeChannel.catalog,
            connection: .live
        ))
        model.start()
        source.push(SubscribeCardCatalogUpdate(status: .loaded, channels: SubscribeChannel.catalog, connection: .stale))
        source.push(SubscribeCardCatalogUpdate(status: .loaded, channels: SubscribeChannel.catalog, connection: .live))
        source.push(SubscribeCardCatalogUpdate(status: .loaded, channels: SubscribeChannel.catalog, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
        _ = model
    }

    func testOfflineKeepsCachedGridWithoutRefresh() {
        let (model, source) = makeModel(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: SubscribeChannel.catalog,
            connection: .live
        ))
        model.start()
        source.push(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: SubscribeChannel.catalog,
            connection: .offline
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.items.count, 5)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopDelegatesToSourceAndReArmsOnNextStart() {
        let (model, source) = makeModel(SubscribeCardCatalogUpdate(status: .loaded, channels: SubscribeChannel.catalog))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SubscribeCardCatalogUpdate(status: .loaded, channels: SubscribeChannel.catalog))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaticSourcePublishesCanonicalLiveCatalog() {
        var received: SubscribeCardCatalogUpdate?
        let source = StaticSubscribeCardChannelSource()
        source.onUpdate = { update in received = update }
        source.start()
        XCTAssertEqual(received?.status, .loaded)
        XCTAssertEqual(received?.connection, .live)
        XCTAssertEqual(received?.channels, SubscribeChannel.catalog)
    }
}

// MARK: - Per-state render smoke (snapshot)

@MainActor final class SubscribeCardRenderTests: XCTestCase {
    private func render(_ update: SubscribeCardCatalogUpdate) -> CGImage? {
        let source = InMemorySubscribeCardChannelSource(initial: update)
        let model = SubscribeCardViewModel(source: source)
        model.start()
        let view = SubscribeCard(model: model)
            .frame(width: 480, height: 320)
        return ImageRenderer(content: view).cgImage
    }

    func testContentLiveStateRenders() {
        XCTAssertNotNil(render(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: SubscribeChannel.catalog,
            connection: .live
        )))
    }

    func testContentStaleStateRenders() {
        XCTAssertNotNil(render(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: SubscribeChannel.catalog,
            connection: .stale
        )))
    }

    func testContentOfflineStateRenders() {
        XCTAssertNotNil(render(SubscribeCardCatalogUpdate(
            status: .loaded,
            channels: SubscribeChannel.catalog,
            connection: .offline
        )))
    }

    func testLoadingStateRenders() {
        XCTAssertNotNil(render(SubscribeCardCatalogUpdate(status: .loading, channels: [])))
    }

    func testEmptyStateRenders() {
        XCTAssertNotNil(render(SubscribeCardCatalogUpdate(status: .loaded, channels: [])))
    }

    func testErrorStateRenders() {
        XCTAssertNotNil(render(SubscribeCardCatalogUpdate(status: .failed("Network unavailable"), channels: [])))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySubscribeCardViewTelemetry: SubscribeCardViewTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
