using System.ComponentModel;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.System;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 fullscreen-toggle surface — a parity port of the web <c>FullscreenButton</c>
/// (web/src/components/ui/FullscreenButton.tsx). It renders a single ghost icon-button (a <see cref="TsButton"/>,
/// the web <c>Button variant="ghost" size="sm"</c> primitive) that toggles the bound target's fullscreen state and
/// swaps its glyph + accessible label between the maximise ("Enter fullscreen") and minimise ("Exit fullscreen")
/// affordances. All state flows through the shared <see cref="FullscreenButtonViewModel"/> and the
/// <see cref="IFullscreenController"/> seam; the view performs only the platform plumbing — composing the button,
/// projecting the view-model into glyph / name / tooltip, and exposing the toggle to UI Automation.
///
/// <para>
/// State coverage: the web source is a presentational control with no data fetch — it issues no query, so (like the
/// shipped <c>CopyLinkButton</c> / <c>Checkbox</c> surfaces) it has no loading / empty / error / stale / offline
/// chrome to reproduce. The states it actually has are reproduced in full: hidden (web
/// <c>if (!supported) return null;</c> → <see cref="Visibility.Collapsed"/> and dropped from the tab order),
/// enter (maximise glyph + "Enter fullscreen", not pressed) and exit (minimise glyph + "Exit fullscreen",
/// pressed). The fullscreen flag is sourced from the controller's change event (web <c>fullscreenchange</c>), so
/// pressing Esc, an OS revoke, or a sibling toggling the same target all keep the button honest.
/// </para>
///
/// <para>
/// Accessibility: the wrapper carries the accessible semantics — its automation peer reports
/// <see cref="AutomationControlType.Button"/> with the active label as its name and an <see cref="IToggleProvider"/>
/// exposing the pressed state (the faithful UIA mapping of the web <c>aria-pressed</c>), so Narrator announces
/// "&lt;label&gt;, button, pressed / not pressed" and assistive tech can toggle it. The inner button is a Raw
/// visual so the tree exposes a single node. Space and Enter activate; a pointer tap activates; the system focus
/// visual is the native analogue of the web focus ring. The control has no animation, so the reduced-motion
/// preference is honoured trivially. Every label resolves through the i18n facade and the surface emits the
/// <c>view.opened</c> diagnostic once when shown.
/// </para>
/// </summary>
public sealed partial class FullscreenButton : ContentControl, IDisposable
{
    private const double IconSize = 14;  // web Maximize / Minimize h-3.5 w-3.5 (14 px).

    private readonly FullscreenButtonViewModel _viewModel;
    private readonly FullscreenButtonDiagnostics _diagnostics;
    // Fully qualified: Windows.System (imported for VirtualKey) also declares a DispatcherQueue.
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;
    private readonly TsButton _button;

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;
    private bool _lastPressed;

    /// <summary>
    /// Creates a gallery-safe surface bound to an interactive in-memory fullscreen controller and the passthrough
    /// localizer — the native analogue of mounting the web component in an isolated host. Production callers use
    /// the seam constructor with an <see cref="AppWindowFullscreenController"/>.
    /// </summary>
    public FullscreenButton()
        : this(new InMemoryFullscreenController(), PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its fullscreen seam, the localizer, the optional label overrides and diagnostics.</summary>
    /// <param name="controller">The fullscreen seam (web Fullscreen API bound to the <c>targetRef</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="enterLabelOverride">Optional override for the enter label (web <c>ariaLabelEnter</c> prop).</param>
    /// <param name="exitLabelOverride">Optional override for the exit label (web <c>ariaLabelExit</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FullscreenButton(
        IFullscreenController controller,
        ILocalizer localizer,
        string? enterLabelOverride = null,
        string? exitLabelOverride = null,
        FullscreenButtonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(controller);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new FullscreenButtonDiagnostics();
        _viewModel = new FullscreenButtonViewModel(controller, localizer, enterLabelOverride, exitLabelOverride);
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        _button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            FontSize = IconSize,
            IsTabStop = false,
        };
        _button.Click += OnButtonClick;

        // The wrapper carries the accessible toggle semantics (web aria-pressed); the inner button is a Raw
        // visual so Narrator reads a single node.
        AutomationProperties.SetAccessibilityView(_button, AccessibilityView.Raw);

        IsTabStop = true;
        UseSystemFocusVisuals = true;
        AutomationProperties.SetAutomationId(this, FullscreenButtonRegistration.AutomationId);

