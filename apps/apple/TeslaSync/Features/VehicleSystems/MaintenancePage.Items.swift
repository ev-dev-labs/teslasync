import SwiftUI

// The maintenance-items grid + its card (web items grid + `MaintenanceItemCard` / `CategoryBadge` /
// `ProgressBar`). Each card shows the category + status badges, name + description, a progress bar with
// the due target (hidden when completed), and the current-odometer + last-service footer. The grid
// renders its own empty state (never a blank region).

// MARK: - Items grid (web maintenance items grid, or EmptyState)

/// The adaptive grid of maintenance item cards (web `filteredItems.map(MaintenanceItemCard)`), or the
/// no-items empty state whose message depends on whether a category filter is active (web ternary).
struct MaintenanceItemsSection: View {
    let items: [MaintenanceItem]
    let isCategoryFiltered: Bool

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    private var emptyMessage: LocalizedStringKey {
        isCategoryFiltered
            ? "No items match the selected category. Try a different filter."
            : "No maintenance items found for this vehicle."
    }

    var body: some View {
        Group {
            if items.isEmpty {
                TSGlassPanel {
                    TSEmptyState(
                        title: "No maintenance items",
                        message: emptyMessage,
                        systemImage: "wrench.and.screwdriver"
                    )
                    .frame(maxWidth: .infinity)
                }
            } else {
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    ForEach(items) { item in
                        MaintenanceItemCard(item: item)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Item card (web `MaintenanceItemCard`)

/// One maintenance item card (web `MaintenanceItemCard`): category + status badges, name + description,
/// a progress bar toward the next service (hidden once completed), and the odometer + last-service
/// footer. Progress + the derived status are computed at the display boundary.
struct MaintenanceItemCard: View {
    let item: MaintenanceItem

    private var progress: Double {
        MaintenanceFormat.progress(item)
    }

    private var derivedStatus: MaintenanceStatus {
        MaintenanceFormat.derivedStatus(item)
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                headerRow
                titleBlock
                if derivedStatus != .completed { progressBlock }
                footerRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: item.name))
        .accessibilityValue(Text(derivedStatus.labelKey))
    }

    private var headerRow: some View {
        HStack(spacing: TSSpacing.sm) {
            MaintenanceCategoryBadge(category: item.category)
            TSBadge(derivedStatus.labelKey, tone: derivedStatus.tone)
            Spacer(minLength: 0)
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: item.name)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Text(verbatim: item.details)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var progressBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: MaintenanceFormat.percentLabel(progress))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                if let due = dueLabel {
                    Text(verbatim: due)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            TSMetricBar(
                fraction: MaintenanceFormat.progressFraction(progress),
                tone: MaintenanceFormat.progressTone(progress)
            )
        }
    }

    private var footerRow: some View {
        HStack(spacing: TSSpacing.lg) {
            if item.currentMileage > 0 {
                Label {
                    Text(verbatim: MaintenanceFormat.mileageLabel(item.currentMileage))
                } icon: {
                    Image(systemName: "gauge.with.dots.needle.bottom.50percent")
                }
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            }
            if let last = item.lastServiceDate {
                Label {
                    Text(verbatim: MaintenanceFormat.date(last))
                } icon: {
                    Image(systemName: "clock")
                }
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    /// Web due label: `Due: <date>` when a due date exists, else `Due: <mileage> mi`, else nil.
    private var dueLabel: String? {
        let due = String(localized: "Due")
        if let dueDate = item.dueDate {
            return "\(due): \(MaintenanceFormat.date(dueDate))"
        }
        if let dueMileage = item.dueMileage {
            return "\(due): \(MaintenanceFormat.mileageLabel(dueMileage))"
        }
        return nil
    }
}

// MARK: - Category badge (web `CategoryBadge` — tinted, tag icon + capitalized category)

/// A tinted category chip (web `CategoryBadge`): a tag icon + the capitalized category, colored by the
/// web `CATEGORY_COLORS` mapping (folded into the shared semantic tones).
struct MaintenanceCategoryBadge: View {
    let category: String

    private var tone: TSTone {
        MaintenanceFormat.categoryTone(category)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "tag.fill").font(.caption2)
            Text(verbatim: MaintenanceFormat.capitalized(category))
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}
