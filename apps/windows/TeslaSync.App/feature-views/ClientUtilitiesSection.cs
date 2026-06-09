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
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.ClientUtilities;

/// <summary>
/// The expand-time content seam for a client-utility tool (the web <c>&lt;tool.Component /&gt;</c>). Each tool
/// body — VIN decoder, JWT decoder, … — is its own native surface (W-0011…W-0025); the host wires those
/// surfaces to this factory so an expanded card shows the real interactive tool. When the factory returns
/// <c>null</c> (a tool whose body surface is not wired into this host) the card falls back to an accessible
/// summary of the tool, never a blank region.
/// </summary>
public interface IClientUtilityToolContentFactory
{
    /// <summary>Create the interactive body for <paramref name="toolId"/>, or <c>null</c> to use the summary fallback.</summary>
    /// <param name="toolId">The stable tool id whose body is requested.</param>
    FrameworkElement? Create(string toolId);
}

/// <summary>
/// The native WinUI 3 Client Utilities surface — a parity port of
/// web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx. It reproduces the web's searchable
/// grid of developer utilities: a search field filters the fifteen-tool registry by localized name or
/// description, and each match renders as an accent-tinted disclosure card (a shared <see cref="TsAccordion"/>
/// — the native Fluent <c>Expander</c> mapping of the web GlassPanel + ghost-button + ChevronDown card) whose
/// header carries the tool's Segoe Fluent glyph, name and description and whose body hosts the tool surface.
/// Only one card is open at a time (the web <c>expandedId</c> single-open semantics). When the search matches
/// nothing a friendly empty surface renders, never a blank panel (the web <c>filtered.length === 0</c>
/// branch). The surface is presentational: it has no data source and no asynchronous reads, so it renders the
/// grid directly (the web's single visual state). All projection flows through the shared
/// <see cref="ClientUtilitiesViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade, the search field and every card carry a Narrator name, the disclosure announces its
/// expanded / collapsed state through the Fluent <c>Expander</c> automation, and the surface adds no custom
/// motion (the expander animation is system-driven, so the reduced-motion setting is honoured by
/// construction).
/// </summary>
public sealed partial class ClientUtilitiesSection : ContentControl, IDisposable
{
    private const double MaxSearchWidth = 420;          // web max-w-md
    private const double MediumBreakpoint = 768;        // web md: -> 2 columns
    private const double LargeBreakpoint = 1024;        // web lg: -> 3 columns

    private readonly ClientUtilitiesViewModel _viewModel;
    private readonly ClientUtilitiesDiagnostics _diagnostics;
    private readonly IClientUtilityToolContentFactory? _contentFactory;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsInput _search;
    private readonly Border _contentHost;
    private readonly List<(string Id, TsAccordion Card)> _cards = new();

    private int _columns = 1;
    private bool _suppressDisclosureEvents;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its tool source, localizer, optional tool-body factory and diagnostics.</summary>
    /// <param name="source">The client-utility entry source (the canonical catalog).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="contentFactory">Optional seam that supplies each tool's interactive body surface.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public ClientUtilitiesSection(
        IClientUtilityToolSource source,
        ILocalizer localizer,
        IClientUtilityToolContentFactory? contentFactory = null,
        ClientUtilitiesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _contentFactory = contentFactory;
        _diagnostics = diagnostics ?? new ClientUtilitiesDiagnostics();
        _viewModel = new ClientUtilitiesViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        _search = new TsInput
        {
            Hint = _viewModel.SearchHint,
            MaxWidth = MaxSearchWidth,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(_search, _viewModel.SearchHint);
        _search.TextChanged += OnSearchTextChanged;

        _contentHost = new Border { HorizontalAlignment = HorizontalAlignment.Stretch };

        var root = new StackPanel { Spacing = 16 };
        root.Children.Add(_search);
        root.Children.Add(_contentHost);
        Content = root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>client-utilities</c>).</summary>
    public static string RegistryId => ClientUtilitiesRegistration.Id;

