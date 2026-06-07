using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Battery Forecast dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/BatteryDegradationForecastWidget.tsx. It mirrors the web
/// <c>WidgetShell</c> (a skeleton while loading, a retry surface on error, otherwise a freshness header)
/// wrapping either the compact health readout + tier badge (1×N), or — when standard (≥2 cols) — the
/// projected-80% hero (date + tier badge + monthly rate), the Current Health stat card, the severity-iconed
/// Risk Factors list, and the Recommendations tip cards; a friendly "No degradation forecast data" empty
/// state covers both layouts when the forecast has neither a current-health value nor a projected date
/// (the web <c>hasData</c> gate). All data flows through the shared
/// <see cref="BatteryDegradationForecastViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class BatteryDegradationForecastWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly BatteryDegradationForecastViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly BatteryDegradationForecastDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();
    private readonly ScrollViewer _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    public BatteryDegradationForecastWidget(
        IBatteryDegradationForecastSource source,
        ILocalizer localizer,
        BatteryDegradationForecastSize size,
        BatteryDegradationForecastDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new BatteryDegradationForecastDiagnostics();
        _viewModel = new BatteryDegradationForecastViewModel(source, localizer, size, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>battery-degradation-forecast</c>).</summary>
    public static string RegistryId => BatteryDegradationForecastRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the forecast for the new layout.</summary>
    public BatteryDegradationForecastSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="BatteryDegradationForecastSource"/>
    /// from the shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached
    /// vehicle unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static BatteryDegradationForecastWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        BatteryDegradationForecastSize? size = null,
        long? vehicleId = null,
        BatteryDegradationForecastDiagnostics? diagnostics = null)
    {
        var source = new BatteryDegradationForecastSource(vehicles, api, engine, options, vehicleId);
        return new BatteryDegradationForecastWidget(
            source, localizer, size ?? BatteryDegradationForecastRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = BatteryDegradationForecastProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.forecast.refresh", "Refresh battery forecast"));
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

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

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
            case BatteryDegradationForecastState.Loading:
                Content = BuildLoading();
                break;

            case BatteryDegradationForecastState.Error:
                Content = BuildError();
                break;

            case BatteryDegradationForecastState.Empty:
                UpdateHeader();
                _bodyHost.Content = BuildEmpty();
                Content = _root;
                break;

            default:
                UpdateHeader();
                _bodyHost.Content = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _titleRow.Visibility = _viewModel.Size.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private StackPanel BuildBody()
    {
        var display = _viewModel.Display;
        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 64, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 44, ReduceMotion = MotionPreference.ReduceMotion });
        column.Children.Add(new TsSkeleton { BlockHeight = 44, ReduceMotion = MotionPreference.ReduceMotion });

        AutomationProperties.SetName(column, _localizer.GetString("widget.forecast.loading", "Loading battery forecast"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.forecast.error", "Couldn't load the battery forecast"),
            ActionText = _localizer.GetString("widget.forecast.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = BatteryDegradationForecastProjection.HeaderGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static StackPanel BuildCompact(BatteryDegradationForecastDisplay display)
    {
        var number = new TextBlock
        {
            Text = display.CurrentHealthText,
            FontSize = 28,
            FontWeight = Microsoft.UI.Text.FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var badge = new TsBadge
        {
            Status = display.TierStatus,
            Content = display.TierLabel,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 6,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(number);
        column.Children.Add(badge);
        AutomationProperties.SetName(
            column,
            string.Format(CultureInfo.CurrentCulture, "{0}, {1}", display.CurrentHealthText, display.TierLabel));
        return column;
    }

    private static StackPanel BuildStandard(BatteryDegradationForecastDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildHero(display));

        if (display.HasCurrentHealth)
        {
            column.Children.Add(new TsStatCard { Label = display.CurrentHealthLabel, Value = display.CurrentHealthText });
        }

        if (display.HasRiskFactors)
        {
            column.Children.Add(BuildRiskSection(display));
        }

        if (display.HasRecommendations)
        {
            column.Children.Add(BuildRecommendationSection(display));
        }

        return column;
    }

    private static StackPanel BuildHero(BatteryDegradationForecastDisplay display)
    {
        var caption = Caption(display.ProjectedDateLabel);
        caption.HorizontalAlignment = HorizontalAlignment.Center;

        var date = new TextBlock
        {
            Text = display.ProjectedDateText,
            FontSize = 24,
            FontWeight = Microsoft.UI.Text.FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var badgeRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        badgeRow.Children.Add(new TsBadge { Status = display.TierStatus, Content = display.TierLabel });
        if (display.ShowRate)
        {
            badgeRow.Children.Add(new TextBlock
            {
                Text = display.RateText,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        var hero = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Stretch };
        hero.Children.Add(caption);
        hero.Children.Add(date);
        hero.Children.Add(badgeRow);
        return hero;
    }

    private static StackPanel BuildRiskSection(BatteryDegradationForecastDisplay display)
    {
        var section = new StackPanel { Spacing = 6 };
        section.Children.Add(Caption(display.RiskFactorsLabel));

        var list = new StackPanel { Spacing = 4 };
        foreach (var risk in display.RiskFactors)
        {
            list.Children.Add(BuildRiskRow(risk));
        }

        section.Children.Add(list);
        return section;
    }

    private static Border BuildRiskRow(ForecastRiskItem risk)
    {
        var icon = new FontIcon
        {
            Glyph = risk.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = risk.Label,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var detail = new TextBlock
        {
            Text = risk.Detail,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(label);
        text.Children.Add(detail);

        var badge = new TsBadge
        {
            Status = risk.ScoreStatus,
            Content = risk.ScoreText,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(text, 1);
        Grid.SetColumn(badge, 2);
        grid.Children.Add(icon);
        grid.Children.Add(text);
        grid.Children.Add(badge);

        var row = new Border
        {
            Child = grid,
            MinHeight = 44,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 8, 12, 8),
        };
        AutomationProperties.SetName(row, risk.AutomationName);
        return row;
    }

    private static StackPanel BuildRecommendationSection(BatteryDegradationForecastDisplay display)
    {
        var section = new StackPanel { Spacing = 6 };
        section.Children.Add(Caption(display.RecommendationsLabel));

        var list = new StackPanel { Spacing = 8 };
        foreach (var tip in display.Tips)
        {
            list.Children.Add(BuildTipCard(tip));
        }

        section.Children.Add(list);
        return section;
    }

    private static Border BuildTipCard(ForecastTip tip)
    {
        var icon = new FontIcon
        {
            Glyph = tip.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = tip.Title,
            FontSize = 13,
            FontWeight = Microsoft.UI.Text.FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var badge = new TsBadge
        {
            Status = tip.ImpactStatus,
            Content = tip.ImpactLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var titleRow = new Grid { ColumnSpacing = 8 };
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(title, 0);
        Grid.SetColumn(badge, 1);
        titleRow.Children.Add(title);
        titleRow.Children.Add(badge);

        var description = new TextBlock
        {
            Text = tip.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var body = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(titleRow);
        body.Children.Add(description);

        var grid = new Grid { ColumnSpacing = 10 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(body, 1);
        grid.Children.Add(icon);
        grid.Children.Add(body);

        var card = new Border
        {
            Child = grid,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
            MinHeight = 44,
        };
        AutomationProperties.SetName(card, tip.AutomationName);
        return card;
    }

    private static TextBlock Caption(string text) => new()
    {
        Text = text.ToUpper(CultureInfo.CurrentCulture),
        FontSize = 10,
        Foreground = DisplayTokens.TextMuted,
        CharacterSpacing = 80,
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
