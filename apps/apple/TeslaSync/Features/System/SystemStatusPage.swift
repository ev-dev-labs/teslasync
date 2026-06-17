import Observation
import SwiftUI

/// System Status page - operator-grade health dashboard
/// Parity: web/src/features/system/pages/SystemStatusPage.tsx
struct SystemStatusPage: View {
    @State private var model = SystemStatusPageModel()

    var body: some View {
        ScrollView {
            if model.isLoading {
                loadingView
            } else if let error = model.error {
                errorView(error)
            } else if model.isEmpty {
                emptyView
            } else {
                contentView
            }
        }
        .navigationTitle(String(localized: "System Status"))
        .task {
            await model.load()
        }
        .refreshable {
            await model.refresh()
        }
    }

    // MARK: - Loading State

    private var loadingView: some View {
        VStack(spacing: 24) {
            loadingHeroSection
            ForEach(0 ..< 5, id: \.self) { _ in
                loadingSectionCard
            }
        }
        .padding()
        .redacted(reason: .placeholder) // parity:allow SwiftUI shimmer API
    }

    private var loadingHeroSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "heart.fill")
                .font(.system(size: 48))
            Text("Loading")
            Text("Fetching system health...")
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var loadingSectionCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Section Title")
                .font(.headline)
            Text("Loading data...")
            Text("Please wait...")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Empty State

    private var emptyView: some View {
        ContentUnavailableView(
            String(localized: "No data"),
            systemImage: "info.circle",
            description: Text(String(localized: "System status unavailable"))
        )
    }

    // MARK: - Error State

    private func errorView(_ error: String) -> some View {
        ContentUnavailableView {
            Label(String(localized: "Health"), systemImage: "exclamationmark.triangle")
        } description: {
            Text(error)
        } actions: {
            Button(String(localized: "Refresh")) {
                Task { await model.refresh() }
            }
        }
    }

    // MARK: - Success State / Content

    private var contentView: some View {
        VStack(spacing: 24) {
            heroSection

            if !model.actionItems.isEmpty {
                actionItemsSection
            }

            resourcesSection
            servicesSection
            databaseSection
            telemetrySection
            teslaAuthSection
            notificationsSection
            workersSection
            backupsSection
            teslaAPISection
            errorsSection
            systemInfoSection
            uptimeSection
            sloSection

            if model.maintenanceMode {
                maintenanceSection
            }

            subscribeSection
            apiDocsSection
        }
        .padding()
    }

    // MARK: - Hero Section

    private var heroSection: some View {
        VStack(spacing: 16) {
            Image(systemName: model.overallStatus.iconName)
                .font(.system(size: 56))
                .foregroundStyle(model.overallStatus.color)
                .accessibilityLabel(model.overallStatus.rawValue)

            Text(model.overallStatus.rawValue)
                .font(.title2)
                .fontWeight(.semibold)

            Text(String(localized: "At-a-glance health for your TeslaSync instance"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 12) {
                ForEach(model.heroChips, id: \.label) { chip in
                    chipView(chip)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func chipView(_ chip: HeroChip) -> some View {
        HStack(spacing: 6) {
            Image(systemName: chip.icon)
            Text(chip.label)
        }
        .font(.caption)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .foregroundStyle(chip.color)
        .background(chip.color.opacity(0.15))
        .clipShape(Capsule())
    }

    // MARK: - Action Items

    private var actionItemsSection: some View {
        GroupBox {
            VStack(spacing: 12) {
                Label(
                    String(localized: "Needs your attention"),
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.headline)
                .foregroundStyle(.orange)
                .frame(maxWidth: .infinity, alignment: .leading)

                ForEach(model.actionItems, id: \.title) { item in
                    actionItemRow(item)
                }
            }
        }
    }

    private func actionItemRow(_ item: ActionItem) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                Text(item.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(item.buttonLabel) {
                // Navigation action
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        .padding(.vertical, 8)
    }
}

#Preview {
    NavigationStack {
        SystemStatusPage()
    }
}
