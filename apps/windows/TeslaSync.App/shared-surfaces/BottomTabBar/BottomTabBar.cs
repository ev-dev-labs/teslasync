using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>BottomTabBar</c> shared surface — a parity port of the web <c>BottomTabBar</c>
/// (web/src/components/layout/BottomTabBar.tsx), the mobile bottom navigation rail a Tesla owner reaches
/// for from their phone: Dashboard → Drives → Charging → Battery → Map. Like the web source it lays the
/// five fixed destinations out evenly across a single quiet, translucent (Fluent glass) bar with a
/// hairline top border, each tab a vertically-stacked Segoe Fluent glyph over a micro label. The active
/// tab — the one whose route the current path resolves to — is lit in the theme accent, carries the
/// <c>aria-current="page"</c> status and shows a short accent pill beneath it (the web active underline),
/// while inactive tabs stay muted. It binds the <see cref="BottomTabBarViewModel"/> over the shared
/// active-location seam (P1/S8) and the i18n facade (P1/S10); the view performs no router or storage I/O,
/// reads every label from the projection, exposes the navigation landmark + a Narrator name on every tab,
/// and emits the <c>view.opened</c> diagnostic once when shown.
///
/// <para>
/// State coverage: the web source is presentational — its destinations are a frozen module constant and
/// its only hooks are <c>useLocation</c> and <c>useTranslation</c>, so it performs no data fetch and
/// therefore has no loading / error / stale / offline chrome to reproduce. The states it actually renders
/// are reproduced in full: every tab in both its active and inactive form (accent vs muted foreground, the
/// active accent pill, the <c>aria-current</c> status). A defensive empty state is also rendered if the
/// surface is ever handed an empty catalogue, so the bar is never a blank box. The surface honours the
/// system font scale (it sizes from text, not a fixed height) and animates nothing beyond the Fluent
/// button's built-in states, so reduced-motion needs no special handling.
/// </para>
/// </summary>
public sealed partial class BottomTabBar : ContentControl, IDisposable
{
    private const double IconSize = 20;        // web h-5 w-5 active/inactive glyph.
    private const double LabelFontSize = 10;   // web text-[10px] font-medium tab label.
    private const double BarMinHeight = 56;     // web h-14 bar; MinHeight so large font scales can grow it.
    private const double TabMinWidth = 48;      // web min-w-[48px] touch target.
    private const double TabMinHeight = 44;     // web min-h-[44px] touch target.
    private const double PillWidth = 16;        // web w-4 active underline pill.
    private const double PillHeight = 2;        // web h-0.5 active underline pill.
    private const double StackSpacing = 2;      // web gap-0.5 between glyph and label.

    private readonly BottomTabBarViewModel _viewModel;
    private readonly BottomTabBarDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly Border _bar = new();

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over the passthrough localizer, the default tab catalogue and an
    /// in-memory location seam — the native analogue of mounting the web component in an isolated gallery
    /// host. Production callers use the seam constructor.
    /// </summary>
    public BottomTabBar()
        : this(PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its i18n facade, the tab catalogue, the shared location seam (P1/S8) and an activation callback.</summary>
    /// <param name="localizer">The i18n facade resolving every surface-owned label (web <c>useTranslation</c>, P1/S10).</param>
    /// <param name="tabs">The tab catalogue (web <c>TABS</c>); defaults to <see cref="BottomTabBarCatalog.Default"/>.</param>
    /// <param name="location">The active-location seam (web <c>useLocation</c>, P1/S8); defaults to an in-memory source at "/".</param>
    /// <param name="onTabActivated">The tab-activation callback (web <c>PrefetchLink</c> click); the host navigates to the route.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public BottomTabBar(
        ILocalizer localizer,
        IReadOnlyList<BottomTab>? tabs = null,
        INavLocationSource? location = null,
        Action<string>? onTabActivated = null,
        BottomTabBarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new BottomTabBarDiagnostics();
        _viewModel = new BottomTabBarViewModel(localizer, tabs, location);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        if (onTabActivated is not null)
        {
            _viewModel.TabActivated += (_, to) => onTabActivated(to);
        }

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Bottom;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>BottomTabBar</c>).</summary>
    public static string Slug => BottomTabBarRegistration.Slug;

