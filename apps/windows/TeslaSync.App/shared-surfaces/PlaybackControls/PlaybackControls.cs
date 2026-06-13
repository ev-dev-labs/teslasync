using Microsoft.UI.Dispatching;
using Microsoft.UI.Input;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using CoreVirtualKeyStates = Windows.UI.Core.CoreVirtualKeyStates;
using VirtualKey = Windows.System.VirtualKey;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 trip-replay playback bar — a parity port of the web <c>PlaybackControls</c>
/// (web/src/components/data-display/PlaybackControls.tsx). Inside a subtle glass card it lays out, left-to-right,
/// the Reset / Play-Pause / Stop button trio (Segoe Fluent <c>Previous</c> / <c>Play</c>·<c>Pause</c> / <c>Stop</c>
/// glyphs standing in for the web Lucide <c>SkipBack</c> / <c>Play</c>·<c>Pause</c> / <c>Square</c>), the embedded
/// <see cref="PlaybackSpeedMenu"/> speed cycle, the flex-filling <see cref="TimelineScrubber"/>, the monospace
/// <c>elapsed / total</c> read-out and — only when keyboard shortcuts are enabled — a "?" keyboard-help affordance
/// whose hover tooltip lists the hotkeys. An inline, polite live-region toast floats above the bar to echo each
/// keyboard action (web <c>shortcutToast</c>). The view owns no logic: all state, the projected copy, the keyboard
/// interpretation and the cheatsheet registration live in the UI-thread-free <see cref="PlaybackControlsViewModel"/>;
/// the view only lays out controls, forwards button clicks + key presses, and runs the toast display timer.
///
/// <para>
/// State coverage: the web source is a presentational, fully-controlled bar driven by <c>isPlaying</c> /
/// <c>speed</c> / <c>progress</c> / <c>elapsed</c> / <c>total</c> props and a set of callbacks — it performs no
/// data fetch, so (like the peer presentational surfaces it composes, PlaybackSpeedMenu / TimelineScrubber) it has
/// no loading / error / stale / offline chrome to reproduce. The states it actually has are reproduced in full:
/// the play vs pause affordance (<see cref="IsPlaying"/>), the per-speed badge + cycle (delegated to the embedded
/// speed menu), the scrubber's fill / hover / drag states (delegated to the embedded scrubber), the
/// shortcuts-enabled vs -disabled layout (the help affordance shown/hidden and the cheatsheet registered/cleared),
/// and the inline shortcut toast shown/hidden.
/// </para>
///
/// <para>
/// Keyboard mapping (Windows-idiomatic, faithful to the web): the web attaches a page-global <c>window</c>
/// <c>keydown</c> listener gated by <c>enableKeyboardShortcuts</c>; this surface instead handles
/// <see cref="UIElement.OnKeyDown"/> on the focusable bar (so multiple mounted bars never fight over global keys —
/// the very noise the web prop guards against), skipping when a non-Shift modifier is held, and forwarding the
/// mapped key to the view-model. Both paths share the same interpretation, so the behaviour is identical when the
/// bar has focus.
/// </para>
///
/// <para>
/// Accessibility: every interactive element carries a localized accessible name + tooltip (the Reset / Play-Pause /
/// Stop buttons, the help trigger, and — from their own surfaces — the speed menu and scrubber); the bar is a
/// named automation group; and the shortcut toast is a polite live region that Narrator announces without moving
/// focus. The glyphs are <see cref="FontIcon"/>s that honour the system font scale.
/// </para>
/// </summary>
public sealed partial class PlaybackControls : ContentControl, IDisposable
{
    private const string ResetGlyph = "\uE892";    // Segoe Fluent "Previous" — the web Lucide SkipBack reset.
    private const string PlayGlyph = "\uE768";     // Segoe Fluent "Play".
    private const string PauseGlyph = "\uE769";    // Segoe Fluent "Pause".
    private const string StopGlyph = "\uE71A";     // Segoe Fluent "Stop" — the web Lucide Square.
    private const string KeyboardGlyph = "\uE765"; // Segoe Fluent "KeyboardClassic" — the web Lucide Keyboard.

