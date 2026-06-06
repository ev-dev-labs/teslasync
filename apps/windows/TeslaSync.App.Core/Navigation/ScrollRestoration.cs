namespace TeslaSync.App.Core.Navigation;

/// <summary>
/// Per-route scroll-offset store backing the shell's scroll restoration (port of the
/// web <c>ScrollRestoration</c> behavior). Records the vertical offset when leaving a
/// path and replays it on return; navigating "forward" to a not-yet-seen path yields
/// the top (offset 0). Pure and headless so the restore policy is unit-tested.
/// </summary>
public sealed class ScrollRestoration
{
    private readonly Dictionary<string, double> _offsets = new(StringComparer.Ordinal);

    /// <summary>Save the scroll <paramref name="offset"/> for <paramref name="path"/>.</summary>
    public void Save(string path, double offset)
    {
        var normalized = RouteRegistry.Normalize(path);
        _offsets[normalized] = offset < 0 ? 0 : offset;
    }

    /// <summary>
    /// The offset to restore for <paramref name="path"/>: a previously-saved value, or
    /// <c>0</c> (top) when the path has not been seen.
    /// </summary>
    public double Restore(string path)
    {
        var normalized = RouteRegistry.Normalize(path);
        return _offsets.TryGetValue(normalized, out var offset) ? offset : 0;
    }

    /// <summary>True when an offset has been recorded for <paramref name="path"/>.</summary>
    public bool HasOffset(string path) => _offsets.ContainsKey(RouteRegistry.Normalize(path));

    /// <summary>Forget the saved offset for a single path.</summary>
    public void Forget(string path) => _offsets.Remove(RouteRegistry.Normalize(path));

    /// <summary>Clear all saved offsets.</summary>
    public void Clear() => _offsets.Clear();
}