        Content = _button;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        KeyDown += OnKeyDown;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        _lastPressed = _viewModel.IsPressed;
        Render();
    }

    /// <summary>The canonical surface slug (<c>FullscreenButton</c>).</summary>
    public static string Slug => FullscreenButtonRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public FullscreenButtonViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _button.Click -= OnButtonClick;
        KeyDown -= OnKeyDown;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new FullscreenButtonAutomationPeer(this);

    // Routes an assistive-technology Toggle request through the same path as a click (the web button's onClick).
    internal void ToggleFromAutomation() => _viewModel.Toggle();

    // Maps the projected pressed state to the WinUI automation toggle enum (web aria-pressed).
    internal ToggleState ResolveToggleState() => _viewModel.IsPressed ? ToggleState.On : ToggleState.Off;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnButtonClick(object sender, RoutedEventArgs e) => _viewModel.Toggle();

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        // Native toggle-button semantics: Space and Enter both activate (the web <button> responds to both).
        if (e.Key is VirtualKey.Space or VirtualKey.Enter)
        {
            e.Handled = true;
            _viewModel.Toggle();
        }
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        // web: if (!supported) return null; — hide the surface entirely and drop it from the tab order.
        bool visible = _viewModel.IsVisible;
        Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        IsTabStop = visible;
        if (!visible)
        {
            return;
        }

        _button.IconGlyph = _viewModel.ShowExitIcon
            ? FullscreenButtonRegistration.ExitGlyph
            : FullscreenButtonRegistration.EnterGlyph;

        // web aria-label === title === label, all flipping together with the fullscreen state.
        string label = _viewModel.AccessibleLabel;
        AutomationProperties.SetName(this, label);
        AutomationProperties.SetName(_button, label);
        ToolTipService.SetToolTip(_button, label);

        RaiseToggleStateChangedIfNeeded();
    }

    private void RaiseToggleStateChangedIfNeeded()
    {
        bool pressed = _viewModel.IsPressed;
        if (pressed == _lastPressed)
        {
            return;
        }

        ToggleState previous = _lastPressed ? ToggleState.On : ToggleState.Off;
        ToggleState current = pressed ? ToggleState.On : ToggleState.Off;
        _lastPressed = pressed;

        if (FrameworkElementAutomationPeer.FromElement(this) is FullscreenButtonAutomationPeer peer)
        {
            peer.RaisePropertyChangedEvent(TogglePatternIdentifiers.ToggleStateProperty, previous, current);
        }
    }

    /// <summary>
    /// Reports the surface as a native <see cref="AutomationControlType.Button"/> with an
    /// <see cref="IToggleProvider"/> exposing the pressed state — the faithful UIA mapping of the web
    /// <c>aria-pressed</c> toggle button, so Narrator announces the pressed state and assistive tech can toggle it.
    /// </summary>
    private sealed partial class FullscreenButtonAutomationPeer : FrameworkElementAutomationPeer, IToggleProvider
    {
        public FullscreenButtonAutomationPeer(FullscreenButton owner)
            : base(owner)
        {
        }

        public ToggleState ToggleState => ((FullscreenButton)Owner).ResolveToggleState();

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Button;

        protected override string GetClassNameCore() => nameof(FullscreenButton);

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((FullscreenButton)Owner).ViewModel.AccessibleLabel : name;
        }

        protected override object? GetPatternCore(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.Toggle ? this : base.GetPatternCore(patternInterface);

        public void Toggle() => ((FullscreenButton)Owner).ToggleFromAutomation();
    }
}

/// <summary>
/// The production <see cref="IFullscreenController"/> — the WinUI host binding over a <see cref="AppWindow"/> (the
/// native analogue of the web component's <c>targetRef</c> + browser Fullscreen API). It toggles the window between
/// its default and fullscreen presenters (<see cref="AppWindowPresenterKind.FullScreen"/> /
/// <see cref="AppWindowPresenterKind.Default"/>) and raises <see cref="FullscreenChanged"/> from the window's own
/// <see cref="AppWindow.Changed"/> event whenever the presenter changes — the native analogue of the web
/// <c>fullscreenchange</c> event, so the surface stays in sync with changes it did not initiate (Esc, the system
/// title-bar control, a sibling toggling the same window). Disposing it detaches from the window event.
/// </summary>
public sealed class AppWindowFullscreenController : IFullscreenController, IDisposable
{
    private readonly AppWindow _appWindow;
    private bool _disposed;

    /// <summary>Creates the controller over the window whose presenter is toggled.</summary>
    /// <param name="appWindow">The target window (web <c>targetRef</c>).</param>
    public AppWindowFullscreenController(AppWindow appWindow)
    {
        ArgumentNullException.ThrowIfNull(appWindow);
        _appWindow = appWindow;
        _appWindow.Changed += OnAppWindowChanged;
    }

    /// <inheritdoc />
    public event EventHandler? FullscreenChanged;

    /// <inheritdoc />
    public bool IsSupported => true;  // The AppWindow FullScreen presenter is available on every supported Windows build.

    /// <inheritdoc />
    public bool IsFullscreen => _appWindow.Presenter is { Kind: AppWindowPresenterKind.FullScreen };

    /// <inheritdoc />
    public void RequestFullscreen()
    {
        if (!IsFullscreen)
        {
            _appWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
        }
    }

    /// <inheritdoc />
    public void ExitFullscreen()
    {
        if (IsFullscreen)
        {
            _appWindow.SetPresenter(AppWindowPresenterKind.Default);
        }
    }

    /// <summary>Detach from the window's change event (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _appWindow.Changed -= OnAppWindowChanged;
        GC.SuppressFinalize(this);
    }

    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        // web fullscreenchange: re-sync whenever the presenter kind changes, however it was triggered.
        if (args.DidPresenterChange)
        {
            FullscreenChanged?.Invoke(this, EventArgs.Empty);
        }
    }
}
