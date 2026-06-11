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
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 operator-grade Tesla Fleet API spend &amp; volume card — a parity port of
/// web/src/features/system/components/status/TeslaApiUsageCard.tsx. It reproduces the web card's regions fed
/// to the shared <c>UsageCard</c> primitive: a budget progress bar (spend of the monthly credit with the
/// billing-window countdown), three at-a-glance bands (this-month volume + daily average, last-24h volume +
/// burn rate, end-of-month cost forecast), a four-cell detail grid (useful vs skipped requests, average
/// latency, error rate), up to two top-list breakdowns ("Top services" and "By method"), an over-budget
/// callout banner and two footer links (API logs, Tesla account). The feature-view owns its combined
/// <c>/system/api-usage</c> + <c>/api-logs/stats</c> read and therefore renders the full state matrix the P2
/// contract mandates — a loading skeleton, the populated regions, a friendly empty surface when the snapshot
/// is absent, an explicit retry surface on hard failure, plus stale and offline freshness chips. All data
/// flows through the shared <see cref="TeslaApiUsageViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade, the surface carries a Narrator name and each band / cell / row / link
/// announces its label-and-value pair.
/// </summary>
public sealed partial class TeslaApiUsageCard : ContentControl, IDisposable
{
    private const double CardPadding = 16;        // web p-4
    private const double SectionSpacing = 16;     // web space-y-4
    private const double BandColumnSpacing = 12;  // web gap-3
    private const double BandPadding = 12;        // web p-3
    private const int BandCount = 3;
    private const int DetailCount = 4;
    private const double DetailColumnSpacing = 16;
    private const double FooterSpacing = 8;
    private const double BudgetBarMax = 100;
    private const double SkeletonBudgetHeight = 40;
    private const double SkeletonBandHeight = 64;
    private const double SkeletonDetailHeight = 32;

    private const byte IntentFillAlpha = 0x1A;    // web bg-*-500/10
    private const byte IntentRingAlpha = 0x4D;    // web ring-*-500/30

    private readonly TeslaApiUsageViewModel _viewModel;
    private readonly TeslaApiUsageDiagnostics _diagnostics;
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
    /// <param name="currencySymbol">The currency symbol for money values; defaults to "$" when null/blank.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TeslaApiUsageCard(
        ITeslaApiUsageSource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        TeslaApiUsageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new TeslaApiUsageDiagnostics();
        _viewModel = new TeslaApiUsageViewModel(source, localizer, currencySymbol);
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

    /// <summary>Raised when a footer link is invoked; the host navigates to <see cref="TeslaApiUsageFooterLink.Route"/>.</summary>
    public event EventHandler<TeslaApiUsageFooterLink>? FooterLinkInvoked;

