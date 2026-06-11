using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="KioskSettingsModal"/> view — the native port of the
/// web <c>KioskSettingsModal</c> component (web/src/features/dashboard/components/KioskSettingsModal.tsx). It owns
/// the editable kiosk config (the web <c>config</c> prop), the rotation dashboard selection (the web
/// <c>selectedIds</c> <c>useState</c>), and the available dashboards, derives the four progressive-disclosure gates
/// and the live-preview swatch, exposes the dropdown options + every localized label, and drives the three callback
/// seams (web <c>onUpdateConfig</c> → <see cref="ConfigUpdated"/>, <c>onClose</c> → <see cref="CloseRequested"/>,
/// <c>onEnterKiosk</c> → <see cref="EnterKioskRequested"/>). The web component is a pure presentational editor with
/// no read query, so the surface never shows a loading / empty / error / stale / offline state; its states are the
/// editable form plus the conditional sub-controls (dashboards-to-rotate, hide-after, dimmed-brightness,
/// clock-position) and the "can't deselect the last dashboard" rule. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class KioskSettingsModalViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly KioskSettingsModalDiagnostics _diagnostics;
    private readonly IReadOnlyList<KioskDashboard> _dashboards;

    private int _rotateIntervalSeconds;
    private bool _hideCursor;
    private int _cursorTimeoutSeconds;
    private int _dimAfterMinutes;
    private double _dimLevel;
    private bool _showClock;
    private ClockCorner _clockPosition;
    private double _widgetOpacity;
    private double _backgroundOpacity;
    private IReadOnlyList<string> _selectedIds;

    /// <summary>Creates the holder over the initial config, the available dashboards, the i18n facade and diagnostics.</summary>
    /// <param name="config">The initial kiosk config (web <c>config</c> prop); defaults applied when null.</param>
    /// <param name="dashboards">The saved dashboards the rotation list offers (web <c>dashboards</c> prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public KioskSettingsModalViewModel(
        KioskConfig config,
        IReadOnlyList<KioskDashboard> dashboards,
        ILocalizer localizer,
        KioskSettingsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(dashboards);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new KioskSettingsModalDiagnostics();
        _dashboards = dashboards;

        _rotateIntervalSeconds = config.RotateIntervalSeconds;
        _hideCursor = config.HideCursor;
        _cursorTimeoutSeconds = config.CursorTimeoutSeconds;
        _dimAfterMinutes = config.DimAfterMinutes;
        _dimLevel = config.DimLevel;
        _showClock = config.ShowClock;
        _clockPosition = config.ClockPosition;
        _widgetOpacity = config.WidgetOpacity;
        _backgroundOpacity = config.BackgroundOpacity;
        _selectedIds = KioskSettingsModalProjection.InitialSelection(config.DashboardIds, dashboards);

        RotationOptions = KioskSettingsModalProjection.RotationOptions(localizer);
        CursorTimeoutOptions = KioskSettingsModalProjection.CursorTimeoutOptions(localizer);
        DimAfterOptions = KioskSettingsModalProjection.DimAfterOptions(localizer);
        ClockPositionOptions = KioskSettingsModalProjection.ClockPositionOptions(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with the full updated config whenever the user edits a setting (web <c>onUpdateConfig</c>).</summary>
    public event EventHandler<KioskConfig>? ConfigUpdated;

    /// <summary>Raised when the modal should close (web <c>onClose()</c>): the Enter or Cancel action.</summary>
    public event EventHandler? CloseRequested;

    /// <summary>Raised when the user commits to kiosk mode (web <c>onEnterKiosk()</c>), after the config + close.</summary>
    public event EventHandler? EnterKioskRequested;

    // ── Static option content (web inline option arrays) ─────────────────────────────────────────────────

    /// <summary>Rotation-interval dropdown options (web <c>ROTATION_OPTIONS</c>).</summary>
    public IReadOnlyList<KioskSelectOption<int>> RotationOptions { get; }

    /// <summary>Cursor auto-hide delay dropdown options (web <c>CURSOR_TIMEOUT_OPTIONS</c>).</summary>
    public IReadOnlyList<KioskSelectOption<int>> CursorTimeoutOptions { get; }

    /// <summary>Screen-dim delay dropdown options (web <c>DIM_AFTER_OPTIONS</c>).</summary>
    public IReadOnlyList<KioskSelectOption<int>> DimAfterOptions { get; }

    /// <summary>Clock-position dropdown options (web <c>CLOCK_POSITION_OPTIONS</c>).</summary>
    public IReadOnlyList<KioskSelectOption<ClockCorner>> ClockPositionOptions { get; }

    /// <summary>The saved dashboards offered in the rotation checklist (web <c>dashboards</c> prop).</summary>
    public IReadOnlyList<KioskDashboard> Dashboards => _dashboards;

    // ── Header / field copy (the Narrator-label source) ──────────────────────────────────────────────────

    /// <summary>Modal title (web <c>Kiosk Settings</c>).</summary>
    public string SettingsTitle => KioskSettingsModalRegistration.SettingsTitle(_localizer);

    /// <summary>Rotation section title (web <c>Dashboard Rotation</c>).</summary>
    public string RotationTitle => KioskSettingsModalRegistration.RotationTitle(_localizer);

    /// <summary>Rotation-interval field label (web <c>Rotation Interval</c>).</summary>
    public string RotationIntervalLabel => KioskSettingsModalRegistration.RotationIntervalLabel(_localizer);

    /// <summary>Dashboards-to-rotate field label (web <c>Dashboards to Rotate</c>).</summary>
    public string DashboardsToRotateLabel => KioskSettingsModalRegistration.DashboardsToRotateLabel(_localizer);

    /// <summary>Default-dashboard chip (web <c>Default</c>).</summary>
    public string DefaultBadge => KioskSettingsModalRegistration.DefaultBadge(_localizer);

    /// <summary>Display section title (web <c>Display</c>).</summary>
    public string DisplayTitle => KioskSettingsModalRegistration.DisplayTitle(_localizer);

    /// <summary>Cursor auto-hide toggle label (web <c>Auto-hide Cursor</c>).</summary>
    public string HideCursorLabel => KioskSettingsModalRegistration.HideCursorLabel(_localizer);

    /// <summary>Cursor auto-hide delay field label (web <c>Hide After</c>).</summary>
    public string CursorTimeoutLabel => KioskSettingsModalRegistration.CursorTimeoutLabel(_localizer);

    /// <summary>Screen-dim delay field label (web <c>Dim Screen After</c>).</summary>
    public string DimAfterLabel => KioskSettingsModalRegistration.DimAfterLabel(_localizer);

    /// <summary>Dimmed-brightness slider label (web <c>Dimmed Brightness</c>).</summary>
    public string BrightnessLabel => KioskSettingsModalRegistration.BrightnessLabel(_localizer);

    /// <summary>Clock toggle label (web <c>Show Clock</c>).</summary>
    public string ShowClockLabel => KioskSettingsModalRegistration.ShowClockLabel(_localizer);

    /// <summary>Clock-position field label (web <c>Clock Position</c>).</summary>
    public string ClockPositionLabel => KioskSettingsModalRegistration.ClockPositionLabel(_localizer);

    /// <summary>Transparency section title (web <c>Transparency</c>).</summary>
    public string TransparencyTitle => KioskSettingsModalRegistration.TransparencyTitle(_localizer);

    /// <summary>Transparency section description (web <c>transparencyDesc</c>).</summary>
    public string TransparencyDescription => KioskSettingsModalRegistration.TransparencyDescription(_localizer);

    /// <summary>Widget-opacity slider label (web <c>Widget Opacity</c>).</summary>
    public string WidgetOpacityLabel => KioskSettingsModalRegistration.WidgetOpacityLabel(_localizer);

    /// <summary>Background-opacity slider label (web <c>Background Opacity</c>).</summary>
    public string BackgroundOpacityLabel => KioskSettingsModalRegistration.BackgroundOpacityLabel(_localizer);

    /// <summary>Slider low-end caption (web <c>Transparent</c>).</summary>
    public string TransparentLabel => KioskSettingsModalRegistration.TransparentLabel(_localizer);

    /// <summary>Slider high-end caption (web <c>Solid</c>).</summary>
    public string SolidLabel => KioskSettingsModalRegistration.SolidLabel(_localizer);

    /// <summary>Live-preview swatch caption (web <c>Preview — this is how widgets will look</c>).</summary>
    public string PreviewText => KioskSettingsModalRegistration.PreviewText(_localizer);

    /// <summary>Footer hint (web <c>kiosk.hint</c>).</summary>
    public string HintText => KioskSettingsModalRegistration.HintText(_localizer);

    /// <summary>Primary action label (web <c>Enter Kiosk Mode</c>).</summary>
    public string EnterLabel => KioskSettingsModalRegistration.EnterLabel(_localizer);

    /// <summary>Dismiss action label (web <c>Cancel</c>).</summary>
    public string CancelLabel => KioskSettingsModalRegistration.CancelLabel(_localizer);

    // ── Editable config fields (web config + onUpdateConfig) ─────────────────────────────────────────────

    /// <summary>Rotation interval in seconds (web <c>rotateInterval</c>). 0 disables rotation.</summary>
    public int RotateIntervalSeconds
    {
        get => _rotateIntervalSeconds;
        set
        {
            if (Set(ref _rotateIntervalSeconds, value))
            {
                Raise(nameof(ShowDashboardList));
                EmitConfig();
            }
        }
    }

    /// <summary>Whether the cursor auto-hides in kiosk mode (web <c>hideCursor</c>).</summary>
    public bool HideCursor
    {
        get => _hideCursor;
        set
        {
            if (Set(ref _hideCursor, value))
            {
                Raise(nameof(ShowCursorTimeout));
                EmitConfig();
            }
        }
    }

    /// <summary>Cursor auto-hide delay in seconds (web <c>cursorTimeout</c>).</summary>
    public int CursorTimeoutSeconds
    {
        get => _cursorTimeoutSeconds;
        set
        {
            if (Set(ref _cursorTimeoutSeconds, value))
            {
                EmitConfig();
            }
        }
    }

    /// <summary>Screen-dim delay in minutes (web <c>dimAfter</c>). 0 disables dimming.</summary>
    public int DimAfterMinutes
    {
        get => _dimAfterMinutes;
        set
        {
            if (Set(ref _dimAfterMinutes, value))
            {
                Raise(nameof(ShowDimBrightness));
                EmitConfig();
            }
        }
    }

    /// <summary>Dimmed-brightness fraction 0..1 (web <c>dimLevel</c>).</summary>
    public double DimLevel
    {
        get => _dimLevel;
        set
        {
            if (Set(ref _dimLevel, value))
            {
                Raise(nameof(DimLevelPercent));
                Raise(nameof(DimLevelDisplay));
                EmitConfig();
            }
        }
    }

    /// <summary>Whether the kiosk clock is shown (web <c>showClock</c>).</summary>
    public bool ShowClock
    {
        get => _showClock;
        set
        {
            if (Set(ref _showClock, value))
            {
                Raise(nameof(ShowClockPosition));
                EmitConfig();
            }
        }
    }

    /// <summary>The clock corner (web <c>clockPosition</c>).</summary>
    public ClockCorner ClockPosition
    {
        get => _clockPosition;
        set
        {
            if (Set(ref _clockPosition, value))
            {
                EmitConfig();
            }
        }
    }

    /// <summary>Widget-panel opacity fraction 0.3..1 (web <c>widgetOpacity</c>).</summary>
    public double WidgetOpacity
    {
        get => _widgetOpacity;
        set
        {
            if (Set(ref _widgetOpacity, value))
            {
                Raise(nameof(WidgetOpacityPercent));
                Raise(nameof(WidgetOpacityDisplay));
                Raise(nameof(Preview));
                EmitConfig();
            }
        }
    }

    /// <summary>Page-background opacity fraction 0..1 (web <c>backgroundOpacity</c>).</summary>
    public double BackgroundOpacity
    {
        get => _backgroundOpacity;
        set
        {
            if (Set(ref _backgroundOpacity, value))
            {
                Raise(nameof(BackgroundOpacityPercent));
                Raise(nameof(BackgroundOpacityDisplay));
                Raise(nameof(Preview));
                EmitConfig();
            }
        }
    }

    // ── Progressive-disclosure gates (web conditional render branches) ───────────────────────────────────

    /// <summary>True when the dashboards-to-rotate checklist renders (web <c>rotateInterval &gt; 0 &amp;&amp; dashboards.length &gt; 1</c>).</summary>
    public bool ShowDashboardList =>
        KioskSettingsModalProjection.ShouldShowDashboardList(_rotateIntervalSeconds, _dashboards.Count);

    /// <summary>True when the cursor-timeout select renders (web <c>hideCursor</c>).</summary>
    public bool ShowCursorTimeout => KioskSettingsModalProjection.ShouldShowCursorTimeout(_hideCursor);

    /// <summary>True when the dimmed-brightness slider renders (web <c>dimAfter &gt; 0</c>).</summary>
    public bool ShowDimBrightness => KioskSettingsModalProjection.ShouldShowDimBrightness(_dimAfterMinutes);

    /// <summary>True when the clock-position select renders (web <c>showClock</c>).</summary>
    public bool ShowClockPosition => KioskSettingsModalProjection.ShouldShowClockPosition(_showClock);

    // ── Slider percent + readout projections ─────────────────────────────────────────────────────────────

    /// <summary>Dimmed-brightness as a slider percent (web <c>Math.round(dimLevel * 100)</c>).</summary>
    public int DimLevelPercent => KioskSettingsModalProjection.OpacityToPercent(_dimLevel);

    /// <summary>Dimmed-brightness readout, e.g. "50%" (web Slider <c>formatValue</c>).</summary>
    public string DimLevelDisplay => KioskSettingsModalRegistration.PercentLabel(DimLevelPercent);

    /// <summary>Widget opacity as a slider percent (web <c>Math.round(widgetOpacity * 100)</c>).</summary>
    public int WidgetOpacityPercent => KioskSettingsModalProjection.OpacityToPercent(_widgetOpacity);

    /// <summary>Widget opacity readout, e.g. "100%" (web Slider <c>formatValue</c>).</summary>
    public string WidgetOpacityDisplay => KioskSettingsModalRegistration.PercentLabel(WidgetOpacityPercent);

    /// <summary>Background opacity as a slider percent (web <c>Math.round(backgroundOpacity * 100)</c>).</summary>
    public int BackgroundOpacityPercent => KioskSettingsModalProjection.OpacityToPercent(_backgroundOpacity);

    /// <summary>Background opacity readout, e.g. "100%" (web Slider <c>formatValue</c>).</summary>
    public string BackgroundOpacityDisplay => KioskSettingsModalRegistration.PercentLabel(BackgroundOpacityPercent);

    /// <summary>The computed live-preview swatch appearance (web preview block inline styles).</summary>
    public KioskPreview Preview =>
        KioskSettingsModalProjection.ComputePreview(_widgetOpacity, _backgroundOpacity);

    /// <summary>The current rotation selection (web <c>selectedIds</c>), in selection order.</summary>
    public IReadOnlyList<string> SelectedIds => _selectedIds;

    /// <summary>The current full config snapshot (the body of every <see cref="ConfigUpdated"/> emission).</summary>
    public KioskConfig CurrentConfig => new(
        RotateIntervalSeconds: _rotateIntervalSeconds,
        DashboardIds: _selectedIds,
        HideCursor: _hideCursor,
        CursorTimeoutSeconds: _cursorTimeoutSeconds,
        DimAfterMinutes: _dimAfterMinutes,
        DimLevel: _dimLevel,
        ShowClock: _showClock,
        ClockPosition: _clockPosition,
        WidgetOpacity: _widgetOpacity,
        BackgroundOpacity: _backgroundOpacity);

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Whether <paramref name="dashboardId"/> is currently in the rotation selection.</summary>
    public bool IsSelected(string dashboardId) => _selectedIds.Contains(dashboardId);

    /// <summary>Record the surface open (web mount) — emits the <c>view.opened</c> diagnostics event.</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Toggle a dashboard in the rotation selection (web <c>toggleDashboard</c>): adds it, or removes it while
    /// more than one remains (the last selection is sticky). When the selection changes it emits the updated
    /// config (web <c>onUpdateConfig({ dashboardIds })</c>).
    /// </summary>
    public void ToggleDashboard(string dashboardId)
    {
        ArgumentNullException.ThrowIfNull(dashboardId);
        var next = KioskSettingsModalProjection.Toggle(_selectedIds, dashboardId);
        if (next.Count == _selectedIds.Count && next.SequenceEqual(_selectedIds))
        {
            return;
        }

        _selectedIds = next;
        Raise(nameof(SelectedIds));
        EmitConfig();
    }

    /// <summary>
    /// Commit to kiosk mode (web <c>handleEnter</c>): syncs the rotation selection into the config and emits it
    /// (web <c>onUpdateConfig({ dashboardIds })</c>), requests the close (web <c>onClose</c>) and then the kiosk
    /// hand-off (web <c>onEnterKiosk</c>) — in that order.
    /// </summary>
    public void RequestEnterKiosk()
    {
        EmitConfig();
        CloseRequested?.Invoke(this, EventArgs.Empty);
        EnterKioskRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Dismiss the modal without entering kiosk mode (web <c>Cancel</c> / <c>onClose</c>).</summary>
    public void RequestClose() => CloseRequested?.Invoke(this, EventArgs.Empty);

    private void EmitConfig() => ConfigUpdated?.Invoke(this, CurrentConfig);

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
