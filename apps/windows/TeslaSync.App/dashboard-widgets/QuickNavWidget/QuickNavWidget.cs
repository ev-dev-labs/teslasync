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
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The native WinUI 3 Quick Navigation dashboard surface — a parity port of
/// web/src/features/dashboard/widgets/QuickNavWidget.tsx, which wraps the presentational
/// web/src/features/dashboard/components/QuickNav.tsx. It reproduces the web's responsive grid of
/// navigation tiles (Drives, Charging, Analytics, Battery): each tile is a shared <see cref="TsButton"/>
/// (subtle) carrying the destination's accent-tinted Segoe Fluent glyph in a faint accent chip, the
/// localized title and description, and a trailing chevron — activating it navigates the shell to that
/// page through the injected <see cref="IQuickNavNavigator"/> (the web react-router <c>Link</c>). The
/// surface is presentational: it has no data source and no asynchronous reads, so it renders the tile
/// grid directly (the web's single visual state); a friendly empty surface renders in the defensive case
/// where no tiles resolve, never a blank panel. All projection flows through the shared
/// <see cref="QuickNavViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade, every tile carries a Narrator name, and the surface adds no custom motion (button visual
/// states are system-driven, so the reduced-motion setting is honoured by construction).
/// </summary>
public sealed partial class QuickNavWidget : ContentControl, IDisposable
{
    private readonly QuickNavViewModel _viewModel;
    private readonly QuickNavDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its item source, navigator, localizer, footprint and diagnostics.</summary>
    public QuickNavWidget(
        IQuickNavItemSource source,
        IQuickNavNavigator navigator,
        ILocalizer localizer,
        QuickNavSize size,
        QuickNavDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new QuickNavDiagnostics();
        _viewModel = new QuickNavViewModel(source, navigator, localizer, size);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical registry id this surface registers under (<c>quick-nav</c>).</summary>
    public static string RegistryId => QuickNavRegistration.Id;

    /// <summary>The widget footprint; reassigning re-projects the surface for the new layout.</summary>
    public QuickNavSize WidgetSize
    {
        get => _viewModel.Size;
        set => _viewModel.Size = value;
    }

    /// <summary>
    /// Convenience factory that wires the canonical <see cref="QuickNavItemSource"/> (the web
    /// <c>NAV_ITEMS</c> catalog) over the host's navigator and localizer.
    /// </summary>
    public static QuickNavWidget Create(
        IQuickNavNavigator navigator,
        ILocalizer localizer,
        QuickNavSize? size = null,
        QuickNavDiagnostics? diagnostics = null) =>
        new(new QuickNavItemSource(), navigator, localizer, size ?? QuickNavRegistration.DefaultSize, diagnostics);

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

    /// <summary>Detach from the view-model (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

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
        Content = _viewModel.State == QuickNavState.Empty ? BuildEmpty() : BuildGrid();
    }

    private Grid BuildGrid()
    {
        var display = _viewModel.Display;
        int columns = Math.Max(1, display.Columns);
        int count = display.Tiles.Count;
        int rows = (count + columns - 1) / columns;

        var grid = new Grid
        {
            ColumnSpacing = 12,
            RowSpacing = 12,
            Padding = new Thickness(12),
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Stretch,
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
            var tile = BuildTile(display.Tiles[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private TsButton BuildTile(QuickNavTile tile)
    {
        var iconChip = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = AccentChip(tile.AccentBrushKey),
            Padding = new Thickness(8),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = tile.Glyph,
                FontSize = 18,
                Foreground = DisplayTokens.Brush(tile.AccentBrushKey),
            },
        };
        AutomationProperties.SetAccessibilityView(iconChip, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = tile.Label,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var description = new TextBlock
        {
            Text = tile.Description,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var texts = new StackPanel
        {
            Spacing = 2,
            VerticalAlignment = VerticalAlignment.Center,
        };
        texts.Children.Add(label);
        texts.Children.Add(description);

        var chevron = new FontIcon
        {
            Glyph = QuickNavProjection.ChevronGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        var content = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(iconChip, 0);
        Grid.SetColumn(texts, 1);
        Grid.SetColumn(chevron, 2);
        content.Children.Add(iconChip);
        content.Children.Add(texts);
        content.Children.Add(chevron);

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Medium,
            Content = content,
            Padding = new Thickness(12),
            MinHeight = 56,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        AutomationProperties.SetName(button, tile.AutomationName);

        string routeName = tile.RouteName;
        button.Click += (_, _) => _viewModel.Navigate(routeName);
        return button;
    }

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            IconGlyph = QuickNavProjection.ChevronGlyph,
            Message = _viewModel.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        };
        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return empty;
    }

    private static Brush AccentChip(string accentBrushKey)
    {
        var brush = DisplayTokens.Brush(accentBrushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = 0.12 }
            : brush;
    }
}
