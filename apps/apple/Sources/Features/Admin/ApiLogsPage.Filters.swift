import SwiftUI

/// The filter panel for `ApiLogsPage` (web `GlassPanel` #2 — `Filters`). Reproduces the web
/// filter grid: a Service dropdown (fed by the live + known-service union, with the
/// "{{tracked}} with data · {{known}} known" caption), Method + Status dropdowns, a free-text
/// endpoint field, and — adapting the web header `RangePicker` to a HIG-native control — a
/// toggle-gated start/end date range. The "Clear" action sits in the panel header (web
/// `hasFilters` → Clear). Kept as a dedicated surface (mirroring `AuditLogFiltersPanel`) so
/// the page file stays focused on chrome + stats.
///
/// Adaptive (ADR-002/006): a multi-column grid on macOS/iPad regular width, a single
/// stacked column on compact iPhone. Filter changes apply immediately from page 0 (web
/// `setFilter`); dynamic dropdown values render verbatim (server tokens) while the "All …"
/// options are localized. All copy resolves from `Localizable.xcstrings`; the panel binds to
/// the `@Observable` `ApiLogsPageModel`.
struct ApiLogsFiltersPanel: View {
    @Bindable var model: ApiLogsPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                headerRow
                LazyVGrid(columns: filterColumns, alignment: .leading, spacing: TSSpacing.md) {
                    serviceControl
                    methodControl
                    statusControl
                    endpointControl
                    sinceControl
                    untilControl
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("translation.apiLogs.filters"))
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    private var filterColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]
    }

    // MARK: - Header (web Filters title + Clear)

    private var headerRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSPanelTitle("translation.apiLogs.filters")
            Spacer(minLength: TSSpacing.md)
            if model.hasFilters {
                TSButton(variant: .ghost, size: .small) {
                    Task { await model.clearFilters() }
                } label: {
                    Label("translation.apiLogs.clear", systemImage: "xmark")
                }
            }
        }
    }

    // MARK: - Service (web `Select` + serviceCount caption)

    private var serviceControl: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Picker(selection: serviceBinding) {
                ForEach(serviceOptions) { option in
                    Text(verbatim: option.label).tag(option.value)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("translation.apiLogs.serviceFilterAria"))

            if model.stats?.byService != nil {
                Text(verbatim: ApiLogsPage.serviceCountText(
                    tracked: model.trackedServiceCount,
                    known: ApiLogsServiceCatalog.knownServices.count
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var serviceOptions: [ApiLogsServiceOption] {
        ApiLogsServiceCatalog.serviceOptions(
            byService: model.stats?.byService,
            activeService: model.service,
            allLabel: String(localized: "translation.apiLogs.allServices")
        )
    }

    // MARK: - Method (web `Select`)

    private var methodControl: some View {
        Picker(selection: methodBinding) {
            ForEach(ApiLogsMethodFilter.allCases) { option in
                methodOptionLabel(option).tag(option.rawValue)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .tint(Color.TS.accent)
        .accessibilityLabel(Text("translation.apiLogs.allMethods"))
    }

    @ViewBuilder
    private func methodOptionLabel(_ option: ApiLogsMethodFilter) -> some View {
        if option == .all {
            Text("translation.apiLogs.allMethods")
        } else {
            Text(verbatim: option.rawValue)
        }
    }

    // MARK: - Status (web `Select`)

    private var statusControl: some View {
        Picker(selection: statusBinding) {
            ForEach(ApiLogsStatusFilter.allCases) { option in
                statusOptionLabel(option).tag(option.rawValue)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .tint(Color.TS.accent)
        .accessibilityLabel(Text("translation.apiLogs.allStatus"))
    }

    @ViewBuilder
    private func statusOptionLabel(_ option: ApiLogsStatusFilter) -> some View {
        if option == .all {
            Text("translation.apiLogs.allStatus")
        } else {
            Text(verbatim: option.verbatimLabel)
        }
    }

    // MARK: - Endpoint (web search `Input`)

    private var endpointControl: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSTextField("translation.apiLogs.filterEndpoint", text: endpointBinding)
        }
    }

    // MARK: - Date range (web header `RangePicker` → toggle-gated start/end)

    private var sinceControl: some View {
        toggledDateFilter(
            label: "translation.apiLogs.startDate",
            isOn: enabledBinding(\.startEnabled),
            date: dateBinding(\.start)
        )
    }

    private var untilControl: some View {
        toggledDateFilter(
            label: "translation.apiLogs.endDate",
            isOn: enabledBinding(\.endEnabled),
            date: dateBinding(\.end)
        )
    }

    private func toggledDateFilter(
        label: LocalizedStringKey,
        isOn: Binding<Bool>,
        date: Binding<Date>
    ) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Toggle(isOn: isOn) {
                TSLabel(label)
            }
            .tint(Color.TS.accent)
            DatePicker(label, selection: date, displayedComponents: [.date])
                .labelsHidden()
                .disabled(!isOn.wrappedValue)
                .opacity(isOn.wrappedValue ? 1 : 0.45)
        }
    }

    // MARK: - Reloading bindings (apply from page 0 on user change; web `setFilter`)

    private var serviceBinding: Binding<String> {
        reloading(\.service)
    }

    private var methodBinding: Binding<String> {
        reloading(\.method)
    }

    private var statusBinding: Binding<String> {
        reloading(\.status)
    }

    private var endpointBinding: Binding<String> {
        reloading(\.endpoint)
    }

    private func reloading(_ keyPath: ReferenceWritableKeyPath<ApiLogsPageModel, String>) -> Binding<String> {
        Binding(
            get: { model[keyPath: keyPath] },
            set: { newValue in
                model[keyPath: keyPath] = newValue
                Task { await model.applyFilters() }
            }
        )
    }

    private func enabledBinding(_ keyPath: ReferenceWritableKeyPath<ApiLogsPageModel, Bool>) -> Binding<Bool> {
        Binding(
            get: { model[keyPath: keyPath] },
            set: { newValue in
                model[keyPath: keyPath] = newValue
                Task { await model.applyFilters() }
            }
        )
    }

    private func dateBinding(_ keyPath: ReferenceWritableKeyPath<ApiLogsPageModel, Date>) -> Binding<Date> {
        Binding(
            get: { model[keyPath: keyPath] },
            set: { newValue in
                model[keyPath: keyPath] = newValue
                Task { await model.applyFilters() }
            }
        )
    }
}
