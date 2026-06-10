using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.Repositories;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 General settings surface — a parity port of
/// web/src/features/settings/components/GeneralSettings.tsx. It reproduces the web component inside one glass panel:
/// the header, the optional "Sync from Car" banner and read-only clock-format banner, the two-column form of unit /
/// range / precision / language / currency / locale / time-zone / cost selectors and inputs, and the Save action with
/// its dirty-state and "Settings saved" affordances. Because the native surface binds its own cache-then-network
/// <see cref="GeneralSettingsViewModel"/>, it renders every state the P2 contract requires — the skeleton while
/// loading, a retry surface on a hard failure, and the full form otherwise (with a stale / offline chip in the
/// header). The form controls are built once and their values pushed only when the draft is replaced programmatically,
/// so a text field keeps focus while the user types. The view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class GeneralSettings : ContentControl, IDisposable
{
    private const double PanelPadding = 24;       // web GlassPanel p-6
    private const double SectionSpacing = 24;     // web space-y-6
    private const double FieldSpacing = 20;       // web gap-5
    private const double SkeletonBlockHeight = 64;

    // Segoe Fluent glyphs (decorative — AccessibilityView.Raw — standing in for the web Lucide icons).
    private const string SettingsGlyph = "\uE713"; // Setting (web Settings)
    private const string CarGlyph = "\uE804";      // Car (web Car)
    private const string ClockGlyph = "\uE121";    // Clock (web Clock)
    private const string DownloadGlyph = "\uE896"; // Download (web Download)
    private const string SaveGlyph = "\uE74E";     // Save (web Save)
    private const string CheckGlyph = "\uE73E";    // CheckMark (web CheckCircle)

    private enum RenderMode
    {
        None,
        Loading,
        Error,
        Content,
    }

    private readonly GeneralSettingsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly GeneralSettingsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Informational,
        Margin = new Thickness(0, 0, 0, 12),
    };

    private readonly TsFadeIn _fade = new();

    private RenderMode _mode = RenderMode.None;
    private bool _contentBuilt;
    private int _renderedEpoch = -1;
    private bool _suppressEvents;
    private bool _started;
    private bool _renderQueued;
    private bool _building;
    private bool _disposed;

    // Persistent content references (built once on first content render).
    private TsGlassPanel? _contentPanel;
    private StackPanel? _bannerHost;
    private StackPanel? _freshnessHost;
    private TsSelect? _distanceSelect;
    private TsSelect? _temperatureSelect;
    private TsSelect? _pressureSelect;
    private TsSelect? _preferredRangeSelect;
    private TsInput? _decimalInput;
    private Caption? _previewCaption;
    private TsSelect? _languageSelect;
    private TsSelect? _currencySelect;
    private TsSelect? _localeSelect;
    private TsSelect? _tzDisplaySelect;
    private TsInput? _timezoneInput;
    private TextBlock? _costSymbol;
    private TsInput? _costInput;
    private TextBlock? _gasSymbol;
    private TsInput? _gasPriceInput;
    private TsSelect? _gasUnitSelect;
    private TsInput? _mpgInput;
    private TsButton? _saveButton;
    private StackPanel? _saveRow;

    /// <summary>Creates the surface over its settings source and localizer.</summary>
    /// <param name="source">The cache-then-network settings source (read + save + vehicle/car-pref reads).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public GeneralSettings(
        IGeneralSettingsSource source,
        ILocalizer localizer,
        GeneralSettingsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new GeneralSettingsDiagnostics();
        _viewModel = new GeneralSettingsViewModel(source, localizer);
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
        _viewModel.NoticeRequested += OnNoticeRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>general-settings</c>).</summary>
    public static string SurfaceId => GeneralSettingsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public GeneralSettingsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="GeneralSettingsSource"/> from the shared data
    /// layer (the host's P2-core dependencies).
    /// </summary>
    /// <param name="settings">The shared cache-then-network settings repository.</param>
    /// <param name="api">The generated contract client (save + best-effort reads).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public static GeneralSettings Create(
        ISettingsRepository settings,
        IApiClient api,
        ILocalizer localizer,
        GeneralSettingsDiagnostics? diagnostics = null)
    {
        var source = new GeneralSettingsSource(settings, api);
        return new GeneralSettings(source, localizer, diagnostics);
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
        _viewModel.NoticeRequested -= OnNoticeRequested;
        _viewModel.Dispose();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnNoticeRequested(object? sender, GeneralSettingsNotice notice)
    {
        _toast.Severity = notice.Kind switch
        {
            GeneralSettingsNoticeKind.Success => InfoBarSeverity.Success,
            GeneralSettingsNoticeKind.Error => InfoBarSeverity.Error,
            _ => InfoBarSeverity.Informational,
        };
        _toast.Title = notice.Title;
        _toast.Message = notice.Detail;
        _toast.IsOpen = !string.IsNullOrEmpty(notice.Title);
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

            switch (_viewModel.State)
            {
                case GeneralSettingsState.Loading:
                    ShowLoading();
                    break;
                case GeneralSettingsState.Error:
                    ShowError();
                    break;
                default:
                    ShowContent(display);
                    break;
            }
        }
        finally
        {
            _building = false;
        }
    }

    // ── Loading (skeleton chrome) ────────────────────────────────────────────────────────────────────────

    private void ShowLoading()
    {
        if (_mode == RenderMode.Loading)
        {
            return;
        }

        _mode = RenderMode.Loading;
        _fade.Content = BuildLoading();
    }

    private TsGlassPanel BuildLoading()
    {
        var content = new StackPanel { Spacing = SectionSpacing };
        content.Children.Add(new TsSkeleton { BlockHeight = 48, ReduceMotion = MotionPreference.ReduceMotion });

        var grid = new Grid { ColumnSpacing = FieldSpacing, RowSpacing = FieldSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (int i = 0; i < 5; i++)
        {
            var block = new TsSkeleton { BlockHeight = SkeletonBlockHeight, ReduceMotion = MotionPreference.ReduceMotion };
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            Grid.SetRow(block, i / 2);
            Grid.SetColumn(block, i % 2);
            grid.Children.Add(block);
        }

        content.Children.Add(grid);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        LiveRegion.Configure(content);
        LiveRegion.Announce(content);
        AutomationProperties.SetName(panel, _localizer.GetString("translation.common.loading", "Loading..."));
        return panel;
    }

    // ── Error surface (web QueryError) ───────────────────────────────────────────────────────────────────

    private void ShowError()
    {
        _mode = RenderMode.Error;
        _fade.Content = BuildError();
    }

    private TsGlassPanel BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.Title,
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("translation.error.loadFailed", "Failed to load data"),
            ActionText = _localizer.GetString("translation.common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = error };
        AutomationProperties.SetName(panel, error.Message);
        return panel;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Content (Loaded / Empty / Stale / Offline): the full settings form ────────────────────────────────

    private void ShowContent(GeneralSettingsDisplay display)
    {
        EnsureContent(display);

        if (_mode != RenderMode.Content)
        {
            _mode = RenderMode.Content;
            _fade.Content = _contentPanel;
        }

        if (_renderedEpoch != _viewModel.FormEpoch)
        {
            PushDraftToControls();
            _renderedEpoch = _viewModel.FormEpoch;
        }

        UpdateBanners(display);
        UpdateFreshness();
        UpdateSaveRow(display);
    }

    private void EnsureContent(GeneralSettingsDisplay display)
    {
        if (_contentBuilt)
        {
            return;
        }

        _contentBuilt = true;

        var sections = new StackPanel { Spacing = SectionSpacing };
        sections.Children.Add(BuildHeader(display));

        _bannerHost = new StackPanel { Spacing = FieldSpacing };
        sections.Children.Add(_bannerHost);

        sections.Children.Add(BuildFormGrid(display));
        sections.Children.Add(BuildSaveRow(display));

        _contentPanel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = sections };
        AutomationProperties.SetName(_contentPanel, display.AutomationName);
    }

    private Grid BuildHeader(GeneralSettingsDisplay display)
    {
        var iconChip = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = AccentTint("TsColorAccentBrush"),
            Width = 40,
            Height = 40,
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = SettingsGlyph,
                FontSize = 18,
                Foreground = DisplayTokens.Accent,
            },
        };
        AutomationProperties.SetAccessibilityView(iconChip, AccessibilityView.Raw);

        var titles = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(new PanelTitle { Value = display.Title });
        titles.Children.Add(new Caption { Value = display.Subtitle });

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(iconChip);
        left.Children.Add(titles);

        _freshnessHost = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(_freshnessHost, 1);
        header.Children.Add(left);
        header.Children.Add(_freshnessHost);
        return header;
    }

    private void UpdateFreshness()
    {
        if (_freshnessHost is null)
        {
            return;
        }

        _freshnessHost.Children.Clear();

        if (_viewModel.State is GeneralSettingsState.Stale or GeneralSettingsState.Offline)
        {
            _freshnessHost.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshnessHost.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching || _viewModel.IsSaving,
            IsError = _viewModel.State == GeneralSettingsState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });
    }

    private TsBadge BuildFreshnessChip(GeneralSettingsState state)
    {
        bool offline = state == GeneralSettingsState.Offline;
        string text = offline
            ? _localizer.GetString("translation.common.offline", "Offline")
            : _localizer.GetString("translation.common.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    // ── Sync-from-car + clock banners (web carPrefs blocks) ──────────────────────────────────────────────

    private void UpdateBanners(GeneralSettingsDisplay display)
    {
        if (_bannerHost is null)
        {
            return;
        }

        _bannerHost.Children.Clear();

        if (display.Sync is { } sync)
        {
            _bannerHost.Children.Add(BuildSyncBanner(sync));
        }

        if (display.Clock is { } clock)
        {
            _bannerHost.Children.Add(BuildClockBanner(clock));
        }
    }

    private Border BuildSyncBanner(SyncBanner model)
    {
        var icon = new FontIcon
        {
            Glyph = CarGlyph,
            FontSize = 18,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var texts = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center, MinWidth = 1 };
        texts.Children.Add(new Text { Value = model.CarUsesText });
        texts.Children.Add(new Caption { Value = model.Hint });

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(icon);
        left.Children.Add(texts);

        var syncButton = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Small,
            IconGlyph = DownloadGlyph,
            Text = model.ActionLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(syncButton, model.ActionLabel);
        syncButton.Click += (_, _) =>
        {
            if (!_building)
            {
                _ = _viewModel.SyncFromCarAsync();
            }
        };

        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(syncButton, 1);
        grid.Children.Add(left);
        grid.Children.Add(syncButton);

        var border = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            BorderBrush = AccentTint("TsColorAccentBrush"),
            BorderThickness = new Thickness(1),
            Background = AccentTint("TsColorAccentBrush"),
            Padding = new Thickness(16),
            Child = grid,
        };
        AutomationProperties.SetName(border, model.CarUsesText);
        return border;
    }

    private static Border BuildClockBanner(ClockBanner model)
    {
        var icon = new FontIcon
        {
            Glyph = ClockGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var line = string.Create(CultureInfo.CurrentCulture, $"{model.Label}: {model.Value}");
        var texts = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center, MinWidth = 1 };
        texts.Children.Add(new Text { Value = line });
        texts.Children.Add(new Caption { Value = model.Hint });

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(icon);
        row.Children.Add(texts);

        var border = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12),
            Child = row,
        };
        AutomationProperties.SetName(border, line);
        return border;
    }

    // ── The two-column form grid (web grid-cols-1 sm:grid-cols-2) ─────────────────────────────────────────

    private Grid BuildFormGrid(GeneralSettingsDisplay display)
    {
        _distanceSelect = BuildSelect(display.DistanceLabel, display.DistanceOptions, OnDistanceChanged);
        _temperatureSelect = BuildSelect(display.TemperatureLabel, display.TemperatureOptions, OnTemperatureChanged);
        _pressureSelect = BuildSelect(display.PressureLabel, display.PressureOptions, OnPressureChanged);
        _preferredRangeSelect = BuildSelect(display.PreferredRangeLabel, display.PreferredRangeOptions, OnPreferredRangeChanged);
        _languageSelect = BuildSelect(display.LanguageLabel, display.LanguageOptions, OnLanguageChanged);
        _currencySelect = BuildSelect(display.CurrencyLabel, display.CurrencyOptions, OnCurrencyChanged);
        _localeSelect = BuildSelect(display.LocaleLabel, display.LocaleOptions, OnLocaleChanged);
        _tzDisplaySelect = BuildSelect(display.TzDisplayLabel, display.TzDisplayOptions, OnTzDisplayChanged);

        var fields = new List<FrameworkElement>
        {
            FieldColumn(display.DistanceLabel, _distanceSelect),
            FieldColumn(display.TemperatureLabel, _temperatureSelect),
            FieldColumn(display.PressureLabel, _pressureSelect),
            FieldColumn(display.PreferredRangeLabel, _preferredRangeSelect),
            BuildDecimalField(display),
            FieldColumn(display.LanguageLabel, _languageSelect),
            FieldColumn(display.CurrencyLabel, _currencySelect),
            FieldColumn(display.LocaleLabel, _localeSelect),
            FieldColumn(display.TzDisplayLabel, _tzDisplaySelect),
            BuildTimezoneField(display),
            BuildElectricityCostField(display),
            BuildGasPriceField(display),
            BuildMpgField(display),
        };

        var grid = new Grid { ColumnSpacing = FieldSpacing, RowSpacing = FieldSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        int rows = (fields.Count + 1) / 2;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < fields.Count; i++)
        {
            var field = fields[i];
            Grid.SetRow(field, i / 2);
            Grid.SetColumn(field, i % 2);
            grid.Children.Add(field);
        }

        return grid;
    }

    private StackPanel BuildDecimalField(GeneralSettingsDisplay display)
    {
        _decimalInput = new TsInput
        {
            InputScope = NumberInputScope(),
            Hint = "2",
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(_decimalInput, display.DecimalPrecisionLabel);
        _decimalInput.TextChanged += OnDecimalChanged;

        _previewCaption = new Caption { Value = display.PreviewLabel };

        var column = FieldColumn(display.DecimalPrecisionLabel, _decimalInput);
        column.Children.Add(_previewCaption);
        return column;
    }

    private StackPanel BuildTimezoneField(GeneralSettingsDisplay display)
    {
        _timezoneInput = new TsInput
        {
            Hint = display.TimezoneUserPlaceholder, // parity:allow input-hint placeholder text mirroring the web attribute, not a stub
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(_timezoneInput, display.TimezoneUserLabel);
        _timezoneInput.TextChanged += OnTimezoneChanged;

        var column = FieldColumn(display.TimezoneUserLabel, _timezoneInput);
        column.Children.Add(new Caption { Value = display.TimezoneUserHint });
        return column;
    }

    private StackPanel BuildElectricityCostField(GeneralSettingsDisplay display)
    {
        _costSymbol = CurrencyAdornment();
        _costInput = new TsInput
        {
            InputScope = NumberInputScope(),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(_costInput, display.ElectricityCostLabel);
        _costInput.TextChanged += OnCostChanged;

        var row = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_costSymbol, 0);
        Grid.SetColumn(_costInput, 1);
        row.Children.Add(_costSymbol);
        row.Children.Add(_costInput);

        return FieldColumn(display.ElectricityCostLabel, row);
    }

    private StackPanel BuildGasPriceField(GeneralSettingsDisplay display)
    {
        _gasSymbol = CurrencyAdornment();
        _gasPriceInput = new TsInput
        {
            InputScope = NumberInputScope(),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(_gasPriceInput, display.GasPriceLabel);
        _gasPriceInput.TextChanged += OnGasPriceChanged;

        _gasUnitSelect = BuildSelect(display.GasPriceLabel, display.GasUnitOptions, OnGasUnitChanged);
        _gasUnitSelect.MinWidth = 112;

        var row = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_gasSymbol, 0);
        Grid.SetColumn(_gasPriceInput, 1);
        Grid.SetColumn(_gasUnitSelect, 2);
        row.Children.Add(_gasSymbol);
        row.Children.Add(_gasPriceInput);
        row.Children.Add(_gasUnitSelect);

        return FieldColumn(display.GasPriceLabel, row);
    }

    private StackPanel BuildMpgField(GeneralSettingsDisplay display)
    {
        _mpgInput = new TsInput
        {
            InputScope = NumberInputScope(),
            Hint = display.MpgPlaceholder, // parity:allow input-hint placeholder text mirroring the web attribute, not a stub
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(_mpgInput, display.ComparisonMpgLabel);
        _mpgInput.TextChanged += OnMpgChanged;

        return FieldColumn(display.ComparisonMpgLabel, _mpgInput);
    }

    // ── Save row (web Save button + dirty / saved affordances) ───────────────────────────────────────────

    private StackPanel BuildSaveRow(GeneralSettingsDisplay display)
    {
        _saveButton = new TsButton
        {
            Variant = ButtonVariant.Primary,
            IconGlyph = SaveGlyph,
            Text = display.SaveLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(_saveButton, display.SaveLabel);
        _saveButton.Click += (_, _) =>
        {
            if (!_building)
            {
                _ = _viewModel.SaveAsync();
            }
        };

        _saveRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _saveRow.Children.Add(_saveButton);
        return _saveRow;
    }

    private void UpdateSaveRow(GeneralSettingsDisplay display)
    {
        if (_saveRow is null || _saveButton is null)
        {
            return;
        }

        _saveButton.IsLoading = _viewModel.IsSaving;

        // Drop everything after the save button and re-add only the active affordance.
        while (_saveRow.Children.Count > 1)
        {
            _saveRow.Children.RemoveAt(_saveRow.Children.Count - 1);
        }

        if (_viewModel.JustSaved)
        {
            var savedRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 4,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var check = new FontIcon
            {
                Glyph = CheckGlyph,
                FontSize = 14,
                Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(check, AccessibilityView.Raw);
            savedRow.Children.Add(check);
            savedRow.Children.Add(new TextBlock
            {
                Text = display.SettingsSavedLabel,
                FontSize = 14,
                Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            });
            AutomationProperties.SetName(savedRow, display.SettingsSavedLabel);
            _saveRow.Children.Add(savedRow);
        }
        else if (_viewModel.IsDirty)
        {
            _saveRow.Children.Add(new Caption
            {
                Value = display.UnsavedLabel,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }
    }

    // ── Push the draft into the controls (programmatic draft change only) ────────────────────────────────

    private void PushDraftToControls()
    {
        var draft = _viewModel.Draft;
        _suppressEvents = true;
        try
        {
            SelectByValue(_distanceSelect, GeneralWire.Token(draft.DistanceUnit));
            SelectByValue(_temperatureSelect, GeneralWire.Token(draft.TemperatureUnit));
            SelectByValue(_pressureSelect, GeneralWire.Token(draft.PressureUnit));
            SelectByValue(_preferredRangeSelect, GeneralWire.Token(draft.PreferredRange));
            SelectByValue(_languageSelect, draft.Language);
            SelectByValue(_currencySelect, draft.CurrencySymbol);
            SelectByValue(_localeSelect, draft.Locale);
            SelectByValue(_tzDisplaySelect, GeneralWire.Token(draft.TzDisplayDefault));
            SelectByValue(_gasUnitSelect, GeneralWire.Token(draft.GasUnit));

            SetText(_decimalInput, draft.DecimalPrecision.ToString(CultureInfo.InvariantCulture));
            SetText(_timezoneInput, draft.TimezoneUser);
            SetText(_costInput, FormatNumber(draft.BaseCostPerKwh));
            SetText(_gasPriceInput, FormatNumber(draft.GasPricePerUnit));
            SetText(_mpgInput, FormatNumber(draft.GasEfficiencyMpg));

            UpdateCurrencyAdornments(draft.CurrencySymbol);
            UpdatePreview(draft);
        }
        finally
        {
            _suppressEvents = false;
        }
    }

    // ── Control change handlers (user edits → view-model) ────────────────────────────────────────────────

    private void OnDistanceChanged(string value) => _viewModel.SetDistanceUnit(GeneralWire.ParseDistance(value));

    private void OnTemperatureChanged(string value) => _viewModel.SetTemperatureUnit(GeneralWire.ParseTemperature(value));

    private void OnPressureChanged(string value) => _viewModel.SetPressureUnit(GeneralWire.ParsePressure(value));

    private void OnPreferredRangeChanged(string value) => _viewModel.SetPreferredRange(GeneralWire.ParsePreferredRange(value));

    private void OnLanguageChanged(string value) => _viewModel.SetLanguage(value);

    private void OnCurrencyChanged(string value)
    {
        _viewModel.SetCurrencySymbol(value);
        UpdateCurrencyAdornments(value);
    }

    private void OnLocaleChanged(string value) => _viewModel.SetLocale(value);

    private void OnTzDisplayChanged(string value) => _viewModel.SetTimeZoneDisplay(GeneralWire.ParseTzDisplay(value));

    private void OnGasUnitChanged(string value) => _viewModel.SetGasUnit(GeneralWire.ParseGasUnit(value));

    private void OnDecimalChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents || _decimalInput is null)
        {
            return;
        }

        int value = int.TryParse(_decimalInput.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : 0;
        _viewModel.SetDecimalPrecision(value);
        UpdatePreview(_viewModel.Draft);
    }

    private void OnTimezoneChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents || _timezoneInput is null)
        {
            return;
        }

        _viewModel.SetTimezoneUser(_timezoneInput.Text);
    }

    private void OnCostChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents || _costInput is null)
        {
            return;
        }

        _viewModel.SetBaseCostPerKwh(ParseNumber(_costInput.Text));
    }

    private void OnGasPriceChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents || _gasPriceInput is null)
        {
            return;
        }

        _viewModel.SetGasPricePerUnit(ParseNumber(_gasPriceInput.Text));
    }

    private void OnMpgChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents || _mpgInput is null)
        {
            return;
        }

        _viewModel.SetGasEfficiencyMpg(ParseNumber(_mpgInput.Text));
    }

    // ── Shared building blocks ───────────────────────────────────────────────────────────────────────────

    private TsSelect BuildSelect(string accessibleName, IReadOnlyList<SelectOption> options, Action<string> onChanged)
    {
        var select = new TsSelect { HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var option in options)
        {
            select.Items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Value });
        }

        AutomationProperties.SetName(select, accessibleName);
        select.SelectionChanged += (_, _) =>
        {
            if (_suppressEvents || _building)
            {
                return;
            }

            if (select.SelectedItem is ComboBoxItem item && item.Tag is string value)
            {
                onChanged(value);
            }
        };
        return select;
    }

    private static StackPanel FieldColumn(string label, FrameworkElement control)
    {
        var column = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Top };
        column.Children.Add(new Label { Value = label });
        column.Children.Add(control);
        return column;
    }

    private static TextBlock CurrencyAdornment() => new()
    {
        Foreground = DisplayTokens.TextMuted,
        VerticalAlignment = VerticalAlignment.Center,
        FontSize = 14,
    };

    private void UpdateCurrencyAdornments(string symbol)
    {
        if (_costSymbol is not null)
        {
            _costSymbol.Text = symbol;
        }

        if (_gasSymbol is not null)
        {
            _gasSymbol.Text = symbol;
        }
    }

    private void UpdatePreview(GeneralFormValues draft)
    {
        if (_previewCaption is null)
        {
            return;
        }

        var label = _viewModel.Display.PreviewLabel;
        _previewCaption.Value = string.Create(CultureInfo.CurrentCulture, $"{label}: {draft.PrecisionPreview()}");
    }

    private static void SelectByValue(TsSelect? select, string value)
    {
        if (select is null)
        {
            return;
        }

        foreach (var item in select.Items)
        {
            if (item is ComboBoxItem candidate && string.Equals(candidate.Tag as string, value, StringComparison.Ordinal))
            {
                select.SelectedItem = candidate;
                return;
            }
        }

        select.SelectedItem = null;
    }

    private static void SetText(TsInput? input, string value)
    {
        if (input is not null && !string.Equals(input.Text, value, StringComparison.Ordinal))
        {
            input.Text = value;
        }
    }

    private static double ParseNumber(string? text) =>
        double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : 0;

    private static string FormatNumber(double value) =>
        value.ToString("0.######", CultureInfo.InvariantCulture);

    private static InputScope NumberInputScope()
    {
        var scope = new InputScope();
        scope.Names.Add(new InputScopeName { NameValue = InputScopeNameValue.Number });
        return scope;
    }

    private static Brush AccentTint(string brushKey)
    {
        var brush = DisplayTokens.Brush(brushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = 0.12 }
            : brush;
    }
}
