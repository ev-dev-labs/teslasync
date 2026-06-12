namespace TeslaSync.App.SharedSurfaces.ThemeProviderSurface;

/// <summary>
/// The synchronous local-preference seam (P1/S8 state-holder layer) — the native analogue of the web
/// <c>localStorage</c> reads/writes in <c>web/src/components/ui/ThemeProvider.tsx</c>
/// (<c>teslasync-theme</c> / <c>teslasync-mode</c> / <c>teslasync-custom-primary</c> /
/// <c>teslasync-custom-accent</c>). It is the fast, always-available source the provider reads on
/// construction (so the cached theme is applied before any network I/O) and writes through on every
/// change. The canonical app binds a packaged <c>ApplicationData.LocalSettings</c> implementation; the
/// headless host and the tests use <see cref="InMemoryThemePreferenceStore"/>. The view never touches
/// this seam directly — it binds through the <see cref="ThemeController"/>.
/// </summary>
public interface IThemePreferenceStore
{
    /// <summary>The persisted theme wire id, or <c>null</c> when none has been stored.</summary>
    string? GetThemeId();

    /// <summary>Persist the theme wire id (web <c>localStorage.setItem('teslasync-theme', …)</c>).</summary>
    /// <param name="wireId">The theme wire id to persist.</param>
    void SetThemeId(string wireId);

    /// <summary>The persisted mode wire id, or <c>null</c> when none has been stored.</summary>
    string? GetModeId();

    /// <summary>Persist the mode wire id (web <c>localStorage.setItem('teslasync-mode', …)</c>).</summary>
    /// <param name="wireId">The mode wire id to persist.</param>
    void SetModeId(string wireId);

    /// <summary>The persisted custom primary colour, or <c>null</c> when none has been stored.</summary>
    string? GetCustomPrimary();

    /// <summary>The persisted custom accent colour, or <c>null</c> when none has been stored.</summary>
    string? GetCustomAccent();

    /// <summary>
    /// Persist the custom primary/accent pair (web <c>localStorage.setItem('teslasync-custom-primary'|'…-accent', …)</c>).
    /// </summary>
    /// <param name="primary">The custom primary colour.</param>
    /// <param name="accent">The custom accent colour.</param>
    void SetCustomColors(string primary, string accent);
}

/// <summary>
/// A thread-safe, in-memory <see cref="IThemePreferenceStore"/> — the headless / test analogue of the web
/// <c>localStorage</c>. Seed it through the constructor to reproduce a returning user whose preferences are
/// already persisted; leave it empty to reproduce a first run (every getter returns <c>null</c>, so the
/// controller falls back to the defaults exactly like the web <c>localStorage.getItem(...) || default</c>).
/// </summary>
public sealed class InMemoryThemePreferenceStore : IThemePreferenceStore
{
    private readonly object _gate = new();
    private string? _themeId;
    private string? _modeId;
    private string? _customPrimary;
    private string? _customAccent;

    /// <summary>Creates an empty store (a first-run user with nothing persisted).</summary>
    public InMemoryThemePreferenceStore()
    {
    }

    /// <summary>Creates a pre-seeded store (a returning user whose preferences are already persisted).</summary>
    /// <param name="themeId">The seeded theme wire id, or null.</param>
    /// <param name="modeId">The seeded mode wire id, or null.</param>
    /// <param name="customPrimary">The seeded custom primary colour, or null.</param>
    /// <param name="customAccent">The seeded custom accent colour, or null.</param>
    public InMemoryThemePreferenceStore(string? themeId, string? modeId, string? customPrimary, string? customAccent)
    {
        _themeId = themeId;
        _modeId = modeId;
        _customPrimary = customPrimary;
        _customAccent = customAccent;
    }

    /// <inheritdoc />
    public string? GetThemeId()
    {
        lock (_gate)
        {
            return _themeId;
        }
    }

    /// <inheritdoc />
    public void SetThemeId(string wireId)
    {
        ArgumentNullException.ThrowIfNull(wireId);
        lock (_gate)
        {
            _themeId = wireId;
        }
    }

    /// <inheritdoc />
    public string? GetModeId()
    {
        lock (_gate)
        {
            return _modeId;
        }
    }

    /// <inheritdoc />
    public void SetModeId(string wireId)
    {
        ArgumentNullException.ThrowIfNull(wireId);
        lock (_gate)
        {
            _modeId = wireId;
        }
    }

    /// <inheritdoc />
    public string? GetCustomPrimary()
    {
        lock (_gate)
        {
            return _customPrimary;
        }
    }

    /// <inheritdoc />
    public string? GetCustomAccent()
    {
        lock (_gate)
        {
            return _customAccent;
        }
    }

