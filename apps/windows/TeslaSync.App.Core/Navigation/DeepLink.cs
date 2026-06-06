namespace TeslaSync.App.Core.Navigation;

/// <summary>
/// Deep-link (protocol-activation) URI mapping for the Windows shell. Translates an
/// external activation URI — either the app's custom <c>teslasync://</c> scheme or an
/// <c>https://</c> universal link — into an in-app route path, and builds the reverse
/// (a shareable URI for a given route). Pure and headless so activation parsing is
/// unit-tested without the app host.
/// </summary>
public static class DeepLink
{
    /// <summary>The app's registered custom URI scheme.</summary>
    public const string Scheme = "teslasync";

    /// <summary>Canonical authority used when building custom-scheme links (<c>teslasync://app/…</c>).</summary>
    public const string Authority = "app";

    /// <summary>
    /// Extract the in-app route path from an activation <paramref name="uri"/>.
    /// Supports <c>teslasync://app/&lt;path&gt;</c>, <c>teslasync://&lt;path&gt;</c> and
    /// <c>https://&lt;host&gt;/&lt;path&gt;</c>. Returns the normalized path (no leading
    /// slash, query/fragment stripped); an empty string maps to the index route.
    /// </summary>
    public static string PathFromUri(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);

        var path = uri.AbsolutePath.Trim('/');

        // For the custom scheme, a non-"app" host is actually the first path segment
        // (teslasync://vehicles/3 → host="vehicles", path="3").
        if (string.Equals(uri.Scheme, Scheme, StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrEmpty(uri.Host)
            && !string.Equals(uri.Host, Authority, StringComparison.OrdinalIgnoreCase))
        {
            path = string.IsNullOrEmpty(path) ? uri.Host : $"{uri.Host}/{path}";
        }

        return RouteRegistry.Normalize(path);
    }

    /// <summary>
    /// Resolve an activation <paramref name="uri"/> to a terminal <see cref="RouteMatch"/>
    /// (redirects followed). Returns <see langword="false"/> only when
    /// <paramref name="uri"/> is null.
    /// </summary>
    public static bool TryActivate(Uri? uri, RouteRegistry registry, out RouteMatch match)
    {
        ArgumentNullException.ThrowIfNull(registry);
        if (uri is null)
        {
            match = default;
            return false;
        }

        match = registry.Resolve(PathFromUri(uri));
        return true;
    }

    /// <summary>
    /// Build a custom-scheme deep link (<c>teslasync://app/&lt;path&gt;</c>) for a route,
    /// substituting any <c>:param</c> values.
    /// </summary>
    public static Uri BuildUri(RouteDefinition route, IReadOnlyDictionary<string, string>? parameters = null)
    {
        var path = RouteRegistry.BuildPath(route, parameters);
        return BuildUri(path);
    }

    /// <summary>Build a custom-scheme deep link for an already-normalized path.</summary>
    public static Uri BuildUri(string path)
    {
        var normalized = RouteRegistry.Normalize(path);
        return new Uri($"{Scheme}://{Authority}/{normalized}");
    }
}
