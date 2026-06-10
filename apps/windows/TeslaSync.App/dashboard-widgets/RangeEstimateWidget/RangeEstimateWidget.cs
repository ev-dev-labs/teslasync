using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Range Estimate dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/RangeEstimateWidget.tsx. It mirrors the web title-less
/// <c>WidgetShell</c> (a full-area skeleton while loading, a retry surface on error, otherwise an overlaid
/// freshness chip) wrapping the vertically-centred rated/ideal composition: a bold accent-cyan "Rated Range"
/// readout above a semibold "Ideal Range" readout, each a "{value} {unit}" line under a muted uppercase
/// caption. When the response carries no state the surface renders a friendly "No range data" empty state (the
/// web <c>{state ? readouts : &lt;EmptyState&gt;}</c> gate); a zero-range state still renders the readouts. All
/// data flows through the shared <see cref="RangeEstimateViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class RangeEstimateWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double RatedValueFontSize = 20; // web text-xl
    private const double IdealValueFontSize = 18; // web text-lg
    private const double CaptionFontSize = 10;    // web text-[10px]

    private readonly RangeEstimateViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly RangeEstimateDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Border _bodyHost = new();
    private readonly StackPanel _overlay = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, 6, 6, 0),
    };

    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    public RangeEstimateWidget(
        IRangeEstimateSource source,
        ILocalizer localizer,
        RangeEstimateSize size,
        UnitPref? units = null,
        RangeEstimateDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new RangeEstimateDiagnostics();
        _viewModel = new RangeEstimateViewModel(source, localizer, size, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>range-estimate</c>).</summary>
    public static string RegistryId => RangeEstimateRegistration.Id;

    /// <summary>The widget footprint; reassigning stores the new layout (the composition is layout-invariant).</summary>
    public RangeEstimateSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the readouts in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="RangeEstimateSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static RangeEstimateWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        RangeEstimateSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        RangeEstimateDiagnostics? diagnostics = null)
    {
        var source = new RangeEstimateSource(vehicles, api, engine, options, vehicleId);
        return new RangeEstimateWidget(source, localizer, size ?? RangeEstimateRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.rangeEstimate.refresh", "Refresh range"));
        _refresh.Click += OnRefreshClick;

        _overlay.Children.Add(_freshness);
        _overlay.Children.Add(_refresh);

        _bodyHost.Padding = new Thickness(12);
        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalAlignment = VerticalAlignment.Stretch;

        _root.Children.Add(_bodyHost);
        _root.Children.Add(_overlay);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
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
        switch (_viewModel.State)
        {
            case RangeEstimateState.Loading:
                Content = BuildLoading();
                break;

            case RangeEstimateState.Error:
                Content = BuildError();
                break;

            case RangeEstimateState.Empty:
                UpdateOverlay();
                _bodyHost.Child = BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateOverlay();
                _bodyHost.Child = _viewModel.Display is { } display ? BuildBody(display) : BuildEmpty();
                Content = _root;
                break;
        }
    }

    private void UpdateOverlay()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private static StackPanel BuildBody(RangeEstimateDisplay display)
    {
        // Web parity: h-full flex flex-col justify-center space-y-3 — a vertically centred column of readouts.
        var column = new StackPanel { Spacing = 12, VerticalAlignment = VerticalAlignment.Center };

        column.Children.Add(BuildReadout(
            display.RatedLabel, display.RatedValueText, display.RatedAutomationName,
            RatedValueFontSize, FontWeights.Bold, DisplayTokens.Accent));
        column.Children.Add(BuildReadout(
            display.IdealLabel, display.IdealValueText, display.IdealAutomationName,
            IdealValueFontSize, FontWeights.SemiBold, DisplayTokens.TextPrimary));

        return column;
    }

    private static StackPanel BuildReadout(
        string label, string valueText, string automationName, double valueFontSize, Windows.UI.Text.FontWeight valueWeight, Brush valueBrush)
    {
        var block = new StackPanel { Spacing = 2 };

        var caption = new TextBlock
        {
            Text = label.ToUpper(CultureInfo.CurrentCulture),
            FontSize = CaptionFontSize,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);
        block.Children.Add(caption);

        var value = new TextBlock
        {
            Text = valueText,
            FontSize = valueFontSize,
            FontWeight = valueWeight,
            Foreground = valueBrush,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        block.Children.Add(value);

        AutomationProperties.SetName(block, automationName);
        return block;
    }

    private TsSkeleton BuildLoading()
    {
        var skeleton = new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = double.NaN,
            Radius = 12,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Margin = new Thickness(12),
        };

        AutomationProperties.SetName(skeleton, _localizer.GetString("widget.rangeEstimate.loading", "Loading range"));
        return skeleton;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.rangeEstimate.error", "Couldn't load range"),
            ActionText = _localizer.GetString("widget.rangeEstimate.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = RangeEstimateProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
