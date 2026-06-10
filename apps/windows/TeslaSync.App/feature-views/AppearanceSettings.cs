using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.UI.Dispatching;
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
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.Repositories;
using TeslaSync.App.Core.Notifications;
using Windows.Storage;
using Windows.UI;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Appearance settings surface — a parity port of
/// web/src/features/settings/components/AppearanceSettings.tsx. It reproduces the web component's eight
/// sections inside one glass panel: the theme picker, the server-driven information-density picker (with its
/// live preview), the per-device sidebar-style picker, the default time-format picker, the chart-palette
/// picker (with palette swatches), the footer status-bar toggles, the achievement-celebration toggles and the
/// product-tour actions. Because the native surface binds its own cache-then-network
/// <see cref="AppearanceSettingsViewModel"/>, it renders every state the P2 contract requires — the skeleton
/// while loading, a retry surface on a hard failure, and the full form otherwise (with a stale / offline chip
/// in the header). The three server preferences save through the web full-replace pattern; the local
/// preferences (sidebar, status bar, celebration) persist instantly to <c>ApplicationData.LocalSettings</c>
/// through <see cref="LocalSettingsAppearancePreferences"/>. The view never performs HTTP. Every string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class AppearanceSettings : ContentControl, IDisposable
{
    private const double PanelPadding = 24;          // web GlassPanel p-6
    private const double SectionSpacing = 24;        // web space-y-6
    private const double SkeletonBlockHeight = 64;

    // Segoe Fluent section glyphs (decorative — AccessibilityView.Raw — standing in for the web Lucide icons).
    private const string PaletteGlyph = "\uE790";    // Color (web Palette)
    private const string DensityGlyph = "\uE71D";    // List (web Rows3)
    private const string SidebarGlyph = "\uE700";    // GlobalNavButton (web Sidebar)
    private const string ClockGlyph = "\uE121";      // Clock (web Clock)
    private const string EyeGlyph = "\uE7B3";        // View (web Eye)
    private const string StatusBarGlyph = "\uE90E";  // DockBottom (web PanelBottom)
    private const string TrophyGlyph = "\uE735";     // FavoriteStar (web Trophy)
    private const string ToursGlyph = "\uE768";      // Play (web PlayCircle)
    private const string PlayGlyph = "\uE768";       // Play (web PlayCircle, on the replay button)
    private const string ResetGlyph = "\uE72C";      // Refresh (web RotateCcw)

    private readonly AppearanceSettingsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly AppearanceSettingsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Informational,
        Margin = new Thickness(0, 0, 0, 12),
    };

    private readonly TsFadeIn _fade = new();

    private bool _started;
    private bool _renderQueued;
    private bool _building;
    private bool _disposed;

    /// <summary>Creates the surface over its server-settings source, local-preference store and localizer.</summary>
    /// <param name="source">The cache-then-network server-settings source (read + full-replace save).</param>
    /// <param name="preferences">The per-device local-preference store (sidebar / status bar / celebration).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AppearanceSettings(
        IAppearanceSettingsSource source,
        IAppearanceLocalPreferences preferences,
        ILocalizer localizer,
        AppearanceSettingsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(preferences);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AppearanceSettingsDiagnostics();
        _viewModel = new AppearanceSettingsViewModel(source, preferences, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        var root = new StackPanel { Spacing = 0 };
        root.Children.Add(_toast);
        root.Children.Add(_fade);
        Content = root;
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>appearance-settings</c>).</summary>
    public static string SurfaceId => AppearanceSettingsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public AppearanceSettingsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="AppearanceSettingsSource"/> from the
    /// shared data layer (the host's P2-core dependencies) and the durable
    /// <see cref="LocalSettingsAppearancePreferences"/> for the per-device preferences, unless an explicit
    /// preference store is supplied.
    /// </summary>
    /// <param name="settings">The shared cache-then-network settings repository.</param>
    /// <param name="api">The generated contract client (for the full-replace save).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="preferences">Optional override for the local-preference store (durable by default).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public static AppearanceSettings Create(
        ISettingsRepository settings,
        IApiClient api,
        ILocalizer localizer,
        IAppearanceLocalPreferences? preferences = null,
        AppearanceSettingsDiagnostics? diagnostics = null)
    {
        var source = new AppearanceSettingsSource(settings, api);
        return new AppearanceSettings(source, preferences ?? new LocalSettingsAppearancePreferences(), localizer, diagnostics);
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
        _viewModel.ToastRequested -= OnToastRequested;
        _viewModel.Dispose();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnToastRequested(object? sender, string message)
    {
        _toast.Title = message;
        _toast.Message = string.Empty;
        _toast.IsOpen = !string.IsNullOrEmpty(message);
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
        _building = true;
        try
        {
            var display = _viewModel.Display;
            AutomationProperties.SetName(this, display.AutomationName);

            _fade.Content = _viewModel.State switch
            {
                AppearanceSettingsState.Loading => BuildLoading(),
                AppearanceSettingsState.Error => BuildError(),
                _ => BuildContent(display),
            };
        }
        finally
        {
            _building = false;
        }
    }

    // ── Loading (skeleton chrome) ────────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading()
    {
        var content = new StackPanel { Spacing = SectionSpacing };
        content.Children.Add(new TsSkeleton { BlockHeight = 48, ReduceMotion = MotionPreference.ReduceMotion });
        for (int i = 0; i < 4; i++)
        {
            content.Children.Add(new TsSkeleton { BlockHeight = SkeletonBlockHeight, ReduceMotion = MotionPreference.ReduceMotion });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        LiveRegion.Configure(content);
        LiveRegion.Announce(content);
        AutomationProperties.SetName(panel, _localizer.GetString("common.loading", "Loading..."));
        return panel;
    }

    // ── Error surface (web QueryError) ───────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.Title,
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("theme.error", "Couldn't load appearance settings"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Content (Loaded / Empty / Stale / Offline): the full eight-section form ───────────────────────────

    private TsGlassPanel BuildContent(AppearanceSettingsDisplay display)
    {
        var sections = new StackPanel { Spacing = SectionSpacing };
        sections.Children.Add(BuildHeader(display));
        sections.Children.Add(BuildThemeSection(display.Theme));
        sections.Children.Add(BuildDensitySection(display.Density, display.ServerControlsEnabled));
        sections.Children.Add(BuildSidebarSection(display.Sidebar));
        sections.Children.Add(BuildTimeFormatSection(display.TimeFormat, display.ServerControlsEnabled));
        sections.Children.Add(BuildChartPaletteSection(display.ChartPalette, display.ServerControlsEnabled));
        sections.Children.Add(BuildStatusBarSection(display.StatusBar));
        sections.Children.Add(BuildCelebrationSection(display.Celebration));
        sections.Children.Add(BuildToursSection(display.Tours));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = sections };
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    private Grid BuildHeader(AppearanceSettingsDisplay display)
    {
        var iconChip = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = AccentTint("TsChartPowerBrush"),
            Width = 40,
            Height = 40,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = PaletteGlyph,
                FontSize = 18,
                Foreground = DisplayTokens.Brush("TsChartPowerBrush"),
            },
        };
        AutomationProperties.SetAccessibilityView(iconChip, AccessibilityView.Raw);

        var titles = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(new PanelTitle { Value = display.Title });
        titles.Children.Add(new Caption { Value = display.Subtitle });

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(iconChip);
        left.Children.Add(titles);

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        header.Children.Add(left);

        var actions = BuildHeaderActions();
        Grid.SetColumn(actions, 1);
        header.Children.Add(actions);
        return header;
    }

    private StackPanel BuildHeaderActions()
    {
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (_viewModel.State is AppearanceSettingsState.Stale or AppearanceSettingsState.Offline)
        {
            actions.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        actions.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching || _viewModel.IsSaving,
            IsError = _viewModel.State == AppearanceSettingsState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });
        return actions;
    }

    private TsBadge BuildFreshnessChip(AppearanceSettingsState state)
    {
        bool offline = state == AppearanceSettingsState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    // ── Theme picker (web shared ThemePicker showMode) ───────────────────────────────────────────────────

    private static StackPanel BuildThemeSection(ThemePickerLabels labels)
    {
        var picker = new TsThemePicker
        {
            SystemLabel = labels.System,
            LightLabel = labels.Light,
            DarkLabel = labels.Dark,
            HighContrastLabel = labels.HighContrast,
            AccessibleName = labels.Label,
            HorizontalAlignment = HorizontalAlignment.Left,
            MinWidth = 220,
        };

        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(BuildSectionHeader(PaletteGlyph, labels.Label, hint: null));
        section.Children.Add(picker);
        return section;
    }

    // ── Density (server-driven) + live preview ───────────────────────────────────────────────────────────

    private StackPanel BuildDensitySection(DensitySection model, bool enabled)
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(BuildSectionHeader(
            DensityGlyph, model.Label,
            _localizer.GetString("help.fields.settings.appearanceDensity",
                "Controls the spacing of table rows, cards and dashboard widgets across the app.")));

        var group = BuildRadioGroup(model.Label, model.Options.Count);
        int index = 0;
        foreach (var option in model.Options)
        {
            var card = OptionCard(DensitySwatch(option.Id), option.Label, option.Help);
            AddRadioCard(group, index++, "appearance.density", option.AutomationName, option.IsActive, enabled, card,
                () => _ = _viewModel.SetDensityAsync(option.Id));
        }

        section.Children.Add(group);
        section.Children.Add(new Caption { Value = model.Help });
        section.Children.Add(BuildDensityPreview(model));
        return section;
    }

    private static Border BuildDensityPreview(DensitySection model)
    {
        var rows = new StackPanel { Spacing = 0 };
        var headerRow = new Border
        {
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 8, 12, 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 0, 0, 1),
            Child = new Subhead { Value = model.PreviewTitle },
        };
        rows.Children.Add(headerRow);

        for (int i = 0; i < model.PreviewRows.Count; i++)
        {
            var rowText = new Text
            {
                Value = model.PreviewRows[i],
                VerticalAlignment = VerticalAlignment.Center,
            };
            var row = new Border
            {
                Padding = new Thickness(12, 8, 12, 8),
                BorderBrush = DisplayTokens.Border,
                BorderThickness = new Thickness(0, i == 0 ? 0 : 1, 0, 0),
                Child = rowText,
            };
            rows.Children.Add(row);
        }

        var container = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Child = rows,
        };
        AutomationProperties.SetName(container, model.PreviewTitle);
        return container;
    }

    // ── Sidebar style (local) ────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildSidebarSection(SidebarSection model)
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(BuildSectionHeader(SidebarGlyph, model.Label, hint: null));

        var group = BuildRadioGroup(model.Label, model.Options.Count);
        int index = 0;
        foreach (var option in model.Options)
        {
            var card = OptionCard(SidebarSwatch(option.Id), option.Label, option.Help);
            AddRadioCard(group, index++, "appearance.sidebar", option.AutomationName, option.IsActive, enabled: true, card,
                () => _viewModel.SetSidebarStyle(option.Id));
        }

        section.Children.Add(group);
        section.Children.Add(new Caption { Value = model.Help });
        return section;
    }

    // ── Time format (server-driven) ──────────────────────────────────────────────────────────────────────

    private StackPanel BuildTimeFormatSection(TimeFormatSection model, bool enabled)
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(BuildSectionHeader(
            ClockGlyph, model.Label,
            _localizer.GetString("help.fields.settings.timeFormat",
                "The default rendering for timestamps; hover any timestamp to see the alternate format.")));

        var group = BuildRadioGroup(model.Label, model.Options.Count);
        int index = 0;
        foreach (var option in model.Options)
        {
            var card = OptionCard(swatch: null, option.Label, option.Help);
            AddRadioCard(group, index++, "appearance.timeFormat", option.AutomationName, option.IsActive, enabled, card,
                () => _ = _viewModel.SetTimeFormatAsync(option.Id));
        }

        section.Children.Add(group);
        section.Children.Add(new Caption { Value = model.Help });
        return section;
    }

    // ── Chart palette (server-driven) + swatches ─────────────────────────────────────────────────────────

    private StackPanel BuildChartPaletteSection(ChartPaletteSection model, bool enabled)
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(BuildSectionHeader(
            EyeGlyph, model.Label,
            _localizer.GetString("help.fields.settings.chartPalette",
                "The colour palette charts use; the default stays distinguishable for colour-vision deficiency.")));

        var group = BuildRadioGroup(model.Label, model.Options.Count);
        int index = 0;
        foreach (var option in model.Options)
        {
            var texts = new StackPanel { Spacing = 4, MinWidth = 1 };
            texts.Children.Add(new Text { Value = option.Label });
            texts.Children.Add(new Caption { Value = option.Help });
            texts.Children.Add(BuildSwatchRow(option.Swatches));

            AddRadioCard(group, index++, "appearance.chartPalette", option.AutomationName, option.IsActive, enabled, texts,
                () => _ = _viewModel.SetChartPaletteAsync(option.Id));
        }

        section.Children.Add(group);
        section.Children.Add(new Caption { Value = model.Help });
        return section;
    }

    private static StackPanel BuildSwatchRow(IReadOnlyList<string> swatches)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            Margin = new Thickness(0, 4, 0, 0),
        };
        foreach (var hex in swatches)
        {
            row.Children.Add(new Border
            {
                Width = 12,
                Height = 12,
                CornerRadius = new CornerRadius(6),
                Background = SwatchBrush(hex),
                BorderBrush = DisplayTokens.Border,
                BorderThickness = new Thickness(1),
            });
        }

        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
        return row;
    }

    // ── Status bar (local) ───────────────────────────────────────────────────────────────────────────────

    private StackPanel BuildStatusBarSection(StatusBarSection model)
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(BuildSectionHeader(StatusBarGlyph, model.Label, hint: null));

        var rows = new StackPanel { Spacing = 0 };
        rows.Children.Add(BuildToggleRow(model.Show, divider: false, onChanged: _viewModel.SetStatusBarEnabled));
        rows.Children.Add(BuildToggleRow(model.IconOnly, divider: true, onChanged: _viewModel.SetStatusBarIconOnly));

        section.Children.Add(WrapPanel(rows));
        return section;
    }

    // ── Achievement celebrations (local) ─────────────────────────────────────────────────────────────────

    private StackPanel BuildCelebrationSection(CelebrationSection model)
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(BuildSectionHeader(TrophyGlyph, model.Label, hint: null));

        var rows = new StackPanel { Spacing = 0 };
        rows.Children.Add(BuildToggleRow(model.ShowToasts, divider: false, onChanged: _viewModel.SetCelebrationShowToasts));
        rows.Children.Add(BuildToggleRow(model.PlaySound, divider: true, onChanged: _viewModel.SetCelebrationPlaySound));
        rows.Children.Add(BuildToggleRow(model.ShowOnDashboard, divider: true, onChanged: _viewModel.SetCelebrationShowOnDashboard));
        rows.Children.Add(BuildToggleRow(model.PushOnUnlock, divider: true, onChanged: _viewModel.SetCelebrationPushOnUnlock));

        section.Children.Add(WrapPanel(rows));
        return section;
    }

    // ── Product tours (local actions) ────────────────────────────────────────────────────────────────────

    private StackPanel BuildToursSection(ToursSection model)
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(BuildSectionHeader(ToursGlyph, model.Label, hint: null));

        var inner = new StackPanel { Spacing = 12 };
        var heading = new StackPanel { Spacing = 2 };
        heading.Children.Add(new Text { Value = model.Title });
        heading.Children.Add(new Caption { Value = model.Body });
        inner.Children.Add(heading);

        var buttonRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        foreach (var button in model.Buttons)
        {
            buttonRow.Children.Add(BuildTourButton(button));
        }

        inner.Children.Add(buttonRow);
        section.Children.Add(WrapPanel(inner));
        return section;
    }

    private TsButton BuildTourButton(TourButton model)
    {
        var button = new TsButton
        {
            Variant = model.Variant,
            Text = model.Label,
            IconGlyph = string.IsNullOrEmpty(model.Glyph) ? null : model.Glyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, model.Label);
        var action = model.Action;
        button.Click += (_, _) =>
        {
            if (!_building)
            {
                _viewModel.InvokeTour(action);
            }
        };
        return button;
    }

    // ── Shared building blocks ───────────────────────────────────────────────────────────────────────────

    private static StackPanel BuildSectionHeader(string glyph, string label, string? hint)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);
        row.Children.Add(new Label { Value = label, VerticalAlignment = VerticalAlignment.Center });

        if (!string.IsNullOrEmpty(hint))
        {
            var help = new TsHelpTooltip { Hint = hint, VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetName(help, hint);
            row.Children.Add(help);
        }

        return row;
    }

    private static Grid BuildRadioGroup(string groupLabel, int columns)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        int safeColumns = Math.Max(1, columns);
        for (int c = 0; c < safeColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        AutomationProperties.SetName(grid, groupLabel);
        return grid;
    }

    private void AddRadioCard(
        Grid group,
        int column,
        string groupName,
        string automationName,
        bool isActive,
        bool enabled,
        UIElement card,
        Action onSelected)
    {
        var radio = new RadioButton
        {
            Content = card,
            IsChecked = isActive,
            IsEnabled = enabled,
            GroupName = groupName,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Center,
            MinWidth = 1,
        };
        AutomationProperties.SetName(radio, automationName);
        radio.Checked += (_, _) =>
        {
            if (!_building)
            {
                onSelected();
            }
        };

        Grid.SetColumn(radio, column);
        group.Children.Add(radio);
    }

    private static StackPanel OptionCard(UIElement? swatch, string label, string help)
    {
        var texts = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center, MinWidth = 1 };
        texts.Children.Add(new Text { Value = label });
        texts.Children.Add(new Caption { Value = help });

        if (swatch is null)
        {
            return texts;
        }

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(swatch);
        row.Children.Add(texts);
        return row;
    }

    private Border BuildToggleRow(AppearanceToggleRow model, bool divider, Action<bool> onChanged)
    {
        var texts = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center, MinWidth = 1 };
        var label = new Text { Value = model.Label };
        var help = new Caption { Value = model.Help };
        texts.Children.Add(label);
        texts.Children.Add(help);
        if (!model.IsEnabled)
        {
            texts.Opacity = 0.5;
        }

        var toggle = new TsToggle { IsOn = model.IsOn, IsEnabled = model.IsEnabled, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(toggle, model.AutomationName);
        toggle.Toggled += (s, _) =>
        {
            if (!_building && s is TsToggle t)
            {
                onChanged(t.IsOn);
            }
        };

        var grid = new Grid { VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(texts, 0);
        Grid.SetColumn(toggle, 1);
        grid.Children.Add(texts);
        grid.Children.Add(toggle);

        return new Border
        {
            Padding = new Thickness(0, divider ? 12 : 0, 0, divider ? 0 : 12),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, divider ? 1 : 0, 0, 0),
            Child = grid,
        };
    }

    private static Border WrapPanel(UIElement content) => new()
    {
        CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
        BorderBrush = DisplayTokens.Border,
        BorderThickness = new Thickness(1),
        Background = DisplayTokens.Surface,
        Padding = new Thickness(16),
        Child = content,
    };

    // ── Swatches (decorative silhouettes / palette chips) ────────────────────────────────────────────────

    private static Border DensitySwatch(DensityChoice density)
    {
        int bars = density switch
        {
            DensityChoice.Compact => 4,
            DensityChoice.Comfortable => 3,
            _ => 2,
        };
        double barHeight = density switch
        {
            DensityChoice.Compact => 2,
            DensityChoice.Comfortable => 3,
            _ => 5,
        };

        var stack = new StackPanel
        {
            Spacing = 2,
            Width = 32,
            Height = 32,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        for (int i = 0; i < bars; i++)
        {
            stack.Children.Add(new Border
            {
                Height = barHeight,
                Width = 18,
                CornerRadius = new CornerRadius(1),
                Background = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var chip = new Border
        {
            Width = 32,
            Height = 32,
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = stack,
        };
        AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);
        return chip;
    }

    private static Border SidebarSwatch(SidebarStyleChoice style)
    {
        var rows = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        int count = style == SidebarStyleChoice.Legacy ? 2 : 3;
        for (int i = 0; i < count; i++)
        {
            bool active = i == 1;
            var bar = new Border
            {
                Height = style == SidebarStyleChoice.Legacy ? 6 : 3,
                Width = active ? 18 : 14,
                CornerRadius = new CornerRadius(1),
                Background = active ? DisplayTokens.Accent : DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Left,
            };
            rows.Children.Add(bar);
        }

        var chip = new Border
        {
            Width = 28,
            Height = 36,
            Padding = new Thickness(5),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = rows,
        };
        AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);
        return chip;
    }

    // ── Token / colour helpers ───────────────────────────────────────────────────────────────────────────

    private static Brush AccentTint(string brushKey)
    {
        var brush = DisplayTokens.Brush(brushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = 0.12 }
            : brush;
    }

    private static Brush SwatchBrush(string hex)
    {
        if (TryParseHex(hex, out var color))
        {
            return new SolidColorBrush(color);
        }

        return DisplayTokens.Border;
    }

    private static bool TryParseHex(string hex, out Color color)
    {
        color = Microsoft.UI.Colors.Transparent;
        if (string.IsNullOrWhiteSpace(hex))
        {
            return false;
        }

        var value = hex.Trim().TrimStart('#');
        if (value.Length != 6
            || !byte.TryParse(value.AsSpan(0, 2), System.Globalization.NumberStyles.HexNumber, null, out var r)
            || !byte.TryParse(value.AsSpan(2, 2), System.Globalization.NumberStyles.HexNumber, null, out var g)
            || !byte.TryParse(value.AsSpan(4, 2), System.Globalization.NumberStyles.HexNumber, null, out var b))
        {
            return false;
        }

        color = Color.FromArgb(255, r, g, b);
        return true;
    }
}

/// <summary>
/// The durable <see cref="IAppearanceLocalPreferences"/> for the Windows app: it persists the per-device
/// appearance preferences as a JSON value in <c>ApplicationData.LocalSettings</c>, mirroring the web
/// localStorage hooks (<c>useSidebarStyle</c> / <c>useStatusBarPrefs</c> /
/// <c>useAchievementCelebrationPrefs</c>) — instant, offline and per-device. Enums are written as stable name
/// tokens so a future reorder cannot corrupt a saved preference, and every access is guarded so an
/// unpackaged / identity-less dev run degrades to <see cref="AppearanceLocalPreferences.Default"/> rather
/// than throwing. This store holds only display preferences — never token or cached-payload material.
/// </summary>
public sealed class LocalSettingsAppearancePreferences : IAppearanceLocalPreferences
{
    private const string ContainerName = "teslasync.appearance";
    private const string RecordKey = "prefs";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    /// <inheritdoc />
    public AppearanceLocalPreferences Load()
    {
        try
        {
            var container = Container();
            if (container.Values.TryGetValue(RecordKey, out var value) && value is string json && !string.IsNullOrEmpty(json))
            {
                var prefs = JsonSerializer.Deserialize<AppearanceLocalPreferences>(json, JsonOptions);
                if (prefs is not null)
                {
                    return prefs.Normalized();
                }
            }
        }
        catch (Exception)
        {
            // Absent / unreadable / no identity — fall back to defaults.
        }

        return AppearanceLocalPreferences.Default;
    }

    /// <inheritdoc />
    public void Save(AppearanceLocalPreferences preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        try
        {
            Container().Values[RecordKey] = JsonSerializer.Serialize(preferences.Normalized(), JsonOptions);
        }
        catch (Exception)
        {
            // No package identity — persistence is best-effort; the in-memory state still holds.
        }
    }

    private static ApplicationDataContainer Container() =>
        ApplicationData.Current.LocalSettings.CreateContainer(ContainerName, ApplicationDataCreateDisposition.Always);
}
