import SwiftUI

// The per-card site-configuration subsection for the Energy Products surface (web
// `SiteInfoSection`): the operation-mode + backup-reserve tiles (the backup-reserve tile hosts the
// `RadialGauge` chart), the Powerwalls / Rated-Power / Rated-Energy StatCards, the firmware +
// timezone line, the component badges, and the Time-of-Use rate-plan row with its detail sheet.
// Implements every data state the per-card query produces (loading skeleton / detail / empty).
// SI watts + watt-hours format at this boundary via `EnergyProductsFormat`.

// MARK: - Site info section (web `SiteInfoSection`)

struct EnergyProductsSiteInfoSection: View {
    let site: EnergyProductSite
    let state: EnergyProductSiteInfoState
    let onRefresh: () -> Void

    @State private var showRatePlan = false

    private let tileColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]
    private let statColumns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            sectionHeader
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    /// Web section header: "Site Configuration" title + a refresh-icon button.
    private var sectionHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Label("energy.siteInfo.title", systemImage: "gearshape.fill")
                .labelStyle(.titleAndIcon)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, isLoading: state.isRefreshing, action: onRefresh) {
                Image(systemName: "arrow.clockwise")
            }
            .accessibilityLabel(Text("energy.siteInfo.refresh"))
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state.status {
        case .loading:
            EnergyProductsSiteInfoSkeleton()
        case .loaded:
            if let info = state.info {
                detail(info)
            } else {
                TSEmptyState(title: "energy.siteInfo.empty", systemImage: "info.circle")
                    .frame(maxWidth: .infinity, minHeight: 100)
            }
        }
    }

    private func detail(_ info: EnergyProductSiteInfo) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: tileColumns, alignment: .leading, spacing: TSSpacing.md) {
                operationModeTile(info)
                backupReserveTile(info)
            }
            nameplateStats(info)
            firmwareLine(info)
            componentBadges(info)
            if site.touCapable || info.touCapable {
                ratePlanRow(info)
            }
            if let fetched = state.fetchedAt {
                Text(verbatim: EnergyProductsStrings.siteInfoFetched(fetched))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .sheet(isPresented: $showRatePlan) {
            EnergyProductsRatePlanSheet(site: site, info: info)
        }
    }

    // MARK: Operation mode + backup reserve (web 2-col inner grid; reserve hosts the RadialGauge)

    private func operationModeTile(_ info: EnergyProductSiteInfo) -> some View {
        EnergyProductsInfoTile(label: "energy.siteInfo.operationMode") {
            Text(verbatim: EnergyProductsStrings.operationMode(info.defaultRealMode))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
        }
    }

    @ViewBuilder
    private func backupReserveTile(_ info: EnergyProductSiteInfo) -> some View {
        if let pct = info.backupReservePercent {
            VStack(spacing: TSSpacing.xs) {
                TSRadialGauge(value: pct / 100, label: "energy.siteInfo.backupReserve", colorIndex: 2)
                    .frame(width: 96, height: 96)
            }
            .frame(maxWidth: .infinity)
            .padding(TSSpacing.md)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        } else {
            EnergyProductsInfoTile(label: "energy.siteInfo.backupReserve") {
                Text(verbatim: EnergyProductsFormat.emptyValue)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    // MARK: Powerwalls / Rated-Power / Rated-Energy StatCards

    /// Web battery-count + nameplate StatCards. Rendered unconditionally with an em-dash fallback
    /// when a value is absent (never a hidden panel), the SwiftUI parity of the web cards.
    private func nameplateStats(_ info: EnergyProductSiteInfo) -> some View {
        LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "energy.siteInfo.batteryCount",
                value: EnergyProductsFormat.count(info.batteryCount),
                systemImage: "battery.100"
            )
            TSStatCard(
                title: "energy.siteInfo.ratedPower",
                value: EnergyProductsFormat.power(info.nameplatePowerW),
                systemImage: "bolt.fill"
            )
            TSStatCard(
                title: "energy.siteInfo.ratedEnergy",
                value: EnergyProductsFormat.energy(info.nameplateEnergyWh),
                systemImage: "gauge.with.dots.needle.bottom.50percent"
            )
        }
    }

    // MARK: Firmware + timezone

    @ViewBuilder
    private func firmwareLine(_ info: EnergyProductSiteInfo) -> some View {
        if info.version != nil || info.installationTimeZone != nil {
            EnergyProductsFlow(spacing: TSSpacing.md) {
                if let version = info.version {
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: "cpu").accessibilityHidden(true)
                        Text(verbatim: EnergyProductsStrings.firmwareLine(version))
                    }
                }
                if let zone = info.installationTimeZone {
                    Text(verbatim: "· \(zone)")
                }
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
    }

    // MARK: Component badges (web `info.components` boolean entries)

    @ViewBuilder
    private func componentBadges(_ info: EnergyProductSiteInfo) -> some View {
        if !info.components.isEmpty {
            EnergyProductsFlow(spacing: TSSpacing.sm) {
                ForEach(info.components) { component in
                    EnergyProductsDataBadge(
                        text: EnergyProductsFormat.humanizeComponent(component.name),
                        tone: component.value ? .success : .neutral
                    )
                }
            }
        }
    }

    // MARK: Time-of-Use rate plan (web TOU section)

    private func ratePlanRow(_ info: EnergyProductSiteInfo) -> some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Label("energy.tou.sectionTitle", systemImage: "clock")
                    .labelStyle(.titleAndIcon)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: info.tariffName ?? noPlan)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            Spacer(minLength: TSSpacing.sm)
            TSButton("energy.tou.updateButton", variant: .ghost, size: .small) { showRatePlan = true }
                .accessibilityLabel(Text("energy.tou.editPlan"))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    private var noPlan: String {
        String(localized: "energy.tou.noPlan", defaultValue: "No rate plan configured")
    }
}

