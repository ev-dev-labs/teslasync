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
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 operator-grade Helix usage card — a parity port of
/// web/src/features/system/components/status/AiUsageCard.tsx. It reproduces the web card's three regions fed
/// to the shared <c>UsageCard</c> primitive: three at-a-glance bands (today's calls + errors, total tokens
/// with the in/out split, cost with average latency), a four-cell detail grid (average latency, errors,
/// input and output tokens) and up to two top-list breakdowns ("By feature (7 days)" and "Recent calls" with
/// a ✓ / ✗ marker). The feature-view owns its combined <c>/ai/usage/{today,by-feature,recent}</c> read and
/// therefore renders the full state matrix the P2 contract mandates — a loading skeleton, the populated
/// regions, a friendly empty surface when today reports no calls, an explicit retry surface on hard failure,
/// plus stale and offline freshness chips. All data flows through the shared
/// <see cref="AiUsageDetailViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade, the surface carries a Narrator name and each band / cell / row announces its label-and-value pair.
/// </summary>
public sealed partial class AiUsageDetailCard : ContentControl, IDisposable
{
    private const double CardPadding = 16;       // web p-4
    private const double SectionSpacing = 16;    // web space-y-4
    private const double BandColumnSpacing = 12; // web gap-3
    private const double BandPadding = 12;       // web p-3
    private const int BandCount = 3;
    private const int DetailCount = 4;
    private const double DetailColumnSpacing = 16;
    private const double TopListColumnSpacing = 12;
    private const double SkeletonBandHeight = 64;
    private const double SkeletonDetailHeight = 32;

    private const byte IntentFillAlpha = 0x1A;   // web bg-*-500/10
    private const byte IntentRingAlpha = 0x4D;   // web ring-*-500/30

