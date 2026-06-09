using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Patterns Slide surface — a parity port of
/// web/src/features/analytics/components/review/PatternsSlide.tsx, one slide of the analytics Year-in-Review
/// deck. It renders the driving-patterns recap — a chart emoji, the "Your driving patterns" heading, the
/// "Favorite driving day" and "Peak driving hour" hero rows, and the drives/week + distance/drive +
/// efficiency stat readout — converting distance and efficiency to the user's display units at the render
/// boundary (web <c>useUnits</c>) and resolving every label through the i18n facade (web
/// <c>useTranslation</c>). Every state renders — a loading skeleton, the populated slide, a friendly empty
/// surface when the year has no driving data, an explicit retry surface on hard failure, plus stale and
/// offline freshness chips. All data flows through the shared <see cref="PatternsSlideViewModel"/>; the view
/// never performs HTTP. Entrance motion honours the OS reduce-motion setting and every region carries a
/// Narrator name.
/// </summary>
public sealed partial class PatternsSlide : ContentControl, IDisposable
{
    private const double EmojiFontSize = 44;
    private const double HeadingFontSize = 18;
    private const double RowValueFontSize = 22;
    private const double MetricValueFontSize = 26;
    private const double ContentMaxWidth = 420;
    private const string ChartEmoji = "\U0001F4CA"; // 📊 bar chart (web emoji)

    private readonly PatternsSlideViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly PatternsSlideDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, review year, units and diagnostics.</summary>
    public PatternsSlide(
        IPatternsSlideSource source,
        ILocalizer localizer,
        int year,
        UnitPref? units = null,
        PatternsSlideDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new PatternsSlideDiagnostics();
        _viewModel = new PatternsSlideViewModel(source, localizer, year, units, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>patterns-slide</c>).</summary>
    public static string SurfaceId => PatternsSlideRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public PatternsSlideViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the slide in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="PatternsSlideSource"/> from the shared
    /// data layer (the host's P2-core dependencies) for a given vehicle and review year (defaulting to the
    /// current year, mirroring the web review deck's default).
    /// </summary>
    public static PatternsSlide Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long vehicleId,
        int? year = null,
        UnitPref? units = null,
        PatternsSlideDiagnostics? diagnostics = null)
    {
        int reviewYear = year ?? PatternsSlideRegistration.DefaultYear;
        var source = new PatternsSlideSource(api, engine, options, vehicleId, reviewYear);
        return new PatternsSlide(source, localizer, reviewYear, units, diagnostics);
    }

    private void BuildChrome()
    {
        // The web slide is headerless; the native superset adds a single right-aligned freshness chip so the
        // mandated stale / offline / refreshing states have a visible affordance.
        _header.Padding = new Thickness(0, 0, 0, 8);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_freshness, 1);
        _header.Children.Add(_freshness);

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

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
            case PatternsSlideState.Loading:
                Content = BuildLoading();
                break;

            case PatternsSlideState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        // Hide the chip entirely on a fresh first load (web parity); show it once content is stale/offline/refreshing.
        bool show = _viewModel.State is PatternsSlideState.Stale or PatternsSlideState.Offline || _viewModel.IsFetching;
        _freshness.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.HasData)
        {
            return BuildSlide(_viewModel.Display);
        }

        return BuildEmpty();
    }

    // ── Slide ────────────────────────────────────────────────────────────────────────────────────────

    private static TsFadeIn BuildSlide(PatternsDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = ContentMaxWidth,
        };

        var emoji = new TextBlock
        {
            Text = ChartEmoji,
            FontSize = EmojiFontSize,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(emoji, AccessibilityView.Raw);
        column.Children.Add(emoji);

        column.Children.Add(new TextBlock
        {
            Text = display.Heading,
            FontSize = HeadingFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });

        column.Children.Add(BuildHeroRow(display.FavoriteDay));
        column.Children.Add(BuildHeroRow(display.PeakHour));
        column.Children.Add(BuildMetricsRow(display.Metrics));

        var fade = new TsFadeIn { HorizontalContentAlignment = HorizontalAlignment.Stretch, Content = column };
        AutomationProperties.SetName(fade, display.Heading);
        return fade;
    }

    private static Border BuildHeroRow(PatternsRow row)
    {
        var glyph = new FontIcon
        {
            Glyph = row.Glyph,
            FontSize = 26,
            Foreground = ChartBrushes.ForIndex(row.ColorIndex),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = row.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var value = new TextBlock
        {
            Text = row.Value,
            FontSize = RowValueFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };

        var textColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(label);
        textColumn.Children.Add(value);

        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Center,
        };
        content.Children.Add(glyph);
        content.Children.Add(textColumn);

        var border = new Border
        {
            Child = content,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(18, 16, 18, 16),
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private static Grid BuildMetricsRow(IReadOnlyList<PatternsMetric> metrics)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        for (int c = 0; c < metrics.Count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < metrics.Count; i++)
        {
            var metric = metrics[i];

            var value = new TextBlock
            {
                Text = metric.Value,
                FontSize = MetricValueFontSize,
                FontWeight = FontWeights.SemiBold,
                Foreground = DisplayTokens.TextPrimary,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
            };

            var label = new TextBlock
            {
                Text = metric.Label,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
            };

            var cell = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
            cell.Children.Add(value);
            cell.Children.Add(label);
            AutomationProperties.SetName(cell, metric.AutomationName);

            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return grid;
    }

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildLoading()
    {
        var column = new StackPanel
        {
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MaxWidth = ContentMaxWidth,
            Padding = new Thickness(0, 4, 0, 4),
        };

        column.Children.Add(new TsSkeleton { BlockWidth = 64, BlockHeight = 48, Radius = 12 });
        column.Children.Add(new TsSkeleton { BlockWidth = 220, BlockHeight = 18 });
        column.Children.Add(new TsSkeleton { BlockHeight = 64, Radius = 12 });
        column.Children.Add(new TsSkeleton { BlockHeight = 64, Radius = 12 });

        var metrics = new Grid { ColumnSpacing = 12 };
        for (int c = 0; c < 3; c++)
        {
            metrics.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var block = new TsSkeleton { BlockHeight = 48, Radius = 8 };
            Grid.SetColumn(block, c);
            metrics.Children.Add(block);
        }

        column.Children.Add(metrics);

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.EmptyTitle,
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("translation.yearReview.error", "Couldn't load your year in review"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.EmptyTitle,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    protected override AutomationPeer OnCreateAutomationPeer() => new PatternsSlideAutomationPeer(this);

    private sealed class PatternsSlideAutomationPeer(PatternsSlide owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((PatternsSlide)Owner).ViewModel.Title
                : name;
        }
    }
}
