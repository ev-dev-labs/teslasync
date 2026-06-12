using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 dual-thumb range slider — a parity port of the web <c>&lt;RangeSlider&gt;</c> primitive
/// (web/src/components/ui/RangeSlider.tsx). The web component renders a label/value row plus a single track
/// carrying a low rail, an accent range fill spanning <c>[low, high]</c> and two grabbable thumbs (built from two
/// stacked native <c>&lt;input type="range"&gt;</c> elements so every WAI-ARIA APG slider keystroke works on each
/// thumb). This surface reproduces that with two stacked WinUI <see cref="Slider"/>s — each a full Slider so the
/// arrow / Page / Home / End keys and the per-thumb RangeValue automation pattern come for free — drawn over a
/// shared rail and range fill, their default tracks made transparent through lightweight styling so only the two
/// accent thumbs show. The low thumb is raised above the high thumb in z-order when it passes the midpoint (web
/// <c>lowPct &gt; 50</c>) so it stays grabbable when the thumbs collide near the far end. All formatting, the
/// thumb-swap and the fill geometry live in the UI-thread-free <see cref="RangeSliderViewModel"/> +
/// <see cref="RangeSliderProjection"/>; the view only lays out shapes, forwards thumb edits through
/// <see cref="RangeSliderViewModel.RequestLow"/> / <see cref="RangeSliderViewModel.RequestHigh"/> and re-renders.
///
/// <para>
/// State coverage: the web source is a controlled, presentational primitive whose only inputs are caller-supplied
/// props (value / bounds / labels) and the <c>onChange</c> callback — it performs no data fetch — so, like the
/// peer presentational surfaces (Range / TimelineScrubber), it has no loading / error / stale / offline chrome to
/// reproduce. Every render branch it does have is reproduced in full: the visible label/value row (web
/// <c>showLabel</c>), the disabled state, the thumb-swap and the low-on-top z-order.
/// </para>
///
/// <para>
/// Accessibility: each thumb exposes the Slider control type with a RangeValue pattern plus its own localized
/// accessible name (web <c>aria-label</c>, "{label} minimum" / "{label} maximum") and the formatted value as its
/// help text (web <c>aria-valuetext</c>); both thumbs are keyboard-operable; the label/value row is decorative
/// (the thumbs carry the semantics). The <c>view.opened</c> diagnostic is emitted exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </para>
/// </summary>
public sealed partial class RangeSlider : ContentControl
{
    private const double HeaderGap = 8;     // web flex-col gap-2 between the label row and the track.
    private const double RailHeight = 4;    // web h-1 rail / fill.
    private const double RailRadius = 2;    // web rounded-full.
    private const double LabelFontSize = 12;
    private const double LabelWeight = 500; // web role.label font-medium.
    private const double CaptionFontSize = 12;
    private const double FillOpacity = 0.6; // web bg-cyan-500/60.

    // WinUI Slider lightweight-styling keys: make both default track halves transparent so only our shared rail +
    // range fill show, and tint the thumbs with the accent (web accent-cyan-500). Set as local resources so the
    // default template's ThemeResource lookups resolve to these before the template is applied.
    private static readonly string[] TrackBrushKeys =
    {
        "SliderTrackFill", "SliderTrackFillPointerOver", "SliderTrackFillPressed", "SliderTrackFillDisabled",
        "SliderTrackValueFill", "SliderTrackValueFillPointerOver", "SliderTrackValueFillPressed", "SliderTrackValueFillDisabled",
    };

    private static readonly string[] ThumbBrushKeys =
    {
        "SliderThumbBackground", "SliderThumbBackgroundPointerOver", "SliderThumbBackgroundPressed",
    };

