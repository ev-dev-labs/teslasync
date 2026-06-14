import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/APIKeysPage.tsx` (route
/// `/api-keys`). Reproduces the web page chrome (web `PageContainer`: title + subtitle +
/// the "Create Key" header action) and the keyed list of API keys — each key is the web's
/// per-row `GlassPanel` (GlassPanel2, in `APIKeysPage.Row.swift`) with its permission chip,
/// expired badge, prefix / created / last-used meta, and revoke + delete actions. The
/// create flow (web `Modal`) is an HIG-native sheet that mints a key and reveals the
/// one-time secret inside a `GlassPanel` (GlassPanel1, in `APIKeysPage.CreateSheet.swift`);
/// the delete confirmation (web `ConfirmDialog`) is an HIG-native sheet
/// (`APIKeysPage.DeleteSheet.swift`).
///
/// The list switches its own data state in place (loading skeletons / empty / error+Retry /
/// success), never rendering a blank region. All copy resolves from `Localizable.xcstrings`
/// with the web key names; data binds through the `@Observable` `APIKeysPageModel` (no
/// networking in the view, ADR-004 — API-key metadata carries no SI units). Adaptive across
/// macOS/iPad (regular) + iPhone (compact) per ADR-002/006.
public struct APIKeysPage: View {
    @State private var model: APIKeysPageModel

    public init(model: APIKeysPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                listSection
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task { await model.load() }
        .sheet(isPresented: $model.createPresented) {
            APIKeysCreateSheet(model: model)
        }
        .sheet(item: deleteItem) { target in
            APIKeysDeleteSheet(model: model, target: target)
        }
    }

    /// Binding seam for the delete sheet: reads `deleteTarget` (private(set) on the model)
    /// and routes a swipe-dismiss back through the model's guarded `cancelDelete`.
    private var deleteItem: Binding<APIKeyEntry?> {
        Binding(
            get: { model.deleteTarget },
            set: { newValue in if newValue == nil { model.cancelDelete() } }
        )
    }

    // MARK: - Header (web PageContainer title + subtitle + "Create Key" action)

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle("API Keys")
                Text("Manage programmatic access to TeslaSync")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            createButton
        }
    }

    private var createButton: some View {
        TSButton(variant: .primary, size: .medium) {
            model.beginCreate()
        } label: {
            Label("Create Key", systemImage: "plus")
        }
        .accessibilityLabel(Text("Create Key"))
    }

    // MARK: - Keys list (web `keys` query → skeletons / EmptyState / rows)

    @ViewBuilder
    private var listSection: some View {
        switch model.listState {
        case .loading:
            loadingView
        case .empty:
            emptyView
        case let .error(message):
            errorView(message)
        case let .loaded(rows):
            keysList(rows)
        }
    }

    private var loadingView: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 76, cornerRadius: TSRadius.lg)
            }
        }
        .accessibilityLabel(Text("API Keys"))
    }

    private var emptyView: some View {
        TSEmptyState(
            title: "No API keys",
            message: "Create an API key to enable programmatic access to TeslaSync data and controls.",
            systemImage: "key"
        )
        .frame(maxWidth: .infinity)
    }

    private func errorView(_ message: String) -> some View {
        TSErrorDisplay(onRetry: { Task { await model.reload() } })
            .frame(maxWidth: .infinity)
            .accessibilityValue(Text(verbatim: message))
    }

    private func keysList(_ rows: [APIKeyEntry]) -> some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(rows) { key in
                APIKeyRow(
                    entry: key,
                    isExpired: model.isExpired(key),
                    isRevoking: model.isRevoking(key),
                    onRevoke: { Task { await model.revoke(key) } },
                    onDelete: { model.askDelete(key) }
                )
            }
        }
    }

    // MARK: - Shared delete copy (web `'…delete the key "{{name}}"?'`)

    /// Web `t('Are you sure you want to permanently delete the key "{{name}}"?', { name })`
    /// — the verbatim web key/default with the i18next `{{name}}` token resolved.
    static func deleteMessage(for name: String) -> String {
        String(localized: "Are you sure you want to permanently delete the key \"{{name}}\"?")
            .replacingOccurrences(of: "{{name}}", with: name)
    }
}

#if DEBUG
    #Preview("Loaded") {
        APIKeysPage(model: APIKeysPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        APIKeysPage(model: APIKeysPageModel(dataSource: PreviewEmptyAPIKeys()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        APIKeysPage(model: APIKeysPageModel(dataSource: PreviewFailingAPIKeys()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero rows (drives the empty state).
    private struct PreviewEmptyAPIKeys: APIKeysDataSource {
        func loadKeys() async throws -> [APIKeyEntry] {
            []
        }

        func createKey(name _: String, permissions _: APIKeyPermission) async throws -> CreatedAPIKey {
            CreatedAPIKey(
                entry: APIKeyEntry(id: "x", name: "x", keyPrefix: "x", permissions: .read, createdAt: ""),
                key: "tsk_live_preview"
            )
        }

        func deleteKey(id _: String) async throws {}
        func revokeKey(id _: String) async throws {}
    }

    /// Preview seam that fails the read (drives the error state).
    private struct PreviewFailingAPIKeys: APIKeysDataSource {
        struct Failure: Error {}
        func loadKeys() async throws -> [APIKeyEntry] {
            throw Failure()
        }

        func createKey(name _: String, permissions _: APIKeyPermission) async throws -> CreatedAPIKey {
            throw Failure()
        }

        func deleteKey(id _: String) async throws {
            throw Failure()
        }

        func revokeKey(id _: String) async throws {
            throw Failure()
        }
    }
#endif
