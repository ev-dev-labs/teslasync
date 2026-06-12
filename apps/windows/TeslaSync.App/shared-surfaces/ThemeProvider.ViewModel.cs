using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.ThemeProviderSurface;

/// <summary>
/// The read/write theme context value a consumer binds to — the native shape of the web
/// <c>useTheme()</c> return (<c>web/src/components/ui/ThemeProvider.tsx</c>:
/// <c>{{ themeId, modeId, theme, mode, setTheme, setMode, setCustomColors, themes, modes }}</c>). A page
/// reads the resolved <see cref="Theme"/> / <see cref="Mode"/> and drives the selectors through
/// <see cref="SetTheme"/> / <see cref="SetMode"/> / <see cref="SetCustomColors"/>; it observes changes
/// through <see cref="INotifyPropertyChanged"/>. The canonical implementation is
/// <see cref="ThemeController"/>; the WinUI view exposes it to descendants through
/// <see cref="ThemeProviderContext"/>.
/// </summary>
public interface IThemeContext : INotifyPropertyChanged
{
    /// <summary>The selected theme id (web <c>themeId</c>).</summary>
    ThemeId ThemeId { get; }

    /// <summary>The selected mode id, possibly <see cref="ModeId.Auto"/> (web <c>modeId</c>).</summary>
    ModeId ModeId { get; }

    /// <summary>The resolved colour theme, with custom colours folded in (web <c>theme</c>).</summary>
    ColorTheme Theme { get; }

    /// <summary>The resolved display mode, with <see cref="ModeId.Auto"/> folded to dark/light (web <c>mode</c>).</summary>
    ModeTheme Mode { get; }

    /// <summary>The fully-applied palette (the web <c>applyThemeCSS</c> output the view renders from).</summary>
    AppliedThemeTokens AppliedTokens { get; }

    /// <summary>The selectable colour themes, custom folded in (web <c>themes</c>).</summary>
    IReadOnlyList<ColorTheme> AvailableThemes { get; }

    /// <summary>The selectable display modes (web <c>modes</c>).</summary>
    IReadOnlyList<ModeTheme> AvailableModes { get; }

    /// <summary>Select a colour theme (web <c>setTheme</c>).</summary>
    /// <param name="id">The theme id to apply.</param>
    void SetTheme(ThemeId id);

    /// <summary>Select a display mode (web <c>setMode</c>).</summary>
    /// <param name="id">The mode id to apply.</param>
    void SetMode(ModeId id);

    /// <summary>Set the custom primary/accent colours and switch to the custom theme (web <c>setCustomColors</c>).</summary>
    /// <param name="primary">The custom primary colour (<c>#rrggbb</c>).</param>
    /// <param name="accent">The custom accent colour (<c>#rrggbb</c>).</param>
    void SetCustomColors(string primary, string accent);
}

/// <summary>
/// The UI-thread-bound state holder backing the WinUI <see cref="ThemeProviderSurface.ThemeProvider"/> — the
/// native port of the web <c>ThemeProvider</c> component body and its <c>useTheme</c> context value
/// (<c>web/src/components/ui/ThemeProvider.tsx</c>). It binds the four P1/S8 seams
/// (<see cref="IThemePreferenceStore"/>, <see cref="IThemeSettingsGateway"/>, <see cref="IThemeBroadcastBus"/>,
/// <see cref="ISystemColorSchemeProbe"/>) and reproduces the component's behaviour exactly:
/// <list type="bullet">
///   <item><description>construct from local preferences, falling back to the defaults (web initial
///     <c>useState</c> from <c>localStorage</c>);</description></item>
///   <item><description><see cref="InitializeAsync"/> folds backend settings in once on mount and then enables
///     fire-and-forget persistence (web mount effect + <c>initialized</c> gate);</description></item>
///   <item><description><see cref="SetTheme"/> / <see cref="SetMode"/> / <see cref="SetCustomColors"/> apply,
///     persist locally, persist to the backend (when initialized) and broadcast (web setters);</description></item>
///   <item><description>it mirrors broadcasts from other windows without re-persisting to the backend or
///     re-broadcasting (web <c>subscribe</c>), and re-resolves <see cref="ModeId.Auto"/> when the OS scheme
///     flips (web <c>matchMedia</c> listener).</description></item>
/// </list>
/// The holder performs no HTTP itself; it calls the gateway seam. It is affined to the thread that constructs
/// it (a React component's single-threaded model); the WinUI view marshals seam callbacks onto the UI thread.
/// </summary>
public sealed class ThemeController : IThemeContext, IDisposable
{
    private readonly IThemePreferenceStore _preferences;
    private readonly IThemeSettingsGateway _gateway;
    private readonly IThemeBroadcastBus _broadcast;
    private readonly ISystemColorSchemeProbe _systemProbe;
    private readonly ThemeProviderDiagnostics _diagnostics;

