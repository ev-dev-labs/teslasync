namespace TeslaSync.App.Core.Settings;

/// <summary>
/// The in-process holder + mutation funnel for <see cref="AppSettings"/> (P2/W8-0002). It loads the
/// persisted settings once, exposes the current snapshot for binding, and routes every change through
/// validation (<see cref="AppSettings.Normalized"/>) and the durable <see cref="IAppSettingsStore"/>.
///
/// <para>The service is the single writer for non-secret preferences. It is deliberately independent
/// of the W4 secure token store and the W5 response cache so the three storage tiers stay separated:
/// preferences here, tokens in the Credential Locker, cached payloads in SQLite. <see cref="Changed"/>
/// fires on every committed mutation so the shell can re-apply theme/density/units live.</para>
/// </summary>
public sealed class AppSettingsService
{
    private readonly IAppSettingsStore _store;
    private readonly object _gate = new();
    private AppSettings _current;

    /// <summary>Creates the service over the persistence seam, starting from <see cref="AppSettings.Default"/>.</summary>
    public AppSettingsService(IAppSettingsStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        _store = store;
        _current = AppSettings.Default;
    }

    /// <summary>Raised after a committed change with the new (normalized) settings snapshot.</summary>
    public event EventHandler<AppSettings>? Changed;

    /// <summary>The current settings snapshot (always normalized).</summary>
    public AppSettings Current
    {
        get
        {
            lock (_gate)
            {
                return _current;
            }
        }
    }

    /// <summary>
    /// Loads the persisted settings into <see cref="Current"/> (normalizing them) and raises
    /// <see cref="Changed"/>. Safe to call once at startup; a failed/absent store leaves the defaults.
    /// </summary>
    public async Task<AppSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        var loaded = (await _store.LoadAsync(cancellationToken).ConfigureAwait(false)).Normalized();
        SetCurrent(loaded);
        return loaded;
    }

    /// <summary>
    /// Applies <paramref name="mutate"/> to the current settings, normalizes + persists the result, and
    /// raises <see cref="Changed"/> when it differs. Returns the committed snapshot. Persistence is
    /// best-effort: a store failure still updates the in-memory snapshot so the UI stays responsive.
    /// </summary>
    public async Task<AppSettings> UpdateAsync(
        Func<AppSettings, AppSettings> mutate,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(mutate);

        AppSettings next;
        lock (_gate)
        {
            next = mutate(_current).Normalized();
            if (next == _current)
            {
                return _current;
            }

            _current = next;
        }

        await PersistAsync(next, cancellationToken).ConfigureAwait(false);
        Changed?.Invoke(this, next);
        return next;
    }

    /// <summary>Resets every preference to <see cref="AppSettings.Default"/> and persists the reset.</summary>
    public Task<AppSettings> ResetAsync(CancellationToken cancellationToken = default) =>
        UpdateAsync(static _ => AppSettings.Default, cancellationToken);

    /// <summary>
    /// Crash-safe save of the current snapshot. Used on suspend / window close / unhandled-exception
    /// so the latest preferences survive an abrupt teardown. Swallows store failures.
    /// </summary>
    public Task FlushAsync(CancellationToken cancellationToken = default) =>
        PersistAsync(Current, cancellationToken);

    private async Task PersistAsync(AppSettings settings, CancellationToken cancellationToken)
    {
        try
        {
            await _store.SaveAsync(settings, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception)
        {
            // Best-effort persistence — a transient store failure must not crash the caller.
        }
    }

    private void SetCurrent(AppSettings settings)
    {
        lock (_gate)
        {
            _current = settings;
        }

        Changed?.Invoke(this, settings);
    }
}
