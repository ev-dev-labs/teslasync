using System.Text.Json;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The deploy-version-watcher seam the <c>NewVersionBanner</c> binds through (P1/S8) — the native analogue of the
/// web <c>useVersionWatcher()</c> hook (web/src/hooks/useVersionWatcher.ts) the banner reads
/// <c>newVersionAvailable</c> and <c>latestVersion</c> from (web/src/components/feedback/NewVersionBanner.tsx
/// L29). It captures the <see cref="BootVersion"/> reported by the backend on the first probe and the
/// <see cref="LatestVersion"/> reported by the most recent probe, and flags <see cref="NewVersionAvailable"/> once
/// the two diverge (the web <c>bootVersion &amp;&amp; latestVersion &amp;&amp; latestVersion !== bootVersion</c>
/// derivation). It raises <see cref="Changed"/> whenever any of those move. The view never performs HTTP or runs a
/// poll timer itself — it binds to this seam. The production binding is <see cref="RepositoryVersionWatcherSource"/>
/// over a <c>GET /system/version</c> cache-then-network stream that the composition root re-runs on the poll
/// cadence; <see cref="StaticVersionWatcherSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface IVersionWatcherSource
{
    /// <summary>The <c>app_version</c> reported on the first probe, or null until it resolves (web <c>bootVersion</c>).</summary>
    string? BootVersion { get; }

    /// <summary>The <c>app_version</c> reported on the most recent probe, or null until the first completes (web <c>latestVersion</c>).</summary>
    string? LatestVersion { get; }

    /// <summary>True once a boot version and a different later version are both known (web <c>newVersionAvailable</c>).</summary>
    bool NewVersionAvailable { get; }

    /// <summary>Raised whenever <see cref="BootVersion"/> / <see cref="LatestVersion"/> moves; may fire from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IVersionWatcherSource"/> driven entirely by caller-supplied observations — the headless / unit-test
/// default. It reproduces the web watcher's boot-then-poll model: the first non-empty observation becomes the
/// <see cref="BootVersion"/> (and the initial <see cref="LatestVersion"/>), and every later non-empty observation
/// updates <see cref="LatestVersion"/>; empty / null observations are ignored, exactly as the web hook ignores a
/// missing or empty <c>app_version</c> (web/src/hooks/useVersionWatcher.ts L57-73, L99-110). It lets the banner
/// projection and view-model be exercised across the hidden (same version), new-version, and re-surface states
/// without a version-query host.
/// </summary>
public sealed class StaticVersionWatcherSource : IVersionWatcherSource
{
    private string? _bootVersion;
    private string? _latestVersion;

    /// <summary>Creates a watcher with no versions observed yet (the pre-boot state; the banner stays hidden).</summary>
    public StaticVersionWatcherSource()
    {
    }

    /// <summary>Creates a watcher seeded with an explicit boot + latest pair (for projection / view-model tests).</summary>
    /// <param name="bootVersion">The version captured on boot (web <c>bootVersion</c>), or null.</param>
    /// <param name="latestVersion">The most recent version seen (web <c>latestVersion</c>), or null.</param>
    public StaticVersionWatcherSource(string? bootVersion, string? latestVersion)
    {
        _bootVersion = NewVersionBannerRegistration.NormalizeVersion(bootVersion);
        _latestVersion = NewVersionBannerRegistration.NormalizeVersion(latestVersion) ?? _bootVersion;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string? BootVersion => _bootVersion;

    /// <inheritdoc />
    public string? LatestVersion => _latestVersion;

    /// <inheritdoc />
    public bool NewVersionAvailable =>
        NewVersionBannerRegistration.IsNewVersionAvailable(_bootVersion, _latestVersion);

    /// <summary>Record the first probe (web boot probe): captures the boot baseline. Empty observations are ignored.</summary>
    /// <param name="version">The reported <c>app_version</c>.</param>
    public void Boot(string? version) => Observe(version);

    /// <summary>Record a later probe (web poll tick): updates the latest version. Empty observations are ignored.</summary>
    /// <param name="version">The reported <c>app_version</c>.</param>
    public void Poll(string? version) => Observe(version);

    private void Observe(string? version)
    {
        var normalized = NewVersionBannerRegistration.NormalizeVersion(version);
        if (normalized is null)
        {
            // web: a missing / empty app_version never updates the captured version (useVersionWatcher.ts L60-72).
            return;
        }

        var changed = false;
        if (_bootVersion is null)
        {
            _bootVersion = normalized;
            changed = true;
        }

        if (!string.Equals(_latestVersion, normalized, StringComparison.Ordinal))
        {
            _latestVersion = normalized;
            changed = true;
        }

        if (changed)
        {
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }
}

/// <summary>
/// The production <see cref="IVersionWatcherSource"/> — binds the boot / latest version to a cache-then-network
/// <c>GET /system/version</c> repository stream (generated operation <c>get_api_v1_system_version</c>, the web
/// <c>useVersionWatcher</c> probe over <c>request('/system/version')</c>). The composition root supplies a stream
/// factory (e.g. <c>ct =&gt; systemAdminRepository.GetVersionAsync(ct)</c>) and re-invokes <see cref="Refresh"/> on
/// the poll cadence (the web 5-minute <c>setInterval</c>); each value-bearing emission has its <c>app_version</c>
/// read by <see cref="NewVersionBannerRegistration.ReadAppVersion"/>. The first non-empty version captured becomes
/// the <see cref="BootVersion"/>, and every later non-empty version updates <see cref="LatestVersion"/>; a
/// value-less load / empty / error emission, or an emission whose body carries no usable version, is ignored —
/// exactly the web behaviour where <c>fetchVersion</c> swallows transient failures and never overwrites the
/// captured version (web/src/hooks/useVersionWatcher.ts L57-73). A monotonic generation guard discards emissions
/// from a superseded run. WinUI-free so it is unit-tested against an in-memory stream without a UI host.
/// </summary>
public sealed class RepositoryVersionWatcherSource : IVersionWatcherSource, IDisposable
{
    private readonly Func<CancellationToken, IAsyncEnumerable<RepositoryResult<JsonElement>>> _stream;
    private readonly Func<JsonElement, string?> _parse;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private string? _bootVersion;
    private string? _latestVersion;
    private int _generation;
    private bool _disposed;

    /// <summary>Creates the source over a <c>/system/version</c> stream factory and an optional version parser.</summary>
    /// <param name="stream">
    /// The cache-then-network stream factory (web version probe), e.g.
    /// <c>ct =&gt; systemAdminRepository.GetVersionAsync(ct)</c>.
    /// </param>
    /// <param name="parse">
    /// Reads the <c>app_version</c> out of a version payload; defaults to
    /// <see cref="NewVersionBannerRegistration.ReadAppVersion"/>.
    /// </param>
    /// <param name="autoStart">Whether to begin the first stream immediately (defaults to true; the web boot probe).</param>
    public RepositoryVersionWatcherSource(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<JsonElement>>> stream,
        Func<JsonElement, string?>? parse = null,
        bool autoStart = true)
    {
        ArgumentNullException.ThrowIfNull(stream);
        _stream = stream;
        _parse = parse ?? NewVersionBannerRegistration.ReadAppVersion;

        if (autoStart)
        {
            Refresh();
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string? BootVersion
    {
        get
        {
            lock (_gate)
            {
                return _bootVersion;
            }
        }
    }

    /// <inheritdoc />
    public string? LatestVersion
    {
        get
        {
            lock (_gate)
            {
                return _latestVersion;
            }
        }
    }

    /// <inheritdoc />
    public bool NewVersionAvailable
    {
        get
        {
            lock (_gate)
            {
                return NewVersionBannerRegistration.IsNewVersionAvailable(_bootVersion, _latestVersion);
            }
        }
    }

    /// <summary>Re-run the version stream — the web poll tick (<c>setInterval</c> → <c>fetchVersion</c>).</summary>
    public void Refresh()
    {
        if (_disposed)
        {
            return;
        }

        var generation = Interlocked.Increment(ref _generation);
        _ = PumpAsync(generation);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _lifetime.Cancel();
        _lifetime.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task PumpAsync(int generation)
    {
        try
        {
            await foreach (var result in _stream(_lifetime.Token).ConfigureAwait(false))
            {
                if (Volatile.Read(ref _generation) != generation)
                {
                    // A newer Refresh superseded this run; stop applying its emissions.
                    return;
                }

                if (result.HasValue && result.Value is { } body)
                {
                    Apply(_parse(body));
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by Dispose (lifetime cancelled); nothing to surface — the web hook cancels its boot/poll on unmount.
        }
        catch (ObjectDisposedException)
        {
            // The lifetime token source was disposed mid-enumeration during Dispose; safe to ignore.
        }
    }

    private void Apply(string? version)
    {
        var normalized = NewVersionBannerRegistration.NormalizeVersion(version);
        if (normalized is null)
        {
            // web: fetchVersion returns null on a missing / empty / failed read and the captured version is left intact.
            return;
        }

        bool changed;
        lock (_gate)
        {
            changed = false;
            if (_bootVersion is null)
            {
                _bootVersion = normalized;
                changed = true;
            }

            if (!string.Equals(_latestVersion, normalized, StringComparison.Ordinal))
            {
                _latestVersion = normalized;
                changed = true;
            }
        }

        if (changed)
        {
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }
}

/// <summary>
/// The per-version dismissal seam the <c>NewVersionBanner</c> binds through (P1/S8) — the native analogue of the
/// web per-version <c>sessionStorage</c> flag the banner keys on <c>latestVersion</c>
/// (web/src/components/feedback/NewVersionBanner.tsx L25, L30-37, L57-66). It reports the version the user last
/// deferred and persists a new deferral. Implementations are best-effort: a failure to read or write degrades to
/// "not dismissed" so the banner reappears, never throws (mirroring the web try/catch around
/// <c>sessionStorage</c>). The production binding is the process-lifetime <c>SessionVersionDismissalStore</c> in the
/// view layer (the native analogue of a single browser tab's <c>sessionStorage</c>); the in-process
/// <see cref="InMemoryVersionDismissalStore"/> stands in for headless hosts and unit tests.
/// </summary>
public interface IVersionDismissalStore
{
    /// <summary>The version the user last deferred with "Later", or null if none (web <c>sessionStorage.getItem</c>).</summary>
    string? DismissedVersion { get; }

    /// <summary>Persist a deferral for <paramref name="version"/> and raise <see cref="Changed"/> (web <c>handleLater</c>).</summary>
    /// <param name="version">The version being deferred (web <c>latestVersion</c>).</param>
    void Dismiss(string version);

    /// <summary>Raised whenever <see cref="DismissedVersion"/> changes; may fire from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An in-memory <see cref="IVersionDismissalStore"/> — the headless / unit-test default and a fully-functional
/// (non-durable) store. It lets the banner be exercised across the not-dismissed, dismissed-for-this-version and
/// dismissed-for-an-older-version states without a storage host, and exposes <see cref="DismissCount"/> for
/// write-forwarding assertions.
/// </summary>
public sealed class InMemoryVersionDismissalStore : IVersionDismissalStore
{
    private string? _dismissedVersion;

    /// <summary>Creates the store, optionally seeded with a prior deferral (a simulated earlier "Later" click).</summary>
    /// <param name="dismissedVersion">The version to start dismissed for, or null.</param>
    public InMemoryVersionDismissalStore(string? dismissedVersion = null) =>
        _dismissedVersion = NewVersionBannerRegistration.NormalizeVersion(dismissedVersion);

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string? DismissedVersion => _dismissedVersion;

    /// <summary>Number of times <see cref="Dismiss"/> persisted a NEW deferral (for write assertions).</summary>
    public int DismissCount { get; private set; }

    /// <inheritdoc />
    public void Dismiss(string version)
    {
        ArgumentException.ThrowIfNullOrEmpty(version);

        if (string.Equals(_dismissedVersion, version, StringComparison.Ordinal))
        {
            return;
        }

        _dismissedVersion = version;
        DismissCount++;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
