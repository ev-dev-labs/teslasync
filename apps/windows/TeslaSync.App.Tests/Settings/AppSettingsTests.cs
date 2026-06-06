using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Units;
using Xunit;

namespace TeslaSync.App.Tests.Settings;

/// <summary>Verifies the <see cref="AppSettings"/> record: defaults, validation, and unit mapping.</summary>
public sealed class AppSettingsTests
{
    [Fact]
    public void Default_is_privacy_first()
    {
        var settings = AppSettings.Default;

        Assert.Equal(AppThemePreference.System, settings.Theme);
        Assert.Equal(InterfaceDensity.Comfortable, settings.Density);
        Assert.Equal(UnitSystemPreference.Metric, settings.Units);
        Assert.False(settings.TelemetryOptIn);
        Assert.False(settings.CrashReportingOptIn);
        Assert.False(settings.LaunchAtStartup);
        Assert.Equal(AppStartupPage.Dashboard, settings.StartupPage);
        Assert.Equal(AppSettings.DefaultMaxCacheEntries, settings.MaxCacheEntries);
        Assert.Equal(AppSettings.DefaultApiBaseUrl, settings.ApiBaseUrl);
    }

    [Theory]
    [InlineData(0, AppSettings.MinCacheEntries)]
    [InlineData(10, AppSettings.MinCacheEntries)]
    [InlineData(1_000_000, AppSettings.MaxCacheEntriesLimit)]
    [InlineData(750, 750)]
    public void Normalized_clamps_cache_bound(int input, int expected)
    {
        var normalized = (AppSettings.Default with { MaxCacheEntries = input }).Normalized();

        Assert.Equal(expected, normalized.MaxCacheEntries);
    }

    [Theory]
    [InlineData("", AppSettings.DefaultApiBaseUrl)]
    [InlineData("   ", AppSettings.DefaultApiBaseUrl)]
    [InlineData("not a url", AppSettings.DefaultApiBaseUrl)]
    [InlineData("ftp://teslasync.local", AppSettings.DefaultApiBaseUrl)]
    [InlineData("https://api.example.com/api/v1", "https://api.example.com")]
    [InlineData("http://localhost:8080", "http://localhost:8080")]
    public void Normalized_sanitizes_base_url(string input, string expected)
    {
        var normalized = (AppSettings.Default with { ApiBaseUrl = input }).Normalized();

        Assert.Equal(expected, normalized.ApiBaseUrl);
    }

    [Fact]
    public void Normalized_replaces_undefined_enums_with_defaults()
    {
        var corrupt = AppSettings.Default with
        {
            Theme = (AppThemePreference)99,
            Density = (InterfaceDensity)99,
            Units = (UnitSystemPreference)99,
            StartupPage = (AppStartupPage)99,
            ApiProfile = "   ",
        };

        var normalized = corrupt.Normalized();

        Assert.Equal(AppThemePreference.System, normalized.Theme);
        Assert.Equal(InterfaceDensity.Comfortable, normalized.Density);
        Assert.Equal(UnitSystemPreference.Metric, normalized.Units);
        Assert.Equal(AppStartupPage.Dashboard, normalized.StartupPage);
        Assert.Equal("default", normalized.ApiProfile);
    }

    [Fact]
    public void ToUnitPref_maps_measurement_system()
    {
        Assert.Same(UnitPref.Metric, (AppSettings.Default with { Units = UnitSystemPreference.Metric }).ToUnitPref());
        Assert.Same(UnitPref.Imperial, (AppSettings.Default with { Units = UnitSystemPreference.Imperial }).ToUnitPref());
    }

    [Fact]
    public void Settings_carry_no_secret_material()
    {
        // The non-secret settings tier must never hold tokens / credentials — those belong to the W4
        // secure store. Guard against a future field name that would smuggle a secret in here.
        var forbidden = new[] { "token", "secret", "password", "credential", "apikey", "bearer" };

        foreach (var property in typeof(AppSettings).GetProperties())
        {
            var name = property.Name.ToLowerInvariant();
            Assert.DoesNotContain(forbidden, term => name.Contains(term, StringComparison.Ordinal));
        }
    }
}
