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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Upgrades &amp; Sharing dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx. It mirrors the web <c>WidgetShell</c>
/// (skeleton while loading, a retry surface on error, otherwise an "Upgrades &amp; Sharing" title + freshness
/// header — both hidden in the single-column compact footprint, exactly as the web passes <c>title</c>/<c>icon</c>
/// = undefined when <c>isCompact</c>) wrapping one of two bodies: the standard two-section body ("Available
/// Upgrades" list of name / optional price chip / Eligible|Not eligible rows, then a "Share Links" section of
/// the active-link count + nearest-expiry chip), or — in the compact footprint — the centred eligible-upgrade
/// count + "available" caption (or an "Up to date" chip when there are none). Each section keeps its own inline
/// empty state ("All upgrades applied" / "No active share links") so the body is never blank. All data flows
/// through the shared <see cref="VehicleUpgradesViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every row + the refresh affordance carries a Narrator name.
/// </summary>
public sealed partial class VehicleUpgradesWidget : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly VehicleUpgradesViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VehicleUpgradesDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ScrollViewer _bodyHost = new();
    private readonly FontIcon _icon;
    private readonly TextBlock _titleText = new();
    private readonly StackPanel _titleRow;
    private readonly TsDataFreshness _freshness = new();
    private readonly Button _refresh = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, footprint and diagnostics.</summary>
    /// <param name="source">The cache-then-network upgrades + share-links source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public VehicleUpgradesWidget(
        IVehicleUpgradesSource source,
        ILocalizer localizer,
        VehicleUpgradesSize size,
        VehicleUpgradesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new VehicleUpgradesDiagnostics();
        _viewModel = new VehicleUpgradesViewModel(source, localizer, size);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _icon = new FontIcon
        {
            Glyph = VehicleUpgradesProjection.UpgradeGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>vehicle-upgrades</c>).</summary>
    public static string RegistryId => VehicleUpgradesRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public VehicleUpgradesSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="VehicleUpgradesSource"/> from the shared
    /// data layer (the dashboard host's P2-core dependencies), resolving the primary cached vehicle unless an
    /// explicit <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static VehicleUpgradesWidget Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        VehicleUpgradesSize? size = null,
        long? vehicleId = null,
        VehicleUpgradesDiagnostics? diagnostics = null)
    {
        var source = new VehicleUpgradesSource(vehicles, api, engine, options, vehicleId);
        return new VehicleUpgradesWidget(source, localizer, size ?? VehicleUpgradesRegistration.DefaultSize, diagnostics);
    }

    private void BuildChrome()
    {
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);

        _titleText.FontSize = 11;
        _titleText.FontWeight = FontWeights.Medium;
        _titleText.Foreground = DisplayTokens.TextMuted;
        _titleText.CharacterSpacing = 80;
        _titleText.VerticalAlignment = VerticalAlignment.Center;

        _titleRow.Children.Add(_icon);
        _titleRow.Children.Add(_titleText);

        _refresh.Content = new FontIcon { Glyph = RefreshGlyph, FontSize = 12 };
        _refresh.Background = Transparent();
        _refresh.BorderThickness = new Thickness(0);
        _refresh.Padding = new Thickness(6, 2, 6, 2);
        _refresh.MinWidth = 44;
        _refresh.MinHeight = 44;
        _refresh.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(_refresh, _localizer.GetString("widget.upgrades.refresh", "Refresh upgrades"));
        _refresh.Click += OnRefreshClick;

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        actions.Children.Add(_freshness);
        actions.Children.Add(_refresh);

        var header = new Grid { Padding = new Thickness(12, 8, 12, 2) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(_titleRow);
        header.Children.Add(actions);

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.Padding = new Thickness(12, 0, 12, 12);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(header, 0);
        Grid.SetRow(_bodyHost, 1);
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
            case VehicleUpgradesState.Loading:
                Content = BuildLoading();
                break;

            case VehicleUpgradesState.Error:
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
        var display = _viewModel.Display;
        bool compact = display.IsCompact;

        // Web parity: the title + icon are hidden in the single-column compact footprint (the web passes
        // title/icon = undefined to WidgetShell), leaving only the freshness chip in the top-right corner.
        _icon.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Visibility = compact ? Visibility.Collapsed : Visibility.Visible;
        _titleText.Text = compact ? string.Empty : _viewModel.Title.ToUpper(CultureInfo.CurrentCulture);

        // The compact summary centres vertically; the standard two-section body flows from the top.
        _bodyHost.VerticalContentAlignment = compact ? VerticalAlignment.Center : VerticalAlignment.Top;

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

    // ── Compact summary (web isCompact branch: eligible count + "available" / "Up to date") ──
    private StackPanel BuildCompact(VehicleUpgradesDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 6,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = VehicleUpgradesProjection.UpgradeGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        column.Children.Add(glyph);

        if (display.HasUpgrades)
        {
            column.Children.Add(new TextBlock
            {
                Text = display.EligibleCount.ToString(CultureInfo.CurrentCulture),
                FontSize = 24,
                FontWeight = FontWeights.Bold,
                Foreground = DisplayTokens.TextPrimary,
                HorizontalAlignment = HorizontalAlignment.Center,
            });

            column.Children.Add(new TextBlock
            {
                Text = _viewModel.AvailableLabel.ToUpper(CultureInfo.CurrentCulture),
                FontSize = 10,
                CharacterSpacing = 80,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }
        else
        {
            var badge = new TsBadge
            {
                Status = StatusKind.Success,
                Content = _viewModel.UpToDateLabel,
                MinHeight = 44,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
            column.Children.Add(badge);
        }

        AutomationProperties.SetName(column, display.CompactAccessibilityName);
        return column;
    }

    // ── Standard / Wide body (web: "Available Upgrades" + "Share Links" sections) ──
    private StackPanel BuildStandard(VehicleUpgradesDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildUpgradesSection(display));
        column.Children.Add(new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
        });
        column.Children.Add(BuildShareLinksSection(display));
        return column;
    }

    private StackPanel BuildUpgradesSection(VehicleUpgradesDisplay display)
    {
        var section = new StackPanel { Spacing = 8 };
        section.Children.Add(BuildHeading(_viewModel.UpgradesHeading, glyph: null));

        if (display.HasUpgrades)
        {
            var rows = new StackPanel { Spacing = 8 };
            for (int i = 0; i < display.Upgrades.Count; i++)
            {
                rows.Children.Add(BuildUpgradeRow(display.Upgrades[i], display.IsWide, last: i == display.Upgrades.Count - 1));
            }

            section.Children.Add(rows);
        }
        else
        {
            section.Children.Add(BuildAllApplied());
        }

        return section;
    }

    private StackPanel BuildShareLinksSection(VehicleUpgradesDisplay display)
    {
        var section = new StackPanel { Spacing = 6 };
        section.Children.Add(BuildHeading(_viewModel.ShareLinksHeading, VehicleUpgradesProjection.LinkGlyph));

        if (display.HasActiveShareLinks)
        {
            section.Children.Add(BuildSummaryRow(
                _viewModel.ActiveLinksLabel,
                new TextBlock
                {
                    Text = display.ActiveShareLinkCount.ToString(CultureInfo.CurrentCulture),
                    FontSize = 14,
                    FontWeight = FontWeights.Medium,
                    Foreground = DisplayTokens.TextPrimary,
                    VerticalAlignment = VerticalAlignment.Center,
                    HorizontalAlignment = HorizontalAlignment.Right,
                }));

            if (display.NearestExpiryText is { Length: > 0 } expiry)
            {
                var badge = new TsBadge
                {
                    Status = StatusKind.Warning,
                    Content = expiry,
                    VerticalAlignment = VerticalAlignment.Center,
                    HorizontalAlignment = HorizontalAlignment.Right,
                };
                AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
                section.Children.Add(BuildSummaryRow(_viewModel.NearestExpiryLabel, badge));
            }
        }
        else
        {
            section.Children.Add(new TsEmptyState
            {
                IconGlyph = VehicleUpgradesProjection.LinkGlyph,
                Message = _viewModel.NoShareLinksLabel,
            });
        }

        return section;
    }

    private static StackPanel BuildHeading(string text, string? glyph)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        if (glyph is { Length: > 0 })
        {
            var icon = new FontIcon { Glyph = glyph, FontSize = 11, Foreground = DisplayTokens.TextMuted };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            row.Children.Add(icon);
        }

        row.Children.Add(new TextBlock
        {
            Text = text.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            CharacterSpacing = 80,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return row;
    }

    private static Border BuildUpgradeRow(UpgradeEntry entry, bool isWide, bool last)
    {
        var nameRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        nameRow.Children.Add(new TextBlock
        {
            Text = entry.Name,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        if (entry.PriceText is { Length: > 0 } price)
        {
            var priceBadge = new TsBadge
            {
                Status = StatusKind.Neutral,
                Content = price,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(priceBadge, AccessibilityView.Raw);
            nameRow.Children.Add(priceBadge);
        }

        var left = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(nameRow);

        if (entry.Description is { Length: > 0 } description)
        {
            left.Children.Add(new TextBlock
            {
                Text = description,
                FontSize = 12,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
        }

        if (isWide)
        {
            left.Children.Add(new TextBlock
            {
                Text = entry.BadgeText,
                FontSize = 10,
                Foreground = DisplayTokens.TextMuted,
            });
        }

        var statusBadge = new TsBadge
        {
            Status = entry.Eligible ? StatusKind.Success : StatusKind.Neutral,
            Content = entry.BadgeText,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetAccessibilityView(statusBadge, AccessibilityView.Raw);

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(statusBadge, 1);
        grid.Children.Add(left);
        grid.Children.Add(statusBadge);

        var container = new Border
        {
            Child = grid,
            Padding = new Thickness(4, 6, 4, 6),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = last ? new Thickness(0) : new Thickness(0, 0, 0, 1),
            MinHeight = 44,
        };
        AutomationProperties.SetName(container, entry.AccessibilityName);
        return container;
    }

    private StackPanel BuildAllApplied()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            MinHeight = 44,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = VehicleUpgradesProjection.AppliedGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        row.Children.Add(glyph);

        row.Children.Add(new TextBlock
        {
            Text = _viewModel.AllAppliedLabel,
            FontSize = 14,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, _viewModel.AllAppliedLabel);
        return row;
    }

    private static Grid BuildSummaryRow(string label, FrameworkElement value)
    {
        var labelText = new TextBlock
        {
            Text = label.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 10,
            CharacterSpacing = 40,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var grid = new Grid { ColumnSpacing = 12, Padding = new Thickness(4, 2, 4, 2), MinHeight = 28 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(labelText, 0);
        Grid.SetColumn(value, 1);
        grid.Children.Add(labelText);
        grid.Children.Add(value);
        return grid;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(12, 12, 12, 12) };
        column.Children.Add(new TsSkeleton { BlockHeight = 16, BlockWidth = 120 });
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 16 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("widget.upgrades.loading", "Loading upgrades"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("widget.upgrades.error", "Couldn't load upgrades"),
            ActionText = _localizer.GetString("widget.upgrades.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static SolidColorBrush Transparent() => new(Microsoft.UI.Colors.Transparent);
}
