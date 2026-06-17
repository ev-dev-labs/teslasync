//
//  DataExportColumnPicker.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Column picker
//
//  SwiftUI parity of the web `ColumnPickerSection` body (the checkbox catalog shown
//  once `useExportColumns` returns a selectable type). Reproduces the web selection
//  semantics exactly: required (always-included) columns cannot be removed; toggling
//  emits the ordered allowlist; re-selecting every column collapses to `nil` (so the
//  submit omits `columns` and the backend keeps its byte-for-byte legacy behaviour);
//  "Select all" → `nil`; "Clear" keeps the required columns selected.
//

import SwiftUI

struct DataExportColumnPicker: View {
    let columns: [DataExportColumnInfo]
    /// Web `selectedColumns`: `nil` = untouched / all selected.
    @Binding var selectedColumns: [String]?

    private var allNames: [String] { columns.map(\.name) }
    private var requiredNames: Set<String> {
        Set(columns.filter(\.alwaysIncluded).map(\.name))
    }

    /// Web `effectiveSelected = selectedColumns ?? allColumnNames`.
    private var effectiveSelected: Set<String> {
        Set(selectedColumns ?? allNames)
    }

    /// Web `allSelected`.
    private var allSelected: Bool {
        let selected = effectiveSelected
        return selected.count == allNames.count && allNames.allSatisfy(selected.contains)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            grid
        }
        .padding()
        .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    // MARK: Header (helper text + Select all / Clear)

    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 12) { helperText; Spacer(minLength: 8); actions }
            VStack(alignment: .leading, spacing: 8) { helperText; actions }
        }
    }

    private var helperText: some View {
        Text(String(
            localized: "dataExport.columns.helperText",
            defaultValue: "Select which columns to include in the export. Required columns cannot be removed."
        ))
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button(String(localized: "dataExport.columns.selectAll", defaultValue: "Select all")) {
                selectedColumns = nil
            }
            .disabled(allSelected)
            Button(String(localized: "dataExport.columns.clear", defaultValue: "Clear"), action: clear)
        }
        .buttonStyle(.borderless)
        .font(.caption.weight(.medium))
    }

    // MARK: Checkbox grid

    private var grid: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 200), spacing: 8)],
            alignment: .leading,
            spacing: 8
        ) {
            ForEach(columns) { column in
                row(column)
            }
        }
        .accessibilityLabel(
            Text(String(localized: "dataExport.columns.title", defaultValue: "STEP 2½ — Columns"))
        )
    }

    private func row(_ column: DataExportColumnInfo) -> some View {
        let checked = effectiveSelected.contains(column.name)
        let required = requiredNames.contains(column.name)
        return Button {
            toggle(column.name)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .foregroundStyle(checked ? Color.accentColor : Color.secondary)
                Text(verbatim: column.label)
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if required {
                    DataExportChip(
                        text: String(localized: "dataExport.columns.alwaysIncluded", defaultValue: "Required"),
                        tone: .amber
                    )
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary.opacity(0.2), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(required ? 0.7 : 1)
        }
        .buttonStyle(.plain)
        .disabled(required)
        .accessibilityLabel(Text(verbatim: column.label))
        .accessibilityValue(Text(verbatim: checked
            ? String(localized: "dataExport.a11y.selected", defaultValue: "Selected")
            : String(localized: "dataExport.a11y.deselected", defaultValue: "Not selected")))
        .accessibilityAddTraits(checked ? [.isSelected] : [])
    }

    // MARK: Selection mutations (web `toggleColumn` / `handleClear`)

    private func toggle(_ name: String) {
        guard !requiredNames.contains(name) else { return }
        var next = effectiveSelected
        if next.contains(name) { next.remove(name) } else { next.insert(name) }
        let ordered = allNames.filter(next.contains)
        selectedColumns = ordered.count == allNames.count ? nil : ordered
    }

    private func clear() {
        let required = allNames.filter(requiredNames.contains)
        selectedColumns = required.count == allNames.count ? nil : required
    }
}