// MARK: - Info tile (web inner `rounded-lg bg-white/[0.03]` panel)

/// One labelled inner tile (web `rounded-lg bg-white/[0.03] border` panel): an uppercase label
/// over caller-supplied content, using the glass material + border tokens.
struct EnergyProductsInfoTile<Content: View>: View {
    let label: LocalizedStringKey
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSMetricLabel(label)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Rate plan detail sheet (web `TOUSettingsModal` entry)

/// The rate-plan detail sheet opened by the site-info "Update" button (web `TOUSettingsModal`).
/// Surfaces the current rate plan plus the operation-mode / backup-reserve context the site
/// reports — real data, never a stub — and dismisses via a Close action.
struct EnergyProductsRatePlanSheet: View {
    let site: EnergyProductSite
    let info: EnergyProductSiteInfo

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    Text(verbatim: site.siteName ?? unnamed)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                    EnergyProductsInfoTile(label: "energy.tou.sectionTitle") {
                        Text(verbatim: info.tariffName ?? noPlan)
                            .font(Font.TS.section)
                            .fontWeight(.semibold)
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                    EnergyProductsInfoTile(label: "energy.siteInfo.operationMode") {
                        Text(verbatim: EnergyProductsStrings.operationMode(info.defaultRealMode))
                            .font(Font.TS.bodySm)
                            .fontWeight(.medium)
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                    if let pct = info.backupReservePercent {
                        EnergyProductsInfoTile(label: "energy.siteInfo.backupReserve") {
                            Text(verbatim: EnergyProductsFormat.percent(pct, decimals: 0))
                                .font(Font.TS.bodySm)
                                .fontWeight(.medium)
                                .foregroundStyle(Color.TS.textPrimary)
                        }
                    }
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.TS.bg.ignoresSafeArea())
            .navigationTitle(Text("energy.tou.sectionTitle"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.close") { dismiss() }
                }
            }
        }
        #if os(macOS)
            .frame(minWidth: 380, minHeight: 360)
        #endif
    }

    private var noPlan: String {
        String(localized: "energy.tou.noPlan", defaultValue: "No rate plan configured")
    }

    private var unnamed: String {
        String(localized: "energy.products.unnamed", defaultValue: "Unnamed Site")
    }
}

// MARK: - Site info skeleton (web `<Skeleton className="h-32" />`)

/// Mirrors the site-info subsection while it loads (web `Skeleton`): the two tiles then the stat row.
struct EnergyProductsSiteInfoSkeleton: View {
    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(height: 72, cornerRadius: TSRadius.md)
                TSSkeleton(height: 72, cornerRadius: TSRadius.md)
            }
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    TSSkeleton(height: 64, cornerRadius: TSRadius.md)
                }
            }
        }
        .accessibilityLabel(Text("loading"))
    }
}