    private const double IconButtonSize = 32;      // web h-8 w-8.
    private const double HelpButtonSize = 28;      // web h-7 w-7.
    private const double RowSpacing = 8;           // web gap-2.
    private const double ScrubberMargin = 8;       // web mx-2.
    private const double CardCornerRadius = 12;    // web rounded-xl.
    private const double CardPaddingH = 16;        // web px-4.
    private const double CardPaddingV = 12;        // web py-3.
    private const double TimeFontSize = 12;        // web text-xs.
    private const double TimeMinWidth = 90;        // web min-w-[90px].
    private const double ToastFontSize = 11;       // web text-[11px].
    private const double ToastCornerRadius = 6;    // web rounded-md.
    private const double ToastOffsetTop = -28;     // web -top-7.
    private const double ToastOffsetRight = 12;    // web right-3.

    private readonly PlaybackControlsViewModel _viewModel;
    private readonly PlaybackControlsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Border _card = new()
    {
        CornerRadius = new CornerRadius(CardCornerRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(CardPaddingH, CardPaddingV, CardPaddingH, CardPaddingV),
    };

    private readonly Grid _row = new() { ColumnSpacing = RowSpacing, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _reset;
    private readonly TsButton _playPause;
    private readonly TsButton _stop;
    private readonly PlaybackSpeedMenu _speedMenu;
    private readonly TimelineScrubber _scrubber;
    private readonly TextBlock _time;
    private readonly TsButton _help;

    private readonly Border _toast = new()
    {
        CornerRadius = new CornerRadius(ToastCornerRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(8, 4, 8, 4),
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, ToastOffsetTop, ToastOffsetRight, 0),
        Visibility = Visibility.Collapsed,
        IsHitTestVisible = false,
    };

    private readonly TextBlock _toastText = new()
    {
        FontSize = ToastFontSize,
        FontFamily = TypographyTokens.Mono ?? new FontFamily("Consolas"),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private DispatcherQueueTimer? _toastTimer;
    private long _shownToastSequence = -1;
    private bool _opened;
    private bool _loaded;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a gallery-safe bar bound to the inert transport sink, the passthrough localizer and a private
    /// shortcut registry — the native analogue of mounting the web component in isolation with no-op callbacks.
    /// Useful for galleries / design hosts; production callers use the seam constructor.
    /// </summary>
    public PlaybackControls()
        : this(NoOpPlaybackTransportSink.Instance, PassthroughLocalizer.Instance, new ShortcutRegistry())
    {
    }

    /// <summary>Creates the bar over its transport seam, localizer, shortcut registry, scrubber preview sampler and diagnostics.</summary>
    /// <param name="transport">The transport seam (web callbacks); pass <see cref="NoOpPlaybackTransportSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade the accessible names + cheatsheet copy resolve through.</param>
    /// <param name="shortcuts">The keyboard-shortcut registry (web <c>useShortcut</c> store).</param>
    /// <param name="preview">The scrubber preview sampler (web <c>getPreviewAt</c>); pass <see cref="NullTimelinePreviewSource.Instance"/> for none.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PlaybackControls(
        IPlaybackTransportSink transport,
        ILocalizer localizer,
        IShortcutRegistry shortcuts,
        ITimelinePreviewSource? preview = null,
        PlaybackControlsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(shortcuts);

        _diagnostics = diagnostics ?? new PlaybackControlsDiagnostics();
        _viewModel = new PlaybackControlsViewModel(transport, localizer, shortcuts);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // The embedded speed menu + scrubber are controlled children: their changes relay up through the
        // view-model into the shared transport seam (web child onChange / onSeek), and the parent echoes the new
        // speed / progress back down in Render.
        _speedMenu = new PlaybackSpeedMenu(
            new DelegatePlaybackSpeedSink(speed => _viewModel.NotifySpeedChanged(speed)),
            localizer,
            _viewModel.Speed);
        _scrubber = new TimelineScrubber(
            new DelegateTimelineSeekSink(progress => _viewModel.NotifySeek(progress)),
            preview ?? NullTimelinePreviewSource.Instance,
            localizer);

        _reset = BuildIconButton(ResetGlyph);
        _playPause = BuildIconButton(PlayGlyph);
        _stop = BuildIconButton(StopGlyph);
        _help = BuildIconButton(KeyboardGlyph, HelpButtonSize);

        _time = new TextBlock
        {
            FontSize = TimeFontSize,
            FontFamily = TypographyTokens.Mono ?? new FontFamily("Consolas"),
            TextAlignment = TextAlignment.Right,
            MinWidth = TimeMinWidth,
            VerticalAlignment = VerticalAlignment.Center,
        };

        BuildTree();
        WireEvents();

        IsTabStop = true;
        UseSystemFocusVisuals = true;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;
        AutomationProperties.SetAutomationId(this, PlaybackControlsRegistration.Slug);

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>PlaybackControls</c>).</summary>
    public static string Slug => PlaybackControlsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public PlaybackControlsViewModel ViewModel => _viewModel;

    /// <summary>Whether playback is running (web <c>isPlaying</c> prop).</summary>
    public bool IsPlaying
    {
        get => _viewModel.IsPlaying;
        set => _viewModel.IsPlaying = value;
    }

    /// <summary>The current replay speed (web <c>speed</c> prop).</summary>
    public int Speed
    {
        get => _viewModel.Speed;
        set => _viewModel.Speed = value;
    }

    /// <summary>The playhead position 0..1 (web <c>progress</c> prop).</summary>
    public double Progress
    {
        get => _viewModel.Progress;
        set => _viewModel.Progress = value;
    }

    /// <summary>The pre-formatted elapsed time, e.g. <c>1:23</c> (web <c>elapsed</c> prop).</summary>
    public string Elapsed
    {
        get => _viewModel.Elapsed;
        set => _viewModel.Elapsed = value;
    }

    /// <summary>The pre-formatted total time, e.g. <c>5:10</c> (web <c>total</c> prop).</summary>
    public string Total
    {
        get => _viewModel.Total;
        set => _viewModel.Total = value;
    }

    /// <summary>The total duration in milliseconds, or null (web <c>durationMs</c> prop).</summary>
    public double? DurationMs
    {
        get => _viewModel.DurationMs;
        set => _viewModel.DurationMs = value;
    }

    /// <summary>Whether the page-scoped keyboard shortcuts + help affordance are active (web <c>enableKeyboardShortcuts</c> prop).</summary>
    public bool EnableKeyboardShortcuts
    {
        get => _viewModel.EnableKeyboardShortcuts;
        set
        {
            _viewModel.EnableKeyboardShortcuts = value;
            SyncShortcutRegistration();
        }
    }

    /// <summary>The keyframe markers along the scrubber track (web <c>markers</c> prop), forwarded to the embedded scrubber.</summary>
    public IReadOnlyList<TimelineMarker> Markers
    {
        get => _scrubber.Markers;
        set => _scrubber.Markers = value;
    }

    /// <summary>The optional decorative element behind the scrubber track (web <c>scrubberBackground</c>), forwarded to the embedded scrubber.</summary>
    public UIElement? ScrubberBackground
    {
        get => _scrubber.DecorativeBackground;
        set => _scrubber.DecorativeBackground = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        StopToastTimer();
        _reset.Click -= OnResetClick;
        _playPause.Click -= OnPlayPauseClick;
        _stop.Click -= OnStopClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        _viewModel.Dispose();
        _speedMenu.Dispose();
        _scrubber.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PlaybackControlsAutomationPeer(this);

    /// <inheritdoc />
    protected override void OnKeyDown(KeyRoutedEventArgs e)
    {
        ArgumentNullException.ThrowIfNull(e);

        // web: the keydown layer only fires when enableKeyboardShortcuts is set, and is skipped while a non-Shift
        // modifier is held (Ctrl/Meta/Alt drive other commands such as the command palette).
        if (!_viewModel.EnableKeyboardShortcuts || HasNonShiftModifier())
        {
            base.OnKeyDown(e);
            return;
        }

        PlaybackShortcutKey mapped = MapKey(e.Key);
        if (mapped == PlaybackShortcutKey.None)
        {
            base.OnKeyDown(e);
            return;
        }

        if (_viewModel.HandleShortcut(mapped, IsKeyDown(VirtualKey.Shift)))
        {
            e.Handled = true;
        }
        else
        {
            base.OnKeyDown(e);
        }
    }

    private static TsButton BuildIconButton(string glyph, double size = IconButtonSize) => new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = glyph,
        Width = size,
        Height = size,
        MinWidth = size,
        MinHeight = size,
        Padding = new Thickness(0),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void BuildTree()
    {
        _row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // reset
        _row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // play/pause
        _row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // stop
        _row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // speed
        _row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // scrubber
        _row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // time
        _row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); // help

        // web: the scrubber sits in `mx-2 flex-1`.
        _scrubber.Margin = new Thickness(ScrubberMargin, 0, ScrubberMargin, 0);
        _scrubber.VerticalAlignment = VerticalAlignment.Center;

        Grid.SetColumn(_reset, 0);
        Grid.SetColumn(_playPause, 1);
        Grid.SetColumn(_stop, 2);
        Grid.SetColumn(_speedMenu, 3);
        Grid.SetColumn(_scrubber, 4);
        Grid.SetColumn(_time, 5);
        Grid.SetColumn(_help, 6);

        _row.Children.Add(_reset);
        _row.Children.Add(_playPause);
        _row.Children.Add(_stop);
        _row.Children.Add(_speedMenu);
        _row.Children.Add(_scrubber);
        _row.Children.Add(_time);
        _row.Children.Add(_help);

        _card.Child = _row;

        _toast.Child = _toastText;

        // web role-of aria-live="polite" inline feedback: a polite live region announced without moving focus.
        LiveRegion.Configure(_toast);

        _root.Children.Add(_card);
        _root.Children.Add(_toast);
    }

    private void WireEvents()
    {
        _reset.Click += OnResetClick;
        _playPause.Click += OnPlayPauseClick;
        _stop.Click += OnStopClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _loaded = true;

        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        // web useShortcut(replayShortcutDefs) registers for the component's lifetime when shortcuts are enabled.
        SyncShortcutRegistration();
        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        _loaded = false;

        // web useShortcut cleanup on unmount: drop this surface's cheatsheet entries.
        _viewModel.UnregisterShortcuts();
        StopToastTimer();
    }

    private void OnResetClick(object sender, RoutedEventArgs e) => _viewModel.Reset();

    private void OnPlayPauseClick(object sender, RoutedEventArgs e) => _viewModel.PlayPause();

    private void OnStopClick(object sender, RoutedEventArgs e) => _viewModel.Stop();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        // Tokens + the controlled children re-applied every render; each child guards equality so this is cheap.
        _card.Background = DisplayTokens.Surface;
        _card.BorderBrush = DisplayTokens.Border;
        _time.Foreground = DisplayTokens.TextSecondary;
        _toast.Background = DisplayTokens.Surface;
        _toast.BorderBrush = DisplayTokens.Border;
        _toastText.Foreground = DisplayTokens.TextPrimary;

        _playPause.IconGlyph = _viewModel.IsPlaying ? PauseGlyph : PlayGlyph;
        _time.Text = _viewModel.TimeText;

        _speedMenu.Speed = _viewModel.Speed;
        _scrubber.Progress = _viewModel.Progress;
        _scrubber.Duration = _viewModel.DurationSeconds;

        ApplyAccessibleName(_reset, _viewModel.ResetAccessibleName);
        ApplyAccessibleName(_playPause, _viewModel.PlayPauseAccessibleName);
        ApplyAccessibleName(_stop, _viewModel.StopAccessibleName);
        ApplyAccessibleName(_help, _viewModel.HelpAccessibleName);

        _help.Visibility = _viewModel.ShowKeyboardHelp ? Visibility.Visible : Visibility.Collapsed;
        ToolTipService.SetToolTip(_help, _viewModel.ShowKeyboardHelp ? BuildHelpToolTip() : null);

        RenderToast();
    }

    private void RenderToast()
    {
        string? label = _viewModel.CurrentToast;
        long sequence = _viewModel.ToastSequence;

        if (label is null)
        {
            _toast.Visibility = Visibility.Collapsed;
            StopToastTimer();
            return;
        }

        _toastText.Text = label;
        _toast.Visibility = Visibility.Visible;

        // Only (re)announce + (re)start the display timer when a NEW toast arrived (web re-keys on every keypress),
        // not on unrelated re-renders (e.g. a progress echo) where the same toast is still showing.
        if (sequence != _shownToastSequence)
        {
            _shownToastSequence = sequence;
            LiveRegion.Announce(_toast);
            RestartToastTimer();
        }
    }

    private void RestartToastTimer()
    {
        StopToastTimer();

        if (_dispatcher is null)
        {
            return;
        }

        // web window.setTimeout(() => setShortcutToast(null), 900) — a single one-shot clear.
        DispatcherQueueTimer timer = _dispatcher.CreateTimer();
        timer.Interval = TimeSpan.FromMilliseconds(PlaybackControlsRegistration.ToastDurationMs);
        timer.IsRepeating = false;
        timer.Tick += (t, _) =>
        {
            t.Stop();
            if (!_disposed)
            {
                _viewModel.ClearToast();
            }
        };
        timer.Start();
        _toastTimer = timer;
    }

    private void StopToastTimer()
    {
        _toastTimer?.Stop();
        _toastTimer = null;
    }

    private void SyncShortcutRegistration()
    {
        if (_loaded && _viewModel.EnableKeyboardShortcuts)
        {
            _viewModel.RegisterShortcuts();
        }
        else
        {
            _viewModel.UnregisterShortcuts();
        }
    }

    private ToolTip BuildHelpToolTip()
    {
        // web keyboard-help Tooltip body: a title above a two-column grid of kbd chips + descriptions.
        var body = new StackPanel { Spacing = 8 };

        body.Children.Add(new TextBlock
        {
            Text = _viewModel.HelpTitle,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
        });

        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 4 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        IReadOnlyList<PlaybackHelpEntry> entries = _viewModel.HelpEntries;
        for (int i = 0; i < entries.Count; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            Border chip = BuildKeyChip(entries[i].Keys);
            Grid.SetRow(chip, i);
            Grid.SetColumn(chip, 0);
            grid.Children.Add(chip);

            var description = new TextBlock
            {
                Text = entries[i].Description,
                Foreground = DisplayTokens.TextPrimary,
                VerticalAlignment = VerticalAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
            };
            Grid.SetRow(description, i);
            Grid.SetColumn(description, 1);
            grid.Children.Add(description);
        }

        body.Children.Add(grid);

        return new ToolTip
        {
            Content = body,
            Placement = Microsoft.UI.Xaml.Controls.Primitives.PlacementMode.Top,
        };
    }

    private static Border BuildKeyChip(string keys) => new()
    {
        Background = DisplayTokens.Surface,
        BorderBrush = DisplayTokens.Border,
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(4),
        Padding = new Thickness(6, 2, 6, 2),
        VerticalAlignment = VerticalAlignment.Center,
        Child = new TextBlock
        {
            Text = keys,
            FontSize = 11,
            FontFamily = TypographyTokens.Mono ?? new FontFamily("Consolas"),
            Foreground = DisplayTokens.TextSecondary,
        },
    };

    private static void ApplyAccessibleName(FrameworkElement element, string name)
    {
        AutomationProperties.SetName(element, name);
        ToolTipService.SetToolTip(element, name);
    }

    private static bool HasNonShiftModifier() =>
        IsKeyDown(VirtualKey.Control) ||
        IsKeyDown(VirtualKey.Menu) ||
        IsKeyDown(VirtualKey.LeftWindows) ||
        IsKeyDown(VirtualKey.RightWindows);

    private static bool IsKeyDown(VirtualKey key) =>
        (InputKeyboardSource.GetKeyStateForCurrentThread(key) & CoreVirtualKeyStates.Down) == CoreVirtualKeyStates.Down;

    private static PlaybackShortcutKey MapKey(VirtualKey key)
    {
        // Number-row digits 0-9.
        if (key >= VirtualKey.Number0 && key <= VirtualKey.Number9)
        {
            return PlaybackShortcutKey.Digit0 + (key - VirtualKey.Number0);
        }

        // Numeric-keypad digits 0-9.
        if (key >= VirtualKey.NumberPad0 && key <= VirtualKey.NumberPad9)
        {
            return PlaybackShortcutKey.Digit0 + (key - VirtualKey.NumberPad0);
        }

        const VirtualKey oemPlus = (VirtualKey)0xBB;   // '=' / '+'
        const VirtualKey oemComma = (VirtualKey)0xBC;  // ','
        const VirtualKey oemMinus = (VirtualKey)0xBD;  // '-' / '_'
        const VirtualKey oemPeriod = (VirtualKey)0xBE; // '.'

        return key switch
        {
            VirtualKey.Space => PlaybackShortcutKey.Space,
            VirtualKey.K => PlaybackShortcutKey.K,
            VirtualKey.Left => PlaybackShortcutKey.ArrowLeft,
            VirtualKey.Right => PlaybackShortcutKey.ArrowRight,
            VirtualKey.J => PlaybackShortcutKey.J,
            VirtualKey.L => PlaybackShortcutKey.L,
            VirtualKey.Home => PlaybackShortcutKey.Home,
            VirtualKey.End => PlaybackShortcutKey.End,
            oemComma => PlaybackShortcutKey.Comma,
            oemPeriod => PlaybackShortcutKey.Period,
            oemPlus or VirtualKey.Add => PlaybackShortcutKey.Plus,
            oemMinus or VirtualKey.Subtract => PlaybackShortcutKey.Minus,
            _ => PlaybackShortcutKey.None,
        };
    }

    private sealed class PlaybackControlsAutomationPeer : FrameworkElementAutomationPeer
    {
        public PlaybackControlsAutomationPeer(PlaybackControls owner)
            : base(owner)
        {
        }

        private PlaybackControls Surface => (PlaybackControls)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.ViewModel.GroupLabel : name;
        }
    }
}