    /// <inheritdoc />
    public void SetCustomColors(string primary, string accent)
    {
        ArgumentNullException.ThrowIfNull(primary);
        ArgumentNullException.ThrowIfNull(accent);
        lock (_gate)
        {
            _customPrimary = primary;
            _customAccent = accent;
        }
    }
}

/// <summary>
/// The asynchronous backend theme-settings seam (P1/S8 state-holder layer) — the native analogue of the
/// web provider's <c>/api/v1/settings</c> traffic. <see cref="LoadAsync"/> mirrors the mount-time
/// <c>fetch(`${{getApiBase()}}/api/v1/settings`)</c> (a best-effort GET that returns <c>null</c> when there
/// is nothing to apply); <see cref="SaveAsync"/> mirrors the fire-and-forget <c>request('/settings', {{ PUT }})</c>
/// (which the web does after a GET-merge so unrelated settings are preserved — an implementation detail the
/// seam encapsulates). The canonical app binds an implementation over the generated API client; the headless
/// host uses <see cref="NullThemeSettingsGateway"/> and the tests use <see cref="InMemoryThemeSettingsGateway"/>.
/// The view never performs HTTP — it binds through the <see cref="ThemeController"/>, which calls this seam.
/// </summary>
public interface IThemeSettingsGateway
{
    /// <summary>
    /// Load the persisted theme settings, or <c>null</c> when none are available (web mount-time GET; a
    /// failure is surfaced as a thrown exception the controller catches and degrades from).
    /// </summary>
    /// <param name="cancellationToken">A cancellation token.</param>
    Task<ThemeSettingsSnapshot?> LoadAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Persist the theme settings (web fire-and-forget PUT after a GET-merge). Best-effort: a failure is the
    /// controller's to swallow, exactly like the web <c>.catch(() =&gt; {{}})</c>.
    /// </summary>
    /// <param name="snapshot">The theme settings to persist.</param>
    /// <param name="cancellationToken">A cancellation token.</param>
    Task SaveAsync(ThemeSettingsSnapshot snapshot, CancellationToken cancellationToken = default);
}

/// <summary>
/// The inert backend seam used by the headless host — the analogue of running with no reachable backend.
/// <see cref="LoadAsync"/> resolves to <c>null</c> (the "no backend settings" outcome) and
/// <see cref="SaveAsync"/> is a no-op, so the provider runs entirely from local preferences without ever
/// throwing.
/// </summary>
public sealed class NullThemeSettingsGateway : IThemeSettingsGateway
{
    /// <summary>The shared inert instance.</summary>
    public static NullThemeSettingsGateway Instance { get; } = new();

    private NullThemeSettingsGateway()
    {
    }

    /// <inheritdoc />
    public Task<ThemeSettingsSnapshot?> LoadAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<ThemeSettingsSnapshot?>(null);

    /// <inheritdoc />
    public Task SaveAsync(ThemeSettingsSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return Task.CompletedTask;
    }
}

/// <summary>
/// An in-memory <see cref="IThemeSettingsGateway"/> for tests. It holds an optional persisted snapshot,
/// counts saves, and can be told to fail the next load or save so the controller's degrade-to-cache path
/// (the web swallowed-fetch branch — the error / offline state) is exercisable.
/// </summary>
public sealed class InMemoryThemeSettingsGateway : IThemeSettingsGateway
{
    private readonly object _gate = new();
    private ThemeSettingsSnapshot? _snapshot;

    /// <summary>Creates the gateway with no persisted settings (the backend "empty" case).</summary>
    public InMemoryThemeSettingsGateway()
    {
    }

    /// <summary>Creates the gateway pre-seeded with the settings <see cref="LoadAsync"/> returns.</summary>
    /// <param name="snapshot">The settings the backend returns on load.</param>
    public InMemoryThemeSettingsGateway(ThemeSettingsSnapshot? snapshot) => _snapshot = snapshot;

    /// <summary>When set, the next <see cref="LoadAsync"/> throws (simulating an unreachable backend).</summary>
    public bool FailNextLoad { get; set; }

    /// <summary>When set, the next <see cref="SaveAsync"/> throws (simulating a write failure).</summary>
    public bool FailNextSave { get; set; }

    /// <summary>The number of times <see cref="SaveAsync"/> has been invoked (whether or not it failed).</summary>
    public int SaveCount { get; private set; }

    /// <summary>The most recently persisted snapshot (the last successful save).</summary>
    public ThemeSettingsSnapshot? LastSaved
    {
        get
        {
            lock (_gate)
            {
                return _snapshot;
            }
        }
    }

    /// <inheritdoc />
    public Task<ThemeSettingsSnapshot?> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (FailNextLoad)
        {
            FailNextLoad = false;
            return Task.FromException<ThemeSettingsSnapshot?>(new InvalidOperationException("Simulated settings-load failure"));
        }