    /// <summary>
    /// Convenience factory that wires the canonical <see cref="ClientUtilityToolSource"/> (the web
    /// <c>useToolList</c> catalog) over the host's localizer.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="contentFactory">Optional seam that supplies each tool's interactive body surface.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static ClientUtilitiesSection Create(
        ILocalizer localizer,
        IClientUtilityToolContentFactory? contentFactory = null,
        ClientUtilitiesDiagnostics? diagnostics = null) =>
        new(new ClientUtilityToolSource(), localizer, contentFactory, diagnostics);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and the search field (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _search.TextChanged -= OnSearchTextChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        SizeChanged -= OnSizeChanged;
        GC.SuppressFinalize(this);
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e) =>
        _viewModel.SearchText = _search.Text;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(ClientUtilitiesViewModel.Display) or nameof(ClientUtilitiesViewModel.State))
        {
            ScheduleRender();
        }
    }

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int columns = ColumnsForWidth(e.NewSize.Width);
        if (columns != _columns)
        {
            _columns = columns;
            if (_viewModel.State == ClientUtilityToolState.Ready)
            {
                ScheduleRender();
            }
        }
    }

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
        _cards.Clear();
        _contentHost.Child = _viewModel.State == ClientUtilityToolState.Empty ? BuildEmpty() : BuildGrid();
    }

    private Grid BuildGrid()
    {
        var cards = _viewModel.Display.Cards;
        int columns = Math.Max(1, _columns);
        int count = cards.Count;
        int rows = (count + columns - 1) / columns;

        var grid = new Grid
        {
            ColumnSpacing = 16,
            RowSpacing = 16,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };

        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < count; i++)
        {
            var card = BuildCard(cards[i]);
            Grid.SetColumn(card, i % columns);
            Grid.SetRow(card, i / columns);
            grid.Children.Add(card);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private TsAccordion BuildCard(ClientUtilityToolCard card)
    {
        var accordion = new TsAccordion
        {
            Header = BuildHeader(card),
            Content = BuildBody(card),
            IsExpanded = _viewModel.IsExpanded(card.Id),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(accordion, card.AutomationName);

        string id = card.Id;
        accordion.Expanding += (_, _) => OnCardExpanding(id);
        accordion.Collapsed += (_, _) => OnCardCollapsed(id);

        _cards.Add((id, accordion));
        return accordion;
    }

    private static Grid BuildHeader(ClientUtilityToolCard card)
    {
        var iconChip = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = AccentChip(card.AccentBrushKey),
            Width = 40,
            Height = 40,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = card.Glyph,
                FontSize = 18,
                Foreground = DisplayTokens.Brush(card.AccentBrushKey),
            },
        };
        AutomationProperties.SetAccessibilityView(iconChip, AccessibilityView.Raw);

        var name = new TextBlock
        {
            Text = card.Name,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var description = new TextBlock
        {
            Text = card.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var texts = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        texts.Children.Add(name);
        texts.Children.Add(description);

        var header = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(iconChip, 0);
        Grid.SetColumn(texts, 1);
        header.Children.Add(iconChip);
        header.Children.Add(texts);
        return header;
    }

    private FrameworkElement BuildBody(ClientUtilityToolCard card)
    {
        var body = _contentFactory?.Create(card.Id);
        if (body is not null)
        {
            return body;
        }

        var description = new TextBlock
        {
            Text = card.Description,
            FontSize = 13,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var hint = new TextBlock
        {
            Text = _localizer.GetString(
                "devtools.toolOpensHere",
                "This utility runs offline on this device."),
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
        };

        var panel = new StackPanel { Spacing = 8 };
        panel.Children.Add(description);
        panel.Children.Add(hint);
        AutomationProperties.SetName(panel, card.AutomationName);
        return panel;
    }

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            Message = _viewModel.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return empty;
    }

    private void OnCardExpanding(string id)
    {
        if (_suppressDisclosureEvents)
        {
            return;
        }

        _suppressDisclosureEvents = true;
        try
        {
            _viewModel.SetExpanded(id, true);
            foreach (var (cardId, card) in _cards)
            {
                if (!string.Equals(cardId, id, StringComparison.Ordinal) && card.IsExpanded)
                {
                    card.IsExpanded = false;
                }
            }
        }
        finally
        {
            _suppressDisclosureEvents = false;
        }
    }

    private void OnCardCollapsed(string id)
    {
        if (_suppressDisclosureEvents)
        {
            return;
        }

        _viewModel.SetExpanded(id, false);
    }

    private static int ColumnsForWidth(double width) =>
        width >= LargeBreakpoint ? 3 : width >= MediumBreakpoint ? 2 : 1;

    private static Brush AccentChip(string accentBrushKey)
    {
        var brush = DisplayTokens.Brush(accentBrushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = 0.12 }
            : brush;
    }
}
