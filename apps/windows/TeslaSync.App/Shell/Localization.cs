using Microsoft.Windows.ApplicationModel.Resources;
using TeslaSync.App.Core.Navigation;

namespace TeslaSync.App.Shell;

/// <summary>
/// Thin localization bridge for shell chrome. Resolves a route's resource key from
/// <c>Strings/{lang}/Resources.resw</c> and falls back to the route's English
/// default when the key (or the resource subsystem) is unavailable — which keeps the
/// shell working in headless/unpackaged contexts while still flowing every label
/// through the resource pipeline (ADR-016 i18n).
/// </summary>
internal static class Localization
{
    private static ResourceLoader? _loader;
    private static bool _loaderTried;

    private static ResourceLoader? Loader
    {
        get
        {
            if (!_loaderTried)
            {
                _loaderTried = true;
                try
                {
                    _loader = new ResourceLoader();
                }
                catch (Exception)
                {
                    _loader = null;
                }
            }

            return _loader;
        }
    }

    /// <summary>Resolve <paramref name="key"/> to a localized string, or return <paramref name="fallback"/>.</summary>
    public static string Get(string? key, string fallback)
    {
        if (string.IsNullOrEmpty(key))
        {
            return fallback;
        }

        try
        {
            // resw keys use '/' as the hierarchy separator; our keys use '.'.
            var value = Loader?.GetString(key.Replace('.', '/'));
            return string.IsNullOrEmpty(value) ? fallback : value;
        }
        catch (Exception)
        {
            return fallback;
        }
    }

    /// <summary>The localized nav/title label for a route (falls back to its default title or name).</summary>
    public static string Title(RouteDefinition route)
    {
        ArgumentNullException.ThrowIfNull(route);
        var fallback = string.IsNullOrEmpty(route.DefaultTitle) ? route.Name : route.DefaultTitle;
        return Get(route.TitleKey, fallback);
    }

    /// <summary>The localized header label for a navigation group.</summary>
    public static string GroupTitle(RouteGroupInfo info) => Get(info.TitleKey, info.DefaultTitle);
}
