namespace TeslaSync.App.Core.Navigation;

/// <summary>
/// A single breadcrumb entry (port of the web breadcrumb item). <see cref="IsCurrent"/>
/// marks the active leaf, which renders as non-interactive text.
/// </summary>
/// <param name="Label">Display label (localized by the caller).</param>
/// <param name="Key">Stable route key used when the crumb is activated.</param>
/// <param name="IsCurrent">True for the trailing, current-page crumb.</param>
public readonly record struct Crumb(string Label, string Key, bool IsCurrent);

/// <summary>
/// Builds a breadcrumb trail from route segments (port of the web <c>Breadcrumbs</c>
/// trail derivation). Pure + headless so the trail shape is unit-tested without a
/// renderer.
/// </summary>
public static class BreadcrumbTrail
{
    /// <summary>
    /// Build a trail from an ordered <paramref name="segments"/> list of
    /// (label, key) pairs. Blank labels are skipped; the last surviving crumb is
    /// flagged <see cref="Crumb.IsCurrent"/>.
    /// </summary>
    public static IReadOnlyList<Crumb> Build(IReadOnlyList<(string Label, string Key)> segments)
    {
        ArgumentNullException.ThrowIfNull(segments);

        var cleaned = new List<(string Label, string Key)>(segments.Count);
        foreach (var (label, key) in segments)
        {
            if (!string.IsNullOrWhiteSpace(label))
            {
                cleaned.Add((label.Trim(), key ?? string.Empty));
            }
        }

        var trail = new List<Crumb>(cleaned.Count);
        for (int i = 0; i < cleaned.Count; i++)
        {
            trail.Add(new Crumb(cleaned[i].Label, cleaned[i].Key, i == cleaned.Count - 1));
        }

        return trail;
    }
}
