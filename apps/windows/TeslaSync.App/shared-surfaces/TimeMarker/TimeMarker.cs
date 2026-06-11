using System.ComponentModel;
using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>TimeMarker</c> shared surface — a parity port of
/// web/src/components/charts/TimeMarker.tsx. It draws a vertical reference rule marking the moment of an alert
/// on a time-series chart, with a small label chip at the top, coloured by the alert severity. Bound to an
/// <see cref="ITimeMarkerSource"/> (the P1/S8 seam standing in for the web <c>useAlertContext()</c> hook the
/// drill-through pages feed it), it is visible only when the context carries a timestamp (the native analogue
/// of the web <c>if (x == null || x === '') return null;</c>) and its colour follows the severity exactly as
/// the web <c>SEVERITY_STROKE</c> map does (info / warn / critical / success). The label defaults to the
/// localized <c>'Alert'</c>; the stroke width (2), dash pattern (solid) and overflow (extend-domain) reproduce
/// the web defaults and may be overridden through the matching properties (the web prop surface). The host
/// positions and sizes the rule on its chart overlay; this control owns only the rule + chip.
///
/// <para>
/// State coverage: the web source is a controlled, presentational annotation with no data fetch — it has no
/// loading / error / stale / offline chrome to reproduce. Its only render states are hidden (no alert
/// timestamp, the web <c>return null</c>) and visible (the rule + chip), both reproduced here. All state lives
/// in the UI-thread-free <see cref="TimeMarkerViewModel"/>; this view only owns the WinUI wiring — it observes
/// the holder, marshals re-renders onto its captured <see cref="DispatcherQueue"/> (the source may mutate from
/// a background callback) and emits the <c>view.opened</c> diagnostic once on load.
/// </para>
/// </summary>
public sealed partial class TimeMarker : ContentControl, IDisposable
{
    private const double ChipCornerRadius = 6;   // web rounded label chip.
    private const double ChipPaddingX = 6;
    private const double ChipPaddingY = 2;
    private const double ChipRuleSpacing = 2;    // gap between the top label chip and the rule.

    private static readonly char[] DashSeparators = [' ', ','];

