import SwiftUI

// The non-site-info panels for the Energy Products surface: the four summary StatCards, the
// per-site card (header + Charge/Capacity/Type stats + capability badges + footer), the capability
// chips/badges, the loading skeleton, the empty state, and the page error panel. Counts format
// directly; pack capacity converts at this boundary via `EnergyProductsFormat`. The
// site-configuration subsection (with the backup-reserve RadialGauge) lives in
// `EnergyProductsPage.SiteInfo.swift`.

// MARK: - Summary StatCards (web 4 StatCards: Energy-Sites / With-Solar / With-Battery / Backup-Capable)

/// The four fleet-summary StatCards (web summary `Grid`), reflowing 4 → 2 across width.
struct EnergyProductsSummarySection: View {
    let model: EnergyProductsPageModel

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "energy.products.totalSites",
                value: "\(model.totalSites)",
                systemImage: "bolt.fill"
            )
            TSStatCard(
                title: "energy.products.withSolar",
                value: "\(model.sitesWithSolar)",
                systemImage: "sun.max.fill"
            )
            TSStatCard(
                title: "energy.products.withBattery",
                value: "\(model.sitesWithBattery)",
                systemImage: "battery.100"
            )
            TSStatCard(
                title: "energy.products.backupCapable",
                value: "\(model.sitesBackupCapable)",
                systemImage: "shield.fill"
            )
        }
    }
}

// MARK: - Site card (web `EnergySiteCard` GlassPanel — manifest GlassPanel4)

/// One discovered product card (web `EnergySiteCard`): the header (resource icon, site name,
/// `{type} · ID {id}` subtitle, battery-type badge), the Charge/Capacity/Type stats, the
/// capability badges, the site-configuration subsection, and the last-fetched footer.
struct EnergyProductsSiteCard: View {
    let site: EnergyProductSite
    let infoState: EnergyProductSiteInfoState
    let onRefreshInfo: () -> Void

    private let statColumns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md)]

    private var resourceSystemImage: String {
        switch site.resourceType {
        case "battery": "battery.100"
        case "solar": "sun.max.fill"
        default: "bolt.fill"
        }
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                stats
                capabilities
                EnergyProductsSiteInfoSection(
                    site: site,
                    state: infoState,
                    onRefresh: onRefreshInfo
                )
                Text(verbatim: EnergyProductsStrings.lastFetched(site.fetchedAt))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: resourceSystemImage, tone: .accent)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: site.siteName ?? unnamed)
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: EnergyProductsStrings.siteSubtitle(type: site.resourceType, id: site.energySiteID))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            if let batteryType = site.batteryType {
                EnergyProductsDataBadge(text: batteryType, tone: .info)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var unnamed: String {
        String(localized: "energy.products.unnamed", defaultValue: "Unnamed Site")
    }

    private var stats: some View {
        LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "energy.products.charge",
                value: EnergyProductsFormat.percent(site.percentageCharged),
                systemImage: "gauge.with.dots.needle.bottom.50percent"
            )
            TSStatCard(
                title: "energy.products.capacity",
                value: EnergyProductsFormat.energy(site.totalPackEnergyWh),
                systemImage: "battery.100"
            )
            TSStatCard(
                title: "energy.products.type",
                value: EnergyProductsStrings.resourceLabel(site.resourceType),
                systemImage: "bolt.fill"
            )
        }
    }

    /// Web capability badges row (Solar / Battery / Grid / Backup / Storm Watch + Storm Active).
    private var capabilities: some View {
        EnergyProductsFlow(spacing: TSSpacing.sm) {
            EnergyProductsCapabilityChip(
                active: site.hasSolar,
                label: "energy.products.solar",
                systemImage: "sun.max.fill"
            )
            EnergyProductsCapabilityChip(
                active: site.hasBattery,
                label: "energy.products.battery",
                systemImage: "battery.100"
            )
            EnergyProductsCapabilityChip(
                active: site.hasGrid,
                label: "energy.products.grid",
                systemImage: "powerplug.fill"
            )
            EnergyProductsCapabilityChip(
                active: site.backupCapable,
                label: "energy.products.backup",
                systemImage: "shield.fill"
            )
            EnergyProductsCapabilityChip(
                active: site.stormModeCapable,
                label: "energy.products.stormWatch",
                systemImage: "cloud.bolt.fill"
            )
            if site.stormModeEnabled {
                EnergyProductsBadge(
                    label: "energy.products.stormActive",
                    systemImage: "cloud.bolt.fill",
                    tone: .warning
                )
            }
        }
    }
}

