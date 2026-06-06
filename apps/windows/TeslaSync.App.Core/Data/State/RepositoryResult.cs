namespace TeslaSync.App.Core.Data.State;

/// <summary>The lifecycle status of a single repository emission.</summary>
public enum LoadStatus
{
    /// <summary>No value yet; a load is in flight and no cache was available.</summary>
    Loading,

    /// <summary>A cached value is being shown while the network refresh runs.</summary>
    Cached,

    /// <summary>A cached value is shown and a refresh is actively in flight.</summary>
    Refreshing,

    /// <summary>A fresh value arrived from the network.</summary>
    Loaded,

    /// <summary>The request succeeded but returned no data.</summary>
    Empty,

    /// <summary>The request failed and no usable cached value exists.</summary>
    Error,

    /// <summary>The network failed but a (stale) cached value is still being shown.</summary>
    Offline,
}

/// <summary>
/// One immutable snapshot emitted by a cache-then-network repository
/// (<see cref="CacheThenNetworkEngine"/>). A single read typically yields a short
/// sequence — e.g. <c>Loading → Cached → Loaded</c>, or <c>Loading → Cached → Offline</c>
/// — so W7 view-models can keep content visible while refreshing rather than flashing
/// a spinner. Use the factory helpers rather than the constructor.
/// </summary>
/// <typeparam name="T">The repository's domain read-model type.</typeparam>
public sealed record RepositoryResult<T>(
    LoadStatus Status,
    T? Value,
    DateTimeOffset? FetchedAt,
    bool IsStale,
    RepositoryError? Error)
{
    /// <summary>True when a value is present (cached, refreshing, loaded or offline).</summary>
    public bool HasValue => Value is not null;

    /// <summary>True for the transient states where a refresh is still in flight.</summary>
    public bool IsLoading => Status is LoadStatus.Loading or LoadStatus.Refreshing;

    /// <summary>The first content-bearing emission with no cache.</summary>
    public static RepositoryResult<T> Loading() =>
        new(LoadStatus.Loading, default, null, false, null);

    /// <summary>A cached value surfaced before the network refresh begins.</summary>
    public static RepositoryResult<T> Cached(T value, DateTimeOffset fetchedAt, bool stale) =>
        new(LoadStatus.Cached, value, fetchedAt, stale, null);

    /// <summary>A cached value with the network refresh actively in flight.</summary>
    public static RepositoryResult<T> Refreshing(T value, DateTimeOffset fetchedAt, bool stale) =>
        new(LoadStatus.Refreshing, value, fetchedAt, stale, null);

    /// <summary>A fresh value from the network, stamped with its fetch time.</summary>
    public static RepositoryResult<T> Loaded(T value, DateTimeOffset fetchedAt) =>
        new(LoadStatus.Loaded, value, fetchedAt, false, null);

    /// <summary>A successful-but-empty response.</summary>
    public static RepositoryResult<T> Empty(DateTimeOffset? fetchedAt = null) =>
        new(LoadStatus.Empty, default, fetchedAt, false, null);

    /// <summary>A hard failure with no cached value to fall back to.</summary>
    public static RepositoryResult<T> Failure(RepositoryError error) =>
        new(LoadStatus.Error, default, null, false, error);

    /// <summary>A network failure where a stale cached value remains usable.</summary>
    public static RepositoryResult<T> OfflineCached(T value, DateTimeOffset fetchedAt, RepositoryError error) =>
        new(LoadStatus.Offline, value, fetchedAt, true, error);

    /// <summary>Project this snapshot into the richer <see cref="LoadState{T}"/> union for binding.</summary>
    public LoadState<T> ToLoadState() => Status switch
    {
        LoadStatus.Loading => new LoadState<T>.Loading(),
        LoadStatus.Cached => new LoadState<T>.Cached(Value!, FetchedAt!.Value, IsStale),
        LoadStatus.Refreshing => new LoadState<T>.Refreshing(Value!, FetchedAt!.Value, IsStale),
        LoadStatus.Loaded => new LoadState<T>.Loaded(Value!, FetchedAt!.Value),
        LoadStatus.Empty => new LoadState<T>.Empty(),
        LoadStatus.Offline => new LoadState<T>.Offline(Value, Error!),
        _ => new LoadState<T>.Error(Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
    };
}