    /// <summary>The canonical surface id (<c>tesla-api-usage-card</c>).</summary>
    public static string SurfaceId => TeslaApiUsageRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public TeslaApiUsageViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for money values; reassigning re-projects the overview.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TeslaApiUsageSource"/> from the shared
    /// data layer (the host's P2-core dependencies) — the native analogue of the web card reading its
    /// api-usage query plus the <c>useApiLogStats</c> hook.
    /// </summary>
    public static TeslaApiUsageCard Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        string? currencySymbol = null,
        TeslaApiUsageDiagnostics? diagnostics = null)
    {
        var source = new TeslaApiUsageSource(api, engine, options);
        return new TeslaApiUsageCard(source, localizer, currencySymbol, diagnostics);
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
        TeslaApiUsageState.Loading => BuildLoading(),
        TeslaApiUsageState.Error => BuildError(),
        TeslaApiUsageState.Empty => BuildEmpty(),
        _ => BuildContent(_viewModel.Display),
    };

    private StackPanel BuildContent(TeslaApiUsageDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        if (display.Budget is { } budget)
        {
            column.Children.Add(BuildBudget(budget));
        }

        column.Children.Add(BuildBandsGrid(display.Bands));
        column.Children.Add(BuildDetailsGrid(display.Details));

        foreach (var topList in display.TopLists)
        {
            column.Children.Add(BuildTopList(topList));
        }

        if (display.Banner is { } banner)
        {
            column.Children.Add(BuildBanner(banner));
        }

        if (display.Footer.Count > 0)
        {
            column.Children.Add(BuildFooter(display.Footer));
        }

        return column;
    }

    private static StackPanel BuildBudget(TeslaApiUsageBudget budget)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var headline = new TextBlock
        {
            Text = budget.Headline,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        var rightLabel = new TextBlock
        {
            Text = budget.RightLabel,
            FontSize = 12,
            Foreground = budget.Intent == TeslaApiUsageIntent.Danger
                ? DisplayTokens.Brush("TsColorDangerBrush")
                : DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Bottom,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetAccessibilityView(headline, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(rightLabel, AccessibilityView.Raw);
        Grid.SetColumn(headline, 0);
        Grid.SetColumn(rightLabel, 1);
        header.Children.Add(headline);
        header.Children.Add(rightLabel);

        var bar = new TsMetricBar
        {
            Value = Math.Clamp(budget.Percent, 0, BudgetBarMax),
            Max = BudgetBarMax,
            AccentBrushKey = BudgetAccentKey(budget.Intent),
        };
        AutomationProperties.SetAccessibilityView(bar, AccessibilityView.Raw);

        var caption = new Caption { Value = budget.Caption };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(header);
        column.Children.Add(bar);
        column.Children.Add(caption);
        AutomationProperties.SetName(column, budget.AutomationName);
        return column;
    }

    private static Grid BuildBandsGrid(IReadOnlyList<TeslaApiUsageBand> bands)
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

    private static Border BuildBand(TeslaApiUsageBand band)
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
            BorderThickness = new Thickness(band.Intent == TeslaApiUsageIntent.Normal ? 0 : 1),
        };
        AutomationProperties.SetName(border, band.AutomationName);
        return border;
    }

    private static Grid BuildDetailsGrid(IReadOnlyList<TeslaApiUsageDetail> details)
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

    private static StackPanel BuildDetailCell(TeslaApiUsageDetail detail)
    {
        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(new TextBlock
        {
            Text = detail.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        column.Children.Add(new TextBlock
        {
            Text = detail.Value,
            FontSize = 14,
            Foreground = IntentValueBrush(detail.Intent),
        });
        AutomationProperties.SetName(column, detail.AutomationName);
        return column;
    }

    private static Border BuildTopList(TeslaApiUsageTopList topList)
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

    private static Grid BuildTopListItem(TeslaApiUsageTopListItem item)
    {
        var row = new Grid { ColumnSpacing = BandColumnSpacing };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = item.Label,
            FontSize = 12,
            FontFamily = new FontFamily("Consolas"),
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var value = new TextBlock
        {
            Text = item.Value,
            FontSize = 13,
            Foreground = DisplayTokens.TextPrimary,
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

    private static TsInlineCallout BuildBanner(TeslaApiUsageBanner banner) => new()
    {
        Variant = ToCalloutVariant(banner.Intent),
        Title = banner.Title,
        Message = banner.Description,
    };

    private StackPanel BuildFooter(IReadOnlyList<TeslaApiUsageFooterLink> links)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = FooterSpacing,
        };

        foreach (var link in links)
        {
            var button = new HyperlinkButton
            {
                Content = link.Label,
                FontSize = 12,
                FontWeight = link.Primary ? FontWeights.SemiBold : FontWeights.Normal,
                Tag = link,
            };
            AutomationProperties.SetName(button, link.AutomationName);
            button.Click += OnFooterLinkClick;
            row.Children.Add(button);
        }

        return row;
    }

    private void OnFooterLinkClick(object sender, RoutedEventArgs e)
    {
        if (sender is HyperlinkButton { Tag: TeslaApiUsageFooterLink link })
        {
            FooterLinkInvoked?.Invoke(this, link);
        }
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(new TsSkeleton { BlockHeight = SkeletonBudgetHeight });

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

    private static string BudgetAccentKey(TeslaApiUsageIntent intent) => intent switch
    {
        TeslaApiUsageIntent.Warn => "TsColorWarningBrush",
        TeslaApiUsageIntent.Danger => "TsColorDangerBrush",
        _ => "TsColorAccentBrush",
    };

    // web band intents: normal = bg-white/[0.03]; warn = bg-amber-500/10 ring-amber-500/30; danger likewise red.
    private static Brush IntentFill(TeslaApiUsageIntent intent) => intent switch
    {
        TeslaApiUsageIntent.Warn => Tint("TsColorWarningColor", IntentFillAlpha),
        TeslaApiUsageIntent.Danger => Tint("TsColorDangerColor", IntentFillAlpha),
        _ => DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
    };

    private static SolidColorBrush IntentRing(TeslaApiUsageIntent intent) => intent switch
    {
        TeslaApiUsageIntent.Warn => Tint("TsColorWarningColor", IntentRingAlpha),
        TeslaApiUsageIntent.Danger => Tint("TsColorDangerColor", IntentRingAlpha),
        _ => new SolidColorBrush(Microsoft.UI.Colors.Transparent),
    };

    // web detail value intents: normal = primary; warn = amber; danger = red.
    private static Brush IntentValueBrush(TeslaApiUsageIntent intent) => intent switch
    {
        TeslaApiUsageIntent.Warn => DisplayTokens.Brush("TsColorWarningBrush"),
        TeslaApiUsageIntent.Danger => DisplayTokens.Brush("TsColorDangerBrush"),
        _ => DisplayTokens.TextPrimary,
    };

    private static CalloutVariant ToCalloutVariant(TeslaApiUsageIntent intent) => intent switch
    {
        TeslaApiUsageIntent.Warn => CalloutVariant.Warning,
        TeslaApiUsageIntent.Danger => CalloutVariant.Danger,
        _ => CalloutVariant.Info,
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
    protected override AutomationPeer OnCreateAutomationPeer() => new TeslaApiUsageCardAutomationPeer(this);

    private sealed class TeslaApiUsageCardAutomationPeer(TeslaApiUsageCard owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((TeslaApiUsageCard)Owner).ViewModel.Title
                : name;
        }
    }
}
