using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The native WinUI 3 <c>WidgetRankedList</c> widget primitive — a parity port of the web component at
/// <c>web/src/features/dashboard/widgets/shared/WidgetRankedList.tsx</c>. It is a pure presentational building
/// block shared by many dashboard widgets: assign a <see cref="Model"/> (the web <c>items</c> / <c>maxItems</c> /
/// <c>compact</c> / <c>showBars</c> / <c>emptyMessage</c> / <c>emptyIcon</c> props) and it renders the web layout
/// — a vertically scrolling list of ranked rows, each a rank number, a truncating label, an optional trailing
/// status chip and a bold value, sitting over a proportional translucent background bar — or, when no rows
/// resolve, the always-visible empty state (never a blank box). The view never performs HTTP and never recomputes
/// — the parent widget owns the data and the ordering / capping / bar maths / badge mapping all happen in the
/// WinUI-free <see cref="WidgetRankedListProjection"/>. Because the web component is synchronous and prop-driven
/// (its parent widget owns any fetching), it has no loading / error / stale / offline chrome — only the populated
/// list and the empty state, both of which always render — so this surface reproduces exactly those two branches
/// and fabricates none. Layout uses platform tokens (<see cref="DisplayTokens"/>) rather than ported Tailwind
/// classes; the bar tint is materialised from the row's semantic data-attribute hex via
/// <see cref="DisplayPrimitives.HexBrush"/> (a chart-series-style palette colour, not an ad-hoc theme colour),
/// while ambient theming still flows through the token brushes. Every string resolves through the i18n facade,
/// each row carries a composed Narrator name (its glyph parts marked decorative), and the surface emits a single
/// <c>view.opened</c> diagnostics event on first load.
/// </summary>
public sealed partial class WidgetRankedList : ContentControl
{
    private const double RowMinHeight = 44;          // web min-h-[44px]
    private const double RowSpacing = 4;             // web ul gap-1
    private const double ContentColumnSpacing = 12;  // web row gap-3
    private const double RankColumnWidth = 20;       // web w-5
    private const double RankFontSize = 12;          // web text-xs
    private const double LabelFontSize = 14;         // web text-sm
    private const double ValueFontSize = 14;         // web text-sm
    private const double BadgeFontSize = 12;         // web Badge size="sm"
    private const double BarOpacity = 0.15;          // web opacity-15
    private const double RowHorizontalPadding = 12;  // web px-3
    private const double RowVerticalPadding = 8;     // web py-2
    private const string HoverBrushKey = "TsColorSurfaceGlassBrush"; // web hover:bg-[var(--surface-2)]

    private readonly ILocalizer _localizer;
    private readonly WidgetRankedListDiagnostics _diagnostics;

