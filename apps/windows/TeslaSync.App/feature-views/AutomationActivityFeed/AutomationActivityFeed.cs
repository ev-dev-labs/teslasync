using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The native WinUI 3 <c>AutomationActivityFeed</c> feature surface — a parity port of
/// web/src/features/automations/pages/AutomationActivityFeed.tsx. It is a presentational section: assign a
/// <see cref="Model"/> (the web <c>history</c> / <c>historyStats</c> / <c>liveEvents</c> / <c>connectionState</c> props
/// plus the parent's <c>isLoading</c> flag) and it renders the web composition inside a single glass panel — the header
/// (the <c>Activity</c> glyph, the "Recent Activity" title and the live-connection chip, with the optional
/// total / success / average statistics strip on the trailing edge), the newest five live SSE events (each a pulsing
/// status icon, the automation name, an optional failure / skip note and a neutral event-type chip), and the execution
/// history (the parent's skeleton hand-off while <see cref="AutomationHistorySection.Loading"/>, the status rows when
/// <see cref="AutomationHistorySection.Populated"/>, or a friendly "No execution history yet" note when
/// <see cref="AutomationHistorySection.Empty"/>). The view never performs HTTP; all branch selection, number / date
/// formatting and label resolution happen in the WinUI-free <see cref="AutomationActivityFeedProjection"/>. The
/// composition fades in through <see cref="TsFadeIn"/> (honouring reduce-motion); every string resolves through the
/// i18n facade; and the surface, each panel section and every row carry a Narrator name.
/// </summary>
public sealed partial class AutomationActivityFeed : ContentControl
{
    private const int FadeDelayMs = 100;             // web FadeIn delay={0.1}
    private const double PanelPadding = 24;          // web p-6
    private const double ColumnSpacing = 16;         // web mb-4 between header / live / history
    private const double HeaderSpacing = 8;          // web gap-2
    private const double ChipSpacing = 4;            // web gap-1 inside the connection chip
    private const double StatsSpacing = 12;          // web gap-3
    private const double RowSpacing = 12;            // web gap-3 inside a row
    private const double LiveStripSpacing = 4;       // web space-y-1
    private const double HistoryStripSpacing = 2;    // web space-y-0.5
    private const double LoadingSpacing = 8;         // web space-y-2
    private const double TitleFontSize = 18;         // web text-lg
    private const double HeaderIconSize = 20;        // web h-5 w-5
    private const double ChipFontSize = 12;          // web text-xs
    private const double ChipIconSize = 12;          // web h-3 w-3
    private const double StatsFontSize = 12;         // web text-xs
    private const double RowFontSize = 14;           // web text-sm
    private const double RowIconSize = 16;           // web h-4 w-4
    private const double MetaFontSize = 12;          // web text-xs
    private const double SkeletonHeight = 40;        // web h-10
    private const double RowPaddingH = 12;           // web px-3
    private const double RowPaddingV = 8;            // web py-2
    private const double RowRadius = 8;              // web rounded-lg

    private readonly ILocalizer _localizer;
    private readonly AutomationActivityFeedDiagnostics _diagnostics;

