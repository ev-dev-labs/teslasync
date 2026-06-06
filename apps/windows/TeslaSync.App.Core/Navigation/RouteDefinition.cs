namespace TeslaSync.App.Core.Navigation;

/// <summary>
/// Which shell chrome a route renders inside. Mirrors the two layers in
/// <c>web/src/App.tsx</c>: routes nested under <c>&lt;Route path="/" element={&lt;Layout /&gt;}&gt;</c>
/// run inside the main NavigationView shell, while the outer routes
/// (<c>quick-stats</c>, <c>glance</c>, <c>watch</c>, <c>onboarding</c>, <c>s/:token</c>,
/// <c>year-review/:year</c>) render full-bleed with no left pane.
/// </summary>
public enum ShellMode
{
    /// <summary>Hosted inside the main NavigationView shell (left pane + title bar + content frame).</summary>
    Main = 0,

    /// <summary>Full-window standalone surface with no navigation chrome.</summary>
    Standalone,
}

/// <summary>
/// One typed entry in the route registry — the native port of a single
/// <c>&lt;Route&gt;</c> from <c>web/src/App.tsx</c>. Carries everything the shell needs
/// to render a nav item, match a URL, resolve a redirect, build a deep link and
/// host the destination page.
/// </summary>
public sealed record RouteDefinition
{
    /// <summary>
    /// Stable route name — the same identifier the web app passes as
    /// <c>SafeRoute name="…"</c>. Used as the navigation tag and recent-page key.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Path pattern relative to the app root, without a leading slash. Segments
    /// beginning with <c>:</c> are parameters (e.g. <c>vehicles/:id</c>); a lone
    /// <c>*</c> segment is the catch-all.
    /// </summary>
    public required string PathPattern { get; init; }

    /// <summary>Left-pane group this route belongs to.</summary>
    public RouteGroup Group { get; init; } = RouteGroup.None;

    /// <summary>Segoe Fluent Icons glyph for the nav item (defaults to a generic page glyph).</summary>
    public string Glyph { get; init; } = "\uE7C3";

    /// <summary>Resource key for the localized nav/title label.</summary>
    public string? TitleKey { get; init; }

    /// <summary>English fallback label used when <see cref="TitleKey"/> is absent or unresolved.</summary>
    public string DefaultTitle { get; init; } = string.Empty;

    /// <summary>Whether the route sits behind the authenticated shell (false for public share links, etc.).</summary>
    public bool AuthRequired { get; init; } = true;

    /// <summary>Whether the route renders inside the main shell or as a standalone surface.</summary>
    public ShellMode ShellMode { get; init; } = ShellMode.Main;

    /// <summary>
    /// When set, this route is a redirect: navigating to <see cref="PathPattern"/>
    /// resolves to this target path (port of <c>&lt;Navigate to="…" replace /&gt;</c>).
    /// </summary>
    public string? RedirectTo { get; init; }

    /// <summary>True when this route is the wildcard catch-all (NotFound).</summary>
    public bool IsCatchAll { get; init; }

    /// <summary>
    /// Whether the route surfaces as its own item in the navigation pane. Detail
    /// routes, redirects, aliases and the catch-all are reachable but hidden.
    /// </summary>
    public bool ShowInNav { get; init; } = true;

    /// <summary>
    /// Factory that instantiates the destination page (a WinUI <c>Page</c>, typed as
    /// <see cref="object"/> so this assembly stays UI-framework agnostic). Populated
    /// by the shell from the generated W7 page classes; <see langword="null"/> while
    /// the corresponding page module has not yet been generated.
    /// </summary>
    public Func<object?>? PageFactory { get; init; }

    /// <summary>The pattern split into segments (cached on first access).</summary>
    public IReadOnlyList<string> Segments => _segments ??= SplitSegments(PathPattern);

    private IReadOnlyList<string>? _segments;

    /// <summary>True when the pattern contains at least one <c>:param</c> segment.</summary>
    public bool IsParameterized => PathPattern.Contains(':', StringComparison.Ordinal);

    /// <summary>True when this entry redirects rather than rendering a page.</summary>
    public bool IsRedirect => RedirectTo is not null;

    /// <summary>True when a destination page factory has been registered.</summary>
    public bool HasPage => PageFactory is not null;

    /// <summary>Split a path into non-empty segments, trimming surrounding slashes.</summary>
    public static IReadOnlyList<string> SplitSegments(string path) =>
        (path ?? string.Empty).Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
}