    /// <summary>The shared state holder — the host drives the active path and language through it and listens for tab activation.</summary>
    public BottomTabBarViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade resolving every surface-owned label.</param>
    /// <param name="location">The active-location seam (web <c>useLocation</c>).</param>
    /// <param name="onTabActivated">The tab-activation callback (web <c>PrefetchLink</c> click).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static BottomTabBar Create(
        ILocalizer localizer,
        INavLocationSource? location = null,
        Action<string>? onTabActivated = null,
        BottomTabBarDiagnostics? diagnostics = null) =>
        new(localizer, tabs: null, location, onTabActivated, diagnostics);

    private void BuildChrome()
    {
        // web: bg-[var(--surface-overlay)] backdrop-blur-xl border-t border-white/[0.06] h-14 px-2.
        _bar.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _bar.BorderBrush = DisplayTokens.Border;
        _bar.BorderThickness = new Thickness(0, 1, 0, 0);
        _bar.Padding = new Thickness(8, 0, 8, 0);
        _bar.MinHeight = BarMinHeight;
        _bar.HorizontalAlignment = HorizontalAlignment.Stretch;

        // web: <nav aria-label="Quick navigation"> — expose the navigation landmark + its accessible name.
        AutomationProperties.SetLandmarkType(_bar, AutomationLandmarkType.Navigation);

        Content = _bar;
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

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model + lifecycle events and dispose the holder (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
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
        BottomTabBarDisplay display = _viewModel.Display;

        AutomationProperties.SetName(_bar, display.NavAutomationName);
        _bar.Child = display.IsEmpty ? BuildEmptyState(display) : BuildTabs(display);
    }

    private Grid BuildTabs(BottomTabBarDisplay display)
    {
        var grid = new Grid
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };

        for (int i = 0; i < display.Tabs.Count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            TsButton tab = BuildTab(display.Tabs[i]);
            Grid.SetColumn(tab, i);
            grid.Children.Add(tab);
        }

        return grid;
    }

    private TsButton BuildTab(BottomTabDisplay tab)
    {
        // web: active text-[var(--theme-primary)] ; inactive text-[var(--text-muted)].
        Brush foreground = tab.IsActive ? DisplayTokens.Accent : DisplayTokens.TextMuted;

        var stack = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = StackSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = tab.Glyph,
            FontFamily = SymbolFont(),
            FontSize = IconSize,
            Foreground = foreground,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = tab.Label,
            FontSize = LabelFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = foreground,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };

        // web: active <span class="absolute -bottom-0.5 h-0.5 w-4 rounded-full bg-theme-primary">.
        // Always laid out (transparent when inactive) so the active/inactive swap never shifts the row.
        var pill = new Border
        {
            Width = PillWidth,
            Height = PillHeight,
            CornerRadius = new CornerRadius(PillHeight / 2),
            Background = tab.IsActive ? DisplayTokens.Accent : null,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        stack.Children.Add(glyph);
        stack.Children.Add(label);
        stack.Children.Add(pill);

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Content = stack,
            MinWidth = TabMinWidth,
            MinHeight = TabMinHeight,
            Padding = new Thickness(12, 6, 12, 6),
            Margin = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
        };

        // web: aria-label={t(tab.i18nKey, tab.fallback)} — the accessible name equals the visible label.
        AutomationProperties.SetName(button, tab.Label);
        if (tab.IsActive)
        {
            AutomationProperties.SetItemStatus(button, "current"); // web aria-current="page".
        }

        string to = tab.Path;
        button.Click += (_, _) => _viewModel.SelectTab(to);
        return button;
    }

    private static TsEmptyState BuildEmptyState(BottomTabBarDisplay display) => new()
    {
        IconGlyph = "\uE707",
        Title = display.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private static FontFamily SymbolFont() =>
        Application.Current?.Resources is { } res
        && res.TryGetValue("SymbolThemeFontFamily", out object? value)
        && value is FontFamily family
            ? family
            : new FontFamily("Segoe Fluent Icons");
}
