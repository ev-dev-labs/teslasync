using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using UiLabel = TeslaSync.App.Components.UI.Label;
using UiText = TeslaSync.App.Components.UI.Text;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>TimeMachineBanner</c> shared surface — a parity port of the web <c>TimeMachineBanner</c>
/// export (web/src/components/feedback/TimeMachineBanner.tsx). It is the global "viewing data as of …" notice that
/// keeps operators aware they are looking at a historical snapshot rather than live data: an info-tinted strip
/// (the native analogue of the web <c>AlertBanner variant="info"</c>) leading with a Segoe Fluent "History" glyph
/// (standing in for the web Lucide <c>History</c>), the localized title with the anchor interpolated, the body
/// (the read-only notice, or the live-mode pick prompt), a "Pick a date" toggle leading with a Segoe Fluent
/// "Clock" glyph (the web Lucide <c>Clock</c>), a "Return to live" action shown only while an anchor is set, and an
/// inline picker. The web <c>&lt;input type="datetime-local"&gt;</c> maps to the Windows-idiomatic
/// <see cref="CalendarDatePicker"/> + <see cref="TimePicker"/> pair (WinUI has no single datetime control); "View
/// as of date" is disabled until both are picked (the web <c>disabled={!draft}</c>). It binds the
/// <see cref="TimeMachineBannerViewModel"/> (over the P1/S8 <see cref="IAsOfDateSource"/> and
/// <see cref="ITimeMachinePickerTrigger"/>), reads no URL/state itself, and emits the <c>view.opened</c> diagnostic
/// once when mounted.
/// <para>
/// State coverage: the web source reads URL-mounted state and performs no network fetch, so it has no loading /
/// error / stale / offline chrome — a still-unresolved or malformed anchor simply collapses to live mode. The web
/// branches that DO exist are reproduced in full: hidden (live mode, picker closed), the live-mode pick prompt
/// (picker open with no anchor), and the historical notice (an anchor set), each with the inline picker open or
/// closed. The surface uses no entrance/transition animation (matching the web, which conditionally renders), so
/// the OS reduce-motion preference is honoured by construction.
/// </para>
/// </summary>
public sealed partial class TimeMachineBanner : ContentControl, IDisposable
{
    private const double GlyphFontSize = 16;     // web History h-4 w-4
    private const double ColumnSpacing = 12;     // web banner glyph/content gap
    private const double ContentSpacing = 8;     // web flex-col gap-2
    private const double ActionsSpacing = 8;     // web actions gap-2
    private const double PickerSpacing = 8;      // web picker gap-2
    private const double AccentBarWidth = 3;     // web banner accent rail
    private const double SurfacePadH = 12;       // web banner px
    private const double SurfacePadV = 10;       // web banner py
    private const double CornerRadiusPx = 8;     // web rounded-lg
    private const double LabelRowSpacing = 4;    // web label/input gap-1

