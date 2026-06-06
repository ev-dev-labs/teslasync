using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Theme;
using Xunit;

namespace TeslaSync.App.Tests.Theme;

/// <summary>
/// W9 component-state coverage for the high-contrast theme seam (<see cref="ThemeResolver"/>): the OS
/// high-contrast palette overrides any persisted light/dark preference, and both the high-contrast
/// and system variants defer to the OS palette rather than forcing an explicit theme.
/// </summary>
public sealed class ThemeResolverTests
{
    [Theory]
    [InlineData(AppThemePreference.System, ThemeVariant.System)]
    [InlineData(AppThemePreference.Light, ThemeVariant.Light)]
    [InlineData(AppThemePreference.Dark, ThemeVariant.Dark)]
    public void Resolve_WithoutHighContrast_MapsPreference(AppThemePreference preference, ThemeVariant expected) =>
        Assert.Equal(expected, ThemeResolver.Resolve(preference, systemHighContrast: false));

    [Theory]
    [InlineData(AppThemePreference.System)]
    [InlineData(AppThemePreference.Light)]
    [InlineData(AppThemePreference.Dark)]
    public void Resolve_HighContrast_OverridesEveryPreference(AppThemePreference preference) =>
        Assert.Equal(ThemeVariant.HighContrast, ThemeResolver.Resolve(preference, systemHighContrast: true));

    [Theory]
    [InlineData(ThemeVariant.System, true)]
    [InlineData(ThemeVariant.HighContrast, true)]
    [InlineData(ThemeVariant.Light, false)]
    [InlineData(ThemeVariant.Dark, false)]
    public void DefersToSystemPalette_OnlyForSystemAndHighContrast(ThemeVariant variant, bool defers) =>
        Assert.Equal(defers, ThemeResolver.DefersToSystemPalette(variant));
}
