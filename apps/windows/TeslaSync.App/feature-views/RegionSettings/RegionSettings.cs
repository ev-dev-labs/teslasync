using Microsoft.UI.Dispatching;
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
using Windows.UI;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 <c>RegionSettings</c> feature surface — a parity port of
/// <c>web/src/features/settings/components/RegionSettings.tsx</c>. It composes the web layout: a tokenized
/// <see cref="TsGlassPanel"/> entered with a <see cref="TsFadeIn"/>, whose header pairs a green
/// Globe icon badge (web <c>IconBox color="green"</c>) and the title/subtitle (web <c>region.title</c> /
/// <c>region.subtitle</c>) with a "Synced {time}" caption (web <c>regionConfig?.fetched_at</c>) and the
/// <see cref="TsButton"/> "Refresh" action (web <c>useRefreshTeslaRegion</c>); the body shows the two-card
/// Region / Fleet API Base URL layout when a region is known (web <c>regionConfig?.data?.region</c>) and the
/// friendly empty surface otherwise (web <c>region.noData</c>). Beyond the web's two branches this standalone
/// surface renders every state from the shared cache-then-network read — a loading skeleton, a freshness/offline
/// chip, and an inline error with a retry affordance — and an assertive live-region notice for the refresh
/// toast (web <c>toast.regionRefreshed</c> / <c>toast.regionFailed</c>). All data flows through the shared
/// <see cref="RegionSettingsViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name. The only motion is the entrance fade, which
/// honours the reduced-motion preference by construction.
/// </summary>
public sealed partial class RegionSettings : ContentControl, IDisposable
{
    private const string GlobeGlyph = "\uE774";   // Segoe Fluent — Globe (web Globe icon)
    private const string RefreshGlyph = "\uE72C";  // Segoe Fluent — Refresh (web RefreshCw icon)
    private const string InfoGlyph = "\uE946";     // Segoe Fluent — Info (web Info icon, empty surface)
    private const string OfflineGlyph = "\uEB5E";  // Segoe Fluent — cloud-off / offline
    private const string SuccessGlyph = "\uE73E";  // Segoe Fluent — CheckMark
    private const string ErrorGlyph = "\uEA39";    // Segoe Fluent — ErrorBadge

    private const double PanelPadding = 24;        // web p-6
    private const double RootSpacing = 16;         // web space-y-4
    private const double HeaderGap = 12;           // web gap-3
    private const double ActionGap = 12;           // web gap-3
    private const double CardGap = 16;             // web gap-4
    private const double CardPadding = 16;         // web p-4
    private const double IconBadgeSize = 40;

    /// <summary>The web surface root automation id.</summary>
    public const string RootAutomationId = "region-settings";

