import SwiftUI

/// Labeled form field wrapper with inline error (web `FormField`).
public struct TSFormField<Content: View>: View {
    private let label: LocalizedStringKey
    private let error: LocalizedStringKey?
    private let content: () -> Content

    public init(
        _ label: LocalizedStringKey,
        error: LocalizedStringKey? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.label = label
        self.error = error
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel(label)
            content()
            if let error { TSErrorText(error) }
        }
    }
}

/// Titled form section (web `FormSection`).
public struct TSFormSection<Content: View>: View {
    private let title: LocalizedStringKey
    private let content: () -> Content

    public init(_ title: LocalizedStringKey, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSectionTitle(title)
            content()
        }
    }
}

/// Search field with clear button (web `SearchInput`).
public struct TSSearchInput: View {
    @Binding private var text: String
    private let prompt: LocalizedStringKey

    public init(text: Binding<String>, prompt: LocalizedStringKey = "search.prompt") {
        _text = text
        self.prompt = prompt
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass").foregroundStyle(Color.TS.textMuted)
            TextField(prompt, text: $text).textFieldStyle(.plain).font(Font.TS.body)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("action.clear"))
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// Token/tag entry field (web `TagInput`).
public struct TSTagInput: View {
    @Binding private var tags: [String]
    private let prompt: LocalizedStringKey
    @State private var draft = ""

    public init(tags: Binding<[String]>, prompt: LocalizedStringKey = "tag.prompt") {
        _tags = tags
        self.prompt = prompt
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: TSSpacing.xs) {
                        ForEach(tags, id: \.self) { tag in
                            HStack(spacing: TSSpacing.xs) {
                                Text(verbatim: tag).font(Font.TS.caption)
                                Button { tags.removeAll { $0 == tag } } label: {
                                    Image(systemName: "xmark").font(.caption2)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(Text("action.remove"))
                            }
                            .padding(.horizontal, TSSpacing.sm)
                            .padding(.vertical, 2)
                            .background(Color.TS.accent.opacity(0.12), in: Capsule())
                            .foregroundStyle(Color.TS.accent)
                        }
                    }
                }
            }
            TextField(prompt, text: $draft)
                .textFieldStyle(.plain)
                .onSubmit(addTag)
        }
    }

    private func addTag() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !tags.contains(trimmed) else { draft = ""; return }
        tags.append(trimmed)
        draft = ""
    }
}

/// One combobox option.
public struct TSComboOption<Value: Hashable>: Identifiable {
    public let value: Value
    public let title: LocalizedStringKey
    public let searchText: String
    public var id: Value {
        value
    }

    public init(_ value: Value, title: LocalizedStringKey, searchText: String) {
        self.value = value
        self.title = title
        self.searchText = searchText
    }
}

/// Searchable single-select combobox (web `Combobox`).
public struct TSCombobox<Value: Hashable>: View {
    @Binding private var selection: Value?
    private let options: [TSComboOption<Value>]
    private let prompt: LocalizedStringKey
    @State private var isOpen = false
    @State private var query = ""

    public init(
        selection: Binding<Value?>,
        options: [TSComboOption<Value>],
        prompt: LocalizedStringKey = "combo.prompt"
    ) {
        _selection = selection
        self.options = options
        self.prompt = prompt
    }

    private var filtered: [TSComboOption<Value>] {
        query.isEmpty ? options : options.filter { $0.searchText.lowercased().contains(query.lowercased()) }
    }

    private var selectedTitle: LocalizedStringKey? {
        options.first { $0.value == selection }?.title
    }

