using System.Text.Json;

namespace TeslaSync.App.SharedSurfaces.RecentActivityFeedSurface;

/// <summary>
/// The in-memory <see cref="IRecentActivityFeedSource"/> backing the feed view — the P1/S8 seam carrying the
/// presentational input (the WinUI analogue of a parent re-rendering the web <c>RecentActivityFeed</c> with new
/// <c>entries</c> / <c>emptyMessage</c> props). It holds the current <see cref="RecentActivityFeedInput"/>, exposes
/// focused mutators that replace one facet and raise <see cref="Changed"/>, and a cached-payload adapter
/// (<see cref="LoadFromJson"/>) that hydrates the rows from a <c>GET /users/me/activity</c> body — the
/// cached-JSON -> projection path the host binds. Pure data — no WinUI types — so it is unit-tested headlessly.
/// </summary>
public sealed class RecentActivityFeedSource : IRecentActivityFeedSource
{
    private RecentActivityFeedInput _input;

    /// <summary>Creates the source over a fresh, empty input (the common host path).</summary>
    public RecentActivityFeedSource()
        : this(new RecentActivityFeedInput())
    {
    }

    /// <summary>Creates the source over an explicit initial input.</summary>
    /// <param name="input">The initial presentational input; a null collapses to a fresh empty input.</param>
    public RecentActivityFeedSource(RecentActivityFeedInput input) => _input = input ?? new RecentActivityFeedInput();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public RecentActivityFeedInput Input => _input;

    /// <summary>Replace the whole presentational input and notify (a null falls back to a fresh empty input).</summary>
    /// <param name="input">The new input.</param>
    public void SetInput(RecentActivityFeedInput input)
    {
        _input = input ?? new RecentActivityFeedInput();
        Raise();
    }

    /// <summary>Replace just the rows and notify (web parent passing new <c>entries</c>); clears the loading flag.</summary>
    /// <param name="entries">The new rows, or null to select the empty branch.</param>
    public void SetEntries(IReadOnlyList<RecentActivityEntry>? entries)
    {
        _input = _input with { Entries = entries, IsLoading = false };
        Raise();
    }

    /// <summary>Replace just the empty-state message override and notify (web <c>emptyMessage</c> prop).</summary>
    /// <param name="emptyMessage">The new override, or null to fall back to the localized default.</param>
    public void SetEmptyMessage(string? emptyMessage)
    {
        _input = _input with { EmptyMessage = emptyMessage };
        Raise();
    }

    /// <summary>Flag (or clear) the host's in-flight first fetch and notify (selects / leaves the skeleton).</summary>
    /// <param name="loading">True while the first fetch is in flight.</param>
    public void SetLoading(bool loading)
    {
        _input = _input with { IsLoading = loading };
        Raise();
    }

    /// <summary>
    /// Hydrate the rows from a cached <c>GET /users/me/activity</c> array body and notify — the cached-JSON ->
    /// projection adapter. Parses through <see cref="RecentActivityEntry.FromArray"/> (snake_case first), replaces
    /// the rows and clears the loading flag.
    /// </summary>
    /// <param name="root">The parsed response body (an array; anything else yields zero rows).</param>
    public void LoadFromJson(JsonElement root) => SetEntries(RecentActivityEntry.FromArray(root));

    private void Raise() => Changed?.Invoke(this, EventArgs.Empty);
}
