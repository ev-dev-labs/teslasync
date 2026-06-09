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
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>JourneyDetailsPanel</c> feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx. It is a presentational panel:
/// assign a <see cref="Model"/> (the web <c>drive: DriveDetail</c> prop, narrowed to the rendered fields, plus
/// the parent-supplied lifecycle status) and it renders one of the contract's states —
/// <see cref="JourneyDetailsPanelState.Loading"/> (skeleton chrome while the drive query is in flight),
/// <see cref="JourneyDetailsPanelState.Empty"/> (a friendly empty state when no drive is selected),
/// <see cref="JourneyDetailsPanelState.Error"/> (a retriable <see cref="TsQueryError"/>), or the populated panel
/// (<see cref="JourneyDetailsPanelState.Ready"/> / <see cref="JourneyDetailsPanelState.Stale"/> /
/// <see cref="JourneyDetailsPanelState.Offline"/>) — the glass panel the web renders: the Route-icon title and
/// the two endpoint columns (the green <c>MapPin</c> "Start" and the red <c>Flag</c> "Destination"), each with
/// its resolved address / coordinate, its timestamp, and its battery line, with a stale / offline freshness chip
/// layered on a cached snapshot. The view never performs HTTP; all branch selection, label resolution and
/// formatting happen in the WinUI-free <see cref="JourneyDetailsPanelProjection"/>. Entrances fade through
/// <see cref="TsFadeIn"/> (honouring reduce-motion), every string resolves through the i18n facade, decorative
/// icons are hidden from Narrator, and the surface + each endpoint column carry a Narrator name. A failed
/// snapshot's retry affordance raises <see cref="RetryRequested"/> for the host to act on (the parent owns the
/// query).
/// </summary>
public sealed partial class JourneyDetailsPanel : ContentControl
{
    private const string RouteGlyph = "\uE7C0";   // Segoe Fluent — Route (web Navigation: the journey header)
    private const string MapPinGlyph = "\uE707";  // Segoe Fluent — Location (web MapPin: the start)
    private const string FlagGlyph = "\uE7C1";    // Segoe Fluent — Flag (web Flag: the destination)

    private const double PanelPadding = 20;     // web p-5
    private const double ContentSpacing = 16;   // web header mb-4 above the grid
    private const double ColumnGap = 16;        // web gap-4
    private const double LabelRowSpacing = 8;   // web gap-2
    private const double EndpointSpacing = 4;   // web mb-1 between an endpoint's stacked lines
    private const double TitleIconSize = 16;    // web Navigation (h-4 w-4)
    private const double LabelIconSize = 16;    // web MapPin / Flag (h-4 w-4)

    private readonly ILocalizer _localizer;
    private readonly JourneyDetailsPanelDiagnostics _diagnostics;

