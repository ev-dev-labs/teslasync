namespace TeslaSync.App.Core.Push;

/// <summary>
/// The non-secret registration metadata persisted locally between runs (P2/W6-0002). It records
/// just enough to renew, detect a channel change, and unregister the exact backend session — and
/// deliberately stores <b>no</b> channel URI or token. The channel is represented only by its
/// non-reversible <see cref="ChannelFingerprint"/> (see <see cref="PushRedaction.Fingerprint"/>).
/// </summary>
public sealed record PushRegistrationRecord(
    string RegistrationId,
    string Platform,
    string AppVersion,
    string ChannelFingerprint,
    DateTimeOffset? ChannelExpiresAt,
    DateTimeOffset RegisteredAt);

/// <summary>
/// Local persistence for the <see cref="PushRegistrationRecord"/> (P2/W6-0002). The Windows app
/// stores it in <c>ApplicationData.LocalSettings</c> (non-secret); the headless core/tests use an
/// in-memory store. Reads return <see langword="null"/> when nothing is stored.
/// </summary>
public interface IPushRegistrationStore
{
    /// <summary>Loads the persisted registration metadata, or <see langword="null"/> when absent.</summary>
    Task<PushRegistrationRecord?> LoadAsync(CancellationToken cancellationToken = default);

    /// <summary>Persists (replaces) the registration metadata.</summary>
    Task SaveAsync(PushRegistrationRecord record, CancellationToken cancellationToken = default);

    /// <summary>Removes the persisted registration metadata (idempotent).</summary>
    Task ClearAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// An in-memory <see cref="IPushRegistrationStore"/> for the headless core and the unit tests. The
/// Windows app overrides this via <c>TryAddSingleton</c> with a settings-backed implementation.
/// </summary>
public sealed class InMemoryPushRegistrationStore : IPushRegistrationStore
{
    private readonly object _gate = new();
    private PushRegistrationRecord? _record;

    /// <inheritdoc />
    public Task<PushRegistrationRecord?> LoadAsync(CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            return Task.FromResult(_record);
        }
    }

    /// <inheritdoc />
    public Task SaveAsync(PushRegistrationRecord record, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(record);
        lock (_gate)
        {
            _record = record;
        }

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task ClearAsync(CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            _record = null;
        }

        return Task.CompletedTask;
    }
}
