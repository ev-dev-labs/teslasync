namespace TeslaSync.App.Core.Settings;

/// <summary>
/// Persistence seam for the non-secret <see cref="AppSettings"/> (P2/W8-0002). The concrete Windows
/// implementation binds to the packaged app's <c>ApplicationData.LocalSettings</c>; the shared core
/// depends only on this interface, and tests use the in-memory fake. Implementations must be
/// best-effort: an unpackaged/identity-less context returns <see cref="AppSettings.Default"/> from
/// <see cref="LoadAsync"/> and silently no-ops <see cref="SaveAsync"/> rather than throwing, and
/// must never persist token or credential material (that is the W4 secure store's responsibility).
/// </summary>
public interface IAppSettingsStore
{
    /// <summary>Returns the persisted settings, or <see cref="AppSettings.Default"/> when absent/unreadable.</summary>
    Task<AppSettings> LoadAsync(CancellationToken cancellationToken = default);

    /// <summary>Persists <paramref name="settings"/>, replacing any previously stored values.</summary>
    Task SaveAsync(AppSettings settings, CancellationToken cancellationToken = default);
}

/// <summary>
/// An in-memory <see cref="IAppSettingsStore"/> used by unit tests (and as the headless fallback). It
/// is intentionally non-durable; the real app binds the LocalSettings-backed store.
/// </summary>
public sealed class InMemoryAppSettingsStore : IAppSettingsStore
{
    private AppSettings _settings;

    /// <summary>Creates the store seeded with <paramref name="initial"/> (defaults when omitted).</summary>
    public InMemoryAppSettingsStore(AppSettings? initial = null) =>
        _settings = initial ?? AppSettings.Default;

    /// <summary>Number of times <see cref="SaveAsync"/> has been invoked.</summary>
    public int SaveCount { get; private set; }

    /// <summary>Optional hook to simulate a persistence failure on the next save.</summary>
    public bool FailNextSave { get; set; }

    /// <inheritdoc />
    public Task<AppSettings> LoadAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult(_settings);

    /// <inheritdoc />
    public Task SaveAsync(AppSettings settings, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        SaveCount++;
        if (FailNextSave)
        {
            FailNextSave = false;
            throw new InvalidOperationException("Simulated settings-store write failure");
        }

        _settings = settings;
        return Task.CompletedTask;
    }
}
