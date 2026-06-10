using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.Storage;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 AdvancedSettings surface — a parity port of
/// web/src/features/settings/components/AdvancedSettings.tsx. It reproduces the web "Restore confirmation
/// prompts" panel composition: a <see cref="TsFadeIn"/> (the web <c>FadeIn</c>) wrapping a
/// <see cref="TsGlassPanel"/> (the web <c>GlassPanel</c>) whose header pairs a cyan accent icon badge (the web
/// <c>IconBox</c> + <c>ShieldQuestion</c>) with the localized title and description and, when any prompt is
/// silenced, a right-aligned "Restore all" <see cref="TsButton"/> (the web ghost button). Below the header the
/// surface renders one of the web's two branches: the friendly <see cref="TsEmptyState"/> when nothing is
/// silenced (web <c>silenced.length === 0</c>) or the restore list — one row per silenced id with its friendly
/// label and a per-row "Restore" button (web <c>silenced.map(...)</c>). There is no loading / error / stale /
/// offline branch because the web source has none: the silenced ids are read synchronously from a per-device
/// store, and an unreadable store degrades to the empty state. All reading and projection flow through the
/// shared <see cref="AdvancedSettingsViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade, the surface and each action carry Narrator names, and the fade honours reduce-motion.
/// </summary>
public sealed partial class AdvancedSettings : ContentControl, IDisposable
{
    private const double BadgeSize = 40;
    private const double IconGlyphSize = 20;