    private readonly TimeMarkerViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Border _chip;
    private readonly TextBlock _label = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextWrapping = TextWrapping.NoWrap,
    };

    private readonly Grid _ruleCell = new();
    private readonly Line _rule = new()
    {
        X1 = 0,
        Y1 = 0,
        X2 = 0,
        Y2 = 0,
        VerticalAlignment = VerticalAlignment.Stretch,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private bool _renderQueued;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its alert-context seam, the localizer and an optional diagnostics collector.</summary>
    /// <param name="source">The alert-context seam (P1/S8) the marker binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TimeMarker(
        ITimeMarkerSource source,
        ILocalizer localizer,
        TimeMarkerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TimeMarkerViewModel(source, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Center;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _chip = new Border
        {
            CornerRadius = new CornerRadius(ChipCornerRadius),
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(ChipPaddingX, ChipPaddingY, ChipPaddingX, ChipPaddingY),
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = _label,
        };

        BuildChrome();

        _ruleCell.SizeChanged += OnRuleCellSizeChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TimeMarker</c>).</summary>
    public static string Slug => TimeMarkerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TimeMarkerViewModel ViewModel => _viewModel;

    /// <summary>The label override (web <c>label?</c> prop); <see langword="null"/> uses the localized default.</summary>
    public string? Label
    {
        get => _viewModel.Label;
        set => _viewModel.Label = value;
    }

    /// <summary>The severity override (web <c>severity?</c> prop); <see langword="null"/> follows the alert context.</summary>
    public string? Severity
    {
        get => _viewModel.Severity;
        set => _viewModel.Severity = value;
    }

    /// <summary>The rule width (web <c>strokeWidth</c> prop, default 2).</summary>
    public double StrokeWidth
    {
        get => _viewModel.StrokeWidth;
        set => _viewModel.StrokeWidth = value;
    }

    /// <summary>The dash pattern (web <c>strokeDasharray</c> prop); <see langword="null"/> draws a solid rule.</summary>
    public string? StrokeDasharray
    {
        get => _viewModel.StrokeDasharray;
        set => _viewModel.StrokeDasharray = value;
    }

    /// <summary>The overflow behaviour (web <c>ifOverflow</c> prop, default extend-domain).</summary>
    public TimeMarkerOverflow IfOverflow
    {
        get => _viewModel.IfOverflow;
        set => _viewModel.IfOverflow = value;
    }

    /// <summary>The host chart's y-axis id (web <c>yAxisId</c> prop); <see langword="null"/> when unset.</summary>
    public string? YAxisId
    {
        get => _viewModel.YAxisId;
        set => _viewModel.YAxisId = value;
    }

    /// <summary>Detach from the view-model and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _ruleCell.SizeChanged -= OnRuleCellSizeChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TimeMarkerAutomationPeer(this);

    private void BuildChrome()
    {
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });                       // chip
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });  // rule

        Grid.SetRow(_chip, 0);
        _root.Children.Add(_chip);

        _ruleCell.Margin = new Thickness(0, ChipRuleSpacing, 0, 0);
        _ruleCell.Children.Add(_rule);
        Grid.SetRow(_ruleCell, 1);
        _root.Children.Add(_ruleCell);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _viewModel.NotifyOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void OnRuleCellSizeChanged(object sender, SizeChangedEventArgs e)
    {
        // A WinUI Line does not stretch to its container, so track the rule cell's height to span the plot.
        _rule.Y2 = e.NewSize.Height;
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
        TimeMarkerDisplay display = _viewModel.Display;

        if (!display.IsVisible)
        {
            // web: `if (x == null || x === '') return null;` — contribute nothing visible and carry no
            // automation id so a hidden marker is not a discoverable element.
            Visibility = Visibility.Collapsed;
            AutomationProperties.SetAutomationId(this, string.Empty);
            AutomationProperties.SetName(this, string.Empty);
            return;
        }

        Visibility = Visibility.Visible;
        AutomationProperties.SetAutomationId(this, TimeMarkerRegistration.RootAutomationId);
        AutomationProperties.SetName(this, display.Label);

        Brush stroke = DisplayPrimitives.HexBrush(display.StrokeHex);

        _label.Text = display.Label;
        _label.FontSize = display.LabelFontSize;
        _label.Foreground = stroke;
        _chip.BorderBrush = stroke;

        _rule.Stroke = stroke;
        _rule.StrokeThickness = display.StrokeWidth;
        ApplyDashPattern(display);
    }

    private void ApplyDashPattern(TimeMarkerDisplay display)
    {
        if (!display.IsDashed)
        {
            _rule.StrokeDashArray = null;
            return;
        }

        var dashes = new DoubleCollection();
        foreach (string token in display.StrokeDasharray!.Split(
                     DashSeparators, StringSplitOptions.RemoveEmptyEntries))
        {
            if (double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out double dash) &&
                dash > 0)
            {
                dashes.Add(dash);
            }
        }

        // Only honour a parseable dash pattern; otherwise leave the rule solid (a malformed value never throws).
        _rule.StrokeDashArray = dashes.Count > 0 ? dashes : null;
    }

    /// <summary>
    /// Exposes the marker as an accessible image whose name is the localized label, so Narrator announces the
    /// "Alert" reference line (the web <c>ReferenceLine</c> label) rather than an anonymous shape.
    /// </summary>
    private sealed class TimeMarkerAutomationPeer : FrameworkElementAutomationPeer
    {
        public TimeMarkerAutomationPeer(TimeMarker owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Image;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((TimeMarker)Owner).ViewModel.ResolvedLabel : name;
        }
    }
}