    private readonly TimeMachineBannerViewModel _viewModel;
    private readonly TimeMachineBannerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _surface = new()
    {
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(CornerRadiusPx),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Rectangle _accentBar = new() { Width = AccentBarWidth };

    private readonly FontIcon _glyph = new()
    {
        Glyph = TimeMachineBannerRegistration.HistoryGlyph,
        FontSize = GlyphFontSize,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly PanelTitle _title = new();
    private readonly UiText _body = new();

    private readonly TsButton _pick = new()
    {
        Variant = ButtonVariant.Outline,
        Size = ControlSize.Small,
        IconGlyph = TimeMachineBannerRegistration.ClockGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _return = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly UiLabel _inputLabel = new();

    private readonly CalendarDatePicker _datePicker = new()
    {
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private readonly TimePicker _timePicker = new()
    {
        VerticalAlignment = VerticalAlignment.Bottom,
        ClockIdentifier = "12HourClock",
    };

    private readonly TsButton _submit = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private readonly TsButton _cancel = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private readonly StackPanel _picker;

    private bool _opened;
    private bool _disposed;
    private bool _suppressDraftEvents;

    /// <summary>
    /// Creates the banner with no composition root (the designer / parameterless host entry point): it binds an
    /// in-memory anchor store and picker trigger over the passthrough localizer, opening in the live-mode prompt
    /// state so the surface renders. The real composition root binds the shared <see cref="IAsOfDateSource"/> +
    /// <see cref="ITimeMachinePickerTrigger"/> via the other constructors.
    /// </summary>
    public TimeMachineBanner()
        : this(
            PassthroughLocalizer.Instance,
            new InMemoryAsOfDateSource(),
            new TimeMachinePickerTrigger(),
            diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and the two bound P1/S8 seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every string resolves through (web <c>useTranslation</c>).</param>
    /// <param name="asOf">The as-of anchor seam (web <c>useAsOfDate()</c>).</param>
    /// <param name="trigger">The command-palette picker-open seam (web <c>TIME_MACHINE_OPEN_PICKER_EVENT</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TimeMachineBanner(
        ILocalizer localizer,
        IAsOfDateSource asOf,
        ITimeMachinePickerTrigger trigger,
        TimeMachineBannerDiagnostics? diagnostics = null)
        : this(new TimeMachineBannerViewModel(localizer, asOf, trigger), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TimeMachineBanner(TimeMachineBannerViewModel viewModel, TimeMachineBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new TimeMachineBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ActionsSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_pick);
        actions.Children.Add(_return);

        _picker = BuildPicker();

        var textColumn = new StackPanel { Spacing = ContentSpacing, VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(_title);
        textColumn.Children.Add(_body);
        textColumn.Children.Add(actions);
        textColumn.Children.Add(_picker);

        var content = new Grid
        {
            ColumnSpacing = ColumnSpacing,
            Padding = new Thickness(SurfacePadH, SurfacePadV, SurfacePadH, SurfacePadV),
        };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_glyph, 0);
        Grid.SetColumn(textColumn, 1);
        content.Children.Add(_glyph);
        content.Children.Add(textColumn);

        var inner = new Grid();
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        inner.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_accentBar, 0);
        Grid.SetColumn(content, 1);
        inner.Children.Add(_accentBar);
        inner.Children.Add(content);

        _surface.Child = inner;
        _surface.Background = TypographyTokens.Brush("TsColorSurfaceBrush");

        // The leading glyph is decorative; the control's Narrator name (title + body) is authoritative.
        AutomationProperties.SetAccessibilityView(_glyph, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, TimeMachineBannerRegistration.BannerAutomationId);
        AutomationProperties.SetAutomationId(_body, TimeMachineBannerRegistration.BodyAutomationId);
        AutomationProperties.SetAutomationId(_pick, TimeMachineBannerRegistration.PickAutomationId);
        AutomationProperties.SetAutomationId(_return, TimeMachineBannerRegistration.ReturnAutomationId);
        AutomationProperties.SetAutomationId(_picker, TimeMachineBannerRegistration.PickerAutomationId);
        AutomationProperties.SetAutomationId(_datePicker, TimeMachineBannerRegistration.InputAutomationId);
        AutomationProperties.SetAutomationId(_submit, TimeMachineBannerRegistration.SubmitAutomationId);
        AutomationProperties.SetAutomationId(_cancel, TimeMachineBannerRegistration.CancelAutomationId);

        // web wraps the banner in role="status" aria-live="polite"; surface it as a polite status live region.
        LiveRegion.Configure(this, assertive: false);

        _pick.Click += OnPickClick;
        _return.Click += OnReturnClick;
        _submit.Click += OnSubmitClick;
        _cancel.Click += OnCancelClick;
        _datePicker.DateChanged += OnDateChanged;
        _timePicker.SelectedTimeChanged += OnTimeChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _surface;
        ApplyAccent();
        Render();
    }

    /// <summary>The canonical surface slug (<c>TimeMachineBanner</c>).</summary>
    public static string Slug => TimeMachineBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TimeMachineBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the title and/or body).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _pick.Click -= OnPickClick;
        _return.Click -= OnReturnClick;
        _submit.Click -= OnSubmitClick;
        _cancel.Click -= OnCancelClick;
        _datePicker.DateChanged -= OnDateChanged;
        _timePicker.SelectedTimeChanged -= OnTimeChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TimeMachineBannerAutomationPeer(this);

    private StackPanel BuildPicker()
    {
        var labelColumn = new StackPanel { Spacing = LabelRowSpacing };
        var fields = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = PickerSpacing,
        };
        fields.Children.Add(_datePicker);
        fields.Children.Add(_timePicker);
        labelColumn.Children.Add(_inputLabel);
        labelColumn.Children.Add(fields);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = PickerSpacing,
        };
        row.Children.Add(labelColumn);
        row.Children.Add(_submit);
        row.Children.Add(_cancel);
        return row;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        if (_viewModel.Projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnPickClick(object sender, RoutedEventArgs e) => _viewModel.TogglePicker();

    private void OnReturnClick(object sender, RoutedEventArgs e)
    {
        _viewModel.ReturnToLive();
        _diagnostics.RecordReturnedToLive();
    }

    private void OnSubmitClick(object sender, RoutedEventArgs e)
    {
        if (_viewModel.Submit())
        {
            _diagnostics.RecordAnchorApplied();
        }
    }

    private void OnCancelClick(object sender, RoutedEventArgs e) => _viewModel.ClosePicker();

    private void OnDateChanged(CalendarDatePicker sender, CalendarDatePickerDateChangedEventArgs args)
    {
        if (_suppressDraftEvents)
        {
            return;
        }

        _viewModel.SetDraftDate(args.NewDate);
    }

    private void OnTimeChanged(TimePicker sender, TimePickerSelectedValueChangedEventArgs args)
    {
        if (_suppressDraftEvents)
        {
            return;
        }

        _viewModel.SetDraftTime(args.NewTime);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        TimeMachineBannerProjection projection = _viewModel.Projection;

        _title.Value = projection.Title;
        _body.Value = projection.Body;
        _pick.Text = projection.PickLabel;
        _return.Text = projection.ReturnLabel;
        _submit.Text = projection.SubmitLabel;
        _cancel.Text = projection.CancelLabel;
        _inputLabel.Value = projection.InputLabel;

        _return.Visibility = projection.ShowReturnToLive ? Visibility.Visible : Visibility.Collapsed;
        _picker.Visibility = projection.PickerOpen ? Visibility.Visible : Visibility.Collapsed;
        _submit.IsEnabled = projection.SubmitEnabled;

        SyncPickerInputs();

        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetName(_pick, projection.PickLabel);
        AutomationProperties.SetName(_return, projection.ReturnLabel);
        AutomationProperties.SetName(_submit, projection.SubmitLabel);
        AutomationProperties.SetName(_cancel, projection.CancelLabel);
        AutomationProperties.SetName(_datePicker, projection.InputLabel);
        AutomationProperties.SetName(_timePicker, projection.InputLabel);
        ToolTipService.SetToolTip(_pick, projection.PickLabel);
        ToolTipService.SetToolTip(_return, projection.ReturnLabel);

        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        if (projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void SyncPickerInputs()
    {
        // Reflect the view-model draft (e.g. the command-palette seed) into the pickers without re-entrancy.
        _suppressDraftEvents = true;
        try
        {
            if (_datePicker.Date != _viewModel.DraftDate)
            {
                _datePicker.Date = _viewModel.DraftDate;
            }

            if (_timePicker.SelectedTime != _viewModel.DraftTime)
            {
                _timePicker.SelectedTime = _viewModel.DraftTime;
            }
        }
        finally
        {
            _suppressDraftEvents = false;
        }
    }

    private void ApplyAccent()
    {
        var accent = TypographyTokens.Brush(TimeMachineBannerRegistration.AccentBrushKey);
        if (accent is not null)
        {
            _glyph.Foreground = accent;
            _accentBar.Fill = accent;
            _surface.BorderBrush = accent;
        }
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private sealed class TimeMachineBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public TimeMachineBannerAutomationPeer(TimeMachineBanner owner)
            : base(owner)
        {
        }

        private TimeMachineBanner Surface => (TimeMachineBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
