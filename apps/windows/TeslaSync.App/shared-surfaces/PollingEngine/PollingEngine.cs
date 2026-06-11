using System.Globalization;
using System.Net.Http;
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
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>PollingEngine</c> shared surface — a parity port of
/// web/src/components/data-display/PollingEngine.tsx. It composes the web <c>GlassPanel</c> from the shared
/// primitives: a tokenized <see cref="TsGlassPanel"/> with a heading and an "Active" status pill; the savings card
/// (four count-up <see cref="TsAnimatedNumber"/> metrics plus the proportional savings-breakdown bar and its
/// legend); the vehicle-activity list, where each vehicle is a Fluent <see cref="Expander"/> whose summary shows the
/// activity-coloured icon, the VIN tail and the activity·profile chip and whose disclosure shows the interval,
/// consecutive-idle count, battery, decision reasons and the optional prediction line; and the friendly empty
/// state when no vehicles are tracked. It renders every data state the web's query layer implies — a skeleton
/// while loading, a <see cref="TsQueryError"/> retry surface on a hard failure, a stale chip, an offline chip with a
/// cached banner — and collapses entirely when the engine is disabled (web <c>return null</c>). All data flows
/// through the shared <see cref="PollingEngineViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade, every interactive element carries a Narrator name, and the surface emits the
/// <c>view.opened</c> diagnostic exactly once when it is shown.
/// </summary>
public sealed partial class PollingEngine : ContentControl, IDisposable
{
    private const string HeaderGlyph = "\uE74B";   // Down — web TrendingDown (fewer polls)
    private const string RefreshGlyph = "\uE72C";  // Refresh
    private const string GaugeGlyph = "\uE9E9";    // Speedometer — web Gauge (section heading + empty)

    private readonly PollingEngineViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly PollingEngineDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, diagnostics and (optional) clock.</summary>
    /// <param name="source">The cache-then-network data seam; never opened by the view.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    /// <param name="clock">The wall clock for relative labels (injected for deterministic hosts/tests).</param>
    public PollingEngine(
        IPollingEngineSource source,
        ILocalizer localizer,
        PollingEngineDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new PollingEngineDiagnostics();
        _viewModel = new PollingEngineViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetAutomationId(this, PollingEngineRegistration.RootAutomationId);
        AutomationProperties.SetName(this, _viewModel.AccessibleName);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="PollingEngineSource"/> from the shared data
    /// layer (the host's P2-core dependencies).
    /// </summary>
    /// <param name="http">The shared, authenticated <see cref="HttpClient"/>.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="diagnostics">The optional PII-safe diagnostics sink.</param>
    /// <param name="clock">The optional injected wall clock.</param>
    /// <returns>A wired surface ready to mount.</returns>
    public static PollingEngine Create(
        HttpClient http,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        PollingEngineDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        var source = new PollingEngineSource(http, engine, options);
        return new PollingEngine(source, localizer, diagnostics, clock);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once when shown.
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

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued || _disposed)
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
        AutomationProperties.SetName(this, _viewModel.AccessibleName);

        if (_viewModel.IsCollapsed)
        {
            // web: `if (!status?.enabled) return null` — the whole surface disappears.
            Visibility = Visibility.Collapsed;
            Content = null;
            return;
        }

        Visibility = Visibility.Visible;
        Content = _viewModel.State switch
        {
            PollingEngineState.Loading => BuildLoading(),
            PollingEngineState.Error => BuildError(),
            _ => BuildPanel(),
        };
    }

