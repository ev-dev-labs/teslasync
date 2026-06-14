import SwiftUI

/// The filter row for `AuditLogPage` (web `GlassPanel` #2 — `Filters`). Reproduces the
/// web filter grid: a since/until datetime range, category + action dropdowns (fed from
/// the distinct-value feeds), free-text actor + entity-type fields, a rows-per-page
/// select, and the Reset / Search actions. Kept as a dedicated surface (mirroring
/// `DiskForecastPage.Table`) so the page file stays focused on chrome + states.
///
/// Adaptive (ADR-002/006): a multi-column grid on macOS/iPad regular width, a single
/// stacked column on compact iPhone. Optional datetime filters (web empty
/// datetime-local) are modelled as a toggle-gated `DatePicker` — the HIG-native way to
/// express "unset" — so a disabled toggle maps to a `nil` query param. Dynamic dropdown
/// values render verbatim (server tokens); only the "All …" option is localized. All
/// copy resolves from `Localizable.xcstrings`; the filter row binds to the `@Observable`
/// `AuditLogPageModel`.
struct AuditLogFiltersPanel: View {
    @Bindable var model: AuditLogPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("admin.auditLog.filtersTitle")
                LazyVGrid(columns: filterColumns, alignment: .leading, spacing: TSSpacing.md) {
                    sinceFilter
                    untilFilter
                    categoryFilter
                    actionFilter
                    actorField
                    entityTypeField
                    limitFilter
                }
                actionRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.auditLog.filtersTitle"))
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
            : [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)]
    }

    // MARK: - Datetime range (web `Input type="datetime-local"` × 2)

    private var sinceFilter: some View {
        toggledDateFilter(
            label: "admin.auditLog.sinceLabel",
            isOn: $model.sinceEnabled,
            date: $model.since
        )
    }

    private var untilFilter: some View {
        toggledDateFilter(
            label: "admin.auditLog.untilLabel",
            isOn: $model.untilEnabled,
            date: $model.until
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
            DatePicker(label, selection: date, displayedComponents: [.date, .hourAndMinute])
                .labelsHidden()
                .disabled(!isOn.wrappedValue)
                .opacity(isOn.wrappedValue ? 1 : 0.45)
        }
    }

    // MARK: - Category / action dropdowns (web `Select` fed by distinct-value feeds)

    private var categoryFilter: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel("admin.auditLog.categoryLabel")
            Picker(selection: $model.category) {
                Text("admin.auditLog.allCategories").tag("")
                ForEach(model.categories, id: \.self) { category in
                    Text(verbatim: category).tag(category)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("admin.auditLog.categoryLabel"))
        }
    }

    private var actionFilter: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel("admin.auditLog.actionLabel")
            Picker(selection: $model.action) {
                Text("admin.auditLog.allActions").tag("")
                ForEach(model.actions, id: \.self) { action in
                    Text(verbatim: action).tag(action)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("admin.auditLog.actionLabel"))
        }
    }

    // MARK: - Free-text filters (web `Input` actor + entity type)

    private var actorField: some View {
        TSTextField(
            "admin.auditLog.actorPlaceholder", // parity:allow i18n key name, not a stub
            text: $model.actor,
            label: "admin.auditLog.actorLabel"
        )
    }

    private var entityTypeField: some View {
        TSTextField(
            "admin.auditLog.entityTypePlaceholder", // parity:allow i18n key name, not a stub
            text: $model.entityType,
            label: "admin.auditLog.entityTypeLabel"
        )
    }

    // MARK: - Rows-per-page (web `Select` LIMIT_OPTIONS)

    private var limitFilter: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel("admin.auditLog.limitLabel")
            Picker(selection: $model.limit) {
                ForEach(AuditLogPageModel.limitOptions, id: \.self) { option in
                    Text(verbatim: String(option)).tag(option)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("admin.auditLog.limitLabel"))
        }
    }

    // MARK: - Reset / Search (web `handleReset` + `logQuery.refetch()`)

    private var actionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TSButton(variant: .ghost, size: .medium) {
                Task { await model.resetFilters() }
            } label: {
                Label("admin.auditLog.resetFilters", systemImage: "xmark")
            }
            TSButton(variant: .primary, size: .medium) {
                Task { await model.applyFilters() }
            } label: {
                Label("admin.auditLog.applyFilters", systemImage: "magnifyingglass")
            }
        }
    }
}
