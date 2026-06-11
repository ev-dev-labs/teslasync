using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 playback-speed control — a parity port of the web <c>PlaybackSpeedMenu</c>
/// (web/src/components/data-display/PlaybackSpeedMenu.tsx). It renders a single compact Fluent button showing
/// the current <c>{speed}x</c> in a monospace badge with a trailing, dimmed <c>ChevronDown</c> (web
/// <c>font-mono</c> text + <c>ChevronDown</c> at <c>opacity-50</c>). A left click cycles to the next-fastest
/// speed and wraps (web <c>onClick={() =&gt; onChange(nextSpeed(speed))}</c>); a right click steps one slot
/// slower and is swallowed so no system context menu appears (web
/// <c>onContextMenu={(e) =&gt; { e.preventDefault(); onChange(shiftSpeed(speed, -1)); }}</c>). All state and the
/// scale maths live in the UI-thread-free <see cref="PlaybackSpeedMenuViewModel"/> + <see cref="PlaybackSpeeds"/>;
/// the view performs no logic and no I/O. The chosen speed is announced through the injected
/// <see cref="IPlaybackSpeedSink"/> (the web <c>onChange</c>); a controlled host echoes it back through
/// <see cref="Speed"/>, while a standalone instance still updates its own badge because the view-model advances
/// its state. The button carries the localized accessible name + tooltip (the web <c>aria-label</c>), the
/// chevron is hidden from Narrator as decoration, and the <c>view.opened</c> diagnostic is emitted exactly once
/// on <see cref="FrameworkElement.Loaded"/>.
///
/// <para>
/// State coverage: the web source is a presentational, fully-controlled button driven by a <c>speed</c> prop and
/// an <c>onChange</c> callback — it performs no data fetch, so (like the peer presentational surfaces
/// AnimatedNumber / Distance / ChartExportMenu) it has no loading / error / stale / offline chrome to reproduce.
/// The states it actually has are reproduced in full: the per-speed badge across every slot
/// (<c>1x / 10x / 25x / 50x / 100x</c>), the forward cycle (click, wrapping <c>100x → 1x</c>) and the backward
/// step (right-click, clamped at <c>1x</c>).
/// </para>
/// </summary>
public sealed partial class PlaybackSpeedMenu : ContentControl, IDisposable
{
    private const string ChevronGlyph = "\uE70D"; // Segoe Fluent "ChevronDown" — the web Lucide ChevronDown.
    private const double BadgeFontSize = 12;       // web text-xs.
    private const double ChevronFontSize = 12;     // web h-3 w-3.
    private const double ChevronOpacity = 0.5;     // web opacity-50.

    private readonly PlaybackSpeedMenuViewModel _viewModel;
    private readonly PlaybackSpeedMenuDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _button;
    private readonly TextBlock _badge;

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe control bound to the inert change sink and the passthrough localizer at the
    /// slowest speed — the native analogue of mounting the web component with a no-op <c>onChange</c> in an
    /// isolated host. Useful for galleries / design hosts; production callers use the seam constructor.
    /// </summary>
    public PlaybackSpeedMenu()
        : this(NoOpPlaybackSpeedSink.Instance, PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the control over its change seam, localizer, initial speed and diagnostics.</summary>
    /// <param name="sink">The change seam (web <c>onChange</c>); pass <see cref="NoOpPlaybackSpeedSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade the accessible name resolves through.</param>
    /// <param name="initialSpeed">The initial speed (web <c>speed</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PlaybackSpeedMenu(
        IPlaybackSpeedSink sink,
        ILocalizer localizer,
        int initialSpeed = 1,
        PlaybackSpeedMenuDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(sink);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new PlaybackSpeedMenuDiagnostics();
        _viewModel = new PlaybackSpeedMenuViewModel(sink, localizer, initialSpeed);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // web font-mono badge: a monospace family keeps the digit columns from shifting as the speed changes.
        _badge = new TextBlock
        {
            FontSize = BadgeFontSize,
            FontFamily = TypographyTokens.Mono ?? new FontFamily("Consolas"),
            VerticalAlignment = VerticalAlignment.Center,
        };

        var chevron = new FontIcon
        {
            Glyph = ChevronGlyph,
            FontSize = ChevronFontSize,
            Opacity = ChevronOpacity,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The web chevron is decorative (no label); keep it out of the Narrator tree.
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 2, // web gap-0.5.
            VerticalAlignment = VerticalAlignment.Center,
        };
        content.Children.Add(_badge);
        content.Children.Add(chevron);

        // web Button variant="ghost" size="sm" → a small subtle button; the compact padding mirrors px-2.
        _button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Padding = new Thickness(8, 2, 8, 2),
            Content = content,
        };
        _button.Click += OnButtonClick;
        _button.RightTapped += OnButtonRightTapped;

        IsTabStop = false;

        // Transparent structural wrapper: the web root is the button itself, so the wrapper hides from Narrator
        // and lets the inner button carry the accessible name + Invoke semantics.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Content = _button;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>PlaybackSpeedMenu</c>).</summary>
    public static string Slug => PlaybackSpeedMenuRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public PlaybackSpeedMenuViewModel ViewModel => _viewModel;

    /// <summary>
    /// The current speed (web <c>speed</c> prop). A controlled host assigns this after the change seam fires to
    /// echo the new speed back; reading it returns the badge's current value.
    /// </summary>
    public int Speed
    {
        get => _viewModel.Speed;
        set => _viewModel.Speed = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _button.Click -= OnButtonClick;
        _button.RightTapped -= OnButtonRightTapped;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PlaybackSpeedMenuAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnButtonClick(object sender, RoutedEventArgs e) => _viewModel.Cycle();

    private void OnButtonRightTapped(object sender, RightTappedRoutedEventArgs e)
    {
        // web onContextMenu: preventDefault() then step one slot slower. Handling the event suppresses the
        // system context menu, the native analogue of preventDefault().
        e.Handled = true;
        _viewModel.StepBackward();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(PlaybackSpeedMenuViewModel.SpeedLabel) ||
            string.IsNullOrEmpty(e.PropertyName))
        {
            ScheduleRender();
        }
    }

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
        _badge.Text = _viewModel.SpeedLabel;

        // Icon-only-ish button: the badge is the value, but the accessible name + tooltip is the web aria-label
        // ("Playback speed"), so Narrator announces the control's purpose exactly as the web source does.
        AutomationProperties.SetName(_button, _viewModel.AccessibleName);
        ToolTipService.SetToolTip(_button, _viewModel.AccessibleName);
    }

    private sealed class PlaybackSpeedMenuAutomationPeer : FrameworkElementAutomationPeer
    {
        public PlaybackSpeedMenuAutomationPeer(PlaybackSpeedMenu owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((PlaybackSpeedMenu)Owner).ViewModel.AccessibleName
                : name;
        }
    }
}
