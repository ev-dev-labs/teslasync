import Foundation

/// Resolves the Energy Products surface's labels + interpolated strings at the display boundary,
/// keeping the web key names. The product `resourceLabel` / `operationModeLabel` maps and the
/// `{type} · ID {id}` subtitle the web computes inline are resolved here so the views hold no
/// hardcoded literals; unknown API values pass through verbatim exactly as the web does
/// (`return type` / `return mode ?? '—'`).
public enum EnergyProductsStrings {
    /// Web `resourceLabel(type)`: `battery` ⇒ "Powerwall", `solar` ⇒ "Solar", else the raw type.
    public static func resourceLabel(_ type: String) -> String {
        switch type {
        case "battery":
            return String(localized: "energy.products.resourcePowerwall", defaultValue: "Powerwall")
        case "solar":
            return String(localized: "energy.products.resourceSolar", defaultValue: "Solar")
        default:
            return type
        }
    }

    /// Web `operationModeLabel(mode)`: the three known Tesla modes mapped to friendly names, else
    /// the raw mode (or an em dash when absent).
    public static func operationMode(_ mode: String?) -> String {
        switch mode {
        case "self_consumption":
            return String(localized: "energy.siteInfo.modeSelfPowered", defaultValue: "Self-Powered")
        case "autonomous":
            return String(localized: "energy.siteInfo.modeTimeBased", defaultValue: "Time-Based Control")
        case "backup":
            return String(localized: "energy.siteInfo.modeBackupOnly", defaultValue: "Backup Only")
        default:
            return mode ?? EnergyProductsFormat.emptyValue
        }
    }

    /// Web `ID {energy_site_id}` chip.
    public static func siteIdLabel(_ id: Int64) -> String {
        String(localized: "energy.products.siteId", defaultValue: "ID {{id}}")
            .replacingOccurrences(of: "{{id}}", with: "\(id)")
    }

    /// Web subtitle line `{resourceLabel(resource_type)} · ID {energy_site_id}`.
    public static func siteSubtitle(type: String, id: Int64) -> String {
        "\(resourceLabel(type)) · \(siteIdLabel(id))"
    }

    /// Web `{t('energy.products.lastFetched')}: {formatDateTime(fetched_at)}`.
    public static func lastFetched(_ raw: String?) -> String {
        let label = String(localized: "energy.products.lastFetched", defaultValue: "Last fetched")
        return "\(label): \(EnergyProductsFormat.dateTime(raw))"
    }

    /// Web `{t('energy.siteInfo.lastFetched')}: {formatDateTime(response.fetched_at)}`.
    public static func siteInfoFetched(_ raw: String?) -> String {
        let label = String(localized: "energy.siteInfo.lastFetched", defaultValue: "Site info fetched")
        return "\(label): \(EnergyProductsFormat.dateTime(raw))"
    }

    /// Web `{t('energy.siteInfo.firmware')}: {info.version}`.
    public static func firmwareLine(_ version: String) -> String {
        let label = String(localized: "energy.siteInfo.firmware", defaultValue: "Firmware")
        return "\(label): \(version)"
    }
}
