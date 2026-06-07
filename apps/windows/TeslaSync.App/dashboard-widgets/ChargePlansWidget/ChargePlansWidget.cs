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
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Charge Plans dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/ChargePlansWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (a skeleton while loading, a retry surface on error, otherwise a freshness header) wrapping either
/// the compact single-column target-SOC big number, or the standard layout: the active plan's status
/// badge + rate-plan caption, a two-up Target SOC / Departure stat grid, the remaining plan details, and
/// — when rate plans exist — a "Rate Plans" section listing each utility's plan. When neither a plan nor
/// a rate plan resolves the surface renders a friendly "No charge plans or rate data" empty state (the
/// web <c>hasData</c> gate). All data flows through the shared <see cref="ChargePlansViewModel"/>; the
/// view never performs HTTP. Every string resolves through the i18n facade and every interactive element
/// carries a Narrator name.
/// </summary>
public sealed partial class ChargePlansWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly ChargePlansViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly ChargePlansDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _titleText = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint, currency settings and diagnostics.</summary>
    public ChargePlansWidget(
        IChargePlansSource source,
        ILocalizer localizer,
        ChargePlansSize size,
        ChargePlansSettings? settings = null,
        ChargePlansDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChargePlansDiagnostics();
        _viewModel = new ChargePlansViewModel(source, localizer, size, settings, clock);
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

    /// <summary>The canonical registry id this surface registers under (<c>charge-plans</c>).</summary>
    public static string RegistryId => ChargePlansRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the details for the new layout.</summary>
    public ChargePlansSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>The currency preferences; reassigning re-projects the money fields.</summary>
    public ChargePlansSettings Settings
    {
        get => _viewModel.Settings;
        set => _viewModel.Settings = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargePlansSource"/> from the
    /// shared data layer (the dashboard host's P2-core dependencies), resolving the primary cached
    /// vehicle unless an explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static ChargePlansWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ChargePlansSize? size = null,
        ChargePlansSettings? settings = null,
        long? vehicleId = null,
        ChargePlansDiagnostics? diagnostics = null)
    {
        var source = new ChargePlansSource(vehicles, api, engine, options, vehicleId);
        return new ChargePlansWidget(
            source, localizer, size ?? ChargePlansRegistration.DefaultSize, settings, diagnostics);
    }

    private void BuildChrome()
    {
        var icon = new FontIcon
        {
            Glyph = ChargePlansProjection.HeaderGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush(ChargePlansProjection.HeaderAccentBrushKey),
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
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.chargePlans.refresh", "Refresh charge plans"));
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
            case ChargePlansState.Loading:
                Content = BuildLoading();
                break;

            case ChargePlansState.Error:
                Content = BuildError();
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
        // Web parity: the compact (single-column) layout uses a title-less WidgetShell.
        _titleRow.Visibility = _viewModel.Display.IsCompact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody()
    {
        var display = _viewModel.Display;
        return display.IsCompact ? BuildCompact(display) : BuildStandard(display);
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.chargePlans.loading", "Loading charge plans"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.chargePlans.error", "Couldn't load charge plans"),
            ActionText = _localizer.GetString("widget.chargePlans.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static TsEmptyState BuildEmpty(string message) => new()
    {
        IconGlyph = ChargePlansProjection.HeaderGlyph,
        Message = message,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static UIElement BuildCompact(ChargePlansDisplay display)
    {
        if (!display.HasActivePlan)
        {
            return BuildEmpty(display.NoPlansMessage);
        }

        var icon = new FontIcon
        {
            Glyph = ChargePlansProjection.HeaderGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(ChargePlansProjection.HeaderAccentBrushKey),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var value = new TextBlock
        {
            Text = display.CompactTargetValue,
            FontSize = 24,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.CompactTargetLabel.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = 2,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(icon);
        column.Children.Add(value);
        column.Children.Add(label);

        if (display.CompactDeparture is { } departure)
        {
            column.Children.Add(new TextBlock
            {
                Text = departure,
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        AutomationProperties.SetName(column, display.CompactAutomationName);
        return column;
    }

    private static UIElement BuildStandard(ChargePlansDisplay display)
    {
        if (!display.HasData)
        {
            return BuildEmpty(display.NoDataMessage);
        }

        var column = new StackPanel { Spacing = 12 };

        column.Children.Add(display.HasActivePlan
            ? BuildActivePlan(display)
            : BuildEmpty(display.NoPlansMessage));

        if (display.HasRates)
        {
            column.Children.Add(BuildRateSection(display));
        }

        return column;
    }

    private static StackPanel BuildActivePlan(ChargePlansDisplay display)
    {
        var section = new StackPanel { Spacing = 8 };

        var badge = new TsBadge
        {
            Status = display.StatusKind,
            Dot = true,
            Content = display.StatusText,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var ratePlan = new TextBlock
        {
            Text = display.RatePlanText,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        ratePlan.Visibility = string.IsNullOrEmpty(display.RatePlanText) ? Visibility.Collapsed : Visibility.Visible;

        var badgeRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        badgeRow.Children.Add(badge);
        badgeRow.Children.Add(ratePlan);
        section.Children.Add(badgeRow);

        var stats = new Grid { ColumnSpacing = 8 };
        stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var targetCard = BuildStatCard(display.TargetSocLabel, display.TargetSocValue);
        var departureCard = BuildStatCard(display.DepartureLabel, display.DepartureValue);
        Grid.SetColumn(targetCard, 0);
        Grid.SetColumn(departureCard, 1);
        stats.Children.Add(targetCard);
        stats.Children.Add(departureCard);
        section.Children.Add(stats);

        section.Children.Add(BuildDetailList(display.PlanEntries, display.DetailsCompact, display.NoDetailsMessage));
        return section;
    }

    private static StackPanel BuildRateSection(ChargePlansDisplay display)
    {
        var section = new StackPanel { Spacing = 4 };

        var divider = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Margin = new Thickness(0, 0, 0, 4),
        };
        section.Children.Add(divider);

        var heading = new TextBlock
        {
            Text = display.RatePlansHeading.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 11,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = 80,
        };
        section.Children.Add(heading);

        section.Children.Add(BuildDetailList(display.RateEntries, display.DetailsCompact, display.NoRatesMessage));
        return section;
    }

    private static TsStatCard BuildStatCard(string label, string value)
    {
        var card = new TsStatCard { Label = label, Value = value };
        AutomationProperties.SetName(card, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));
        return card;
    }

    private static UIElement BuildDetailList(IReadOnlyList<DetailEntry> entries, bool compact, string emptyMessage)
    {
        if (entries.Count == 0)
        {
            return BuildInlineEmpty(emptyMessage);
        }

        int count = compact ? Math.Min(entries.Count, 4) : entries.Count;
        var column = new StackPanel();
        for (int i = 0; i < count; i++)
        {
            column.Children.Add(BuildDetailRow(entries[i], showDivider: i < count - 1));
        }

        return column;
    }

    private static Grid BuildDetailRow(DetailEntry entry, bool showDivider)
    {
        var grid = new Grid
        {
            Padding = new Thickness(2, 8, 2, 8),
            ColumnSpacing = 12,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = showDivider ? new Thickness(0, 0, 0, 1) : new Thickness(0),
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = entry.Label.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            CharacterSpacing = 60,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 0);
        grid.Children.Add(label);

        var right = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        var value = new TextBlock
        {
            Text = entry.Value,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (entry.Mono)
        {
            value.FontFamily = new FontFamily("Consolas");
        }

        right.Children.Add(value);

        if (entry.Badge is { } badge)
        {
            var chip = new TsBadge
            {
                Status = badge.Kind,
                Content = badge.Text,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);
            right.Children.Add(chip);
        }

        Grid.SetColumn(right, 1);
        grid.Children.Add(right);

        AutomationProperties.SetName(grid, entry.AutomationName);
        return grid;
    }

    private static Border BuildInlineEmpty(string message)
    {
        var text = new TextBlock
        {
            Text = message,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var border = new Border
        {
            Padding = new Thickness(8, 16, 8, 16),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Child = text,
        };
        AutomationProperties.SetName(border, message);
        return border;
    }

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
