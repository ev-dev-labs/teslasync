namespace TeslaSync.App.Core.Data.Cache;

/// <summary>Tuning knobs for the SQLite offline cache.</summary>
public sealed class CacheOptions
{
    /// <summary>
    /// The SQLite connection string. Defaults to a private file in the app's local
    /// data folder. Tests pass a shared in-memory source. Never put credentials here.
    /// </summary>
    public string ConnectionString { get; set; } =
        "Data Source=teslasync-cache.db";

    /// <summary>
    /// Maximum number of cached rows retained. Bounded eviction removes the oldest
    /// rows (by <c>fetched_at</c>) once this is exceeded, keeping the cache from
    /// growing without limit on long-lived installs.
    /// </summary>
    public int MaxEntries { get; set; } = 500;
}
