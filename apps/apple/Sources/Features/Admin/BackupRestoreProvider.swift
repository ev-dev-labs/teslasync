import Foundation

// MARK: - Provider catalog (web `PROVIDERS` / `PROVIDER_FIELDS`)

/// A backup storage backend (web `PROVIDERS`). Display names are vendor proper nouns
/// rendered verbatim (the web labels them identically, not via i18n). The per-provider
/// credential field set mirrors the web `PROVIDER_FIELDS` map 1:1.
public enum BackupProvider: String, CaseIterable, Hashable, Sendable, Identifiable {
    case local
    case s3
    case azure
    case gcs

    public init(_ raw: String) {
        self = BackupProvider(rawValue: raw) ?? .local
    }

    public var id: String {
        rawValue
    }

    /// Vendor display label (web `PROVIDERS[].label`).
    public var displayName: String {
        switch self {
        case .local: "Local"
        case .s3: "Amazon S3"
        case .azure: "Azure Blob"
        case .gcs: "Google Cloud"
        }
    }

    /// SF Symbol for the provider chip (web `PROVIDER_ICON`).
    public var symbolName: String {
        switch self {
        case .local: "folder"
        default: "cloud"
        }
    }

    /// The editable credential fields for this provider (web `PROVIDER_FIELDS[provider]`).
    public var fields: [BackupProviderField] {
        switch self {
        case .local:
            [BackupProviderField(key: "path", label: "Path", required: true, prompt: "/backups")]
        case .s3:
            BackupProvider.s3Fields
        case .azure:
            BackupProvider.azureFields
        case .gcs:
            BackupProvider.gcsFields
        }
    }

    private static let s3Fields: [BackupProviderField] = [
        BackupProviderField(key: "bucket", label: "Bucket", required: true, prompt: "my-backup-bucket"),
        BackupProviderField(key: "region", label: "Region", required: true, prompt: "us-east-1"),
        BackupProviderField(key: "access_key", label: "Access Key", required: true),
        BackupProviderField(key: "secret_key", label: "Secret Key", kind: .password, required: true),
        BackupProviderField(key: "endpoint", label: "Endpoint (optional)", prompt: "https://s3.amazonaws.com"),
        BackupProviderField(key: "prefix", label: "Prefix (optional)", prompt: "backups/")
    ]

    private static let azureFields: [BackupProviderField] = [
        BackupProviderField(key: "account_name", label: "Account Name", required: true),
        BackupProviderField(key: "account_key", label: "Account Key", kind: .password, required: true),
        BackupProviderField(key: "container_name", label: "Container Name", required: true),
        BackupProviderField(key: "prefix", label: "Prefix (optional)", prompt: "backups/")
    ]

    private static let gcsFields: [BackupProviderField] = [
        BackupProviderField(key: "bucket", label: "Bucket", required: true, prompt: "my-backup-bucket"),
        BackupProviderField(key: "credentials_json", label: "Credentials JSON", kind: .multiline, required: true),
        BackupProviderField(key: "prefix", label: "Prefix (optional)", prompt: "backups/")
    ]
}

/// One editable credential field for a provider (web `PROVIDER_FIELDS[]` entry). The
/// label is a vendor term rendered verbatim; `kind` selects the input control.
public struct BackupProviderField: Identifiable, Hashable, Sendable {
    /// The input control kind (web field `type`): single-line, masked, or multi-line.
    public enum Kind: Sendable, Hashable {
        case text
        case password
        case multiline
    }

    public let key: String
    public let label: String
    public let kind: Kind
    public let required: Bool
    public let prompt: String

    public init(key: String, label: String, kind: Kind = .text, required: Bool = false, prompt: String = "") {
        self.key = key
        self.label = label
        self.kind = kind
        self.required = required
        self.prompt = prompt
    }

    public var id: String {
        key
    }

    /// The rendered label — web appends `*` for required fields (`${label} *`).
    public var displayLabel: String {
        required ? "\(label) *" : label
    }
}
