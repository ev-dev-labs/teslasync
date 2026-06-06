using System.Xml.Linq;
using Xunit;

namespace TeslaSync.App.Tests.Packaging;

/// <summary>
/// Asserts the real MSIX <c>Package.appxmanifest</c> (copied next to the test assembly) declares the
/// identity, protocol activation, file type association and capabilities the packaged Windows app
/// requires (P2/W8-0002).
/// </summary>
public sealed class PackageManifestTests
{
    private static readonly XNamespace Foundation = "http://schemas.microsoft.com/appx/manifest/foundation/windows10";
    private static readonly XNamespace Uap = "http://schemas.microsoft.com/appx/manifest/uap/windows10";
    private static readonly XNamespace Rescap = "http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities";

    private static XDocument LoadManifest()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Package.appxmanifest");
        Assert.True(File.Exists(path), $"Package.appxmanifest was not copied next to the tests at {path}");
        return XDocument.Load(path);
    }

    [Fact]
    public void Identity_and_display_name_are_declared()
    {
        var manifest = LoadManifest();

        var identity = manifest.Root!.Element(Foundation + "Identity");
        Assert.NotNull(identity);
        Assert.False(string.IsNullOrWhiteSpace(identity!.Attribute("Name")?.Value));
        Assert.False(string.IsNullOrWhiteSpace(identity.Attribute("Publisher")?.Value));

        var version = identity.Attribute("Version")?.Value;
        Assert.Matches(@"^\d+\.\d+\.\d+\.\d+$", version);

        var displayName = manifest.Root!
            .Element(Foundation + "Properties")?
            .Element(Foundation + "DisplayName")?.Value;
        Assert.Equal("TeslaSync", displayName);
    }

    [Fact]
    public void Protocol_activation_is_registered()
    {
        var manifest = LoadManifest();

        var protocols = manifest.Descendants(Uap + "Protocol")
            .Select(p => p.Attribute("Name")?.Value)
            .ToList();

        Assert.Contains("teslasync", protocols);
    }

    [Fact]
    public void Teslasync_file_type_association_is_registered()
    {
        var manifest = LoadManifest();

        var fileTypes = manifest.Descendants(Uap + "FileType")
            .Select(f => f.Value)
            .ToList();

        Assert.Contains(".teslasync", fileTypes);
    }

    [Fact]
    public void Required_capabilities_are_declared()
    {
        var manifest = LoadManifest();

        var capabilities = manifest.Descendants(Foundation + "Capability")
            .Select(c => c.Attribute("Name")?.Value)
            .ToList();
        var restricted = manifest.Descendants(Rescap + "Capability")
            .Select(c => c.Attribute("Name")?.Value)
            .ToList();

        Assert.Contains("internetClient", capabilities);
        Assert.Contains("runFullTrust", restricted);
    }
}