    private ThemeId _themeId;
    private ModeId _modeId;
    private string _customPrimary;
    private string _customAccent;
    private bool _systemDark;
    private ThemeLoadPhase _phase = ThemeLoadPhase.Initializing;
    private ThemeSettingsLoadOutcome _outcome = ThemeSettingsLoadOutcome.Pending;

    private ColorTheme _theme;
    private ModeTheme _mode;
    private AppliedThemeTokens _appliedTokens;
    private bool _initializeStarted;
    private bool _disposed;

    /// <summary>Creates the controller over an explicit seam bundle and an optional diagnostics collector.</summary>
    /// <param name="seams">The four P1/S8 seams the controller binds to.</param>
    /// <param name="diagnostics">An optional PII-safe diagnostics collector.</param>
    public ThemeController(ThemeProviderSeams seams, ThemeProviderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(seams);

        _preferences = seams.Preferences;
        _gateway = seams.Gateway;
        _broadcast = seams.Broadcast;
        _systemProbe = seams.SystemColorScheme;
        _diagnostics = diagnostics ?? new ThemeProviderDiagnostics();

        // web: initial useState reads localStorage, validating `saved in themes` / `in modes`, else the default.
        _themeId = ThemeCatalog.TryParseId(_preferences.GetThemeId()) ?? ThemeCatalog.DefaultId;
        _modeId = ModeCatalog.TryParseId(_preferences.GetModeId()) ?? ModeCatalog.DefaultId;

        // web loadCustomColors: localStorage value || default.
        _customPrimary = NormalizeCustom(_preferences.GetCustomPrimary(), ThemeCatalog.DefaultCustomPrimary);
        _customAccent = NormalizeCustom(_preferences.GetCustomAccent(), ThemeCatalog.DefaultCustomAccent);

        _systemDark = _systemProbe.IsDark;

        _theme = ThemeCatalog.Resolve(_themeId, _customPrimary, _customAccent);
        _mode = ModeCatalog.Resolve(_modeId, _systemDark);
        _appliedTokens = AppliedThemeTokens.Compute(_themeId, _modeId, _theme, _mode);

        _systemProbe.Changed += OnSystemColorSchemeChanged;
        _broadcast.Received += OnBroadcastReceived;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>ThemeProvider</c>).</summary>
    public static string Slug => ThemeProviderRegistration.Slug;

    /// <inheritdoc />
    public ThemeId ThemeId => _themeId;

    /// <inheritdoc />
    public ModeId ModeId => _modeId;

    /// <inheritdoc />
    public ColorTheme Theme => _theme;

    /// <inheritdoc />
    public ModeTheme Mode => _mode;

    /// <inheritdoc />
    public AppliedThemeTokens AppliedTokens => _appliedTokens;

    /// <summary>The current custom primary colour (web <c>customColors.primary</c>).</summary>
    public string CustomPrimary => _customPrimary;

    /// <summary>The current custom accent colour (web <c>customColors.accent</c>).</summary>
    public string CustomAccent => _customAccent;

    /// <summary>Whether the OS colour-scheme preference is currently dark (web <c>systemDark</c>).</summary>
    public bool SystemDark => _systemDark;

    /// <summary>The async lifecycle phase of the one-shot backend load (web <c>initialized</c>).</summary>
    public ThemeLoadPhase LoadPhase => _phase;

    /// <summary>How the backend load resolved (the observable loading / empty / error / offline outcome).</summary>
    public ThemeSettingsLoadOutcome LoadOutcome => _outcome;

    /// <summary>Whether the backend load has completed, enabling persistence (web <c>initialized === true</c>).</summary>
    public bool IsInitialized => _phase == ThemeLoadPhase.Ready;

    /// <inheritdoc />
    public IReadOnlyList<ColorTheme> AvailableThemes => BuildAvailableThemes();

    /// <inheritdoc />
    public IReadOnlyList<ModeTheme> AvailableModes => ModeCatalog.Ids.Select(ModeCatalog.Get).ToArray();

