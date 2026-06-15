import SwiftUI

// MARK: - Controls bar (web GlassPanel1 control row)

/// The populated controls row inside GlassPanel1 (web): the vehicle picker, the signal-name
/// search, the category filter, the auto-refresh toggle, the Refresh button, and the two
/// destructive purge buttons. Adaptive (ADR-002/006) — the picker pair and the action buttons
/// reflow from a row on macOS / iPad regular width to a stack on compact iPhone width. All copy
/// resolves from `Localizable.xcstrings`; state binds to the `@Observable` model.
struct RedisControlsBar: View {
    @Bindable var model: RedisSignalViewerPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            RedisAdaptiveStack {
                vehiclePicker
                categoryPicker
            }
            searchField
            HStack(spacing: TSSpacing.md) {
                TSToggle("redis.autoRefresh", isOn: autoRefreshBinding)
                Spacer(minLength: 0)
            }
            RedisAdaptiveStack {
                refreshButton
                purgeButton
                purgeAllButton
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Vehicle picker (web `<Select>` of vehicles)

    private var vehiclePicker: some View {
        Picker(selection: vehicleBinding) {
            Text("redis.selectVehicle").tag(Int64?.none)
            ForEach(model.vehicles) { vehicle in
                Text(verbatim: vehicle.label).tag(Int64?.some(vehicle.id))
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: RedisSignalViewerPage.pickerWidth, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityLabel(Text("redis.selectVehicle"))
    }

    private var vehicleBinding: Binding<Int64?> {
        Binding(
            get: { model.selectedVehicleID },
            set: { model.selectVehicle($0) }
        )
    }

    // MARK: Category filter (web `<Select>` of categories with counts)

    private var categoryPicker: some View {
        Picker(selection: categoryBinding) {
            Text("redis.allCategories").tag(RedisCategoryFilter.all)
            ForEach(Self.categoryFilters, id: \.self) { filter in
                if let category = filter.category {
                    Text(verbatim: "\(category.label) (\(model.count(for: category)))").tag(filter)
                }
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityLabel(Text("redis.allCategories"))
    }

    /// The five concrete category filters in web order (Battery → Other).
    private static let categoryFilters: [RedisCategoryFilter] = [
        .battery, .charging, .driving, .climate, .other
    ]

    private var categoryBinding: Binding<RedisCategoryFilter> {
        Binding(
            get: { model.categoryFilter },
            set: { model.setCategoryFilter($0) }
        )
    }

    // MARK: Search (web `<Input>` with a leading magnifier)

    private var searchField: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSTextField("redis.searchPlaceholder", text: $model.search) // parity:allow required i18n key
        }
    }

    private var autoRefreshBinding: Binding<Bool> {
        Binding(
            get: { model.autoRefresh },
            set: { model.setAutoRefresh($0) }
        )
    }

    // MARK: Action buttons

    private var refreshButton: some View {
        TSButton(
            variant: .secondary,
            size: .small,
            action: { Task { await model.refreshSignals() } },
            label: { Label("redis.refresh", systemImage: "arrow.clockwise") }
        )
        .disabled(!model.canRefresh)
        .accessibilityLabel(Text("redis.refresh"))
    }

    private var purgeButton: some View {
        TSButton(
            variant: .destructive,
            size: .small,
            action: { model.openPurgeOne() },
            label: { Label("redis.purgeButton", systemImage: "trash") }
        )
        .disabled(!model.hasSelection || model.isPurging)
        .help(Text("redis.purgeButtonTitle"))
        .accessibilityLabel(Text("redis.purgeButton"))
        .accessibilityHint(Text("redis.purgeButtonTitle"))
    }

    private var purgeAllButton: some View {
        TSButton(
            variant: .destructive,
            size: .small,
            action: { model.openPurgeAll() },
            label: { Label("redis.purgeAllButton", systemImage: "trash.fill") }
        )
        .disabled(model.isPurging)
        .help(Text("redis.purgeAllButtonTitle"))
        .accessibilityLabel(Text("redis.purgeAllButton"))
        .accessibilityHint(Text("redis.purgeAllButtonTitle"))
    }
}

// MARK: - Persistent diagnostic chips (web header chips)

/// The persistent diagnostic chips shown once a vehicle is selected (web `meta` chips): the
/// live-signal-store mode, the VIN, and the L1 last-seen timestamp. Reproduced as token-styled
/// HIG chips; the mode + last-seen copy resolves from `Localizable.xcstrings` with the web key
/// names and interpolates at the display boundary.
struct RedisMetaChips: View {
    let meta: RedisSignalsMeta

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .medium
        return formatter
    }()

    var body: some View {
        RedisAdaptiveStack {
            RedisMetaChip(text: modeText, tone: meta.isHybrid ? .success : .danger)
            if let vin = meta.vehicleVIN, !vin.isEmpty {
                RedisMetaChip(text: vin, tone: .neutral, monospaced: true)
            }
            if let seenAt = meta.l1LastSeenAt {
                RedisMetaChip(text: l1SeenText(seenAt), tone: .info)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    /// Web `t('redis.headerChip.mode', 'Mode: {{mode}}', { mode })`.
    private var modeText: String {
        String(format: String(localized: "redis.headerChip.mode"), meta.liveSignalStoreMode)
    }

    /// Web `t('redis.headerChip.l1Seen', 'L1 last: {{date}}', { date: formatTime(...) })`.
    private func l1SeenText(_ date: Date) -> String {
        String(format: String(localized: "redis.headerChip.l1Seen"), Self.dateFormatter.string(from: date))
    }
}

/// A small token-styled chip rendering verbatim diagnostic text (web `Badge`). Kept local to
/// the viewer because the shared `TSBadge` only accepts a `LocalizedStringKey`, whereas these
/// chips carry runtime values (mode token, VIN, formatted timestamp).
struct RedisMetaChip: View {
    let text: String
    let tone: TSTone
    var monospaced = false

    var body: some View {
        Text(verbatim: text)
            .font(monospaced ? .system(.caption, design: .monospaced) : Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Adaptive stack helper

/// A row on macOS / iPad regular width, a vertical stack on compact iPhone width — the native
/// analogue of the web `flex-wrap` control row (ADR-002/006).
struct RedisAdaptiveStack<Content: View>: View {
    @ViewBuilder var content: () -> Content

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isCompact: Bool {
            horizontalSizeClass == .compact
        }
    #else
        private var isCompact: Bool {
            false
        }
    #endif

    var body: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.sm, content: content)
        } else {
            HStack(alignment: .center, spacing: TSSpacing.md, content: content)
        }
    }
}

/// Maps a model-layer tone token to the shared SwiftUI `TSTone`.
extension TSToneToken {
    var tsTone: TSTone {
        switch self {
        case .neutral: .neutral
        case .accent: .accent
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .info: .info
        }
    }
}
