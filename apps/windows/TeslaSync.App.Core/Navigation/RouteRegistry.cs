using System.Diagnostics.CodeAnalysis;

namespace TeslaSync.App.Core.Navigation;

/// <summary>
/// The result of matching a path against the registry: the winning
/// <see cref="RouteDefinition"/> plus any extracted <c>:param</c> values.
/// </summary>
/// <param name="Route">The matched route (never null — falls back to the catch-all).</param>
/// <param name="Parameters">Extracted path parameters (empty for static routes).</param>
/// <param name="MatchedPath">The normalized path that produced this match.</param>
public readonly record struct RouteMatch(
    RouteDefinition Route,
    IReadOnlyDictionary<string, string> Parameters,
    string MatchedPath)
{
    /// <summary>True when the match fell through to the wildcard catch-all.</summary>
    public bool IsCatchAll => Route.IsCatchAll;

    /// <summary>Convenience accessor for a single parameter (null when absent).</summary>
    public string? Param(string key) => Parameters.TryGetValue(key, out var v) ? v : null;
}

/// <summary>
/// Resolves URLs to routes and back: static/parameter/catch-all matching, redirect
/// following, and reverse path construction. Pure and headless so the routing rules
/// are unit-tested without a live <c>Frame</c>. The native counterpart of React
/// Router's matcher for <c>web/src/App.tsx</c>.
/// </summary>
public sealed class RouteRegistry
{
    private const int MaxRedirectHops = 8;

    private static readonly IReadOnlyDictionary<string, string> Empty =
        new Dictionary<string, string>(0);

    private readonly IReadOnlyList<RouteDefinition> _routes;
    private readonly RouteDefinition _catchAll;

    /// <summary>Create a registry over the supplied route list (defaults to <see cref="RouteTable.All"/>).</summary>
    public RouteRegistry(IReadOnlyList<RouteDefinition>? routes = null)
    {
        _routes = routes ?? RouteTable.All;
        _catchAll = _routes.FirstOrDefault(r => r.IsCatchAll)
            ?? throw new InvalidOperationException("Route table must contain a catch-all route.");
    }

    /// <summary>All routes in the registry.</summary>
    public IReadOnlyList<RouteDefinition> Routes => _routes;

    /// <summary>Routes that surface as navigation items, in declaration order.</summary>
    public IReadOnlyList<RouteDefinition> NavigableRoutes =>
        _routes.Where(r => r.ShowInNav && !r.IsRedirect && !r.IsCatchAll).ToList();

    /// <summary>Navigable routes belonging to <paramref name="group"/>, in declaration order.</summary>
    public IReadOnlyList<RouteDefinition> RoutesInGroup(RouteGroup group) =>
        _routes.Where(r => r.Group == group && r.ShowInNav && !r.IsRedirect && !r.IsCatchAll).ToList();

    /// <summary>First route registered under <paramref name="name"/> (case-sensitive), or null.</summary>
    public RouteDefinition? ByName(string name) =>
        _routes.FirstOrDefault(r => string.Equals(r.Name, name, StringComparison.Ordinal));

    /// <summary>
    /// Normalize a raw path: strip the leading slash, query and fragment, and collapse
    /// surrounding whitespace. <c>"/"</c> and <c>""</c> both normalize to the empty
    /// (index) path.
    /// </summary>
    public static string Normalize(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return string.Empty;
        }

        var p = path.Trim();
        int cut = p.IndexOfAny(['?', '#']);
        if (cut >= 0)
        {
            p = p[..cut];
        }