    private JourneyDetailsPanelModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="JourneyDetailsPanelModel.Loading"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public JourneyDetailsPanel(
        ILocalizer localizer,
        JourneyDetailsPanelModel? model = null,
        JourneyDetailsPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? JourneyDetailsPanelModel.Loading;
        _diagnostics = diagnostics ?? new JourneyDetailsPanelDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>JourneyDetailsPanel</c>).</summary>
    public static string Slug => JourneyDetailsPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public JourneyDetailsPanelModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        var display = JourneyDetailsPanelProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            JourneyDetailsPanelState.Loading => BuildLoading(display),
            JourneyDetailsPanelState.Empty => BuildEmpty(display),
            JourneyDetailsPanelState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline (web fall-through: title + the two endpoint columns) ──────────────────────
    private static TsFadeIn BuildContent(JourneyDetailsPanelDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildEndpointsGrid(display));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { Content = panel };
    }

    private static Grid BuildHeader(JourneyDetailsPanelDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LabelRowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(DecorativeIcon(RouteGlyph, TitleIconSize, DisplayTokens.Brush("TsChartSpeedBrush")));
        titleRow.Children.Add(new SectionTitle { Value = display.Title });
        Grid.SetColumn(titleRow, 0);
        grid.Children.Add(titleRow);

        if (display.ShowFreshnessChip)
        {
            var chip = BuildChip(display);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    private static TsBadge BuildChip(JourneyDetailsPanelDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock
            {
                Text = display.FreshnessChipText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    // web grid-cols-1 sm:grid-cols-2 gap-4 — the start column then the destination column.
    private static Grid BuildEndpointsGrid(JourneyDetailsPanelDisplay display)
    {
        var grid = new Grid { ColumnSpacing = ColumnGap, RowSpacing = ColumnGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var start = BuildEndpoint(display.Start);
        Grid.SetColumn(start, 0);
        grid.Children.Add(start);

        var destination = BuildEndpoint(display.Destination);
        Grid.SetColumn(destination, 1);
        grid.Children.Add(destination);

        return grid;
    }

    // web endpoint column: accent label row + bold address (mono for coordinates) + muted time + secondary battery.
    private static StackPanel BuildEndpoint(JourneyEndpoint endpoint)
    {
        var accent = EndpointAccent(endpoint.Kind);
        var column = new StackPanel { Spacing = EndpointSpacing };

        var labelRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LabelRowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        labelRow.Children.Add(DecorativeIcon(EndpointGlyph(endpoint.Kind), LabelIconSize, accent));
        labelRow.Children.Add(new TextBlock
        {
            Text = endpoint.Label,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        column.Children.Add(labelRow);

        var address = new TextBlock
        {
            Text = endpoint.AddressText,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        };
        if (endpoint.IsCoordinates && TypographyTokens.Mono is { } mono)
        {
            address.FontFamily = mono;
        }

        column.Children.Add(address);
        column.Children.Add(Caption(endpoint.TimestampText, DisplayTokens.TextMuted));
        column.Children.Add(Caption(endpoint.BatteryText, DisplayTokens.TextSecondary));

        AutomationProperties.SetName(column, endpoint.AutomationName);
        return column;
    }

    private static Brush EndpointAccent(JourneyEndpointKind kind) => kind switch
    {
        JourneyEndpointKind.Start => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success)),
        _ => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger)),
    };

    private static string EndpointGlyph(JourneyEndpointKind kind) =>
        kind == JourneyEndpointKind.Start ? MapPinGlyph : FlagGlyph;

    // ── Loading (parent still fetching the drive) ─────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(JourneyDetailsPanelDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(new TsSkeleton { BlockWidth = 160, BlockHeight = 20 });
        stack.Children.Add(BuildSkeletonColumns());

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    private static Grid BuildSkeletonColumns()
    {
        var grid = new Grid { ColumnSpacing = ColumnGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        for (int i = 0; i < 2; i++)
        {
            var column = new StackPanel { Spacing = EndpointSpacing };
            column.Children.Add(new TsSkeleton { BlockWidth = 80, BlockHeight = 14 });
            column.Children.Add(new TsSkeleton { BlockHeight = 18 });
            column.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = 12 });
            column.Children.Add(new TsSkeleton { BlockWidth = 90, BlockHeight = 12 });
            Grid.SetColumn(column, i);
            grid.Children.Add(column);
        }

        return grid;
    }

    // ── Empty (web parity: no drive selected) ─────────────────────────────────────────────────────────────
    private static TsFadeIn BuildEmpty(JourneyDetailsPanelDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState { IconGlyph = RouteGlyph, Message = display.EmptyMessage });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { Content = panel };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ─────────────────────────────────────────
    private TsFadeIn BuildError(JourneyDetailsPanelDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));

        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        stack.Children.Add(error);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { Content = panel };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    // ── Shared primitives ─────────────────────────────────────────────────────────────────────────────────
    private static FontIcon DecorativeIcon(string glyph, double size, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative: the surface / column automation name already conveys the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static TextBlock Caption(string text, Brush foreground) => new()
    {
        Text = text,
        FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
        Foreground = foreground,
        TextWrapping = TextWrapping.Wrap,
    };
}