    private AutomationActivityFeedModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model and optional diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="AutomationActivityFeedModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AutomationActivityFeed(
        ILocalizer localizer,
        AutomationActivityFeedModel? model = null,
        AutomationActivityFeedDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? AutomationActivityFeedModel.Pending;
        _diagnostics = diagnostics ?? new AutomationActivityFeedDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AutomationActivityFeed</c>).</summary>
    public static string Slug => AutomationActivityFeedRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public AutomationActivityFeedModel Model
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
        var display = AutomationActivityFeedProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = BuildContent(display) };
        AutomationProperties.SetName(panel, display.AutomationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);

        Content = new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private static StackPanel BuildContent(AutomationActivityFeedDisplay display)
    {
        var column = new StackPanel { Spacing = ColumnSpacing };
        column.Children.Add(BuildHeader(display));

        if (display.HasLiveEvents)
        {
            column.Children.Add(BuildLiveStrip(display));
        }

        column.Children.Add(BuildHistory(display));
        return column;
    }

    // web: <div className="mb-4 flex items-center justify-between"> left header group + optional stats strip.
    private static Grid BuildHeader(AutomationActivityFeedDisplay display)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = display.Glyph,
            FontSize = HeaderIconSize,
            Foreground = DisplayTokens.TextSecondary, // web text-[var(--text-secondary)]
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw); // decorative
        left.Children.Add(glyph);

        left.Children.Add(new TextBlock
        {
            Text = display.Title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.SemiBold, // web text-lg font-semibold
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        left.Children.Add(BuildConnectionChip(display));
        Grid.SetColumn(left, 0);
        header.Children.Add(left);

        if (display.ShowStats)
        {
            var stats = BuildStats(display);
            Grid.SetColumn(stats, 1);
            header.Children.Add(stats);
        }

        return header;
    }

    // web: connectionState === 'connected' ? <Wifi/> Live : 'reconnecting' ? <WifiOff/> Reconnecting.
    private static StackPanel BuildConnectionChip(AutomationActivityFeedDisplay display)
    {
        Brush accent = ChartBrushes.ForStatus(display.ConnectionAccent);

        var chip = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ChipSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = display.ConnectionGlyph,
            FontSize = ChipIconSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw); // decorative
        chip.Children.Add(icon);

        chip.Children.Add(new TextBlock
        {
            Text = display.ConnectionLabel,
            FontSize = ChipFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(chip, display.ConnectionLabel);
        AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Content);
        return chip;
    }

    // web: <div className="flex gap-3 text-xs"> {total} · {success(green)} · {avg}.
    private static StackPanel BuildStats(AutomationActivityFeedDisplay display)
    {
        var stats = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = StatsSpacing,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        stats.Children.Add(StatText(display.TotalLabel, DisplayTokens.TextSecondary));
        stats.Children.Add(StatText(display.SuccessLabel, ChartBrushes.ForStatus(StatusKind.Success))); // web text-green-400
        stats.Children.Add(StatText(display.AvgLabel, DisplayTokens.TextSecondary));

        AutomationProperties.SetName(stats, $"{display.TotalLabel}, {display.SuccessLabel}, {display.AvgLabel}");
        AutomationProperties.SetAccessibilityView(stats, AccessibilityView.Content);
        return stats;
    }

    private static TextBlock StatText(string text, Brush brush) => new()
    {
        Text = text,
        FontSize = StatsFontSize,
        Foreground = brush,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // web: {recentLive.length > 0 && <div className="mb-3 space-y-1"> live event rows }.
    private static StackPanel BuildLiveStrip(AutomationActivityFeedDisplay display)
    {
        var strip = new StackPanel { Spacing = LiveStripSpacing };
        foreach (var row in display.LiveEvents)
        {
            strip.Children.Add(BuildLiveRow(row));
        }

        return strip;
    }

    // web LiveEventRow: <div className="bg-neon-cyan/[0.03] px-3 py-2"> icon + name(+detail) + Badge.
    private static Border BuildLiveRow(AutomationLiveRow row)
    {
        var grid = new Grid { ColumnSpacing = RowSpacing, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = RowIcon(row.Glyph, ChartBrushes.ForStatus(row.Accent));
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var name = NameWithDetail(
            row.Name,
            row.Detail,
            row.DetailIsError ? ChartBrushes.ForStatus(StatusKind.Danger) : DisplayTokens.TextMuted);
        Grid.SetColumn(name, 1);
        grid.Children.Add(name);

        var badge = new TsBadge
        {
            Status = StatusKind.Neutral, // web <Badge variant="neutral">
            Content = new TextBlock { Text = row.BadgeLabel, FontSize = MetaFontSize },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw); // carried by the row name
        Grid.SetColumn(badge, 2);
        grid.Children.Add(badge);

        var border = new Border
        {
            Background = DisplayTokens.Surface, // web faint bg-neon-cyan/[0.03] → tokened surface tint
            CornerRadius = new CornerRadius(RowRadius),
            Padding = new Thickness(RowPaddingH, RowPaddingV, RowPaddingH, RowPaddingV),
            Child = grid,
        };
        AutomationProperties.SetName(border, row.AutomationName);
        AutomationProperties.SetAccessibilityView(border, AccessibilityView.Content);
        return border;
    }

    private static UIElement BuildHistory(AutomationActivityFeedDisplay display) => display.HistorySection switch
    {
        AutomationHistorySection.Loading => BuildLoading(display),
        AutomationHistorySection.Populated => BuildHistoryRows(display),
        _ => BuildEmpty(display),
    };

    // web: {isLoading ? Array.from({ length: 5 }).map(() => <Skeleton className="h-10 w-full rounded-lg" />)}.
    private static StackPanel BuildLoading(AutomationActivityFeedDisplay display)
    {
        var column = new StackPanel { Spacing = LoadingSpacing };
        for (int i = 0; i < display.SkeletonRows; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = SkeletonHeight, Radius = RowRadius });
        }

        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    // web: items.map((item) => <HistoryRow item={item} />) inside <div className="space-y-0.5">.
    private static StackPanel BuildHistoryRows(AutomationActivityFeedDisplay display)
    {
        var column = new StackPanel { Spacing = HistoryStripSpacing };
        foreach (var row in display.History)
        {
            column.Children.Add(BuildHistoryRow(row));
        }

        return column;
    }

    // web HistoryRow: <div className="px-3 py-2"> icon + name(+error) + timeAgo + duration + actions.
    private static Grid BuildHistoryRow(AutomationHistoryRow row)
    {
        var grid = new Grid
        {
            ColumnSpacing = RowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
            Padding = new Thickness(RowPaddingH, RowPaddingV, RowPaddingH, RowPaddingV),
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = RowIcon(row.Glyph, ChartBrushes.ForStatus(row.Accent));
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var name = NameWithDetail(row.Name, row.Error, ChartBrushes.ForStatus(StatusKind.Danger));
        Grid.SetColumn(name, 1);
        grid.Children.Add(name);

        var time = MetaText(row.RelativeTime);
        Grid.SetColumn(time, 2);
        grid.Children.Add(time);

        var duration = MetaText(row.Duration);
        Grid.SetColumn(duration, 3);
        grid.Children.Add(duration);

        if (!string.IsNullOrEmpty(row.Actions))
        {
            var actions = MetaText(row.Actions);
            Grid.SetColumn(actions, 4);
            grid.Children.Add(actions);
        }

        AutomationProperties.SetName(grid, row.AutomationName);
        AutomationProperties.SetAccessibilityView(grid, AccessibilityView.Content);
        return grid;
    }

    // web: <EmptyState icon={<Activity/>} message={t('automations.noHistory')} />.
    private static TsEmptyState BuildEmpty(AutomationActivityFeedDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = AutomationActivityFeedProjection.ActivityGlyph,
            Message = display.EmptyMessage,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(empty, display.EmptyMessage);
        return empty;
    }

    private static FontIcon RowIcon(string glyph, Brush brush)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = RowIconSize,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw); // decorative; meaning carried by the row name
        return icon;
    }

    // web: <span className="font-medium">{name}</span>{detail && <span className="ml-2 text-xs">— {detail}</span>}.
    private static TextBlock NameWithDetail(string name, string? detail, Brush detailBrush)
    {
        var block = new TextBlock
        {
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        block.Inlines.Add(new Run
        {
            Text = name,
            FontSize = RowFontSize,
            FontWeight = FontWeights.Medium, // web font-medium
            Foreground = DisplayTokens.TextPrimary,
        });

        if (!string.IsNullOrEmpty(detail))
        {
            block.Inlines.Add(new Run
            {
                Text = "  \u2014 " + detail, // web "— {detail}" (em dash) with a leading gap (ml-2)
                FontSize = MetaFontSize,
                Foreground = detailBrush,
            });
        }

        return block;
    }

    private static TextBlock MetaText(string text) => new()
    {
        Text = text,
        FontSize = MetaFontSize,
        Foreground = DisplayTokens.TextMuted, // web text-xs text-[var(--text-muted)]
        VerticalAlignment = VerticalAlignment.Center,
    };
}