    private TsGlassPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(20) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return new TsGlassPanel { Glow = GlassGlow.Green, Content = column };
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString(
                PollingEngineRegistration.ErrorKey, PollingEngineRegistration.ErrorFallback),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsGlassPanel BuildPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(20) };
        body.Children.Add(BuildHeader());

        if (_viewModel.ShowOfflineChip)
        {
            body.Children.Add(BuildOfflineBanner());
        }

        if (_viewModel.HasSavings)
        {
            body.Children.Add(BuildSavings(_viewModel.Savings!));
        }

        body.Children.Add(BuildVehicleSection());
        return new TsGlassPanel { Glow = GlassGlow.Green, Content = body };
    }

    private Grid BuildHeader()
    {
        var icon = new FontIcon
        {
            Glyph = HeaderGlyph,
            FontSize = 18,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(icon);
        titleRow.Children.Add(new PanelTitle { Value = _viewModel.Title, VerticalAlignment = VerticalAlignment.Center });

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(Chip(_viewModel.ActiveLabel, DisplayTokens.Brush("TsColorSuccessBrush"), withDot: true));
        if (_viewModel.ShowStaleChip)
        {
            actions.Children.Add(Chip(_viewModel.StaleLabel, DisplayTokens.Brush("TsColorWarningBrush"), withDot: false));
        }

        if (_viewModel.ShowOfflineChip)
        {
            actions.Children.Add(Chip(_viewModel.OfflineChipLabel, DisplayTokens.Brush("TsColorDangerBrush"), withDot: false));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        });
        actions.Children.Add(BuildRefreshButton());

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(titleRow);
        header.Children.Add(actions);
        return header;
    }

    private Button BuildRefreshButton()
    {
        var refresh = new Button
        {
            Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 },
            Background = Transparent(),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(6, 2, 6, 2),
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(refresh, _viewModel.RetryLabel);
        refresh.Click += OnRefreshClick;
        return refresh;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private Border BuildOfflineBanner()
    {
        var text = new Text
        {
            Value = _viewModel.ErrorMessage ?? _localizer.GetString(
                PollingEngineRegistration.OfflineKey, PollingEngineRegistration.OfflineFallback),
        };
        var banner = new Border
        {
            Child = text,
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Brush("TsColorDangerBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(12, 8, 12, 8),
        };
        AutomationProperties.SetName(banner, text.Value);
        return banner;
    }

    private StackPanel BuildSavings(PollingSavingsView savings)
    {
        var column = new StackPanel { Spacing = 12 };

        var metrics = new Grid { ColumnSpacing = 12 };
        for (int i = 0; i < savings.Metrics.Count; i++)
        {
            metrics.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var cell = BuildMetricCell(savings.Metrics[i]);
            Grid.SetColumn(cell, i);
            metrics.Children.Add(cell);
        }

        column.Children.Add(metrics);

        if (savings.HasBreakdown)
        {
            column.Children.Add(BuildBreakdownBar(savings.Segments));
            column.Children.Add(BuildBreakdownLegend(savings.Segments));
        }

        return column;
    }

    private StackPanel BuildMetricCell(PollingSavingsMetric metric)
    {
        var value = new TsAnimatedNumber
        {
            Value = metric.Value,
            Precision = metric.Precision,
            Prefix = metric.Prefix,
            Suffix = metric.Suffix,
            ReduceMotion = _reduceMotion,
            HorizontalAlignment = HorizontalAlignment.Center,
            Foreground = metric.Emphasis ? DisplayTokens.Brush("TsColorSuccessBrush") : DisplayTokens.TextPrimary,
        };

        var label = new MetricLabel
        {
            Value = _localizer.GetString(metric.LabelKey, metric.LabelFallback),
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var cell = new StackPanel
        {
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        cell.Children.Add(value);
        cell.Children.Add(label);
        AutomationProperties.SetName(cell, _viewModel.MetricAccessibleName(metric));
        return cell;
    }

    private static Grid BuildBreakdownBar(IReadOnlyList<PollingBreakdownSegment> segments)
    {
        var bar = new Grid { Height = 8, ColumnSpacing = 4 };
        for (int i = 0; i < segments.Count; i++)
        {
            PollingBreakdownSegment segment = segments[i];
            bar.ColumnDefinitions.Add(new ColumnDefinition
            {
                Width = new GridLength(Math.Max(segment.Fraction, 0.0001), GridUnitType.Star),
            });
            var fill = new Border
            {
                Background = DisplayPrimitives.HexBrush(segment.ColorHex),
                CornerRadius = new CornerRadius(4),
            };
            Grid.SetColumn(fill, i);
            bar.Children.Add(fill);
        }

        AutomationProperties.SetAccessibilityView(bar, AccessibilityView.Raw);
        return bar;
    }

    private StackPanel BuildBreakdownLegend(IReadOnlyList<PollingBreakdownSegment> segments)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (PollingBreakdownSegment segment in segments)
        {
            var item = DisplayPrimitives.Row(6);
            item.Children.Add(DisplayPrimitives.Dot(DisplayPrimitives.HexBrush(segment.ColorHex), 8));
            item.Children.Add(DisplayPrimitives.Caption(_localizer.GetString(segment.LabelKey, segment.LabelFallback)));
            legend.Children.Add(item);
        }

        return legend;
    }

    private StackPanel BuildVehicleSection()
    {
        var section = new StackPanel { Spacing = 8 };

        var headingIcon = new FontIcon
        {
            Glyph = GaugeGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(headingIcon, AccessibilityView.Raw);

        var headingRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        headingRow.Children.Add(headingIcon);
        headingRow.Children.Add(new SectionTitle { Value = _viewModel.VehicleActivityLabel, VerticalAlignment = VerticalAlignment.Center });
        section.Children.Add(headingRow);

        if (_viewModel.HasVehicles)
        {
            foreach (PollingVehicleRow row in _viewModel.VehicleRows)
            {
                section.Children.Add(BuildVehicleRow(row));
            }
        }
        else
        {
            section.Children.Add(new TsEmptyState
            {
                IconGlyph = GaugeGlyph,
                Message = _viewModel.EmptyMessage,
            });
        }

        return section;
    }

    private FrameworkElement BuildVehicleRow(PollingVehicleRow row)
    {
        FrameworkElement summary = BuildVehicleSummary(row);
        string name = string.Concat(
            row.VinTail, ", ", row.ActivityChip, ", ", _viewModel.NextLabel, " ", row.NextPollLabel);

        if (!row.HasDetails)
        {
            var bare = new Border
            {
                Child = summary,
                BorderBrush = DisplayTokens.Border,
                BorderThickness = new Thickness(1),
                CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
                Padding = new Thickness(12, 10, 12, 10),
            };
            AutomationProperties.SetName(bare, name);
            return bare;
        }

        var expander = new Expander
        {
            Header = summary,
            Content = BuildVehicleDetails(row),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(expander, name);
        return expander;
    }

    private Grid BuildVehicleSummary(PollingVehicleRow row)
    {
        Brush accent = DisplayPrimitives.HexBrush(row.ActivityColorHex);

        var icon = new FontIcon
        {
            Glyph = row.ActivityGlyph,
            FontSize = 16,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        if (row.Animate && !_reduceMotion)
        {
            PulseHelper.Attach(icon);
        }

        var vin = new Code { Value = row.VinTail, VerticalAlignment = VerticalAlignment.Center };

        var chip = Chip(row.ActivityChip, accent, withDot: false);

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(icon);
        left.Children.Add(vin);
        left.Children.Add(chip);

        var clockIcon = new FontIcon
        {
            Glyph = "\uE823", // Recent / clock
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(clockIcon, AccessibilityView.Raw);

        var next = DisplayPrimitives.Caption(string.Concat(_viewModel.NextLabel, ": ", row.NextPollLabel));
        var right = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        right.Children.Add(clockIcon);
        right.Children.Add(next);

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
    }

    private StackPanel BuildVehicleDetails(PollingVehicleRow row)
    {
        var details = new StackPanel { Spacing = 4, Padding = new Thickness(0, 4, 0, 0) };

        if (!string.IsNullOrEmpty(row.IntervalLabel))
        {
            details.Children.Add(DetailLine(string.Concat(_viewModel.IntervalLabel, ": ", row.IntervalLabel)));
        }

        details.Children.Add(DetailLine(string.Concat(
            _viewModel.ConsecutiveIdleLabel, ": ", row.ConsecIdle.ToString(CultureInfo.CurrentCulture))));
        details.Children.Add(DetailLine(string.Concat(
            _viewModel.BatteryLabel, ": ", row.BatteryLevel.ToString("0", CultureInfo.CurrentCulture), "%")));

        foreach (string reason in row.Reasons)
        {
            details.Children.Add(DetailLine(string.Concat("\u2192 ", reason)));
        }

        if (row.Prediction is { } prediction)
        {
            details.Children.Add(BuildPredictionLine(prediction));
        }

        return details;
    }

    private StackPanel BuildPredictionLine(PollingPredictionRow prediction)
    {
        string headline = string.Format(
            CultureInfo.CurrentCulture,
            "{0}: {1} \u00b7 {2} ({3}% {4})",
            _viewModel.PredictionLabel,
            prediction.NextState,
            prediction.InLabel,
            prediction.ConfidencePercent.ToString(CultureInfo.CurrentCulture),
            _viewModel.ConfidenceLabel);

        var headlineText = new Text { Value = headline };
        headlineText.Foreground = DisplayTokens.Brush("TsColorInfoBrush");

        var basedOn = DisplayPrimitives.Caption(string.Concat(_viewModel.BasedOnLabel, ": ", prediction.BasedOn));

        var block = new StackPanel { Spacing = 2, Padding = new Thickness(0, 4, 0, 0) };
        block.Children.Add(headlineText);
        block.Children.Add(basedOn);
        return block;
    }

    private static TextBlock DetailLine(string text)
    {
        var caption = DisplayPrimitives.Caption(text);
        caption.Foreground = DisplayTokens.TextSecondary;
        return caption;
    }

    private static Border Chip(string text, Brush accent, bool withDot)
    {
        var row = DisplayPrimitives.Row(6);
        if (withDot)
        {
            row.Children.Add(DisplayPrimitives.Dot(accent, 8));
        }

        var label = DisplayPrimitives.Caption(text);
        label.Foreground = accent;
        label.FontWeight = FontWeights.Medium;
        row.Children.Add(label);
        return DisplayPrimitives.Pill(row, accent);
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