// MARK: - Capability chip / badge / data badge

/// A capability pill (web `CapBadge`): success tone when the capability is present, neutral when
/// absent, with a leading SF Symbol and a localized label.
struct EnergyProductsCapabilityChip: View {
    let active: Bool
    let label: LocalizedStringKey
    let systemImage: String

    var body: some View {
        EnergyProductsBadge(label: label, systemImage: systemImage, tone: active ? .success : .neutral)
    }
}

/// A small tinted badge with a leading SF Symbol + localized label (web `Badge` with an icon),
/// matching the shared `TSBadge` capsule styling.
struct EnergyProductsBadge: View {
    let label: LocalizedStringKey
    let systemImage: String
    let tone: TSTone

    var body: some View {
        Label(label, systemImage: systemImage)
            .labelStyle(.titleAndIcon)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .combine)
    }
}

/// A tinted badge rendering a verbatim API value (battery type / humanized component key) in the
/// shared `TSBadge` capsule styling — these are data, not localized UI literals.
struct EnergyProductsDataBadge: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Loading skeleton (web PageContainer spinner / GlassPanel skeleton — manifest GlassPanel12)

/// Mirrors the Energy Products layout while the sites load (web loading state): the summary row
/// then two site-card skeletons. The card skeleton is the manifest `GlassPanel12`.
struct EnergyProductsSkeleton: View {
    private let summaryColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]
    private let cardColumns = [GridItem(.adaptive(minimum: 380), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(columns: summaryColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 88, cornerRadius: TSRadius.lg)
                }
            }
            LazyVGrid(columns: cardColumns, alignment: .leading, spacing: TSSpacing.lg) {
                ForEach(0 ..< 2, id: \.self) { _ in
                    TSGlassPanel {
                        VStack(alignment: .leading, spacing: TSSpacing.md) {
                            TSSkeleton(width: 200, height: 24)
                            TSSkeleton(height: 64, cornerRadius: TSRadius.md)
                            TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(Text("loading"))
    }
}

// MARK: - Empty state (web `sites.length === 0` GlassPanel — manifest GlassPanel13)

/// The honest empty state when no products are discovered (web `EmptyState` inside a GlassPanel).
struct EnergyProductsEmptyPanel: View {
    var body: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "energy.products.empty",
                systemImage: "bolt.fill"
            )
            .frame(maxWidth: .infinity, minHeight: 160)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Page error (web PageContainer `error`)

/// The blocking page error state with a retry (web PageContainer `error` box). Surfaces the
/// underlying message verbatim while offering a retry action.
struct EnergyProductsErrorPanel: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: message)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                TSButton("action.retry", variant: .secondary, size: .small, action: onRetry)
            }
            .frame(maxWidth: .infinity)
            .padding(TSSpacing.md)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Wrapping flow layout (web `flex flex-wrap` badge rows)

/// Lays subviews left-to-right, wrapping to a new row when the next subview would overflow the
/// proposed width (web `flex flex-wrap gap-2`). Native `Layout` (iOS 16+/macOS 13+), so no
/// WKWebView; kept feature-local to keep the Battery surface self-contained.
struct EnergyProductsFlow: Layout {
    var spacing: CGFloat = TSSpacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .greatestFiniteMagnitude
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var maxRowWidth: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                maxRowWidth = max(maxRowWidth, rowWidth)
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += (rowWidth > 0 ? spacing : 0) + size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalHeight += rowHeight
        maxRowWidth = max(maxRowWidth, rowWidth)
        let width = proposal.width ?? maxRowWidth
        return CGSize(width: width, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
        var positionX = bounds.minX
        var positionY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if positionX > bounds.minX, positionX + size.width > bounds.maxX {
                positionX = bounds.minX
                positionY += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(
                at: CGPoint(x: positionX, y: positionY),
                anchor: .topLeading,
                proposal: ProposedViewSize(size)
            )
            positionX += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