        return p.Trim('/');
    }

    /// <summary>
    /// Match a path to its route. Resolution order mirrors React Router specificity:
    /// an exact static route wins, then the most specific parameter route, then the
    /// catch-all. Redirects are <b>not</b> followed here — use <see cref="Resolve"/>.
    /// </summary>
    public RouteMatch Match(string? path)
    {
        var normalized = Normalize(path);
        var segments = RouteDefinition.SplitSegments(normalized);

        // 1) Exact static match (no parameters, segment-for-segment equal).
        foreach (var route in _routes)
        {
            if (route.IsCatchAll || route.IsParameterized)
            {
                continue;
            }

            if (SegmentsEqual(route.Segments, segments))
            {
                return new RouteMatch(route, Empty, normalized);
            }
        }

        // 2) Parameter match — prefer routes with the fewest parameters (most specific).
        RouteDefinition? best = null;
        IReadOnlyDictionary<string, string>? bestParams = null;
        int bestParamCount = int.MaxValue;

        foreach (var route in _routes)
        {
            if (route.IsCatchAll || !route.IsParameterized)
            {
                continue;
            }

            if (TryMatchParameters(route, segments, out var captured))
            {
                int paramCount = captured.Count;
                if (paramCount < bestParamCount)
                {
                    best = route;
                    bestParams = captured;
                    bestParamCount = paramCount;
                }
            }
        }

        if (best is not null)
        {
            return new RouteMatch(best, bestParams!, normalized);
        }

        // 3) Catch-all.
        return new RouteMatch(_catchAll, Empty, normalized);
    }

    /// <summary>
    /// Match <b>and</b> follow redirects to the terminal route. The returned
    /// <see cref="RouteMatch.MatchedPath"/> reflects the final destination path.
    /// Guards against redirect cycles via <see cref="MaxRedirectHops"/>.
    /// </summary>
    public RouteMatch Resolve(string? path)
    {
        var match = Match(path);
        int hops = 0;
        while (match.Route.IsRedirect && hops++ < MaxRedirectHops)
        {
            match = Match(match.Route.RedirectTo);
        }

        return match;
    }

    /// <summary>
    /// Build the concrete path for a parameterized (or static) route by substituting
    /// <paramref name="parameters"/> into its pattern. Throws when a required
    /// parameter is missing.
    /// </summary>
    public static string BuildPath(RouteDefinition route, IReadOnlyDictionary<string, string>? parameters = null)
    {
        ArgumentNullException.ThrowIfNull(route);

        var segs = route.Segments;
        if (segs.Count == 0)
        {
            return string.Empty;
        }

        var outSegs = new string[segs.Count];
        for (int i = 0; i < segs.Count; i++)
        {
            var s = segs[i];
            if (s.StartsWith(':'))
            {
                var key = s[1..];
                if (parameters is null || !parameters.TryGetValue(key, out var value) || string.IsNullOrEmpty(value))
                {
                    throw new ArgumentException($"Missing value for route parameter ':{key}'.", nameof(parameters));
                }

                outSegs[i] = Uri.EscapeDataString(value);
            }
            else
            {
                outSegs[i] = s;
            }
        }

        return string.Join('/', outSegs);
    }

    private static bool TryMatchParameters(
        RouteDefinition route,
        IReadOnlyList<string> pathSegments,
        [NotNullWhen(true)] out IReadOnlyDictionary<string, string>? captured)
    {
        captured = null;
        var pattern = route.Segments;
        if (pattern.Count != pathSegments.Count)
        {
            return false;
        }

        Dictionary<string, string>? map = null;
        for (int i = 0; i < pattern.Count; i++)
        {
            var p = pattern[i];
            if (p.StartsWith(':'))
            {
                map ??= new Dictionary<string, string>(StringComparer.Ordinal);
                map[p[1..]] = Uri.UnescapeDataString(pathSegments[i]);
            }
            else if (!string.Equals(p, pathSegments[i], StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }

        captured = map ?? Empty;
        return true;
    }

    private static bool SegmentsEqual(IReadOnlyList<string> a, IReadOnlyList<string> b)
    {
        if (a.Count != b.Count)
        {
            return false;
        }

        for (int i = 0; i < a.Count; i++)
        {
            if (!string.Equals(a[i], b[i], StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }

        return true;
    }
}