    private readonly ILocalizer _localizer;
    private readonly AdvancedSettingsViewModel _viewModel;
    private readonly AdvancedSettingsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = 240 };
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new();
    private readonly Grid _header = new();
    private readonly Border _badge = new();
    private readonly FontIcon _badgeIcon = new();
    private readonly StackPanel _titleStack = new() { Spacing = 2 };
    private readonly TextBlock _title = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _description = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TsButton _restoreAll = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = RestoreGlyph };
    private readonly TsEmptyState _empty = new();
    private readonly Border _listBorder = new();
    private readonly StackPanel _list = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>The Segoe Fluent "Refresh" glyph standing in for the web Lucide <c>RotateCcw</c> restore icon.</summary>
    public const string RestoreGlyph = "\uE72C";

    /// <summary>Creates the surface over its silenced-prompts store, the i18n facade and an optional diagnostics collector.</summary>
    /// <param name="store">The synchronous, per-device silenced-prompts store (list / restore / restore-all).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public AdvancedSettings(ISilencedPromptsStore store, ILocalizer localizer, AdvancedSettingsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AdvancedSettingsDiagnostics();
        _viewModel = new AdvancedSettingsViewModel(store, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _restoreAll.Click += OnRestoreAllClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>AdvancedSettings</c>).</summary>
    public static string Slug => AdvancedSettingsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public AdvancedSettingsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the durable <see cref="LocalSettingsSilencedPromptsStore"/> (the per-device
    /// store mirroring the web localStorage), unless an explicit store is supplied for hosting or tests.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    /// <param name="store">Optional override for the silenced-prompts store (durable by default).</param>
    public static AdvancedSettings Create(
        ILocalizer localizer,
        AdvancedSettingsDiagnostics? diagnostics = null,
        ISilencedPromptsStore? store = null) =>
        new(store ?? new LocalSettingsSilencedPromptsStore(), localizer, diagnostics);

    private void BuildChrome()
    {
        // GlassPanel p-5 (web) — TsGlassPanel default padding is 16; override to 20.
        _panel.Padding = new Thickness(TypographyTokens.Size("TsSpaceXl", 20));

        // Accent icon badge: 40x40, rounded, tinted fill + ring, centered glyph (the web IconBox).
        _badge.Width = BadgeSize;
        _badge.Height = BadgeSize;
        _badge.CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8);
        _badge.BorderThickness = new Thickness(1);
        _badge.VerticalAlignment = VerticalAlignment.Center;
        _badge.HorizontalAlignment = HorizontalAlignment.Left;
        _badgeIcon.FontSize = IconGlyphSize;
        _badgeIcon.HorizontalAlignment = HorizontalAlignment.Center;
        _badgeIcon.VerticalAlignment = VerticalAlignment.Center;
        _badge.Child = _badgeIcon;
        AutomationProperties.SetAccessibilityView(_badge, AccessibilityView.Raw);

        // Title (text-base / semibold / primary) + description (text-xs / muted).
        _title.FontFamily = TypographyTokens.Sans;
        _title.FontSize = TypographyTokens.Size("TsTypePanelFontSize", 16);
        _title.FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeWeightSemibold", 600));
        _title.Foreground = TypographyTokens.Brush("TsColorTextPrimaryBrush");
        _description.FontFamily = TypographyTokens.Sans;
        _description.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _description.Foreground = TypographyTokens.Brush("TsColorTextMutedBrush");
        _titleStack.VerticalAlignment = VerticalAlignment.Center;
        _titleStack.Children.Add(_title);
        _titleStack.Children.Add(_description);

        _restoreAll.VerticalAlignment = VerticalAlignment.Center;
        _restoreAll.HorizontalAlignment = HorizontalAlignment.Right;

        // Header row: [auto badge | * title/desc | auto restore-all], items-center, gap-3 (12) gutter.
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _header.ColumnSpacing = TypographyTokens.Size("TsSpaceMd", 12);
        Grid.SetColumn(_badge, 0);
        Grid.SetColumn(_titleStack, 1);
        Grid.SetColumn(_restoreAll, 2);
        _header.Children.Add(_badge);
        _header.Children.Add(_titleStack);
        _header.Children.Add(_restoreAll);

        // Restore list container: rounded, hairline border, subtle surface tint (web divide-y / border / bg).
        _listBorder.CornerRadius = DisplayTokens.Radius("TsRadiusSm", 8);
        _listBorder.BorderThickness = new Thickness(1);
        _listBorder.BorderBrush = DisplayTokens.Border;
        _listBorder.Background = DisplayTokens.Surface;
        _listBorder.Child = _list;

        // Root: header then the body branch (empty state or the restore list), space-y-4 (16) gutter.
        _root.Spacing = TypographyTokens.Size("TsSpaceLg", 16);
        _root.Children.Add(_header);
        _root.Children.Add(_empty);
        _root.Children.Add(_listBorder);

        _panel.Content = _root;
        _fade.Content = _panel;
        Content = _fade;
    }

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

    /// <summary>Detach from the view-model and the action buttons (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _restoreAll.Click -= OnRestoreAllClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        ClearRows();
        GC.SuppressFinalize(this);
    }

    private void OnRestoreAllClicked(object sender, RoutedEventArgs e) => _viewModel.RestoreAll();

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
        AdvancedSettingsDisplay display = _viewModel.Display;

        AutomationProperties.SetName(this, display.RegionName);

        _title.Text = display.Title;
        _description.Text = display.Description;
        _description.Visibility = string.IsNullOrEmpty(display.Description) ? Visibility.Collapsed : Visibility.Visible;

        ApplyAccent(display.Accent, display.Glyph);

        _restoreAll.Text = display.RestoreAllText;
        _restoreAll.Visibility = display.ShowRestoreAll ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_restoreAll, display.RestoreAllActionName);

        _empty.Message = display.EmptyMessage;
        _empty.Visibility = display.IsEmpty ? Visibility.Visible : Visibility.Collapsed;

        _listBorder.Visibility = display.IsEmpty ? Visibility.Collapsed : Visibility.Visible;
        if (!display.IsEmpty)
        {
            BuildRows(display);
        }
        else
        {
            ClearRows();
        }
    }

    private void BuildRows(AdvancedSettingsDisplay display)
    {
        ClearRows();

        double gutterH = TypographyTokens.Size("TsSpaceMd", 12);
        double gutterV = TypographyTokens.Size("TsSpaceSm", 8);

        for (int i = 0; i < display.Rows.Count; i++)
        {
            AdvancedSettingsRow row = display.Rows[i];

            if (i > 0)
            {
                _list.Children.Add(new Border
                {
                    Height = 1,
                    BorderThickness = new Thickness(0),
                    Background = DisplayTokens.Border,
                });
            }

            var rowGrid = new Grid
            {
                Padding = new Thickness(gutterH, gutterV, gutterH, gutterV),
                ColumnSpacing = gutterH,
            };
            rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var label = new TextBlock
            {
                Text = row.Label,
                FontFamily = TypographyTokens.Sans,
                FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
                Foreground = TypographyTokens.Brush("TsColorTextPrimaryBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(label, 0);

            var button = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                IconGlyph = RestoreGlyph,
                Text = display.RestoreText,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(button, row.RestoreActionName);
            string key = row.Key;
            button.Click += (_, _) => _viewModel.Restore(key);
            Grid.SetColumn(button, 1);

            rowGrid.Children.Add(label);
            rowGrid.Children.Add(button);
            _list.Children.Add(rowGrid);
        }
    }

    private void ClearRows() => _list.Children.Clear();

    private void ApplyAccent(string accent, string glyph)
    {
        _badgeIcon.Glyph = glyph;

        Brush? brush = TypographyTokens.Brush(ToolCardAccent.BrushKey(accent));
        if (brush is SolidColorBrush solid)
        {
            _badgeIcon.Foreground = solid;
            Windows.UI.Color c = solid.Color;
            _badge.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x1A, c.R, c.G, c.B));
            _badge.BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x33, c.R, c.G, c.B));
        }
        else if (brush is not null)
        {
            _badgeIcon.Foreground = brush;
        }
    }
}