    private readonly AiUsageDetailViewModel _viewModel;
    private readonly AiUsageDetailDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _card = new();
    private readonly StackPanel _root = new() { Spacing = 8 };
    private readonly Grid _header = new();
    private readonly Subhead _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, currency symbol and diagnostics.</summary>
    /// <param name="source">The cache-then-network usage source (P1/S8 state-holder seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol for the cost band; defaults to "$" when null/blank.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AiUsageDetailCard(
        IAiUsageDetailSource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        AiUsageDetailDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new AiUsageDetailDiagnostics();
        _viewModel = new AiUsageDetailViewModel(source, localizer, currencySymbol);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _card;
        Render();
    }

    /// <summary>The canonical surface id (<c>ai-usage-detail-card</c>).</summary>
    public static string SurfaceId => AiUsageDetailRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public AiUsageDetailViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for the cost band; reassigning re-projects the overview.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="AiUsageDetailSource"/> from the shared
    /// data layer (the host's P2-core dependencies) — the native analogue of the web card calling its three
    /// usage hooks.
    /// </summary>
    public static AiUsageDetailCard Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        string? currencySymbol = null,
        AiUsageDetailDiagnostics? diagnostics = null)
    {
        var source = new AiUsageDetailSource(api, engine, options);
        return new AiUsageDetailCard(source, localizer, currencySymbol, diagnostics);
    }

    private void BuildChrome()
    {
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);
        Grid.SetColumn(_freshness, 1);
        _header.Children.Add(_title);
        _header.Children.Add(_freshness);

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _card.Padding = new Thickness(CardPadding);
        _card.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8);
        _card.BorderBrush = DisplayTokens.Border;
        _card.BorderThickness = new Thickness(1);
        _card.Background = DisplayTokens.Surface;
        _card.Child = _root;
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
        _title.Value = _viewModel.Title;
        AutomationProperties.SetName(this, _viewModel.Title);

        bool showFreshness = _viewModel.HasData;
        _freshness.Visibility = showFreshness ? Visibility.Visible : Visibility.Collapsed;
        if (showFreshness)
        {
            _freshness.UpdatedAt = _viewModel.UpdatedAt;
            _freshness.IsFetching = _viewModel.IsFetching;
            _freshness.IsError = _viewModel.IsError;
        }

        _bodyHost.Child = BuildBody();
    }

    private UIElement BuildBody() => _viewModel.State switch
    {
        AiUsageDetailState.Loading => BuildLoading(),
        AiUsageDetailState.Error => BuildError(),
        AiUsageDetailState.Empty => BuildEmpty(),
        _ => BuildContent(_viewModel.Display),
    };

    private static StackPanel BuildContent(AiUsageDetailDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildBandsGrid(display.Bands));
        column.Children.Add(BuildDetailsGrid(display.Details));
        foreach (var topList in display.TopLists)
        {
            column.Children.Add(BuildTopList(topList));
        }

        return column;
    }

    private static Grid BuildBandsGrid(IReadOnlyList<AiUsageDetailBand> bands)
    {
        var grid = StarGrid(BandCount, BandColumnSpacing);
        for (int i = 0; i < bands.Count && i < BandCount; i++)
        {
            var band = BuildBand(bands[i]);
            Grid.SetColumn(band, i);
            grid.Children.Add(band);
        }

        return grid;
    }

    private static Border BuildBand(AiUsageDetailBand band)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(MutedLabel(band.Label));

        var valueRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        valueRow.Children.Add(new TextBlock
        {
            Text = band.Value,
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
        });
        if (!string.IsNullOrEmpty(band.Unit))
        {
            valueRow.Children.Add(new TextBlock
            {
                Text = band.Unit,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Bottom,
            });
        }

        column.Children.Add(valueRow);
        column.Children.Add(new TextBlock
        {
            Text = band.Sub,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });

        var border = new Border
        {
            Child = column,
            Padding = new Thickness(BandPadding),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = IntentFill(band.Intent),
            BorderBrush = IntentRing(band.Intent),
            BorderThickness = new Thickness(band.Intent == AiUsageIntent.Normal ? 0 : 1),
        };
        AutomationProperties.SetName(border, band.AutomationName);
        return border;
    }

    private static Grid BuildDetailsGrid(IReadOnlyList<AiUsageDetailMetric> details)
    {
        var grid = StarGrid(DetailCount, DetailColumnSpacing);
        for (int i = 0; i < details.Count && i < DetailCount; i++)
        {
            var cell = BuildDetailCell(details[i]);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static StackPanel BuildDetailCell(AiUsageDetailMetric metric)
    {
        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(new TextBlock
        {
            Text = metric.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        column.Children.Add(new TextBlock
        {
            Text = metric.Value,
            FontSize = 14,
            Foreground = IntentValueBrush(metric.Intent),
        });
        AutomationProperties.SetName(column, metric.AutomationName);
        return column;
    }

    private static Border BuildTopList(AiUsageDetailTopList topList)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(MutedLabel(topList.Title));

        var list = new StackPanel { Spacing = 4 };
        foreach (var item in topList.Items)
        {
            list.Children.Add(BuildTopListItem(item));
        }

        column.Children.Add(list);

        return new Border
        {
            Child = column,
            Padding = new Thickness(BandPadding),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
        };
    }

    private static Grid BuildTopListItem(AiUsageDetailTopListItem item)
    {
        var row = new Grid { ColumnSpacing = TopListColumnSpacing };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = item.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var value = new TextBlock
        {
            Text = item.Value,
            FontSize = 13,
            Foreground = MarkBrush(item.Value),
            VerticalAlignment = VerticalAlignment.Center,
        };

        Grid.SetColumn(label, 0);
        Grid.SetColumn(value, 1);
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        row.Children.Add(label);
        row.Children.Add(value);
        AutomationProperties.SetName(row, item.AutomationName);
        return row;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        var bands = StarGrid(BandCount, BandColumnSpacing);
        for (int i = 0; i < BandCount; i++)
        {
            var skeleton = new TsSkeleton { BlockHeight = SkeletonBandHeight };
            Grid.SetColumn(skeleton, i);
            bands.Children.Add(skeleton);
        }

        var details = StarGrid(DetailCount, DetailColumnSpacing);
        for (int i = 0; i < DetailCount; i++)
        {
            var skeleton = new TsSkeleton { BlockHeight = SkeletonDetailHeight };
            Grid.SetColumn(skeleton, i);
            details.Children.Add(skeleton);
        }

        column.Children.Add(bands);
        column.Children.Add(details);

        AutomationProperties.SetName(column, _viewModel.LoadingAnnouncement);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
    };

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static Grid StarGrid(int columns, double spacing)
    {
        var grid = new Grid { ColumnSpacing = spacing };
        for (int i = 0; i < columns; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        return grid;
    }

    private static TextBlock MutedLabel(string text) => new()
    {
        Text = text,
        FontSize = 12,
        CharacterSpacing = 60,
        Foreground = DisplayTokens.TextMuted,
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    // web band intents: normal = bg-white/[0.03]; warn = bg-amber-500/10 ring-amber-500/30; danger likewise red.
    private static Brush IntentFill(AiUsageIntent intent) => intent switch
    {
        AiUsageIntent.Warn => Tint("TsColorWarningColor", IntentFillAlpha),
        AiUsageIntent.Danger => Tint("TsColorDangerColor", IntentFillAlpha),
        _ => DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
    };

    private static SolidColorBrush IntentRing(AiUsageIntent intent) => intent switch
    {
        AiUsageIntent.Warn => Tint("TsColorWarningColor", IntentRingAlpha),
        AiUsageIntent.Danger => Tint("TsColorDangerColor", IntentRingAlpha),
        _ => new SolidColorBrush(Microsoft.UI.Colors.Transparent),
    };

    // web detail value intents: normal = primary; warn = amber; danger = red.
    private static Brush IntentValueBrush(AiUsageIntent intent) => intent switch
    {
        AiUsageIntent.Warn => DisplayTokens.Brush("TsColorWarningBrush"),
        AiUsageIntent.Danger => DisplayTokens.Brush("TsColorDangerBrush"),
        _ => DisplayTokens.TextPrimary,
    };

    // The recent-call marker: ✓ success-green, ✗ danger-red, anything else (feature counts) primary.
    private static Brush MarkBrush(string value) => value switch
    {
        AiUsageDetailProjection.SuccessMark => DisplayTokens.Brush("TsColorSuccessBrush"),
        AiUsageDetailProjection.FailureMark => DisplayTokens.Brush("TsColorDangerBrush"),
        _ => DisplayTokens.TextPrimary,
    };

    private static SolidColorBrush Tint(string colorKey, byte alpha)
    {
        if (Application.Current?.Resources is { } res &&
            res.TryGetValue(colorKey, out object? value) &&
            value is Windows.UI.Color color)
        {
            return new SolidColorBrush(Windows.UI.Color.FromArgb(alpha, color.R, color.G, color.B));
        }

        return new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new AiUsageDetailCardAutomationPeer(this);

    private sealed class AiUsageDetailCardAutomationPeer(AiUsageDetailCard owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AiUsageDetailCard)Owner).ViewModel.Title
                : name;
        }
    }
}
