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
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Preset-Gallery surface — a parity port of
/// web/src/features/automations/pages/PresetGallery.tsx. It renders the automation preset templates in a
/// responsive card grid: each card shows the preset's icon, name, first-trigger label (or "No trigger
/// configured"), an action-count chip, the description, and an "Install" button that deep-links the automation
/// builder pre-filled with the preset (web <c>navigate(`/automations/new?preset=${preset.id}`)</c>). The web
/// component is a pure child of the Automations page; the native feature-view owns its own cache-then-network
/// read of the presets list, so it renders every state the P2 contract mandates — the four card skeletons
/// while loading (web <c>Array.from({ length: 4 })</c>), a friendly empty surface when there are no templates
/// (web <c>presets.length === 0</c>), an explicit retry surface on hard failure, plus stale and offline
/// freshness chips over the cards otherwise. All data flows through the shared
/// <see cref="PresetGalleryViewModel"/>; the view never performs HTTP and never touches the router (Install
/// leaves through the bound <see cref="IPresetGalleryNavigator"/>). Every string resolves through the i18n
/// facade (web <c>useTranslation</c>) and every interactive element carries a Narrator name. The whole surface
/// fades in on load (web <c>FadeIn</c>), and the cards stagger in row-by-row (web <c>StaggerContainer</c> /
/// <c>StaggerItem</c>), honouring reduce-motion.
/// </summary>
public sealed partial class PresetGalleryView : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh
    private const string AddGlyph = "\uE710";       // Segoe Fluent — Add (web Plus)
    private const string EmptyGlyph = "\uE823";     // Segoe Fluent — Clock (web Clock empty icon)
    private const int FadeInDelayMs = 0;
    private const int SkeletonCount = 4;            // web Array.from({ length: 4 })
    private const double CardGap = 16;              // web gap-4
    private const double CardPadding = 20;          // web p-5
    private const double IconBoxSize = 40;          // web w-10 h-10
    private const double IconGlyphSize = 20;
    private const double NameFontSize = 14;         // web text-sm
    private const double MetaFontSize = 12;         // web text-xs
    private const double SmBreakpoint = 640;        // web sm: → 2 columns
    private const double LgBreakpoint = 1024;       // web lg: → 3 columns
    private const double XlBreakpoint = 1280;       // web xl: → 4 columns

    private readonly PresetGalleryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly PresetGalleryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly Brush _accent = DisplayTokens.Brush("TsChartSpeedBrush");

    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly StackPanel _headerActions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, navigation port, localizer and (optional) diagnostics/clock.</summary>
    /// <param name="source">The cache-then-network preset data port.</param>
    /// <param name="navigator">The navigation port the Install action is dispatched through.</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">An injectable clock (defaults to <see cref="DateTimeOffset.Now"/>).</param>
    public PresetGalleryView(
        IPresetGallerySource source,
        IPresetGalleryNavigator navigator,
        ILocalizer localizer,
        PresetGalleryDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new PresetGalleryDiagnostics();
        _viewModel = new PresetGalleryViewModel(source, navigator, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();
        Content = new TsFadeIn { DelayMs = FadeInDelayMs, Content = _root };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>preset-gallery</c>).</summary>
    public static string SurfaceId => PresetGalleryRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public PresetGalleryViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="PresetGallerySource"/> from the shared
    /// data layer (the host's P2-core dependencies), optionally scoped to one category.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="navigator">The navigation port the Install action is dispatched through.</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="category">An explicit category to scope the presets read to; null reads every preset.</param>
    public static PresetGalleryView Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        IPresetGalleryNavigator navigator,
        ILocalizer localizer,
        PresetGalleryDiagnostics? diagnostics = null,
        string? category = null)
    {
        var source = new PresetGallerySource(api, engine, options, category);
        return new PresetGalleryView(source, navigator, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_headerActions, 1);
        header.Children.Add(_headerActions);

        _root.Children.Add(header);
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (e.PreviousSize.Width != e.NewSize.Width && IsGridState(_viewModel.State))
        {
            ScheduleRender();
        }
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        SizeChanged -= OnSizeChanged;
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
        AutomationProperties.SetName(this, _viewModel.Title);

        switch (_viewModel.State)
        {
            case PresetGalleryState.Loading:
                _headerActions.Visibility = Visibility.Collapsed;
                _bodyHost.Child = BuildLoading();
                break;

            case PresetGalleryState.Error:
                _headerActions.Visibility = Visibility.Collapsed;
                _bodyHost.Child = BuildError();
                break;

            case PresetGalleryState.Empty:
                _headerActions.Visibility = Visibility.Collapsed;
                _bodyHost.Child = BuildEmpty();
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = BuildCards(_viewModel.Display);
                break;
        }
    }

    // ── Header (stale / offline chip + refresh) ───────────────────────────────────────────────────────

    private void UpdateHeader()
    {
        _headerActions.Children.Clear();

        if (_viewModel.State is PresetGalleryState.Stale or PresetGalleryState.Offline)
        {
            _headerActions.Children.Add(BuildFreshnessChip(_viewModel.State));
            _headerActions.Children.Add(BuildRefreshButton());
            _headerActions.Visibility = Visibility.Visible;
        }
        else
        {
            _headerActions.Visibility = Visibility.Collapsed;
        }
    }

    private TsBadge BuildFreshnessChip(PresetGalleryState state)
    {
        bool offline = state == PresetGalleryState.Offline;
        string text = offline ? _viewModel.OfflineChipLabel : _viewModel.StaleChipLabel;

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = MetaFontSize },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Card grid (web FadeIn > StaggerContainer > StaggerItem) ───────────────────────────────────────

    private TsStaggerContainer BuildCards(PresetGalleryDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var container = new TsStaggerContainer { Spacing = CardGap };

        int count = display.Cards.Count;
        int rows = (int)Math.Ceiling(count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            var rowGrid = new Grid { ColumnSpacing = CardGap };
            for (int c = 0; c < columns; c++)
            {
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            }

            for (int c = 0; c < columns; c++)
            {
                int index = (r * columns) + c;
                if (index >= count)
                {
                    break;
                }

                var card = BuildCard(display.Cards[index]);
                Grid.SetColumn(card, c);
                rowGrid.Children.Add(card);
            }

            container.Add(new TsStaggerItem { Content = rowGrid });
        }

        AutomationProperties.SetName(container, _viewModel.Title);
        return container;
    }

    private TsGlassPanel BuildCard(PresetCardModel card)
    {
        var glyph = new FontIcon
        {
            Glyph = card.IconGlyph,
            FontSize = IconGlyphSize,
            Foreground = _accent,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var iconBox = new Border
        {
            Width = IconBoxSize,
            Height = IconBoxSize,
            CornerRadius = new CornerRadius(8),
            BorderBrush = _accent,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Child = glyph,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var name = new TextBlock
        {
            Text = card.Name,
            FontSize = NameFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            MaxLines = 1,
        };

        var trigger = new TextBlock
        {
            Text = card.TriggerLabel,
            FontSize = MetaFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 2, 0, 0),
        };

        var nameColumn = new StackPanel { Spacing = 0 };
        nameColumn.Children.Add(name);
        nameColumn.Children.Add(trigger);

        var badge = new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = new TextBlock { Text = card.ActionCountLabel, FontSize = MetaFontSize },
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(badge, card.ActionCountLabel);

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(iconBox, 0);
        Grid.SetColumn(nameColumn, 1);
        Grid.SetColumn(badge, 2);
        header.Children.Add(iconBox);
        header.Children.Add(nameColumn);
        header.Children.Add(badge);

        var description = new TextBlock
        {
            Text = card.Description,
            FontSize = MetaFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            TextTrimming = TextTrimming.CharacterEllipsis,
            MaxLines = 2,
        };

        var install = new TsButton
        {
            Variant = ButtonVariant.Secondary,
            Size = ControlSize.Small,
            IconGlyph = AddGlyph,
            Text = card.InstallLabel,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(install, string.Create(CultureInfo.CurrentCulture, $"{card.InstallLabel} {card.Name}"));
        install.Click += (_, _) => _viewModel.Install(card.Id);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(header);
        column.Children.Add(description);
        column.Children.Add(install);

        var panel = new TsGlassPanel
        {
            Glow = GlassGlow.Cyan,
            Padding = new Thickness(CardPadding),
            Content = column,
        };
        AutomationProperties.SetName(panel, card.AutomationName);
        return panel;
    }

    private double AvailableWidth()
    {
        double width = _bodyHost.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    // web grid: grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 (sm=640, lg=1024, xl=1280).
    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 4,
        < SmBreakpoint => 1,
        < LgBreakpoint => 2,
        < XlBreakpoint => 3,
        _ => 4,
    };

    private static bool IsGridState(PresetGalleryState state) =>
        state is PresetGalleryState.Loaded or PresetGalleryState.Stale or PresetGalleryState.Offline;

    // ── State bodies ──────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading()
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = CardGap, RowSpacing = CardGap };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(SkeletonCount / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < SkeletonCount; i++)
        {
            var tile = BuildSkeletonCard();
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    // Mirrors web PresetCardSkeleton: icon block, name/trigger blocks, description block, button block.
    private static TsGlassPanel BuildSkeletonCard()
    {
        var textColumn = new StackPanel { Spacing = 6 };
        textColumn.Children.Add(new TsSkeleton { BlockHeight = 16, BlockWidth = 128 });
        textColumn.Children.Add(new TsSkeleton { BlockHeight = 12, BlockWidth = 80 });

        var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        headerRow.Children.Add(new TsSkeleton { BlockWidth = IconBoxSize, BlockHeight = IconBoxSize, Radius = 8 });
        headerRow.Children.Add(textColumn);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(headerRow);
        column.Children.Add(new TsSkeleton { BlockHeight = 32 });
        column.Children.Add(new TsSkeleton { BlockHeight = 28 });

        return new TsGlassPanel { Padding = new Thickness(CardPadding), Content = column };
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.Title,
            Message = _viewModel.ErrorMessage ?? _localizer.GetString(
                PresetGalleryRegistration.CatalogKey("automations.presets.error"), "Couldn't load preset templates"),
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            IconGlyph = EmptyGlyph,
            Message = _viewModel.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(empty, _viewModel.EmptyMessage);
        return empty;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PresetGalleryAutomationPeer(this);

    private sealed class PresetGalleryAutomationPeer(PresetGalleryView owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((PresetGalleryView)Owner).ViewModel.Title
                : name;
        }
    }
}
