namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// The catalog of Windows widgets TeslaSync provides (P2/W8-0003). The ids and provider name are the
/// contract shared by the packaged <c>Package.appxmanifest</c> widget-provider definition, the
/// <c>Microsoft.Windows.Widgets.Providers</c> host callbacks (which identify a widget by its
/// <c>DefinitionId</c>), and the headless tests. Keeping them here means the manifest, the provider and
/// the tests can never drift to three different spellings of the same widget.
/// </summary>
public static class WidgetDefinitions
{
    /// <summary>The Windows app-extension contract name a widget provider must declare.</summary>
    public const string ProviderExtensionName = "com.microsoft.windows.widgets";

    /// <summary>The definition id of the vehicle-status widget (matches the manifest entry).</summary>
    public const string VehicleStatusId = "TeslaSync_VehicleStatus";

    /// <summary>The default (localizable) display name of the vehicle-status widget.</summary>
    public const string VehicleStatusDisplayName = "Vehicle status";

    /// <summary>The default (localizable) description of the vehicle-status widget.</summary>
    public const string VehicleStatusDescription =
        "Battery, range and charge status for your Tesla, with quick links into TeslaSync.";

    /// <summary>The packaged Adaptive Card template file backing the vehicle-status widget.</summary>
    public const string VehicleStatusTemplateFile = "VehicleStatusTemplate.json";

    /// <summary>True when <paramref name="definitionId"/> is a widget this provider services.</summary>
    public static bool IsKnown(string? definitionId) =>
        string.Equals(definitionId, VehicleStatusId, StringComparison.Ordinal);
}