    private readonly RangeSliderViewModel _viewModel;
    private readonly RangeSliderDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Orientation = Orientation.Vertical, Spacing = HeaderGap };
    private readonly Grid _header = new();
    private readonly TextBlock _label = new() { VerticalAlignment = VerticalAlignment.Center, CharacterSpacing = 60 };
    private readonly TextBlock _caption = new() { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
    private readonly Grid _track = new() { MinHeight = 24, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Rectangle _rail = new() { Height = RailHeight, RadiusX = RailRadius, RadiusY = RailRadius, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Center, IsHitTestVisible = false };
    private readonly Rectangle _fill = new() { Height = RailHeight, RadiusX = RailRadius, RadiusY = RailRadius, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center, Opacity = FillOpacity, IsHitTestVisible = false };
    private readonly Slider _lowSlider = new();
    private readonly Slider _highSlider = new();

    private bool _syncing;
    private bool _opened;
    private double _trackWidth;

    /// <summary>Creates the slider with the web prop defaults over the passthrough localizer (designer / host entry point).</summary>
    public RangeSlider()
        : this(new RangeSliderViewModel(PassthroughLocalizer.Instance), diagnostics: null)
    {
    }

    /// <summary>Creates the slider over an explicit state holder (hosts / tests) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RangeSlider(RangeSliderViewModel viewModel, RangeSliderDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new RangeSliderDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        BuildTree();

        AutomationProperties.SetAutomationId(this, RangeSliderRegistration.RootAutomationId);

        _lowSlider.ValueChanged += OnLowSliderValueChanged;
        _highSlider.ValueChanged += OnHighSliderValueChanged;
        _track.SizeChanged += OnTrackSizeChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>
    /// Raised when the user moves a thumb — the native port of the web <c>onChange</c>. Carries the sorted
    /// <c>[low, high]</c> tuple. Forwarded from the backing holder.
    /// </summary>
    public event EventHandler<RangeSliderValue>? ValueChanged
    {
        add => _viewModel.ValueChanged += value;
        remove => _viewModel.ValueChanged -= value;
    }

    /// <summary>The canonical surface slug (<c>RangeSlider</c>).</summary>
    public static string Slug => RangeSliderRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public RangeSliderViewModel ViewModel => _viewModel;

    /// <summary>The selected <c>[low, high]</c> pair (web <c>value</c>). Assigning re-renders without raising <see cref="ValueChanged"/>.</summary>
    public RangeSliderValue Value
    {
        get => _viewModel.Value;
        set => _viewModel.Value = value;
    }

    /// <summary>The inclusive lower bound (web <c>min</c>).</summary>
    public double Minimum
    {
        get => _viewModel.Min;
        set => _viewModel.Min = value;
    }

    /// <summary>The inclusive upper bound (web <c>max</c>).</summary>
    public double Maximum
    {
        get => _viewModel.Max;
        set => _viewModel.Max = value;
    }

    /// <summary>The step increment (web <c>step</c>).</summary>
    public double Step
    {
        get => _viewModel.Step;
        set => _viewModel.Step = value;
    }

    /// <summary>The visible label and accessible-name base (web <c>label</c>).</summary>
    public string Label
    {
        get => _viewModel.Label;
        set => _viewModel.Label = value;
    }

    /// <summary>The display / aria-text formatter (web <c>formatValue</c>).</summary>
    public Func<double, string>? FormatValue
    {
        get => _viewModel.FormatValue;
        set => _viewModel.FormatValue = value;
    }

    /// <summary>Explicit lower-thumb accessible name (web <c>minThumbLabel</c>); null resolves the i18n key.</summary>
    public string? MinThumbLabel
    {
        get => _viewModel.MinThumbLabel;
        set => _viewModel.MinThumbLabel = value;
    }

    /// <summary>Explicit upper-thumb accessible name (web <c>maxThumbLabel</c>); null resolves the i18n key.</summary>
    public string? MaxThumbLabel
    {
        get => _viewModel.MaxThumbLabel;
        set => _viewModel.MaxThumbLabel = value;
    }

    /// <summary>Whether the visible label/value row renders (web <c>showLabel</c>).</summary>
    public bool ShowLabel
    {
        get => _viewModel.ShowLabel;
        set => _viewModel.ShowLabel = value;
    }

    /// <summary>Whether both thumbs are non-interactive (web <c>disabled</c>).</summary>
    public bool IsReadOnly
    {
        get => _viewModel.Disabled;
        set => _viewModel.Disabled = value;
    }

    private void BuildTree()
    {
        _label.FontSize = TypographyTokens.Size("TsTypeLabelFontSize", LabelFontSize);
        _label.FontWeight = TypographyTokens.Weight(LabelWeight);
        _label.Foreground = DisplayTokens.TextSecondary;

        _caption.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", CaptionFontSize);
        _caption.Foreground = DisplayTokens.TextMuted;
        Typography.SetNumeralAlignment(_caption, FontNumeralAlignment.Tabular);

        // The label/value row is decorative — each thumb carries the real accessible name, so the row is hidden
        // from Narrator to avoid a duplicate announcement (web role.label / Caption are visual only).
        AutomationProperties.SetAccessibilityView(_label, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_caption, AccessibilityView.Raw);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_label, 0);
        Grid.SetColumn(_caption, 1);
        _header.Children.Add(_label);
        _header.Children.Add(_caption);

        _rail.Fill = DisplayTokens.Border;
        _fill.Fill = DisplayTokens.Accent;

        ConfigureThumbOnlySlider(_lowSlider, RangeSliderRegistration.LowThumbAutomationId);
        ConfigureThumbOnlySlider(_highSlider, RangeSliderRegistration.HighThumbAutomationId);

        _track.Children.Add(_rail);
        _track.Children.Add(_fill);
        _track.Children.Add(_lowSlider);
        _track.Children.Add(_highSlider);

        _root.Children.Add(_header);
        _root.Children.Add(_track);
        Content = _root;
    }

    private static void ConfigureThumbOnlySlider(Slider slider, string automationId)
    {
        slider.Header = null;
        slider.IsThumbToolTipEnabled = false;
        slider.HorizontalAlignment = HorizontalAlignment.Stretch;
        slider.VerticalAlignment = VerticalAlignment.Center;

        var transparent = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        foreach (string key in TrackBrushKeys)
        {
            slider.Resources[key] = transparent;
        }

        Brush accent = DisplayTokens.Accent;
        foreach (string key in ThumbBrushKeys)
        {
            slider.Resources[key] = accent;
        }

        AutomationProperties.SetAutomationId(slider, automationId);
    }

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

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        _lowSlider.ValueChanged -= OnLowSliderValueChanged;
        _highSlider.ValueChanged -= OnHighSliderValueChanged;
        _track.SizeChanged -= OnTrackSizeChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Reproject always raises Projection when anything changes, so a single key re-renders once.
        if (e.PropertyName == nameof(RangeSliderViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void OnLowSliderValueChanged(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.RequestLow(e.NewValue);
    }

    private void OnHighSliderValueChanged(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.RequestHigh(e.NewValue);
    }

    private void OnTrackSizeChanged(object sender, SizeChangedEventArgs e)
    {
        _trackWidth = e.NewSize.Width;
        UpdateFill();
    }

    private void Render()
    {
        RangeSliderProjection projection = _viewModel.Projection;

        ConfigureSliders(projection);

        // web aria-label (thumb name) + aria-valuetext (formatted value as help text).
        AutomationProperties.SetName(_lowSlider, projection.AriaLow);
        AutomationProperties.SetName(_highSlider, projection.AriaHigh);
        AutomationProperties.SetHelpText(_lowSlider, projection.DisplayLow);
        AutomationProperties.SetHelpText(_highSlider, projection.DisplayHigh);
        AutomationProperties.SetName(this, _viewModel.Label);

        // web z-index swap: keep the low thumb grabbable once it passes the midpoint.
        Canvas.SetZIndex(_lowSlider, projection.LowOnTop ? 2 : 1);
        Canvas.SetZIndex(_highSlider, projection.LowOnTop ? 1 : 2);

        _label.Text = _viewModel.Label;
        _caption.Text = projection.RangeText;
        _header.Visibility = projection.ShowLabel ? Visibility.Visible : Visibility.Collapsed;

        UpdateFill();
    }

    private void ConfigureSliders(RangeSliderProjection projection)
    {
        double low = Math.Min(_viewModel.Min, _viewModel.Max);
        double high = Math.Max(_viewModel.Min, _viewModel.Max);
        double step = RangeSliderMath.SafeStep(_viewModel.Step);
        double large = RangeSliderMath.LargeStep(_viewModel.Min, _viewModel.Max, _viewModel.Step);
        bool enabled = !_viewModel.Disabled;

        // Programmatic bound / value writes can re-coerce Value and raise ValueChanged; suppress that echo so it
        // is not mistaken for a user edit (which would re-enter RequestLow / RequestHigh).
        _syncing = true;
        foreach (Slider slider in new[] { _lowSlider, _highSlider })
        {
            slider.Minimum = low;
            slider.Maximum = high;
            slider.StepFrequency = step;
            slider.SmallChange = step;
            slider.LargeChange = large;
            slider.IsEnabled = enabled;
        }

        _lowSlider.Value = Math.Clamp(projection.Low, low, high);
        _highSlider.Value = Math.Clamp(projection.High, low, high);
        _syncing = false;
    }

    private void UpdateFill()
    {
        if (_trackWidth <= 0)
        {
            return;
        }

        RangeSliderProjection projection = _viewModel.Projection;
        double left = projection.LowPercent / 100.0 * _trackWidth;
        double right = projection.HighPercent / 100.0 * _trackWidth;

        _fill.Margin = new Thickness(left, 0, 0, 0);
        _fill.Width = Math.Max(0, right - left);
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
}
