using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// The native WinUI 3 <c>globalShortcuts</c> misc surface — a parity port of web/src/lib/globalShortcuts.tsx.
/// The web source is a registry seeder that renders <c>null</c>: mounted once from the layout it pours the four
/// universal app keys (<c>Ctrl+K</c> / <c>/</c> / <c>?</c> / <c>Esc</c>), the <c>GOTO_SHORTCUTS</c> g+letter
/// navigation table and every <c>commandRegistry</c> entry that declares a shortcut into the shared shortcut
/// registry, grouped Actions / Navigation / Commands. This native surface reproduces that seeding faithfully —
/// on <see cref="FrameworkElement.Loaded"/> it registers the definitions into the bound
/// <see cref="IShortcutRegistry"/> (the same registry the <c>KeyboardShortcutsModal</c> cheatsheet reads) and on
/// <see cref="FrameworkElement.Unloaded"/> it unregisters them — and, because a render-nothing control would be
/// indistinguishable from a stub, it also renders the global shortcuts it owns as a tangible, accessible inline
/// reference panel: a title followed by one section per group, each a description and its key combination drawn
/// as <c>kbd</c> chips, ordered through the shared <see cref="ShortcutProjection"/> so it matches the cheatsheet
/// exactly. Because the web source composes no asynchronous read (only <c>useTranslation</c> + the synchronous
/// registry), there is deliberately no loading / error / stale / offline chrome (the same shape as the sibling
/// <c>KeyboardShortcutsModal</c> / <c>TourLauncher</c> surfaces); the only states are the populated grouped list
/// and a defensive empty surface (the catalogue produced nothing — never a blank box). All state + label
/// resolution flows through the shared <see cref="GlobalShortcutsViewModel"/> / <see cref="GlobalShortcutsDisplay"/>;
/// the view never performs HTTP or storage. Every string resolves through the i18n facade, every shortcut row
/// carries a Narrator name, text honors the system font scale and the panel uses no entrance motion so the
/// OS reduce-motion setting is honored.
/// </summary>
public sealed partial class GlobalShortcuts : ContentControl, IDisposable
{
    private const double RootSpacing = 16;        // gap between the title and the groups host
    private const double GroupSpacing = 24;       // web space-y-6 between groups (matches the cheatsheet)
    private const double GroupContentSpacing = 12; // gap between a group's title and its rows
    private const double RowSpacing = 6;           // web space-y-1.5 between rows (matches the cheatsheet)
    private const double RowColumnSpacing = 12;    // gap between the description and the key chips
    private const double KeySpacing = 4;           // gap between key chips / the "+" connector
    private const double KeyChipMinWidth = 24;     // web min-w-[24px]
    private const double ContentMinWidth = 360;    // keep rows readable
    private const double KeyChipFontSize = 12;     // web kbd chip size

    private readonly GlobalShortcutsViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = RootSpacing, MinWidth = ContentMinWidth };
    private readonly StackPanel _groupsHost = new() { Spacing = GroupSpacing };
    private readonly Heading _title = new();

    private bool _disposed;

    /// <summary>Creates the surface over its i18n facade, the shared shortcut registry and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="registry">The shared shortcut registry the surface seeds (web <c>useShortcut</c> seam).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public GlobalShortcuts(
        ILocalizer localizer,
        IShortcutRegistry registry,
        GlobalShortcutsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(registry);

        _viewModel = new GlobalShortcutsViewModel(localizer, registry, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _root.Children.Add(_title);
        _root.Children.Add(_groupsHost);
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Rebuild();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>globalShortcuts</c>).</summary>
    public static string Slug => GlobalShortcutsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public GlobalShortcutsViewModel ViewModel => _viewModel;

    private void OnLoaded(object sender, RoutedEventArgs e) => _viewModel.Activate();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(GlobalShortcutsViewModel.Display))
        {
            Marshal(Rebuild);
        }
    }

    private void Rebuild()
    {
        GlobalShortcutsDisplay display = _viewModel.Display;
        AutomationProperties.SetName(this, display.AutomationName);

        _title.Value = display.Title;
        _groupsHost.Children.Clear();

        if (display.State == GlobalShortcutsState.Empty)
        {
            _groupsHost.Children.Add(new TsEmptyState { Message = display.EmptyMessage });
            return;
        }

        foreach (ShortcutGroup group in display.Groups)
        {
            _groupsHost.Children.Add(BuildGroup(group));
        }
    }

    private static StackPanel BuildGroup(ShortcutGroup group)
    {
        var section = new StackPanel { Spacing = GroupContentSpacing };
        section.Children.Add(new SectionTitle { Value = group.Title });

        var rows = new StackPanel { Spacing = RowSpacing };
        foreach (ShortcutDefinition shortcut in group.Shortcuts)
        {
            rows.Children.Add(BuildRow(shortcut));
        }

        section.Children.Add(rows);
        return section;
    }

    private static Grid BuildRow(ShortcutDefinition shortcut)
    {
        var grid = new Grid { ColumnSpacing = RowColumnSpacing, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var description = new Text
        {
            Value = shortcut.Description,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(description, 0);
        grid.Children.Add(description);

        StackPanel keys = BuildKeys(shortcut.Keys);
        Grid.SetColumn(keys, 1);
        grid.Children.Add(keys);

        AutomationProperties.SetName(grid, shortcut.AccessibleName);
        return grid;
    }

    private static StackPanel BuildKeys(IReadOnlyList<string> keys)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = KeySpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        for (int i = 0; i < keys.Count; i++)
        {
            if (i > 0)
            {
                row.Children.Add(new Caption
                {
                    Value = "+",
                    Foreground = DisplayTokens.TextMuted,
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }

            row.Children.Add(BuildKeyChip(keys[i]));
        }

        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    private static Border BuildKeyChip(string token)
    {
        var label = new TextBlock
        {
            Text = token,
            FontFamily = new FontFamily("Consolas"),
            FontSize = KeyChipFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            MinWidth = KeyChipMinWidth,
        };

        return new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 4),
            Padding = new Thickness(8, 1, 8, 1),
            Child = label,
        };
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    /// <summary>Unregister the seeded definitions, detach from the view-model and stop responding (idempotent).</summary>
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

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new GlobalShortcutsAutomationPeer(this);

    private sealed class GlobalShortcutsAutomationPeer(GlobalShortcuts owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((GlobalShortcuts)Owner)._viewModel.Display.Title : name;
        }
    }
}
