using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The native WinUI 3 <c>WidgetTipCards</c> primitive — a parity port of the shared web building block
/// web/src/features/dashboard/widgets/shared/WidgetTipCards.tsx. A consuming dashboard widget feeds it a
/// list of <see cref="TipItem"/> plus the footprint hints (<see cref="MaxTips"/> / <see cref="Compact"/>)
/// and it renders one of the web component's two branches: the friendly empty surface (web
/// <c>visible.length === 0</c> → <c>EmptyState</c>) or the capped, scrollable column of tip cards
/// (icon + title + optional impact chip + description, with the description clamped to two lines in
/// compact mode). It is purely presentational — it performs no HTTP and holds no async/freshness state
/// (the web source has none either) — so a consuming widget owns the data lifecycle and passes resolved
/// tips in. Every string flows through the <see cref="ILocalizer"/> facade and every card carries a
/// Narrator name; with no animation the surface is inherently reduced-motion safe and its text honours
/// the system font scale.
/// </summary>
public sealed partial class WidgetTipCards : ContentControl
{
    /// <summary>Segoe Fluent — Lightbulb, the default empty glyph (web <c>emptyIcon</c> fallback).</summary>
    private const string DefaultEmptyGlyph = "\uEA80";

    private readonly ILocalizer _localizer;
    private readonly WidgetTipCardsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private IReadOnlyList<TipItem> _tips = Array.Empty<TipItem>();
    private int? _maxTips;
    private bool _compact;
    private string? _emptyMessage;
    private string? _emptyGlyph;

    private bool _opened;
    private bool _renderQueued;

    /// <summary>Creates the primitive over its localizer and (optional) PII-safe diagnostics sink.</summary>
    public WidgetTipCards(ILocalizer localizer, WidgetTipCardsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new WidgetTipCardsDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetAutomationControlType(this, AutomationControlType.List);

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The recommendations to render (web <c>tips</c>); a null assignment clears the list.</summary>
    public IReadOnlyList<TipItem> Tips
    {
        get => _tips;
        set
        {
            _tips = value ?? Array.Empty<TipItem>();
            ScheduleRender();
        }
    }

    /// <summary>Optional explicit cap (web <c>maxTips</c>); when null it defaults to <c>compact ? 1 : 3</c>.</summary>
    public int? MaxTips
    {
        get => _maxTips;
        set
        {
            _maxTips = value;
            ScheduleRender();
        }
    }

    /// <summary>Compact layout (web <c>compact</c>): a single tip by default and a two-line description clamp.</summary>
    public bool Compact
    {
        get => _compact;
        set
        {
            _compact = value;
            ScheduleRender();
        }
    }

    /// <summary>Localized empty copy (web <c>emptyMessage</c>); when null the localized default is used.</summary>
    public string? EmptyMessage
    {
        get => _emptyMessage;
        set
        {
            _emptyMessage = value;
            ScheduleRender();
        }
    }

    /// <summary>Optional Segoe Fluent glyph for the empty surface (web <c>emptyIcon</c>).</summary>
    public string? EmptyGlyph
    {
        get => _emptyGlyph;
        set
        {
            _emptyGlyph = value;
            ScheduleRender();
        }
    }

    /// <summary>Replace every input in one shot, projecting and rendering a single time.</summary>
    public void Update(
        IReadOnlyList<TipItem> tips,
        int? maxTips = null,
        bool compact = false,
        string? emptyMessage = null,
        string? emptyGlyph = null)
    {
        _tips = tips ?? Array.Empty<TipItem>();
        _maxTips = maxTips;
        _compact = compact;
        _emptyMessage = emptyMessage;
        _emptyGlyph = emptyGlyph;
        ScheduleRender();
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

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        var display = WidgetTipCardsProjection.Project(_tips, _localizer, _maxTips, _compact, _emptyMessage);
        Content = display.IsEmpty ? BuildEmpty(display) : BuildList(display);
    }

    private TsEmptyState BuildEmpty(WidgetTipCardsDisplay display) => new()
    {
        IconGlyph = string.IsNullOrEmpty(_emptyGlyph) ? DefaultEmptyGlyph : _emptyGlyph,
        Message = display.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private static ScrollViewer BuildList(WidgetTipCardsDisplay display)
    {
        var column = new StackPanel { Spacing = 8 };
        foreach (var card in display.Cards)
        {
            column.Children.Add(BuildCard(card));
        }

        return new ScrollViewer
        {
            Content = column,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private static Border BuildCard(TipCardProjection card)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        if (!string.IsNullOrEmpty(card.Glyph))
        {
            var icon = new FontIcon
            {
                Glyph = card.Glyph,
                FontSize = 14,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Top,
            };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            Grid.SetColumn(icon, 0);
            grid.Children.Add(icon);
        }

        var body = BuildBody(card);
        Grid.SetColumn(body, 1);
        grid.Children.Add(body);

        var border = new Border
        {
            Child = grid,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 10, 12, 10),
            MinHeight = 44,
        };
        AutomationProperties.SetName(border, card.AutomationName);
        return border;
    }

    private static StackPanel BuildBody(TipCardProjection card)
    {
        var titleRow = new Grid { ColumnSpacing = 8 };
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new TextBlock
        {
            Text = card.Title,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Top,
        };
        Grid.SetColumn(title, 0);
        titleRow.Children.Add(title);

        if (card.HasImpact)
        {
            var badge = new TsBadge
            {
                Status = card.ImpactStatus,
                Content = card.ImpactLabel,
                VerticalAlignment = VerticalAlignment.Top,
            };
            AutomationProperties.SetName(badge, card.ImpactLabel);
            Grid.SetColumn(badge, 1);
            titleRow.Children.Add(badge);
        }

        var description = new TextBlock
        {
            Text = card.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };
        if (card.Compact)
        {
            description.MaxLines = 2;
            description.TextTrimming = TextTrimming.CharacterEllipsis;
        }

        var body = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(titleRow);
        if (!string.IsNullOrEmpty(card.Description))
        {
            body.Children.Add(description);
        }

        return body;
    }
}
