import SwiftUI

// MARK: - Registry descriptor (web `WidgetDef`)

/// Grid footprint in dashboard columns × rows.
public struct DigitalTwinMiniGridSize: Equatable, Sendable {
    public var cols: Int
    public var rows: Int
    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

/// Registry metadata so the dashboard grid can place the widget with the same id
/// and size constraints as the web registry entry (`digital-twin-mini`).
public struct DigitalTwinMiniDescriptor: Sendable {
    public let id: String
    public let displayNameKey: String
    public let descriptionKey: String
    public let category: String
    public let defaultSize: DigitalTwinMiniGridSize
    public let minSize: DigitalTwinMiniGridSize
    public let maxSize: DigitalTwinMiniGridSize
}

// MARK: - Widget view

/// Native parity of web `features/dashboard/widgets/DigitalTwinMiniWidget.tsx`.
public struct DigitalTwinMiniWidget: View {
    /// Canonical registry entry — id and sizes match the web `vehicle.ts` registry.
    public static let descriptor = DigitalTwinMiniDescriptor(
        id: "digital-twin-mini",
        displayNameKey: "widget.digitalTwinMini.displayName",
        descriptionKey: "widget.digitalTwinMini.description",
        category: "vehicle",
        defaultSize: DigitalTwinMiniGridSize(cols: 2, rows: 4),
        minSize: DigitalTwinMiniGridSize(cols: 1, rows: 4),
        maxSize: DigitalTwinMiniGridSize(cols: 4, rows: 40)
    )

    private let size: DigitalTwinMiniGridSize
    private let onOpen: (() -> Void)?
    @State private var model: DigitalTwinMiniModel

    public init(
        vehicleID: Int64? = nil,
        size: DigitalTwinMiniGridSize = DigitalTwinMiniWidget.descriptor.defaultSize,
        source: any DigitalTwinMiniDataSource = DigitalTwinMiniUnconfiguredSource(),
        telemetry: @escaping @Sendable (_ event: String, _ surface: String) -> Void = DigitalTwinMiniTelemetry.osLog,
        onOpen: (() -> Void)? = nil
    ) {
        self.size = size
        self.onOpen = onOpen
        _model = State(
            initialValue: DigitalTwinMiniModel(vehicleID: vehicleID, source: source, telemetry: telemetry)
        )
    }

    public var body: some View {
        DigitalTwinMiniShell(
            isLoading: !model.didLoadOnce && model.state.value == nil,
            isFetching: model.isFetching,
            isStale: model.isStale,
            isOffline: model.isOffline,
            isError: model.state.error != nil,
            onRefresh: { model.refresh() },
            onOpen: onOpen,
            content: { content }
        )
        .onAppear { model.onAppear() }
        .onDisappear { model.onDisappear() }
        .accessibilityIdentifier("widget.digitalTwinMini")
    }

    @ViewBuilder private var content: some View {
        if !model.hasVehicle {
            DigitalTwinMiniEmpty()
        } else if let data = model.state.value {
            DigitalTwinMiniContent(
                data: data,
                exteriorColor: model.vehicle?.exteriorColor,
                showBadges: showBadges
            )
        } else if model.showsErrorSurface {
            TSQueryError(message: "widget.digitalTwinMini.error", onRetry: { model.refresh() })
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            DigitalTwinMiniEmpty()
        }
    }

    /// Web rule: hide badges only when extremely cramped (`!isCompact || rows ≥ 2`).
    private var showBadges: Bool {
        let compact = size.cols <= 2 && size.rows <= 2
        return !compact || size.rows >= 2
    }
}

// MARK: - Shell (web `WidgetShell`)

private struct DigitalTwinMiniShell<Content: View>: View {
    let isLoading: Bool
    let isFetching: Bool
    let isStale: Bool
    let isOffline: Bool
    let isError: Bool
    let onRefresh: () -> Void
    let onOpen: (() -> Void)?
    @ViewBuilder var content: () -> Content

    var body: some View {
        Group {
            if isLoading {
                DigitalTwinMiniSkeleton()
            } else {
                VStack(spacing: TSSpacing.sm) {
                    header
                    content()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(panel)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "display")
                .font(.caption)
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text("widget.digitalTwinMini.title")
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            DigitalTwinMiniFreshness(
                isFetching: isFetching,
                isStale: isStale,
                isOffline: isOffline,
                isError: isError,
                onRefresh: onRefresh
            )
            openButton
        }
    }

    @ViewBuilder private var openButton: some View {
        if let onOpen {
            Button(action: onOpen) {
                HStack(spacing: 2) {
                    Text("widget.open")
                        .font(Font.TS.caption)
                    Image(systemName: "arrow.up.right")
                        .font(.caption2)
                }
                .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("widget.digitalTwinMini.a11y.open")
        }
    }

    private var panel: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Freshness chip (web `DataFreshness`)

struct DigitalTwinMiniFreshness: View {
    let isFetching: Bool
    let isStale: Bool
    let isOffline: Bool
    let isError: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            statusLabel
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.caption2)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("widget.digitalTwinMini.a11y.refresh")
        }
    }

    @ViewBuilder private var statusLabel: some View {
        if isOffline {
            chip(systemImage: "wifi.slash", key: "widget.freshness.offline", color: Color.TS.statusWarning)
        } else if isError {
            chip(
                systemImage: "exclamationmark.triangle.fill",
                key: "widget.freshness.error",
                color: Color.TS.statusDanger
            )
        } else if isStale {
            chip(
                systemImage: "clock.badge.exclamationmark",
                key: "widget.freshness.stale",
                color: Color.TS.statusWarning
            )
        } else if isFetching {
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel("widget.freshness.live")
        } else {
            chip(systemImage: "checkmark.circle", key: "widget.freshness.live", color: Color.TS.statusSuccess)
        }
    }

    private func chip(systemImage: String, key: LocalizedStringKey, color: Color) -> some View {
        HStack(spacing: 2) {
            Image(systemName: systemImage)
                .font(.caption2)
            Text(key)
                .font(Font.TS.caption)
        }
        .foregroundStyle(color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(key))
    }
}

// MARK: - Empty + loading states (web `EmptyState` / `Skeleton`)

struct DigitalTwinMiniEmpty: View {
    var body: some View {
        TSEmptyState(title: "widget.digitalTwinMini.noVehicle", systemImage: "display")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityIdentifier("widget.digitalTwinMini.empty")
    }
}

struct DigitalTwinMiniSkeleton: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            HStack {
                TSSkeleton(width: 96, height: 10)
                Spacer()
                TSSkeleton(width: 36, height: 10)
            }
            Spacer(minLength: 0)
            TSSkeleton(width: 110, height: 72, cornerRadius: TSRadius.md)
            Spacer(minLength: 0)
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 70, height: 18, cornerRadius: TSRadius.pill)
                TSSkeleton(width: 52, height: 18, cornerRadius: TSRadius.pill)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("widget.digitalTwinMini.loading")
        .accessibilityLabel("widget.digitalTwinMini.loading")
    }
}