    public var body: some View {
        Button { isOpen.toggle() } label: {
            HStack {
                Text(selectedTitle ?? prompt)
                    .foregroundStyle(selectedTitle == nil ? Color.TS.textMuted : Color.TS.textPrimary)
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .popover(isPresented: $isOpen) {
            VStack(spacing: TSSpacing.sm) {
                TSSearchInput(text: $query)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(filtered) { option in
                            Button {
                                selection = option.value
                                isOpen = false
                            } label: {
                                HStack {
                                    Text(option.title)
                                    Spacer()
                                    if option.value == selection {
                                        Image(systemName: "checkmark").foregroundStyle(Color.TS.accent)
                                    }
                                }
                                .padding(.vertical, TSSpacing.xs)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 240)
            }
            .padding(TSSpacing.md)
            .frame(minWidth: 240)
        }
    }
}

/// Searchable multi-select combobox (web `ComboboxMulti`).
public struct TSComboboxMulti<Value: Hashable>: View {
    @Binding private var selection: Set<Value>
    private let options: [TSComboOption<Value>]
    private let prompt: LocalizedStringKey
    @State private var isOpen = false
    @State private var query = ""

    public init(
        selection: Binding<Set<Value>>,
        options: [TSComboOption<Value>],
        prompt: LocalizedStringKey = "combo.prompt"
    ) {
        _selection = selection
        self.options = options
        self.prompt = prompt
    }

    private var filtered: [TSComboOption<Value>] {
        query.isEmpty ? options : options.filter { $0.searchText.lowercased().contains(query.lowercased()) }
    }

    public var body: some View {
        Button { isOpen.toggle() } label: {
            HStack {
                Text(selection.isEmpty ? prompt : "combo.selectedCount \(selection.count)")
                    .foregroundStyle(selection.isEmpty ? Color.TS.textMuted : Color.TS.textPrimary)
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .popover(isPresented: $isOpen) {
            VStack(spacing: TSSpacing.sm) {
                TSSearchInput(text: $query)
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(filtered) { option in
                            Button {
                                if selection.contains(option.value) {
                                    selection.remove(option.value)
                                } else {
                                    selection.insert(option.value)
                                }
                            } label: {
                                HStack {
                                    Image(systemName: selection
                                        .contains(option.value) ? "checkmark.square.fill" : "square")
                                        .foregroundStyle(selection.contains(option.value) ? Color.TS.accent : Color.TS
                                            .textMuted)
                                    Text(option.title)
                                    Spacer()
                                }
                                .padding(.vertical, TSSpacing.xs)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 240)
            }
            .padding(TSSpacing.md)
            .frame(minWidth: 240)
        }
    }
}

/// Numeric currency input (web `CurrencyInput`).
public struct TSCurrencyInput: View {
    @Binding private var amount: Double
    private let code: String

    public init(amount: Binding<Double>, code: String = "USD") {
        _amount = amount
        self.code = code
    }

    public var body: some View {
        TextField("currency.prompt", value: $amount, format: .currency(code: code))
            .textFieldStyle(.plain)
            .monospacedDigit()
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

/// Numeric value with a trailing unit label (web `UnitInput`). SI conversion is
/// the page's responsibility (via the facade); this is a plain numeric input.
public struct TSUnitInput: View {
    @Binding private var value: Double
    private let unitLabel: String

    public init(value: Binding<Double>, unitLabel: String) {
        _value = value
        self.unitLabel = unitLabel
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TextField("number.prompt", value: $value, format: .number)
                .textFieldStyle(.plain)
                .monospacedDigit()
            Text(verbatim: unitLabel).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// One node in a `TSTreeSelect`.
public struct TSTreeNode: Identifiable {
    public let id: String
    public let label: LocalizedStringKey
    public let children: [TSTreeNode]

    public init(id: String, label: LocalizedStringKey, children: [TSTreeNode] = []) {
        self.id = id
        self.label = label
        self.children = children
    }
}

/// Hierarchical selector (web `TreeSelect`) over the native `OutlineGroup`.
public struct TSTreeSelect: View {
    @Binding private var selection: String?
    private let nodes: [TSTreeNode]

    public init(selection: Binding<String?>, nodes: [TSTreeNode]) {
        _selection = selection
        self.nodes = nodes
    }

    public var body: some View {
        List(nodes, children: \.optionalChildren) { node in
            Button {
                selection = node.id
            } label: {
                HStack {
                    Text(node.label)
                    Spacer()
                    if selection == node.id {
                        Image(systemName: "checkmark").foregroundStyle(Color.TS.accent)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

extension TSTreeNode {
    /// `nil` for leaves so `List(children:)` doesn't show an empty disclosure.
    var optionalChildren: [TSTreeNode]? {
        children.isEmpty ? nil : children
    }
}
