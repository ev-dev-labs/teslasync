using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives.WidgetDetailCardSurface;

/// <summary>
/// The native WinUI 3 <c>WidgetDetailCard</c> widget primitive — a parity port of
/// <c>web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx</c>. It is a pure presentational control: a
/// shared building block a widget's body fills with already-resolved label / value rows. Assign a
/// <see cref="Model"/> (the web <c>entries</c> / <c>compact</c> / <c>emptyMessage</c> / <c>emptyIcon</c> props)
/// and it renders the web layout — a vertically scrolling list of rows, each with an uppercase muted label on
/// the left and the value (optionally monospace) plus an optional status chip on the right, separated by a
/// hairline between rows. The view never performs HTTP; the empty-message resolution, the value <c>?? '—'</c>
/// fallback, the badge-variant mapping, the compact slice and the per-row accessible name all happen in the
/// WinUI-free <see cref="WidgetDetailCardProjection"/>. Because the web component is synchronous and prop-driven
/// (its parent widget owns any data fetching), it has no loading / error / stale / offline chrome — only the
/// populated branch and the empty branch (the friendly <see cref="TsEmptyState"/>), both of which always render
/// so a region never collapses silently. The label glyph is uppercased for display (the web <c>uppercase</c>
/// class) while the row's accessible name uses the original label so Narrator reads it naturally. The row label
/// (10&#160;px muted) and value (14&#160;px primary) sizes are a parity-driven scale (the web
/// <c>text-[10px]</c> / <c>text-sm</c> classes), not typographic roles, so they are set directly while ambient
/// theming still flows through the token brushes.
/// </summary>
public sealed partial class WidgetDetailCard : ContentControl
{
    private const double LabelFontSize = 10;   // web text-[10px]
    private const double ValueFontSize = 14;   // web text-sm
    private const double LabelTracking = 25;   // web tracking-wide (≈0.025em, CharacterSpacing units = 1/1000 em)
    private const double ColumnGap = 12;       // web gap-3
    private const double RowPaddingX = 4;      // web px-1
    private const double RowPaddingY = 8;      // web py-2

    private readonly ILocalizer _localizer;
    private readonly WidgetDetailCardDiagnostics _diagnostics;

    private WidgetDetailCardModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the empty-message string resolves through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="WidgetDetailCardModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WidgetDetailCard(
        ILocalizer localizer,
        WidgetDetailCardModel? model = null,
        WidgetDetailCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? WidgetDetailCardModel.Empty;
        _diagnostics = diagnostics ?? new WidgetDetailCardDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>WidgetDetailCard</c>).</summary>
    public static string Slug => WidgetDetailCardRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public WidgetDetailCardModel Model
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
        WidgetDetailCardDisplay display = WidgetDetailCardProjection.Project(_model, _localizer);

        // web: entries.length === 0 → the friendly empty surface (never a blank box). The web passes no icon by
        // default, so an absent glyph hides the icon while the message always shows.
        if (display.IsEmpty)
        {
            Content = new TsEmptyState
            {
                Message = display.EmptyMessage,
                IconGlyph = display.EmptyIconGlyph ?? string.Empty,
            };
            return;
        }

        // web: <div className="overflow-y-auto h-full"> wrapping the mapped rows.
        var list = new StackPanel { Orientation = Orientation.Vertical, Spacing = 0 };
        foreach (WidgetDetailRowDisplay row in display.Rows)
        {
            list.Children.Add(BuildRow(row));
        }

        Content = new ScrollViewer
        {
            Content = list,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private static UIElement BuildRow(WidgetDetailRowDisplay row)
    {
        // web row: flex items-center justify-between gap-3 py-2 px-1 — label left (shrinks first), value group
        // right (sized to content). A star/auto grid reproduces justify-between with the gap.
        var grid = new Grid { Padding = new Thickness(RowPaddingX, RowPaddingY, RowPaddingX, RowPaddingY), ColumnSpacing = ColumnGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // web: min-w-0 truncate text-[10px] uppercase text-[var(--text-muted)] tracking-wide.
        var label = new TextBlock
        {
            Text = row.Label.ToUpperInvariant(),
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = (int)LabelTracking,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(label, 0);

        // web: <span className="flex min-w-0 items-center gap-2"> — value then optional badge.
        var right = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        // web: truncate text-sm text-[var(--text-primary)] [font-mono when mono].
        var value = new TextBlock
        {
            Text = row.DisplayValue,
            FontSize = ValueFontSize,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (row.Mono && TypographyTokens.Mono is { } mono)
        {
            value.FontFamily = mono;
        }

        right.Children.Add(value);
        if (row.HasBadge)
        {
            right.Children.Add(new TsBadge { Status = row.BadgeStatus, Content = row.BadgeText });
        }

        Grid.SetColumn(right, 1);

        grid.Children.Add(label);
        grid.Children.Add(right);

        // The row is non-interactive; the composed name lets Narrator announce label + value (+ chip) together.
        AutomationProperties.SetName(grid, row.AutomationName);

        if (!row.ShowDivider)
        {
            return grid;
        }

        // web: border-b border-white/[0.06] between rows — a bottom hairline drawn from the border token.
        return new Border
        {
            Child = grid,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
    }
}
