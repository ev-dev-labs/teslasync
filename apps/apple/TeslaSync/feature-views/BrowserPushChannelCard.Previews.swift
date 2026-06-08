//
//  BrowserPushChannelCard.Previews.swift
//  TeslaSync — P4 feature view · 0181 · BrowserPushChannelCard (Apple)
//
//  #if DEBUG previews — one per state + branch of the web source: subscribed
//  (active) + devices, not-subscribed, each of the four unsupported reasons, the
//  empty device list, plus the native loading / error / stale / offline chrome.
//  Previews use the bundle-free `.echo` localizer so the English copy renders
//  without the folded catalog, a fixed clock for deterministic relative times, and a
//  no-op in-memory source so they are side-effect-free.
//

#if DEBUG
    import SwiftUI

    @MainActor
    private enum BrowserPushChannelCardPreview {
        static let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

        static func devices() -> [BrowserPushDeviceRow] {
            [
                BrowserPushDeviceRow(
                    id: 1,
                    endpoint: "https://push.example.com/this-device",
                    userAgent: "Safari 18 · macOS",
                    lastUsedAt: "2023-11-14T19:30:00Z"
                ),
                BrowserPushDeviceRow(
                    id: 2,
                    endpoint: "https://push.example.com/old-phone",
                    userAgent: "Chrome 120 · Android",
                    lastUsedAt: "2023-11-10T08:00:00Z"
                ),
                BrowserPushDeviceRow(
                    id: 3,
                    endpoint: "https://push.example.com/unused",
                    userAgent: nil,
                    lastUsedAt: nil
                )
            ]
        }

        static func update(
            capability: BrowserPushCapability,
            devices: [BrowserPushDeviceRow] = devices(),
            connection: BrowserPushChannelCardConnection = .live,
            status: BrowserPushChannelCardStatus = .loaded
        ) -> BrowserPushChannelCardUpdate {
            BrowserPushChannelCardUpdate(
                status: status,
                connection: connection,
                capability: capability,
                devices: devices,
                updatedAt: fixedNow
            )
        }

        static func card(_ update: BrowserPushChannelCardUpdate) -> some View {
            let source = InMemoryBrowserPushChannelCardSource(initial: update)
            let model = BrowserPushChannelCardModel(
                source: source,
                telemetry: NoopBrowserPushChannelCardTelemetry(),
                localize: .echo,
                now: { fixedNow }
            )
            return BrowserPushChannelCard(model: model)
        }

        static let subscribed = BrowserPushCapability(
            permission: .granted,
            isSubscribed: true,
            currentEndpoint: "https://push.example.com/this-device"
        )

        static let notSubscribed = BrowserPushCapability(permission: .notDetermined, isSubscribed: false)
    }

    private struct NoopBrowserPushChannelCardTelemetry: BrowserPushChannelCardTelemetry {
        func viewOpened(surface _: String) {}
    }

    #Preview("Available · subscribed / not subscribed") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                BrowserPushChannelCardPreview.card(
                    BrowserPushChannelCardPreview.update(capability: BrowserPushChannelCardPreview.subscribed)
                )
                BrowserPushChannelCardPreview.card(
                    BrowserPushChannelCardPreview.update(capability: BrowserPushChannelCardPreview.notSubscribed)
                )
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Unavailable · the four reasons") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                BrowserPushChannelCardPreview.card(BrowserPushChannelCardPreview.update(
                    capability: BrowserPushCapability(notificationsSupported: false),
                    devices: []
                ))
                BrowserPushChannelCardPreview.card(BrowserPushChannelCardPreview.update(
                    capability: BrowserPushCapability(pushSupported: false, serverConfigured: false),
                    devices: []
                ))
                BrowserPushChannelCardPreview.card(BrowserPushChannelCardPreview.update(
                    capability: BrowserPushCapability(pushSupported: false),
                    devices: []
                ))
                BrowserPushChannelCardPreview.card(BrowserPushChannelCardPreview.update(
                    capability: BrowserPushCapability(permission: .denied),
                    devices: []
                ))
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Chrome · empty / loading / error") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                BrowserPushChannelCardPreview.card(BrowserPushChannelCardPreview.update(
                    capability: BrowserPushChannelCardPreview.notSubscribed,
                    devices: []
                ))
                BrowserPushChannelCardPreview.card(BrowserPushChannelCardUpdate(status: .loading))
                BrowserPushChannelCardPreview.card(BrowserPushChannelCardUpdate(status: .failed("Network error")))
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Freshness · stale / offline") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                BrowserPushChannelCardPreview.card(BrowserPushChannelCardPreview.update(
                    capability: BrowserPushChannelCardPreview.subscribed,
                    connection: .stale
                ))
                BrowserPushChannelCardPreview.card(BrowserPushChannelCardPreview.update(
                    capability: BrowserPushChannelCardPreview.subscribed,
                    connection: .offline
                ))
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }
#endif