/// <summary>
/// The durable <see cref="ISilencedPromptsStore"/> for the Windows app: it persists the silenced confirm-dialog
/// ids as the JSON array document the web <c>confirmSilence</c> store uses (web/src/lib/confirmSilence.ts),
/// stored in <c>ApplicationData.LocalSettings</c> — synchronous, offline and per-device, exactly like the web
/// localStorage. The JSON shape is produced and parsed by the WinUI-free <see cref="SilencedPromptsCodec"/> so
/// the on-disk contract matches the web schema (<see cref="SilencedPromptsStorage.StorageKey"/>). Every access
/// is guarded so an unpackaged / identity-less dev run degrades to an empty list rather than throwing, and a
/// failed write is swallowed (the web defensive try/catch). This store holds only display preferences — never
/// token or cached-payload material.
/// </summary>
public sealed class LocalSettingsSilencedPromptsStore : ISilencedPromptsStore
{
    private const string ContainerName = "teslasync.confirmSilence";
    private const string RecordKey = "v1";

    /// <inheritdoc />
    public IReadOnlyList<string> List()
    {
        try
        {
            ApplicationDataContainer container = Container();
            if (container.Values.TryGetValue(RecordKey, out object? value) && value is string json)
            {
                return SilencedPromptsCodec.Parse(json);
            }
        }
        catch (Exception)
        {
            // Absent / unreadable / no identity — fall back to an empty list (the web load() contract).
        }

        return Array.Empty<string>();
    }

    /// <inheritdoc />
    public void Restore(string key)
    {
        if (string.IsNullOrEmpty(key))
        {
            return;
        }

        IReadOnlyList<string> current = List();
        if (!current.Contains(key, StringComparer.Ordinal))
        {
            return;
        }

        var next = new List<string>(current.Count - 1);
        foreach (string existing in current)
        {
            if (!string.Equals(existing, key, StringComparison.Ordinal))
            {
                next.Add(existing);
            }
        }

        Save(next);
    }

    /// <inheritdoc />
    public void RestoreAll()
    {
        try
        {
            Container().Values.Remove(RecordKey);
        }
        catch (Exception)
        {
            // Same defensive ignore as the web clearAllSilenced — a failed clear is recoverable.
        }
    }

    private static void Save(IEnumerable<string> keys)
    {
        try
        {
            Container().Values[RecordKey] = SilencedPromptsCodec.Serialize(keys);
        }
        catch (Exception)
        {
            // No package identity — persistence is best-effort; the next read simply returns the prior set.
        }
    }

    private static ApplicationDataContainer Container() =>
        ApplicationData.Current.LocalSettings.CreateContainer(ContainerName, ApplicationDataCreateDisposition.Always);
}
