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
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Security feature surface — a parity port of
/// web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx. It reproduces the web
/// <c>GlassPanel</c> wrapper (the "Security" header) over the lock tile (a tinted lock / unlock glyph chip beside
/// the large Locked / Unlocked word and its "Vehicle lock status" caption) and the rows beneath it — Sentry Mode
/// (an Active danger / Inactive neutral chip), Doors and Windows (the scalar value or a localized "Closed"),
/// User Present (Yes emerald / No muted) and the optional detail note — plus the always-present Remote Start row
/// (Enabled emerald / Disabled muted / em dash when unknown). The web component is a pure child of the
/// Live-Telemetry grid; the native surface binds its own cache-then-network <see cref="SecurityPanelViewModel"/>,
/// so it renders every state the P2 contract requires — the skeleton while loading, a retry surface on a hard
/// failure, a friendly empty state when there is no security event and no remote-start flag, and a stale /
/// offline freshness chip over the content otherwise. The view never performs HTTP. Every string resolves
/// through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class SecurityPanel : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const int FadeDelayMs = 180;           // web FadeIn delay={0.18}
    private const double OuterPadding = 24;         // web GlassPanel p-6
    private const double SectionSpacing = 20;       // web header mb-5
    private const double RowSpacing = 16;           // web space-y-4
    private const double LockGlyphSize = 24;        // web h-6 w-6
    private const double LockChipPadding = 12;      // web p-3
    private const double LockChipRadius = 12;       // web rounded-xl
    private const double LockTextSize = 18;         // web text-lg
    private const double CaptionSize = 11;          // web text-[10px]/[11px]
    private const double RowGlyphSize = 14;         // web h-3.5 w-3.5
    private const double BadgeGlyphSize = 12;       // web h-3 w-3
    private const double ValueSize = 14;            // web text-sm
    private const double AccentValueSize = 12;      // web text-xs
    private const double SkeletonHeight = 220;
    private const double SkeletonIconSize = 16;
    private const double LockTileTint = 0.10;       // web bg-*-500/10
    private const double LockBorderTint = 0.30;     // web border-*-500/30

    private readonly SecurityPanelViewModel _viewModel;
    private readonly SecurityPanelDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public SecurityPanel(
        ISecurityPanelSource source,
        ILocalizer localizer,
        SecurityPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new SecurityPanelDiagnostics();
        _viewModel = new SecurityPanelViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.AriaLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>security-panel</c>).</summary>
    public static string SurfaceId => SecurityPanelRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SecurityPanelViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SecurityPanelSource"/> from the shared
    /// data layer (the host's P2-core dependencies), resolving the primary cached vehicle unless an explicit
    /// <paramref name="vehicleId"/> is supplied.
    /// </summary>
    public static SecurityPanel Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        SecurityPanelDiagnostics? diagnostics = null)
    {
        var source = new SecurityPanelSource(vehicles, api, engine, options, vehicleId);
        return new SecurityPanel(source, localizer, diagnostics);
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
        AutomationProperties.SetName(this, _viewModel.AriaLabel);

        _fade.Content = _viewModel.State switch
        {
            SecurityPanelState.Loading => BuildLoading(),
            SecurityPanelState.Error => BuildErrorSurface(),
            _ => BuildPanel(),
        };
    }

    // ── Loaded / Empty / Stale / Offline (the GlassPanel composition) ───────────────────────────────────

    private TsGlassPanel BuildPanel()
    {
        var display = _viewModel.Display;

        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader());

        if (_viewModel.State == SecurityPanelState.Empty || !display.HasData)
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = SecurityPanelProjection.ShieldGlyph,
                Message = display.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }
        else
        {
            column.Children.Add(BuildBody(display));
        }

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        AutomationProperties.SetName(panel, display.AriaLabel);
        return panel;
    }

    private static StackPanel BuildBody(SecurityPanelDisplay display)
    {
        var body = new StackPanel { Spacing = RowSpacing };

        if (display.HasSecurity)
        {
            if (display.LockTile is { } lockTile)
            {
                body.Children.Add(BuildLockTile(lockTile));
            }

            foreach (var row in display.SecurityRows)
            {
                body.Children.Add(BuildRow(row));
            }

            if (!string.IsNullOrEmpty(display.Detail))
            {
                body.Children.Add(BuildDetail(display.Detail));
            }
        }

        body.Children.Add(BuildRow(display.RemoteStart));
        return body;
    }

    private Grid BuildHeader()
    {
        var header = new Grid { VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var titleIcon = new FontIcon
        {
            Glyph = SecurityPanelProjection.ShieldGlyph,
            FontSize = RowGlyphSize,
            Foreground = DisplayTokens.Accent,
        };
        AutomationProperties.SetAccessibilityView(titleIcon, AccessibilityView.Raw);
        titleRow.Children.Add(titleIcon);
        titleRow.Children.Add(new SectionTitle
        {
            Value = _viewModel.Title,
            VerticalAlignment = VerticalAlignment.Center,
        });
        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        var actions = BuildActions();
        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);

        return header;
    }

    private static StackPanel BuildLockTile(SecurityLockTile tile)
    {
        var accent = DisplayTokens.Brush(tile.AccentBrushKey);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var chip = new Border
        {
            Background = Tint(accent, LockTileTint),
            BorderBrush = Tint(accent, LockBorderTint),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(LockChipRadius),
            Padding = new Thickness(LockChipPadding),
            Child = new FontIcon { Glyph = tile.Glyph, FontSize = LockGlyphSize, Foreground = accent },
        };
        row.Children.Add(chip);

        var textColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(new TextBlock
        {
            Text = tile.Text,
            FontSize = LockTextSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = accent,
        });
        textColumn.Children.Add(new TextBlock
        {
            Text = tile.Caption,
            FontSize = CaptionSize,
            Foreground = DisplayTokens.TextMuted,
        });
        row.Children.Add(textColumn);

        AutomationProperties.SetName(row, tile.AutomationName);
        return row;
    }

    private static Grid BuildRow(SecurityRow row)
    {
        var grid = new Grid { VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (!string.IsNullOrEmpty(row.Glyph))
        {
            label.Children.Add(new FontIcon
            {
                Glyph = row.Glyph,
                FontSize = RowGlyphSize,
                Foreground = DisplayTokens.TextMuted,
            });
        }

        label.Children.Add(new Caption { Value = row.Label, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(label, 0);
        grid.Children.Add(label);

        var value = BuildValue(row);
        value.HorizontalAlignment = HorizontalAlignment.Right;
        value.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(value, 1);
        grid.Children.Add(value);

        AutomationProperties.SetName(grid, row.AutomationName);
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        return grid;
    }

    private static FrameworkElement BuildValue(SecurityRow row) => row.ValueKind switch
    {
        SecurityValueKind.Badge => BuildBadge(row),
        SecurityValueKind.AccentText => new TextBlock
        {
            Text = row.ValueText,
            FontSize = AccentValueSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.Brush(row.TextBrushKey),
        },
        _ => BuildMonoValue(row),
    };

    private static TsBadge BuildBadge(SecurityRow row)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (!string.IsNullOrEmpty(row.BadgeGlyph))
        {
            content.Children.Add(new FontIcon { Glyph = row.BadgeGlyph, FontSize = BadgeGlyphSize });
        }

        content.Children.Add(new TextBlock { Text = row.ValueText, FontSize = AccentValueSize, FontWeight = FontWeights.SemiBold });

        var badge = new TsBadge { Status = row.BadgeStatus, Content = content };
        AutomationProperties.SetName(badge, row.ValueText);
        return badge;
    }

    private static TextBlock BuildMonoValue(SecurityRow row)
    {
        var text = new TextBlock
        {
            Text = row.ValueText,
            FontSize = ValueSize,
            Foreground = DisplayTokens.Brush(row.TextBrushKey),
        };
        if (TypographyTokens.Mono is { } mono)
        {
            text.FontFamily = mono;
        }

        return text;
    }

    private static TextBlock BuildDetail(string detail) => new()
    {
        Text = detail,
        FontSize = CaptionSize,
        FontStyle = Windows.UI.Text.FontStyle.Italic,
        Foreground = DisplayTokens.TextMuted,
        TextWrapping = TextWrapping.Wrap,
    };

    // ── Header actions (freshness chip + freshness + refresh) ───────────────────────────────────────────

    private StackPanel BuildActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is SecurityPanelState.Stale or SecurityPanelState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == SecurityPanelState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });

        actions.Children.Add(BuildRefreshButton());
        return actions;
    }

    private TsBadge BuildFreshnessChip(SecurityPanelState state)
    {
        bool offline = state == SecurityPanelState.Offline;
        string text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = AccentValueSize },
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
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _viewModel.RefreshLabel);
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Loading (skeleton chrome) ───────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        column.Children.Add(new TsSkeleton
        {
            BlockWidth = 140,
            BlockHeight = SkeletonIconSize,
            ReduceMotion = MotionPreference.ReduceMotion,
        });

        column.Children.Add(new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = SkeletonHeight,
            Radius = 12,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = column };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(
            panel,
            string.Format(CultureInfo.CurrentCulture, "{0}. {1}", _viewModel.Title, _viewModel.LoadingLabel));
        return panel;
    }

    // ── Error surface (web QueryError) ──────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildErrorSurface()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(OuterPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private static Brush Tint(Brush brush, double opacity) =>
        brush is SolidColorBrush solid ? new SolidColorBrush(solid.Color) { Opacity = opacity } : brush;
}