        lock (_gate)
        {
            return Task.FromResult(_snapshot);
        }
    }

    /// <inheritdoc />
    public Task SaveAsync(ThemeSettingsSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        lock (_gate)
        {
            SaveCount++;
            if (FailNextSave)
            {
                FailNextSave = false;
                return Task.FromException(new InvalidOperationException("Simulated settings-save failure"));
            }

            _snapshot = snapshot;
        }

        return Task.CompletedTask;
    }
}

/// <summary>Event payload for a <see cref="IThemeBroadcastBus"/> delivery — the message plus its originator.</summary>
public sealed class ThemeBroadcastReceivedEventArgs : EventArgs
{
    /// <summary>Creates the payload.</summary>
    /// <param name="message">The broadcast message.</param>
    /// <param name="origin">The publisher token (so a subscriber can ignore its own echo), or null.</param>
    public ThemeBroadcastReceivedEventArgs(ThemeBroadcast message, object? origin)
    {
        ArgumentNullException.ThrowIfNull(message);
        Message = message;
        Origin = origin;
    }

    /// <summary>The broadcast message.</summary>
    public ThemeBroadcast Message { get; }

    /// <summary>The publisher token, so a subscriber can ignore a message it published itself.</summary>
    public object? Origin { get; }
}

/// <summary>
/// The cross-instance broadcast seam (P1/S8 state-holder layer) — the native analogue of the web
/// <c>broadcast(...)</c> / <c>subscribe(...)</c> bus (<c>web/src/lib/broadcast.ts</c>) the provider uses to
/// mirror a theme change made in another window. Like a <c>BroadcastChannel</c>, a publisher does <em>not</em>
/// receive its own message: <see cref="Publish"/> carries an <c>origin</c> token and
/// <see cref="ThemeBroadcastReceivedEventArgs.Origin"/> lets each subscriber skip its own echo (the web "mirror
/// changes from other tabs without rebroadcasting, which would loop" behaviour). The canonical app binds a
/// process-wide implementation so every window's controller coordinates through one instance; the headless host
/// uses <see cref="NullThemeBroadcastBus"/>.
/// </summary>
public interface IThemeBroadcastBus
{
    /// <summary>
    /// Publish <paramref name="message"/> to every other subscriber (web <c>broadcast(...)</c>). The
    /// <paramref name="origin"/> token is echoed back in <see cref="ThemeBroadcastReceivedEventArgs.Origin"/> so
    /// the publisher can ignore its own message.
    /// </summary>
    /// <param name="message">The broadcast message.</param>
    /// <param name="origin">The publisher token, or null.</param>
    void Publish(ThemeBroadcast message, object? origin = null);

    /// <summary>Raised when a message is published (web <c>subscribe(...)</c>).</summary>
    event EventHandler<ThemeBroadcastReceivedEventArgs>? Received;
}

/// <summary>
/// The canonical in-process broadcast bus — the native analogue of the single app-wide
/// <c>BroadcastChannel</c>. <see cref="Shared"/> is the process-wide instance every window's controller
/// coordinates through; tests construct isolated instances. Thread-safe; a subscriber that throws does not
/// prevent the message reaching the others.
/// </summary>
public sealed class InProcessThemeBroadcastBus : IThemeBroadcastBus
{
    /// <summary>The process-wide bus — the single cross-window channel.</summary>
    public static InProcessThemeBroadcastBus Shared { get; } = new();

    /// <inheritdoc />
    public event EventHandler<ThemeBroadcastReceivedEventArgs>? Received;

    /// <inheritdoc />
    public void Publish(ThemeBroadcast message, object? origin = null)
    {
        ArgumentNullException.ThrowIfNull(message);
        Received?.Invoke(this, new ThemeBroadcastReceivedEventArgs(message, origin));
    }
}

/// <summary>
/// The inert broadcast bus used by the headless host — <see cref="Publish"/> is a no-op and
/// <see cref="Received"/> never fires, so a single-window run has no cross-instance sync (and never loops).
/// </summary>
public sealed class NullThemeBroadcastBus : IThemeBroadcastBus
{
    /// <summary>The shared inert instance.</summary>
    public static NullThemeBroadcastBus Instance { get; } = new();

    private NullThemeBroadcastBus()
    {
    }

    /// <inheritdoc />
    public event EventHandler<ThemeBroadcastReceivedEventArgs>? Received
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public void Publish(ThemeBroadcast message, object? origin = null) => ArgumentNullException.ThrowIfNull(message);
}

