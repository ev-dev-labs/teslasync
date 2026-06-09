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
/// The native WinUI 3 Range Bar dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/RangeBarWidget.tsx. It mirrors the web <c>WidgetShell</c> (a skeleton
/// while loading, a retry surface on error, otherwise a freshness header) wrapping the rated/ideal range
/// composition: at standard size two horizontal <c>MetricBar</c>s (rated tinted accent-cyan, ideal tinted
/// brand-violet) scaled against the larger of the two, followed by the right-aligned "EPA variance" delta line
/// (only when both ranges are positive); at a single cell (web <c>isCompact</c>) the title and bars collapse to
/// a single big rated-range readout with a "{unit} rated" caption. A friendly "No range data" empty state
/// covers the surface when there is no state or both ranges are zero (the web <c>hasData</c> gate). All data
/// flows through the shared <see cref="RangeBarViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class RangeBarWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double CompactValueFontSize = 24;

    private readonly RangeBarViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly RangeBarDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, units and diagnostics.</summary>
    public RangeBarWidget(
        IRangeBarSource source,
        ILocalizer localizer,
        RangeBarSize size,
        UnitPref? units = null,
        RangeBarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new RangeBarDiagnostics();
        _viewModel = new RangeBarViewModel(source, localizer, size, units);
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

    /// <summary>The canonical registry id this surface registers under (<c>range-bar</c>).</summary>
    public static string RegistryId => RangeBarRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the bars for the new layout.</summary>
    public RangeBarSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The user's unit preference; reassigning re-projects the bars in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="RangeBarSource"/> from the shared data
    /// layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static RangeBarWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        RangeBarSize? size = null,
        UnitPref? units = null,
        long? vehicleId = null,
        RangeBarDiagnostics? diagnostics = null)
    {
        var source = new RangeBarSource(vehicles, api, engine, options, vehicleId);
        return new RangeBarWidget(source, localizer, size ?? RangeBarRegistration.DefaultSize, units, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = RangeBarProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.rangeBar.refresh", "Refresh range"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        _header.Padding = new Thickness(12, 8, 12, 2);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(actions);

        _bodyHost.Padding = new Thickness(12, 4, 12, 12);
        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalAlignment = VerticalAlignment.Stretch;

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
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
            case RangeBarState.Loading:
                Content = BuildLoading();
                break;

            case RangeBarState.Error:
                Content = BuildError();
                break;

            case RangeBarState.Empty:
                UpdateHeader();
                _bodyHost.Child = BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = _viewModel.Display is { } display ? BuildBody(display) : BuildEmpty();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        // Web parity: the compact layout uses a title-less WidgetShell.
        bool compact = _viewModel.Display?.IsCompact ?? _viewModel.Size.IsCompact;
        _titleRow.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private static StackPanel BuildBody(RangeBarDisplay display) =>
        display.IsCompact ? BuildCompact(display) : BuildBars(display);

    private static StackPanel BuildCompact(RangeBarDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var value = new TextBlock
        {
            Text = display.CompactValueText,
            FontSize = CompactValueFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Accent,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        column.Children.Add(value);

        var caption = new TextBlock
        {
            Text = display.CompactCaption,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);
        column.Children.Add(caption);

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private static StackPanel BuildBars(RangeBarDisplay display)
    {
        // Web parity: h-full flex flex-col justify-center space-y-3 — a vertically centred column of bars.
        var column = new StackPanel { Spacing = 12, VerticalAlignment = VerticalAlignment.Center };

        column.Children.Add(BuildMetricBar(
            display.RatedLabel, display.RatedValue, display.MaxValue, display.RatedSublabel, display.RatedBrushKey, display.RatedAutomationName));
        column.Children.Add(BuildMetricBar(
            display.IdealLabel, display.IdealValue, display.MaxValue, display.IdealSublabel, display.IdealBrushKey, display.IdealAutomationName));

        if (display.ShowEpa)
        {
            column.Children.Add(BuildEpa(display));
        }

        return column;
    }

    private static TsMetricBar BuildMetricBar(
        string label, double value, double max, string sublabel, string brushKey, string automationName)
    {
        var bar = new TsMetricBar
        {
            Label = label,
            Value = value,
            Max = max,
            ValueText = sublabel,
            AccentBrushKey = brushKey,
        };

        // Override the bar's default percent-only name with the value + unit for richer Narrator output.
        AutomationProperties.SetName(bar, automationName);
        return bar;
    }

    private static StackPanel BuildEpa(RangeBarDisplay display)
    {
        // Web parity: a right-aligned line — the muted "EPA variance" label and a mono-spaced delta value.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        row.Children.Add(new TextBlock
        {
            Text = display.EpaLabel,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        row.Children.Add(new TextBlock
        {
            Text = display.EpaValueText,
            FontSize = 10,
            FontFamily = new FontFamily("Consolas"),
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, display.EpaAutomationName);
        return row;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12), VerticalAlignment = VerticalAlignment.Center };
        column.Children.Add(new TsSkeleton { BlockHeight = 28, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 28, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.rangeBar.loading", "Loading range"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.rangeBar.error", "Couldn't load range"),
            ActionText = _localizer.GetString("widget.rangeBar.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = RangeBarProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
