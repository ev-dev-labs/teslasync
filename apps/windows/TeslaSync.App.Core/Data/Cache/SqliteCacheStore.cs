using Microsoft.Data.Sqlite;

namespace TeslaSync.App.Core.Data.Cache;

/// <summary>
/// SQLite-backed implementation of <see cref="ICacheStore"/> (ADR-013).
///
/// A single <see cref="SqliteConnection"/> is opened once and reused, with access
/// serialized by a <see cref="SemaphoreSlim"/> so the store is safe to share across
/// the app's repositories. Each row stores a serialized payload plus a
/// <c>fetched_at</c> stamp (Unix milliseconds, UTC); bounded eviction deletes the
/// oldest rows first. The store deliberately persists no token or credential material
/// — only API response bodies, which are themselves SI/contract data.
/// </summary>
public sealed class SqliteCacheStore : ICacheStore, IAsyncDisposable, IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly int _maxEntries;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _initialized;

    /// <summary>Creates the store over the supplied <see cref="CacheOptions"/>.</summary>
    public SqliteCacheStore(CacheOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _connection = new SqliteConnection(options.ConnectionString);
        _maxEntries = Math.Max(1, options.MaxEntries);
    }

    /// <inheritdoc />
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<CacheEntry?> ReadAsync(string key, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
            await using var cmd = _connection.CreateCommand();
            cmd.CommandText =
                "SELECT payload, fetched_at FROM cache_entries WHERE cache_key = $key";
            cmd.Parameters.AddWithValue("$key", key);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                return null;
            }

            var payload = reader.GetString(0);
            var fetchedAt = DateTimeOffset.FromUnixTimeMilliseconds(reader.GetInt64(1));
            return new CacheEntry(key, payload, fetchedAt);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task WriteAsync(string key, string payload, DateTimeOffset fetchedAt, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentNullException.ThrowIfNull(payload);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
            await using var cmd = _connection.CreateCommand();
            cmd.CommandText =
                """
                INSERT INTO cache_entries (cache_key, payload, fetched_at)
                VALUES ($key, $payload, $fetched_at)
                ON CONFLICT(cache_key) DO UPDATE SET
                    payload = excluded.payload,
                    fetched_at = excluded.fetched_at
                """;
            cmd.Parameters.AddWithValue("$key", key);
            cmd.Parameters.AddWithValue("$payload", payload);
            cmd.Parameters.AddWithValue("$fetched_at", fetchedAt.ToUnixTimeMilliseconds());
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<bool> RemoveAsync(string key, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
            await using var cmd = _connection.CreateCommand();
            cmd.CommandText = "DELETE FROM cache_entries WHERE cache_key = $key";
            cmd.Parameters.AddWithValue("$key", key);
            var rows = await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            return rows > 0;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<int> CountAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
            return await CountCoreAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<int> EvictAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
            var count = await CountCoreAsync(cancellationToken).ConfigureAwait(false);
            var overflow = count - _maxEntries;
            if (overflow <= 0)
            {
                return 0;
            }

            await using var cmd = _connection.CreateCommand();
            cmd.CommandText =
                """
                DELETE FROM cache_entries
                WHERE cache_key IN (
                    SELECT cache_key FROM cache_entries
                    ORDER BY fetched_at ASC
                    LIMIT $overflow
                )
                """;
            cmd.Parameters.AddWithValue("$overflow", overflow);
            return await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task ClearAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await EnsureInitializedAsync(cancellationToken).ConfigureAwait(false);
            await using var cmd = _connection.CreateCommand();
            cmd.CommandText = "DELETE FROM cache_entries";
            await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<int> CountCoreAsync(CancellationToken cancellationToken)
    {
        await using var cmd = _connection.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM cache_entries";
        var scalar = await cmd.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return scalar is long l ? (int)l : 0;
    }

    private async Task EnsureInitializedAsync(CancellationToken cancellationToken)
    {
        if (_initialized)
        {
            return;
        }

        if (_connection.State != System.Data.ConnectionState.Open)
        {
            await _connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        await using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            CREATE TABLE IF NOT EXISTS cache_entries (
                cache_key  TEXT    NOT NULL PRIMARY KEY,
                payload    TEXT    NOT NULL,
                fetched_at INTEGER NOT NULL
            ) WITHOUT ROWID;
            CREATE INDEX IF NOT EXISTS idx_cache_entries_fetched_at
                ON cache_entries (fetched_at);
            """;
        await cmd.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        _initialized = true;
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await _connection.DisposeAsync().ConfigureAwait(false);
        _gate.Dispose();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        _connection.Dispose();
        _gate.Dispose();
    }
}