/// <summary>
/// The OS colour-scheme seam (P1/S8 state-holder layer) — the native analogue of the web
/// <c>window.matchMedia('(prefers-color-scheme: dark)')</c> the provider watches to resolve
/// <see cref="ModeId.Auto"/>. Exposes the current preference and raises <see cref="Changed"/> when the user
/// flips the system theme (web <c>mq.addEventListener('change', …)</c>). The canonical app binds an
/// implementation over the Windows <c>UISettings</c> / accessibility signals; tests use
/// <see cref="FakeSystemColorSchemeProbe"/> and the headless host uses <see cref="StaticSystemColorSchemeProbe"/>.
/// </summary>
public interface ISystemColorSchemeProbe
{
    /// <summary>Whether the OS colour-scheme preference is currently dark (web <c>matches</c>).</summary>
    bool IsDark { get; }

    /// <summary>Raised when the OS colour-scheme preference changes (web media-query <c>change</c>).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// A fixed <see cref="ISystemColorSchemeProbe"/> that never changes — the headless default. Dark by default,
/// matching the web fallback mode.
/// </summary>
public sealed class StaticSystemColorSchemeProbe : ISystemColorSchemeProbe
{
    /// <summary>Creates the probe with a fixed preference (dark by default).</summary>
    /// <param name="isDark">Whether the fixed preference is dark.</param>
    public StaticSystemColorSchemeProbe(bool isDark = true) => IsDark = isDark;

    /// <inheritdoc />
    public bool IsDark { get; }

    /// <inheritdoc />
    public event EventHandler? Changed
    {
        add { }
        remove { }
    }
}

/// <summary>
/// A mutable <see cref="ISystemColorSchemeProbe"/> for tests. Assigning <see cref="IsDark"/> a new value raises
/// <see cref="Changed"/>, reproducing the user flipping the OS theme while an <see cref="ModeId.Auto"/> surface
/// is mounted.
/// </summary>
public sealed class FakeSystemColorSchemeProbe : ISystemColorSchemeProbe
{
    private bool _isDark;

    /// <summary>Creates the probe with an initial preference.</summary>
    /// <param name="isDark">The initial dark preference.</param>
    public FakeSystemColorSchemeProbe(bool isDark = true) => _isDark = isDark;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsDark
    {
        get => _isDark;
        set
        {
            if (_isDark == value)
            {
                return;
            }

            _isDark = value;
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }
}

/// <summary>
/// A bundle of the four seams a <see cref="ThemeController"/> binds to (P1/S8). Grouping them keeps the
/// controller constructor readable and gives the WinUI view and tests one place to assemble the dependencies.
/// <see cref="CreateHeadless"/> returns an all-local, no-backend bundle (in-memory preferences, no broadcast,
/// a fixed dark OS probe) suitable for an unpackaged dev run or a default host.
/// </summary>
public sealed class ThemeProviderSeams
{
    /// <summary>Creates the bundle from its four seams.</summary>
    /// <param name="preferences">The local-preference seam (localStorage analogue).</param>
    /// <param name="gateway">The backend settings seam (<c>/settings</c> analogue).</param>
    /// <param name="broadcast">The cross-instance broadcast seam.</param>
    /// <param name="systemColorScheme">The OS colour-scheme seam (matchMedia analogue).</param>
    public ThemeProviderSeams(
        IThemePreferenceStore preferences,
        IThemeSettingsGateway gateway,
        IThemeBroadcastBus broadcast,
        ISystemColorSchemeProbe systemColorScheme)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        ArgumentNullException.ThrowIfNull(gateway);
        ArgumentNullException.ThrowIfNull(broadcast);
        ArgumentNullException.ThrowIfNull(systemColorScheme);

        Preferences = preferences;
        Gateway = gateway;
        Broadcast = broadcast;
        SystemColorScheme = systemColorScheme;
    }

    /// <summary>The local-preference seam (localStorage analogue).</summary>
    public IThemePreferenceStore Preferences { get; }

    /// <summary>The backend settings seam (<c>/settings</c> analogue).</summary>
    public IThemeSettingsGateway Gateway { get; }

    /// <summary>The cross-instance broadcast seam.</summary>
    public IThemeBroadcastBus Broadcast { get; }

    /// <summary>The OS colour-scheme seam (matchMedia analogue).</summary>
    public ISystemColorSchemeProbe SystemColorScheme { get; }

    /// <summary>
    /// An all-local, no-backend bundle (in-memory preferences, the inert backend + broadcast seams, a fixed
    /// dark OS probe) — the default for an unpackaged dev run or a headless host.
    /// </summary>
    public static ThemeProviderSeams CreateHeadless() => new(
        new InMemoryThemePreferenceStore(),
        NullThemeSettingsGateway.Instance,
        NullThemeBroadcastBus.Instance,
        new StaticSystemColorSchemeProbe());
}