    /// <summary>
    /// Fold the backend theme settings in once on mount, then enable fire-and-forget persistence — the native
    /// port of the web mount <c>useEffect</c>. Idempotent: the load runs at most once; a failed or empty backend
    /// degrades to the already-applied cached / default theme (the web swallowed-fetch branch) and still flips
    /// the surface to <see cref="ThemeLoadPhase.Ready"/> so subsequent changes persist. Safe to await (tests) or
    /// fire-and-forget (the view, mirroring the web effect).
    /// </summary>
    /// <param name="cancellationToken">A cancellation token.</param>
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || _initializeStarted)
        {
            return;
        }

        _initializeStarted = true;

        ThemeSettingsLoadOutcome outcome;
        try
        {
            // Default (no ConfigureAwait(false)): resume on the captured context so the view's state mutation
            // and PropertyChanged happen back on the UI thread.
            ThemeSettingsSnapshot? settings = await _gateway.LoadAsync(cancellationToken);
            outcome = ApplyBackendSettings(settings);
        }
        catch (OperationCanceledException)
        {
            // A cancelled load leaves the cached / default theme in place; treat it as a graceful degrade.
            outcome = ThemeSettingsLoadOutcome.DegradedToCache;
        }
        catch (Exception)
        {
            // web: `.catch(() => {})` — a failed/unreachable backend keeps the cached/default theme (error/offline).
            outcome = ThemeSettingsLoadOutcome.DegradedToCache;
        }

        _outcome = outcome;
        _phase = ThemeLoadPhase.Ready;
        _diagnostics.RecordSettingsLoaded(outcome);
        RaiseChanged(nameof(LoadPhase));
        RaiseChanged(nameof(LoadOutcome));
        RaiseChanged(nameof(IsInitialized));
    }

    /// <inheritdoc />
    public void SetTheme(ThemeId id)
    {
        ThrowIfDisposed();
        if (_themeId == id)
        {
            return;
        }

        _themeId = id;
        Apply();
        QueuePersistToBackend();
        _broadcast.Publish(new ThemeBroadcast.ThemeChanged(_themeId, _modeId), this);
    }

    /// <inheritdoc />
    public void SetMode(ModeId id)
    {
        ThrowIfDisposed();
        if (_modeId == id)
        {
            return;
        }

        _modeId = id;
        Apply();
        QueuePersistToBackend();
        _broadcast.Publish(new ThemeBroadcast.ThemeChanged(_themeId, _modeId), this);
    }

    /// <inheritdoc />
    public void SetCustomColors(string primary, string accent)
    {
        ArgumentNullException.ThrowIfNull(primary);
        ArgumentNullException.ThrowIfNull(accent);
        ThrowIfDisposed();

        // web: persist custom colours, set state, then switch the selected theme to 'custom'.
        _preferences.SetCustomColors(primary, accent);
        _customPrimary = primary;
        _customAccent = accent;
        _themeId = ThemeId.Custom;
        Apply();
        QueuePersistToBackend();
        _broadcast.Publish(new ThemeBroadcast.CustomColors(primary, accent), this);
        _broadcast.Publish(new ThemeBroadcast.ThemeChanged(_themeId, _modeId), this);
    }

    /// <summary>Detach from the seams (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _systemProbe.Changed -= OnSystemColorSchemeChanged;
        _broadcast.Received -= OnBroadcastReceived;
        GC.SuppressFinalize(this);
    }

    private static string NormalizeCustom(string? stored, string fallback) =>
        string.IsNullOrEmpty(stored) ? fallback : stored;

    private ColorTheme[] BuildAvailableThemes() =>
        ThemeCatalog.Ids.Select(id => ThemeCatalog.Resolve(id, _customPrimary, _customAccent)).ToArray();

    private ThemeSettingsLoadOutcome ApplyBackendSettings(ThemeSettingsSnapshot? settings)
    {
        if (settings is null)
        {
            return ThemeSettingsLoadOutcome.NoBackendSettings;
        }

        var applied = false;

        // web: `if (settings.theme && settings.theme in themes) { setThemeId(...); localStorage.setItem(...) }`
        ThemeId? backendTheme = ThemeCatalog.TryParseId(settings.Theme);
        if (backendTheme is { } themeId && themeId != _themeId)
        {
            _themeId = themeId;
            applied = true;
        }
        else if (backendTheme is not null)
        {
            applied = true;
        }

        ModeId? backendMode = ModeCatalog.TryParseId(settings.Mode);
        if (backendMode is { } modeId && modeId != _modeId)
        {
            _modeId = modeId;
            applied = true;
        }
        else if (backendMode is not null)
        {
            applied = true;
        }

        // web: `if (settings.custom_primary && settings.custom_accent) { ... }`
        if (!string.IsNullOrEmpty(settings.CustomPrimary) && !string.IsNullOrEmpty(settings.CustomAccent))
        {
            _customPrimary = settings.CustomPrimary;
            _customAccent = settings.CustomAccent;
            _preferences.SetCustomColors(settings.CustomPrimary, settings.CustomAccent);
            applied = true;
        }

        if (applied)
        {
            // Re-resolve and persist the folded-in theme/mode to local preferences (web localStorage.setItem).
            Apply();
        }

        return applied ? ThemeSettingsLoadOutcome.AppliedFromBackend : ThemeSettingsLoadOutcome.NoBackendSettings;
    }

    private void Apply()
    {
        ColorTheme previousTheme = _theme;
        ModeTheme previousMode = _mode;

        _theme = ThemeCatalog.Resolve(_themeId, _customPrimary, _customAccent);
        _mode = ModeCatalog.Resolve(_modeId, _systemDark);
        _appliedTokens = AppliedThemeTokens.Compute(_themeId, _modeId, _theme, _mode);

        // web apply effect: persist the selected theme/mode to localStorage on every change.
        _preferences.SetThemeId(ThemeCatalog.ToWireId(_themeId));
        _preferences.SetModeId(ModeCatalog.ToWireId(_modeId));

        _diagnostics.RecordThemeApplied(_themeId, _modeId);

        RaiseChanged(nameof(ThemeId));
        RaiseChanged(nameof(ModeId));
        RaiseChanged(nameof(CustomPrimary));
        RaiseChanged(nameof(CustomAccent));
        RaiseChanged(nameof(AvailableThemes));
        if (!ReferenceEquals(previousTheme, _theme))
        {
            RaiseChanged(nameof(Theme));
        }

        if (!ReferenceEquals(previousMode, _mode))
        {
            RaiseChanged(nameof(Mode));
        }

        RaiseChanged(nameof(AppliedTokens));
    }

    private void QueuePersistToBackend()
    {
        // web saveThemeToBackend: `if (!initialized) return` — do not persist during/Before the mount load.
        if (_phase != ThemeLoadPhase.Ready)
        {
            return;
        }

        var snapshot = new ThemeSettingsSnapshot(
            ThemeCatalog.ToWireId(_themeId),
            ModeCatalog.ToWireId(_modeId),
            _customPrimary,
            _customAccent);

        _ = PersistToBackendAsync(snapshot);
    }

    private async Task PersistToBackendAsync(ThemeSettingsSnapshot snapshot)
    {
        try
        {
            await _gateway.SaveAsync(snapshot).ConfigureAwait(false);
        }
        catch (Exception)
        {
            // web: `.catch(() => {})` — backend persistence is best-effort and must never surface to the UI.
        }
    }

    private void OnSystemColorSchemeChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        var systemDark = _systemProbe.IsDark;
        if (systemDark == _systemDark)
        {
            return;
        }

        _systemDark = systemDark;
        RaiseChanged(nameof(SystemDark));

        // web: the resolvedMode memo only changes the rendered palette when the mode is 'auto'.
        if (_modeId == ModeId.Auto)
        {
            Apply();
        }
    }

    private void OnBroadcastReceived(object? sender, ThemeBroadcastReceivedEventArgs e)
    {
        if (_disposed || ReferenceEquals(e.Origin, this))
        {
            // web BroadcastChannel does not echo to the sender; ignore our own message so we never loop.
            return;
        }

        switch (e.Message)
        {
            case ThemeBroadcast.ThemeChanged changed:
                // web subscribe: mirror themeId/modeId without re-persisting to the backend or rebroadcasting.
                MirrorThemeChanged(changed.ThemeId, changed.ModeId);
                break;

            case ThemeBroadcast.CustomColors custom:
                // web subscribe: mirror the custom colours only (the selected theme id is not touched here).
                MirrorCustomColors(custom.Primary, custom.Accent);
                break;

            default:
                break;
        }
    }

    private void MirrorThemeChanged(ThemeId themeId, ModeId modeId)
    {
        if (_themeId == themeId && _modeId == modeId)
        {
            return;
        }

        _themeId = themeId;
        _modeId = modeId;
        Apply();
    }

    private void MirrorCustomColors(string primary, string accent)
    {
        if (string.Equals(_customPrimary, primary, StringComparison.Ordinal)
            && string.Equals(_customAccent, accent, StringComparison.Ordinal))
        {
            return;
        }

        _customPrimary = primary;
        _customAccent = accent;
        Apply();
    }

    private void RaiseChanged(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);
}