    private readonly RegionSettingsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly RegionSettingsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = RootSpacing };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, diagnostics and (optional) clock.</summary>
    public RegionSettings(
        IRegionSettingsSource source,
        ILocalizer localizer,
        RegionSettingsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new RegionSettingsDiagnostics();
        _viewModel = new RegionSettingsViewModel(source, localizer, _diagnostics, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetName(this, RegionSettingsRegistration.Title(localizer));
        AutomationProperties.SetAutomationId(this, RootAutomationId);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = _root,
        };
        Content = new TsFadeIn { DelayMs = 40, Content = panel };

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>region-settings</c>).</summary>
    public static string SurfaceId => RegionSettingsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public RegionSettingsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="RegionSettingsSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static RegionSettings Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        RegionSettingsDiagnostics? diagnostics = null)
    {
        var source = new RegionSettingsSource(api, engine, options);
        return new RegionSettings(source, localizer, diagnostics);
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

    /// <summary>Detach from the view-model and cancel in-flight work (idempotent).</summary>
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
        _root.Children.Clear();
        _root.Children.Add(BuildHeader());

        var notice = BuildNotice();
        if (notice is not null)
        {
            _root.Children.Add(notice);
        }

        _root.Children.Add(BuildBody());
    }

    // ── Header (always visible) ──────────────────────────────────────────────────────────────────────

    private Grid BuildHeader()
    {
        var header = new Grid { ColumnSpacing = HeaderGap, VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        left.Children.Add(BuildIconBadge());

        var titles = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(new PanelTitle { Value = _viewModel.Title });
        titles.Children.Add(new Caption { Value = _viewModel.Subtitle });
        left.Children.Add(titles);
        Grid.SetColumn(left, 0);

        var actions = BuildActions();
        Grid.SetColumn(actions, 1);

        header.Children.Add(left);
        header.Children.Add(actions);
        return header;
    }

    private static Border BuildIconBadge()
    {
        var color = (DisplayTokens.Brush("TsColorSuccessBrush") as SolidColorBrush)?.Color
            ?? Color.FromArgb(0xFF, 0x34, 0xD3, 0x99);

        var badge = new Border
        {
            Width = IconBadgeSize,
            Height = IconBadgeSize,
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
            BorderThickness = new Thickness(1),
            Background = new SolidColorBrush(Color.FromArgb(0x1A, color.R, color.G, color.B)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(0x33, color.R, color.G, color.B)),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = GlobeGlyph,
                FontSize = 20,
                Foreground = new SolidColorBrush(color),
            },
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
        return badge;
    }

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ActionGap,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.HasSyncTime && _viewModel.SyncedLabel is { } synced)
        {
            actions.Children.Add(new Caption
            {
                Value = synced,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        var chip = BuildStateChip();
        if (chip is not null)
        {
            actions.Children.Add(chip);
        }

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Secondary,
            Size = ControlSize.Small,
            Text = _viewModel.RefreshLabel,
            IconGlyph = RefreshGlyph,
            IsLoading = _viewModel.IsRefreshing,
            IsEnabled = _viewModel.IsRefreshEnabled,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        AutomationProperties.SetAutomationId(button, "region-settings-refresh");
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RefreshAsync();

    // The freshness / offline chip surfaces the native cache-then-network states in the header without ever
    // hiding the web "Synced" caption: "Updating…" while a (re)fetch runs, an offline chip when unreachable, or
    // the relative age while showing stale cached data.
    private FrameworkElement? BuildStateChip()
    {
        if (_viewModel.IsFetching)
        {
            return new TsDataFreshness
            {
                UpdatedAt = _viewModel.UpdatedAt,
                IsFetching = true,
                VerticalAlignment = VerticalAlignment.Center,
            };
        }

        return _viewModel.State switch
        {
            RegionSettingsSurfaceState.Offline => BuildOfflineChip(),
            RegionSettingsSurfaceState.Stale => new TsDataFreshness
            {
                UpdatedAt = _viewModel.UpdatedAt,
                VerticalAlignment = VerticalAlignment.Center,
            },
            _ => null,
        };
    }

    private StackPanel BuildOfflineChip()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new FontIcon
        {
            Glyph = OfflineGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Caption
        {
            Value = _viewModel.OfflineLabel,
            VerticalAlignment = VerticalAlignment.Center,
        });
        AutomationProperties.SetName(row, _viewModel.OfflineLabel);
        return row;
    }

    // ── Refresh notice (web toast parity) ────────────────────────────────────────────────────────────

    private StackPanel? BuildNotice()
    {
        if (_viewModel.RefreshNotice is not { } notice)
        {
            return null;
        }

        bool success = notice.Kind == RegionRefreshNoticeKind.Success;
        var brush = DisplayTokens.Brush(success ? "TsColorSuccessBrush" : "TsColorDangerBrush");

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new FontIcon
        {
            Glyph = success ? SuccessGlyph : ErrorGlyph,
            FontSize = 14,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Text
        {
            Value = notice.Message,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, notice.Message);
        LiveRegion.Configure(row, assertive: true);
        LiveRegion.Announce(row);
        return row;
    }

    // ── Body (state-driven) ──────────────────────────────────────────────────────────────────────────

    private FrameworkElement BuildBody() => _viewModel.State switch
    {
        RegionSettingsSurfaceState.Loading => BuildLoading(),
        RegionSettingsSurfaceState.Empty => BuildEmpty(),
        RegionSettingsSurfaceState.Error => BuildError(),
        _ => BuildCards(),
    };

    private Grid BuildLoading()
    {
        var grid = BuildTwoColumnGrid();
        for (int column = 0; column < 2; column++)
        {
            var skeleton = new TsSkeleton { BlockHeight = 76, Radius = 8 };
            Grid.SetColumn(skeleton, column);
            grid.Children.Add(skeleton);
        }

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private Grid BuildCards()
    {
        var grid = BuildTwoColumnGrid();

        var region = BuildCard(_viewModel.RegionCodeLabel, BuildRegionValue());
        Grid.SetColumn(region, 0);
        grid.Children.Add(region);

        var url = BuildCard(_viewModel.FleetApiUrlLabel, BuildUrlValue());
        Grid.SetColumn(url, 1);
        grid.Children.Add(url);

        return grid;
    }

    private static Grid BuildTwoColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = CardGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        return grid;
    }

    private static Border BuildCard(string label, FrameworkElement value)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new Label { Value = label });
        column.Children.Add(value);

        var card = new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(CardPadding),
            Child = column,
        };

        // Narrator reads the card as "{label}: {value}" so the pairing is not lost.
        var spoken = value is TsTypography typography ? typography.Value : string.Empty;
        AutomationProperties.SetName(card, $"{label}: {spoken}");
        return card;
    }

    private SectionTitle BuildRegionValue() => new()
    {
        Value = _viewModel.RegionValue,
        Foreground = DisplayTokens.TextPrimary,
    };

    private Code BuildUrlValue() => new()
    {
        Value = _viewModel.FleetApiUrlValue,
        Foreground = DisplayTokens.TextPrimary,
    };

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            IconGlyph = InfoGlyph,
            Message = _viewModel.NoDataMessage,
        };
        return empty;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            IconGlyph = ErrorGlyph,
            Message = _viewModel.ErrorMessage,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
        };
        error.ActionInvoked += OnRetryInvoked;
        return error;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
