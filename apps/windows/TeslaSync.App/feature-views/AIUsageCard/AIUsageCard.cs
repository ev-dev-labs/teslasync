using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Helix usage card — a parity port of
/// web/src/features/settings/components/AIUsageCard.tsx. It mirrors the web bordered <c>&lt;section&gt;</c>
/// (a <c>&lt;Subhead&gt;Usage today&lt;/Subhead&gt;</c> over a three-column grid of Tokens in / Tokens out /
/// Estimated cost cells, closed by a <c>&lt;Caption&gt;</c> that reads "{n} Helix calls today." or the
/// empty copy). The web card degrades every non-loaded branch to a long em-dash; the native
/// feature-view owns its own <c>/ai/usage/today</c> read and therefore renders the full state matrix the P2
/// contract mandates — a loading skeleton, the populated cells, a friendly empty surface when the response
/// carries no usage object, an explicit retry surface on hard failure, plus stale and offline freshness chips.
/// All data flows through the shared <see cref="AiUsageCardViewModel"/>; the view never performs HTTP. Every
/// string resolves through the i18n facade, the surface carries a Narrator name and each cell announces its
/// label-and-value pair.
/// </summary>
public sealed partial class AIUsageCard : ContentControl, IDisposable
{
    private const double CardPadding = 16; // web p-4
    private const double CellColumnSpacing = 12; // web gap-3
    private const double SkeletonCellHeight = 36;
    private const double SkeletonCaptionHeight = 14;
    private const int CellCount = 3;

    private readonly AiUsageCardViewModel _viewModel;
    private readonly AiUsageCardDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _card = new();
    private readonly StackPanel _root = new() { Spacing = 8 };
    private readonly Grid _header = new();
    private readonly Subhead _title = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, currency symbol and diagnostics.</summary>
    /// <param name="source">The cache-then-network usage source (P1/S8 state-holder seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol for the cost cell; defaults to "$" when null/blank.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AIUsageCard(
        IAiUsageTodaySource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        AiUsageCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new AiUsageCardDiagnostics();
        _viewModel = new AiUsageCardViewModel(source, localizer, currencySymbol);
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

    /// <summary>The canonical surface id (<c>ai-usage-card</c>).</summary>
    public static string SurfaceId => AiUsageCardRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public AiUsageCardViewModel ViewModel => _viewModel;

    /// <summary>The currency symbol used for the cost cell; reassigning re-projects the snapshot.</summary>
    public string CurrencySymbol
    {
        get => _viewModel.CurrencySymbol;
        set => _viewModel.CurrencySymbol = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="AiUsageTodaySource"/> from the shared
    /// data layer (the host's P2-core dependencies) — the native analogue of the web card calling
    /// <c>useAiUsageToday()</c>.
    /// </summary>
    public static AIUsageCard Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        string? currencySymbol = null,
        AiUsageCardDiagnostics? diagnostics = null)
    {
        var source = new AiUsageTodaySource(api, engine, options);
        return new AIUsageCard(source, localizer, currencySymbol, diagnostics);
    }

    private void BuildChrome()
    {
        _title.VerticalAlignment = VerticalAlignment.Center;

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);
        Grid.SetColumn(_freshness, 1);
        _header.Children.Add(_title);
        _header.Children.Add(_freshness);

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        // web <section className="rounded-md border border-[var(--border-subtle)] p-4 space-y-1">
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
        AiUsageCardState.Loading => BuildLoading(),
        AiUsageCardState.Error => BuildError(),
        AiUsageCardState.Empty => BuildEmpty(),
        _ => BuildContent(_viewModel.Display),
    };

    private static StackPanel BuildContent(AiUsageDisplay display)
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(BuildCellGrid(display.Cells));
        column.Children.Add(new Caption { Value = display.Caption });
        return column;
    }

    private static Grid BuildCellGrid(IReadOnlyList<AiUsageCell> cells)
    {
        var grid = new Grid { ColumnSpacing = CellColumnSpacing };
        for (int c = 0; c < CellCount; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < cells.Count && i < CellCount; i++)
        {
            var cell = BuildCell(cells[i]);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static StackPanel BuildCell(AiUsageCell cell)
    {
        // web UsageCell: <div className="flex flex-col"><span muted>{label}</span><span medium primary>{value}</span></div>
        var label = new TextBlock
        {
            Text = cell.Label,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        var value = new TextBlock
        {
            Text = cell.Value,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(label);
        column.Children.Add(value);
        AutomationProperties.SetName(column, cell.AutomationName);
        return column;
    }

    private Grid BuildLoading()
    {
        var column = new Grid { RowSpacing = 8 };
        column.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        column.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var cells = new Grid { ColumnSpacing = CellColumnSpacing };
        for (int c = 0; c < CellCount; c++)
        {
            cells.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < CellCount; i++)
        {
            var skeleton = new TsSkeleton { BlockHeight = SkeletonCellHeight };
            Grid.SetColumn(skeleton, i);
            cells.Children.Add(skeleton);
        }

        Grid.SetRow(cells, 0);
        column.Children.Add(cells);

        var captionSkeleton = new TsSkeleton
        {
            BlockHeight = SkeletonCaptionHeight,
            BlockWidth = 180,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        Grid.SetRow(captionSkeleton, 1);
        column.Children.Add(captionSkeleton);

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
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

    protected override AutomationPeer OnCreateAutomationPeer() => new AiUsageCardAutomationPeer(this);

    private sealed class AiUsageCardAutomationPeer(AIUsageCard owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AIUsageCard)Owner).ViewModel.Title
                : name;
        }
    }
}
