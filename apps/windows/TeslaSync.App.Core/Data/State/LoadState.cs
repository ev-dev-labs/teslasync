namespace TeslaSync.App.Core.Data.State;

/// <summary>
/// A discriminated union describing what a W7 page should render for one data source.
/// It is derived from a <see cref="RepositoryResult{T}"/> via
/// <see cref="RepositoryResult{T}.ToLoadState"/> and deliberately enumerates every
/// state the page must handle — loading, cached, refreshing, loaded, empty, offline
/// and error — so a view-model cannot forget one. The nested records are exhaustive
/// and can be matched with a C# <c>switch</c> expression.
/// </summary>
/// <typeparam name="T">The domain read-model type.</typeparam>
public abstract record LoadState<T>
{
    private LoadState()
    {
    }

    /// <summary>First load with no cached value available yet.</summary>
    public sealed record Loading : LoadState<T>;

    /// <summary>Showing a cached value (<paramref name="Stale"/> when past the freshness window).</summary>
    public sealed record Cached(T Value, DateTimeOffset FetchedAt, bool Stale) : LoadState<T>;

    /// <summary>Showing a cached value while a network refresh is in flight.</summary>
    public sealed record Refreshing(T Value, DateTimeOffset FetchedAt, bool Stale) : LoadState<T>;

    /// <summary>A fresh value arrived from the network.</summary>
    public sealed record Loaded(T Value, DateTimeOffset FetchedAt) : LoadState<T>;

    /// <summary>The request succeeded but there is nothing to show.</summary>
    public sealed record Empty : LoadState<T>;

    /// <summary>The network failed; <paramref name="Value"/> is the last good cached value, if any.</summary>
    public sealed record Offline(T? Value, RepositoryError ErrorInfo) : LoadState<T>;

    /// <summary>The request failed with no cached value to fall back to.</summary>
    public sealed record Error(RepositoryError ErrorInfo) : LoadState<T>;

    /// <summary>The currently-available value, if this state carries one.</summary>
    public T? ValueOrDefault => this switch
    {
        Cached c => c.Value,
        Refreshing r => r.Value,
        Loaded l => l.Value,
        Offline o => o.Value,
        _ => default,
    };
}
