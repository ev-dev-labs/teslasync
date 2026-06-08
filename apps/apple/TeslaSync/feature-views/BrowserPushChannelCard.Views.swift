//
//  BrowserPushChannelCard.Views.swift
//  TeslaSync — P4 feature view · 0181 · BrowserPushChannelCard (Apple)
//
//  The presentational subviews of the BrowserPushChannelCard — the native port of
//  the web card's header (icon chip + title + subtitle + status badge), the
//  unsupported amber callout, the enable/disable affordance + iOS note, the
//  registered-device list (with the per-row revoke button), and the native-only
//  chrome (freshness chip, loading skeleton, hard-error view, empty device list).
//  Each piece reads its copy through the injected `BrowserPushChannelCardLocalizer`;
//  no English is hardcoded. The card container + phase switch live in
//  `BrowserPushChannelCard.swift`.
//

import SwiftUI

// MARK: - Header (icon chip + title + subtitle + status badge)

struct BrowserPushChannelCardHeader: View {
    let status: BrowserPushStatus
    let localize: BrowserPushChannelCardLocalizer

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "bell.badge.fill", tone: .accent)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: localize.string("webpush.title", "Browser push"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: localize.string(
                    "webpush.subtitle",
                    "Get OS-level notifications even when TeslaSync is closed."
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            TSBadge(LocalizedStringKey(status.key), tone: status.tone)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Text(verbatim: BrowserPushChannelCardAccessibility.headerLabel(
            status: status,
            localize: localize
        )))
    }
}

// MARK: - Unsupported callout (web amber `AlertCircle` box)

struct BrowserPushUnsupportedBanner: View {
    let reason: BrowserPushUnsupportedReason
    let localize: BrowserPushChannelCardLocalizer

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 13))
            Text(verbatim: reason.text(localize))
                .font(Font.TS.caption)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.statusWarning.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Enable / disable affordance (+ iOS note)

struct BrowserPushActionRow: View {
    let isSubscribed: Bool
    let localize: BrowserPushChannelCardLocalizer
    let onEnable: () -> Void
    let onDisable: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            toggleButton
            Text(verbatim: localize.string(
                "webpush.iosNote",
                "iOS Safari requires version 16.4 or later, and you must add TeslaSync to your Home Screen."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var toggleButton: some View {
        if isSubscribed {
            TSButton(variant: .secondary, size: .small, action: onDisable) {
                Label {
                    Text(verbatim: localize.string("webpush.disable", "Disable on this device"))
                } icon: {
                    Image(systemName: "bell.slash.fill")
                }
            }
            .accessibilityLabel(Text(verbatim: BrowserPushChannelCardAccessibility.toggleLabel(
                isSubscribed: true,
                localize: localize
            )))
        } else {
            TSButton(variant: .primary, size: .small, action: onEnable) {
                Label {
                    Text(verbatim: localize.string("webpush.enable", "Enable on this device"))
                } icon: {
                    Image(systemName: "bell.badge.fill")
                }
            }
            .accessibilityLabel(Text(verbatim: BrowserPushChannelCardAccessibility.toggleLabel(
                isSubscribed: false,
                localize: localize
            )))
        }
    }
}

// MARK: - Registered devices section

struct BrowserPushDevicesSection: View {
    let devices: [BrowserPushDeviceProjection]
    let localize: BrowserPushChannelCardLocalizer
    let onRemove: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Divider().overlay(Color.TS.border)
            Text(verbatim: localize.string("webpush.devices.title", "Registered devices"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            if devices.isEmpty {
                emptyState
            } else {
                VStack(spacing: TSSpacing.sm) {
                    ForEach(devices) { device in
                        BrowserPushDeviceRowView(device: device, localize: localize, onRemove: onRemove)
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey("webpush.devices.empty.title"),
            message: LocalizedStringKey("webpush.devices.empty.message"),
            systemImage: "iphone.slash"
        )
        .frame(maxWidth: .infinity)
    }
}

struct BrowserPushDeviceRowView: View {
    let device: BrowserPushDeviceProjection
    let localize: BrowserPushChannelCardLocalizer
    let onRemove: (String) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "iphone.gen3")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                agentLine
                Text(verbatim: device.lastUsedLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: BrowserPushChannelCardAccessibility.deviceLabel(
                device,
                localize: localize
            )))
            removeButton
        }
        .padding(TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    private var agentLine: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: device.agentLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            if device.isCurrentDevice {
                Text(verbatim: localize.string("webpush.devices.thisDevice", "(this device)"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
        }
    }

    private var removeButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { onRemove(device.endpoint) },
            label: {
                Image(systemName: "trash")
                    .font(.system(size: 13))
            }
        )
        .accessibilityLabel(Text(verbatim: BrowserPushChannelCardAccessibility.removeLabel(localize)))
    }
}

// MARK: - Freshness chip (native stale / offline chrome)

struct BrowserPushFreshnessChip: View {
    let connection: BrowserPushChannelCardConnection
    let onRefresh: () -> Void

    private var tone: TSTone {
        connection == .offline ? .neutral : .warning
    }

    private var systemImage: String {
        connection == .offline ? "wifi.slash" : "clock.arrow.circlepath"
    }

    private var message: String {
        connection == .offline ? offlineCopy : staleCopy
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
            Text(verbatim: message)
                .font(Font.TS.caption)
                .frame(maxWidth: .infinity, alignment: .leading)
            TSButton(variant: .ghost, size: .small, action: onRefresh) {
                Text(verbatim: refreshCopy)
            }
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }

    private var staleCopy: String {
        BrowserPushChannelCardStringsBridge.string(
            "webpush.stale",
            "Reconnecting — these settings may be out of date"
        )
    }

    private var offlineCopy: String {
        BrowserPushChannelCardStringsBridge.string(
            "webpush.offline",
            "Offline — showing the last known settings"
        )
    }

    private var refreshCopy: String {
        BrowserPushChannelCardStringsBridge.string("webpush.refresh", "Refresh")
    }
}

// MARK: - Loading skeleton (native chrome)

struct BrowserPushChannelCardSkeleton: View {
    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 140, height: 14)
                        TSSkeleton(width: 220, height: 10)
                    }
                    Spacer(minLength: 0)
                    TSSkeleton(width: 90, height: 18, cornerRadius: TSRadius.pill)
                }
                TSSkeleton(width: 180, height: 28, cornerRadius: TSRadius.md)
                TSSkeleton(height: 12)
            }
        }
        .accessibilityLabel(Text(verbatim: BrowserPushChannelCardStringsBridge.string(
            "webpush.loading",
            "Loading browser push settings"
        )))
    }
}

// MARK: - Hard-error view (native chrome)

struct BrowserPushChannelCardErrorView: View {
    let message: String?
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: LocalizedStringKey("webpush.error.title"),
                message: message.map { LocalizedStringKey($0) },
                onRetry: onRetry
            )
        }
    }
}

// MARK: - Strings bridge for the SwiftUI-only chrome

/// A tiny re-export of the surface strings facade so the SwiftUI-only chrome
/// (freshness chip / skeleton) can resolve its native-only keys without re-deriving
/// the table name. The model-facing copy still flows through the injected localizer.
enum BrowserPushChannelCardStringsBridge {
    static func string(_ key: String, _ fallback: String) -> String {
        BrowserPushChannelCardStrings.string(key, fallback)
    }
}
