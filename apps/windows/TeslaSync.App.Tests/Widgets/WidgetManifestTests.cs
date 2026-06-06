using System.Xml.Linq;
using TeslaSync.App.Core.Widgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Asserts the real MSIX manifest declares the Windows widget provider (P2/W8-0003): the COM ExeServer
/// the Widgets Board launches, the <c>com.microsoft.windows.widgets</c> app extension, and the
/// vehicle-status widget definition — with the activation CLSID consistent across both. No classic
/// Live Tile surface is declared, matching the not-applicable decision.
/// </summary>
public sealed class WidgetManifestTests
{
    private const string ProviderClsid = "B7E6D2A1-4C3F-4A5E-9D8B-1F2A3C4D5E60";

    private static XDocument LoadManifest()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Package.appxmanifest");
        Assert.True(File.Exists(path), $"Package.appxmanifest was not copied next to the tests at {path}");
        return XDocument.Load(path);
    }

    private static IEnumerable<XElement> ByLocalName(XDocument doc, string localName) =>
        doc.Descendants().Where(e => e.Name.LocalName == localName);

    [Fact]
    public void Widget_com_exe_server_is_registered_with_the_activation_argument()
    {
        var manifest = LoadManifest();

        var exeServer = ByLocalName(manifest, "ExeServer")
            .FirstOrDefault(e => (e.Attribute("Arguments")?.Value ?? string.Empty)
                .Contains("-RegisterProcessAsComServer", StringComparison.Ordinal));
        Assert.NotNull(exeServer);

        var classId = exeServer!.Elements().First(e => e.Name.LocalName == "Class").Attribute("Id")?.Value;
        Assert.Equal(ProviderClsid, classId, ignoreCase: true);
    }

    [Fact]
    public void Widget_app_extension_is_declared()
    {
        var manifest = LoadManifest();

        var names = ByLocalName(manifest, "AppExtension")
            .Select(e => e.Attribute("Name")?.Value)
            .ToList();

        Assert.Contains("com.microsoft.windows.widgets", names);
    }

    [Fact]
    public void Vehicle_status_widget_definition_matches_the_catalog_id()
    {
        var manifest = LoadManifest();

        var ids = ByLocalName(manifest, "Definition")
            .Select(e => e.Attribute("Id")?.Value)
            .ToList();

        Assert.Contains(WidgetDefinitions.VehicleStatusId, ids);
    }

    [Fact]
    public void Activation_class_id_matches_the_com_server_class()
    {
        var manifest = LoadManifest();

        var createInstance = ByLocalName(manifest, "CreateInstance").Single();
        Assert.Equal(ProviderClsid, createInstance.Attribute("ClassId")?.Value, ignoreCase: true);
    }
}