    private WidgetRankedListModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every string resolves through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="WidgetRankedListModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WidgetRankedList(
        ILocalizer localizer,
        WidgetRankedListModel? model = null,
        WidgetRankedListDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? WidgetRankedListModel.Empty;
        _diagnostics = diagnostics ?? new WidgetRankedListDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>WidgetRankedList</c>).</summary>
    public static string Slug => WidgetRankedListRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public WidgetRankedListModel Model
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
        WidgetRankedListDisplay display = WidgetRankedListProjection.Project(_model, _localizer);
        Content = display.IsEmpty ? BuildEmpty(display) : BuildList(display);
    }

    private static TsEmptyState BuildEmpty(WidgetRankedListDisplay display)
    {
        // web: <EmptyState icon={emptyIcon} message={emptyMessage} className="py-8" /> — always rendered in place
        // of a hidden panel. The shared empty surface keeps its friendly default glyph unless the model supplies
        // one (web emptyIcon), so the region is never a blank box.
        var empty = new TsEmptyState { Message = display.EmptyMessage };
        if (!string.IsNullOrEmpty(display.EmptyIconGlyph))
        {
            empty.IconGlyph = display.EmptyIconGlyph;
        }

        return empty;
    }

    private static ScrollViewer BuildList(WidgetRankedListDisplay display)
    {
        // web: <div className="overflow-y-auto"><ul className="flex flex-col gap-1">…</ul></div>.
        var list = new StackPanel { Spacing = RowSpacing };
        foreach (RankedRow row in display.Rows)
        {
            list.Children.Add(BuildRow(row));
        }

        var scroller = new ScrollViewer
        {
            Content = list,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };

        // The list itself is anonymous in the web source; expose it as a List control type so Narrator announces
        // the grouping while each row carries its own composed name.
        AutomationProperties.SetAccessibilityView(list, AccessibilityView.Content);
        return scroller;
    }

    private static Grid BuildRow(RankedRow row)
    {
        // web <li>: a relative, rounded, min-height row with a hover surface; the background bar sits behind the
        // content within the same cell.
        var rowGrid = new Grid
        {
            MinHeight = RowMinHeight,
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
            Padding = new Thickness(RowHorizontalPadding, RowVerticalPadding, RowHorizontalPadding, RowVerticalPadding),
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        };

        if (row.ShowBar)
        {
            rowGrid.Children.Add(BuildBar(row));
        }

        rowGrid.Children.Add(BuildContent(row));

        AttachHover(rowGrid);

        AutomationProperties.SetName(rowGrid, row.AccessibleName);
        AutomationProperties.SetAccessibilityView(rowGrid, AccessibilityView.Content);
        return rowGrid;
    }

    private static Grid BuildBar(RankedRow row)
    {
        // web background bar: absolutely positioned, width = barPct%, rounded, opacity-15. Reproduced declaratively
        // with two star-weighted columns so the fill is a true proportion of the row width (no layout-pass maths).
        var track = new Grid();
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(row.BarPercent, GridUnitType.Star) });
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0, 100 - row.BarPercent), GridUnitType.Star) });

        var fill = new Border
        {
            Background = DisplayPrimitives.HexBrush(row.BarColorHex),
            Opacity = BarOpacity,
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        Grid.SetColumn(fill, 0);
        track.Children.Add(fill);

        AutomationProperties.SetAccessibilityView(track, AccessibilityView.Raw);
        return track;
    }

    private static Grid BuildContent(RankedRow row)
    {
        var content = new Grid { ColumnSpacing = ContentColumnSpacing, VerticalAlignment = VerticalAlignment.Center };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(RankColumnWidth) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // web: rank number — w-5, right-aligned, text-xs, medium, muted.
        var rank = new TextBlock
        {
            Text = row.Rank.ToString(System.Globalization.CultureInfo.CurrentCulture),
            FontSize = RankFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(rank, 0);
        AutomationProperties.SetAccessibilityView(rank, AccessibilityView.Raw);
        content.Children.Add(rank);

        // web: label — flex-1, truncate, text-sm, primary.
        var label = new TextBlock
        {
            Text = row.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 1);
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        content.Children.Add(label);

        if (row.Badge is { } badge)
        {
            // web: <Badge variant={badgeVariantMap[badge.variant]} size="sm">{badge.text}</Badge>.
            var chip = new TsBadge
            {
                Status = badge.Status,
                Content = new TextBlock { Text = badge.Text, FontSize = BadgeFontSize },
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(chip, 2);
            AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);
            content.Children.Add(chip);
        }

        // web: value — text-sm, semibold, tabular-nums, primary. (WinUI TextBlock has no tabular-figures hook; the
        // value is right-anchored in its own auto column so columns still align.)
        var value = new TextBlock
        {
            Text = row.FormattedValue,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(value, 3);
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        content.Children.Add(value);

        return content;
    }

    private static void AttachHover(Grid rowGrid)
    {
        // web hover:bg-[var(--surface-2)] — a subtle translucent surface on pointer-over; the transparent resting
        // background keeps the whole row hit-testable so the pointer events fire.
        Brush hover = DisplayTokens.Brush(HoverBrushKey);
        var rest = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        rowGrid.PointerEntered += (_, _) => rowGrid.Background = hover;
        rowGrid.PointerExited += (_, _) => rowGrid.Background = rest;
        rowGrid.PointerCanceled += (_, _) => rowGrid.Background = rest;
    }
}
