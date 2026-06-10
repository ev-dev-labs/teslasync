using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The native WinUI 3 <c>AutomationCard</c> feature surface — a parity port of
/// web/src/features/automations/pages/AutomationCard.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>automation</c> prop plus the <c>isFiring</c> / <c>vehicleName</c> / pin
/// flags) and it renders the web layout inside a tokenized <see cref="TsGlassPanel"/> — a header row (the
/// truncating name, the active / disabled / auto-disabled <see cref="TsBadge"/>, the pulsing "Firing" chip,
/// the pin affordance, the enable <see cref="TsToggle"/> and the kebab actions menu), the description line,
/// the scoped-vehicle / all-vehicles chip row, the last-run / never-run + runs + fails + next-fire stats row,
/// the auto-disabled reason banner and the conflict rows. The hosting page wires the actions through the
/// <see cref="ToggleRequested"/>, <see cref="ReEnableRequested"/>, <see cref="DeleteRequested"/>,
/// <see cref="TestRunRequested"/>, <see cref="DuplicateRequested"/>, <see cref="ExportRequested"/> and
/// <see cref="PinToggleRequested"/> events — the native analogue of the web callbacks — so the card stays
/// reusable. The view never performs HTTP; all branch selection, label resolution and formatting happen in
/// the WinUI-free <see cref="AutomationCardProjection"/> (so there is no fetch-driven loading / empty / error
/// / stale / offline branch to reproduce — the web component never fetches). Semantic accents come from the
/// generated design tokens, decorative glyphs are hidden from Narrator, every interactive element carries an
/// accessible name, and the surface carries a single composed Narrator name. Every label resolves through the
/// i18n facade.
/// </summary>
public sealed partial class AutomationCard : ContentControl
{
    private const double PanelPadding = 16;        // web p-4
    private const double SectionSpacing = 12;      // web mt-3 between sections
    private const double HeaderGap = 12;           // web gap-3
    private const double NameFontSize = 16;        // web text-base
    private const double DescriptionFontSize = 14; // web text-sm
    private const double MetaFontSize = 12;        // web text-xs
    private const double StatusFontSize = 12;      // web Badge text
    private const double MetaIconFontSize = 12;    // web h-3 w-3
    private const double ActionIconFontSize = 14;  // web h-3.5 w-3.5
    private const double BannerCornerRadius = 6;   // web rounded-md
    private const double BannerPadding = 8;        // web px-3 py-2
    private const double TintOpacity = 0.12;       // web bg tint (≈ /10)
    private const double DangerBorderOpacity = 0.4; // web border-red-500/30

    private readonly ILocalizer _localizer;
    private readonly AutomationCardDiagnostics _diagnostics;

    private AutomationCardModel _model;
    private AutomationCardDisplay _display;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, the automation to render, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The automation to render (the web <c>automation</c> prop plus the ambient flags).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AutomationCard(
        ILocalizer localizer,
        AutomationCardModel model,
        AutomationCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(model);

        _localizer = localizer;
        _model = model;
        _diagnostics = diagnostics ?? new AutomationCardDiagnostics();
        _display = AutomationCardProjection.Project(model, localizer, DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the enable toggle changes; the argument is the requested enabled state (the web <c>onToggle(id, enabled)</c>).</summary>
    public event EventHandler<bool>? ToggleRequested;

    /// <summary>Raised when the re-enable affordance is activated (the web <c>onReEnable</c>).</summary>
    public event EventHandler? ReEnableRequested;

    /// <summary>Raised when the delete action is confirmed in the dialog (the web <c>onDelete</c>).</summary>
    public event EventHandler? DeleteRequested;

    /// <summary>Raised when the test-run action is activated (the web <c>onTestRun</c>).</summary>
    public event EventHandler? TestRunRequested;

    /// <summary>Raised when the duplicate action is activated (the web duplicate menu item).</summary>
    public event EventHandler? DuplicateRequested;

    /// <summary>Raised when the export action is activated (the web export menu item).</summary>
    public event EventHandler? ExportRequested;

    /// <summary>Raised when the pin affordance is activated (the web <c>PinButton</c> toggle).</summary>
    public event EventHandler? PinToggleRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AutomationCard</c>).</summary>
    public static string Slug => AutomationCardRegistration.Slug;

    /// <summary>The automation this card renders; reassigning re-projects and re-renders the surface.</summary>
    public AutomationCardModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _display = AutomationCardProjection.Project(value, _localizer, DateTimeOffset.Now);
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
        AutomationCardDisplay display = _display;

        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(BuildHeaderRow(display));
        stack.Children.Add(BuildVehicleRow(display));
        stack.Children.Add(BuildStatsRow(display));

        if (display.ShowAutoDisabledReason)
        {
            stack.Children.Add(BuildAutoDisabledBanner(display));
        }

        if (display.Conflicts.Count > 0)
        {
            stack.Children.Add(BuildConflicts(display));
        }

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = stack,
        };

        // Web: firing automations gain the cyan ring; auto-disabled automations gain the danger border.
        // The native glass panel exposes a single accent border, so the more critical auto-disabled state
        // wins when an automation is both firing and auto-disabled.
        if (display.IsFiring)
        {
            panel.Glow = GlassGlow.Cyan;
        }

        if (display.IsAutoDisabled)
        {
            panel.BorderBrush = Tint(DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger)), DangerBorderOpacity);
        }

        AutomationProperties.SetName(this, display.AutomationName);
        Content = panel;
    }

    // Web `flex items-start justify-between gap-3`: the title/description column and the pin/toggle/menu cluster.
    private Grid BuildHeaderRow(AutomationCardDisplay display)
    {
        var grid = new Grid { ColumnSpacing = HeaderGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleColumn = BuildTitleColumn(display);
        Grid.SetColumn(titleColumn, 0);
        grid.Children.Add(titleColumn);

        var actions = BuildHeaderActions(display);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);

        return grid;
    }

    private static StackPanel BuildTitleColumn(AutomationCardDisplay display)
    {
        var column = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Top };
        column.Children.Add(BuildNameRow(display));

        // Web: the description renders only when present (truncated).
        if (display.HasDescription)
        {
            column.Children.Add(new TextBlock
            {
                Text = display.Description,
                FontSize = DescriptionFontSize,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
        }

        return column;
    }

    // Web `flex items-center gap-2`: the truncating name, the status badge and (when firing) the firing chip.
    private static Grid BuildNameRow(AutomationCardDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var name = new TextBlock
        {
            Text = display.Name,
            FontSize = NameFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(name, 0);
        grid.Children.Add(name);

        var badge = new TsBadge
        {
            Status = display.StatusBadgeKind,
            Content = new TextBlock { Text = display.StatusLabel, FontSize = StatusFontSize },
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(badge, 1);
        grid.Children.Add(badge);

        if (display.IsFiring)
        {
            var firing = BuildFiringChip(display);
            Grid.SetColumn(firing, 2);
            grid.Children.Add(firing);
        }

        return grid;
    }

    // Web `flex items-center gap-1 text-xs text-cyan-300 animate-pulse`: the live "Firing" chip.
    private static StackPanel BuildFiringChip(AutomationCardDisplay display)
    {
        Brush accent = DisplayTokens.Brush("TsChartSpeedBrush");
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var glyph = new FontIcon
        {
            Glyph = AutomationCardRegistration.FiringGlyph,
            FontSize = MetaIconFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        row.Children.Add(glyph);
        row.Children.Add(new TextBlock
        {
            Text = display.FiringLabel,
            FontSize = MetaFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return row;
    }

    // Web `flex items-center gap-2 shrink-0`: the pin affordance, the enable toggle and the kebab menu.
    private StackPanel BuildHeaderActions(AutomationCardDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Top,
        };

        row.Children.Add(BuildPinButton(display));
        row.Children.Add(BuildToggle(display));
        row.Children.Add(BuildMenuButton(display));
        return row;
    }

    // Web `<PinButton itemType="automation" size="sm" />`: the pin / unpin affordance.
    private TsButton BuildPinButton(AutomationCardDisplay display)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = AutomationCardRegistration.PinGlyphFor(display.IsPinned),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, display.PinLabel);
        button.Click += OnPinClick;
        return button;
    }

    // Web `<Toggle checked={auto_disabled ? false : enabled} onChange={handleToggle} />`.
    private TsToggle BuildToggle(AutomationCardDisplay display)
    {
        var toggle = new TsToggle
        {
            IsOn = display.ToggleIsOn,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(toggle, display.ToggleLabel);

        // Subscribe AFTER seeding IsOn so the initial projection does not raise a spurious request.
        toggle.Toggled += OnToggleToggled;
        return toggle;
    }

    // Web kebab `<Button variant="ghost">` opening the actions dropdown.
    private TsButton BuildMenuButton(AutomationCardDisplay display)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = AutomationCardRegistration.MenuGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, display.MenuLabel);
        button.Flyout = BuildActionsMenu(display);
        return button;
    }

    // Web dropdown items: Test Run, [Re-enable when auto-disabled], Duplicate, Export, Delete.
    private MenuFlyout BuildActionsMenu(AutomationCardDisplay display)
    {
        var menu = new MenuFlyout();
        menu.Items.Add(MenuItem(display.TestRunLabel, AutomationCardRegistration.TestRunGlyph, OnTestRunClick));

        if (display.ShowReEnableMenuItem)
        {
            menu.Items.Add(MenuItem(display.ReEnableLabel, AutomationCardRegistration.ReEnableGlyph, OnReEnableClick));
        }

        menu.Items.Add(MenuItem(display.DuplicateLabel, AutomationCardRegistration.DuplicateGlyph, OnDuplicateClick));
        menu.Items.Add(MenuItem(display.ExportLabel, AutomationCardRegistration.ExportGlyph, OnExportClick));
        menu.Items.Add(MenuItem(display.DeleteLabel, AutomationCardRegistration.DeleteGlyph, OnDeleteClick));
        return menu;
    }

    private static MenuFlyoutItem MenuItem(string text, string glyph, RoutedEventHandler onClick)
    {
        var item = new MenuFlyoutItem
        {
            Text = text,
            Icon = new FontIcon { Glyph = glyph },
        };
        AutomationProperties.SetName(item, text);
        item.Click += onClick;
        return item;
    }

    // Web `mt-3 flex flex-wrap items-center gap-2 text-xs`: the scoped vehicle or the all-vehicles label.
    private static WrapRow BuildVehicleRow(AutomationCardDisplay display)
    {
        var wrap = new WrapRow { HorizontalSpacing = 8, VerticalSpacing = 6 };

        if (display.HasVehicleName)
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 4,
                VerticalAlignment = VerticalAlignment.Center,
            };
            var car = new FontIcon
            {
                Glyph = AutomationCardRegistration.VehicleGlyph,
                FontSize = MetaIconFontSize,
                Foreground = DisplayTokens.TextSecondary,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(car, AccessibilityView.Raw);
            row.Children.Add(car);
            row.Children.Add(MetaText(display.VehicleLabel));
            wrap.Children.Add(row);
        }
        else
        {
            wrap.Children.Add(MetaText(display.VehicleLabel));
        }

        return wrap;
    }

    // Web `mt-3 flex flex-wrap items-center gap-3 text-xs`: last-run / never-run, runs, fails, next-fire.
    private static WrapRow BuildStatsRow(AutomationCardDisplay display)
    {
        var wrap = new WrapRow { HorizontalSpacing = 12, VerticalSpacing = 6 };

        // Web: last_triggered_at -> CheckCircle + "Last: {ago}"; otherwise SkipForward + "Never run".
        if (display.ShowLastRun)
        {
            wrap.Children.Add(IconChip(
                AutomationCardRegistration.LastRunGlyph,
                display.LastRunText,
                DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success))));
        }
        else
        {
            wrap.Children.Add(IconChip(
                AutomationCardRegistration.NeverRunGlyph,
                display.NeverRunLabel,
                DisplayTokens.TextSecondary));
        }

        wrap.Children.Add(Separator());
        wrap.Children.Add(MetaText(display.RunsText));

        // Web: failure_count > 0 -> XCircle + "Fails: {n}".
        if (display.ShowFails)
        {
            wrap.Children.Add(Separator());
            wrap.Children.Add(IconChip(
                AutomationCardRegistration.FailsGlyph,
                display.FailsText,
                DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger))));
        }

        // Web: next_fire_time -> "Next: {formatDateTime}".
        if (display.ShowNextFire)
        {
            wrap.Children.Add(Separator());
            wrap.Children.Add(new TextBlock
            {
                Text = display.NextFireText,
                FontSize = MetaFontSize,
                Foreground = DisplayTokens.Brush("TsChartSpeedBrush"),
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return wrap;
    }

    // Web `mt-2 flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300`.
    private static Border BuildAutoDisabledBanner(AutomationCardDisplay display)
    {
        Brush accent = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger));
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };

        var icon = new FontIcon
        {
            Glyph = AutomationCardRegistration.WarningGlyph,
            FontSize = MetaIconFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);
        row.Children.Add(new TextBlock
        {
            Text = display.AutoDisabledReason,
            FontSize = MetaFontSize,
            Foreground = accent,
            TextWrapping = TextWrapping.Wrap,
        });

        return new Border
        {
            Child = row,
            Background = Tint(accent, TintOpacity),
            CornerRadius = new CornerRadius(BannerCornerRadius),
            Padding = new Thickness(BannerPadding),
        };
    }

    // Web `mt-2 space-y-1`: one amber (warning) or blue (info) banner per conflict.
    private static StackPanel BuildConflicts(AutomationCardDisplay display)
    {
        var stack = new StackPanel { Spacing = 4 };
        foreach (AutomationConflictDisplay conflict in display.Conflicts)
        {
            Brush accent = conflict.IsWarning
                ? DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Warning))
                : DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var icon = new FontIcon
            {
                Glyph = AutomationCardRegistration.WarningGlyph,
                FontSize = MetaIconFontSize,
                Foreground = accent,
                VerticalAlignment = VerticalAlignment.Top,
            };
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            row.Children.Add(icon);
            row.Children.Add(new TextBlock
            {
                Text = conflict.Text,
                FontSize = MetaFontSize,
                Foreground = accent,
                TextWrapping = TextWrapping.Wrap,
            });

            stack.Children.Add(new Border
            {
                Child = row,
                Background = Tint(accent, TintOpacity),
                CornerRadius = new CornerRadius(BannerCornerRadius),
                Padding = new Thickness(BannerPadding, 6, BannerPadding, 6),
            });
        }

        return stack;
    }

    private static StackPanel IconChip(string glyph, string text, Brush accent)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = MetaIconFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        row.Children.Add(icon);
        row.Children.Add(MetaText(text));
        return row;
    }

    private static TextBlock MetaText(string text) => new()
    {
        Text = text,
        FontSize = MetaFontSize,
        Foreground = DisplayTokens.TextSecondary,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // Web inter-stat "·" muted separator.
    private static TextBlock Separator() => new()
    {
        Text = "\u00B7",
        FontSize = MetaFontSize,
        Foreground = DisplayTokens.TextMuted,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void OnPinClick(object sender, RoutedEventArgs e) => PinToggleRequested?.Invoke(this, EventArgs.Empty);

    private void OnTestRunClick(object sender, RoutedEventArgs e) => TestRunRequested?.Invoke(this, EventArgs.Empty);

    private void OnReEnableClick(object sender, RoutedEventArgs e) => ReEnableRequested?.Invoke(this, EventArgs.Empty);

    private void OnDuplicateClick(object sender, RoutedEventArgs e) => DuplicateRequested?.Invoke(this, EventArgs.Empty);

    private void OnExportClick(object sender, RoutedEventArgs e) => ExportRequested?.Invoke(this, EventArgs.Empty);

    private void OnToggleToggled(object? sender, EventArgs e)
    {
        if (sender is not TsToggle toggle)
        {
            return;
        }

        bool requested = toggle.IsOn;

        // Web: re-enabling an auto-disabled automation turns it back on; otherwise it is an ordinary toggle.
        if (_model.AutoDisabled && requested)
        {
            ReEnableRequested?.Invoke(this, EventArgs.Empty);
        }
        else
        {
            ToggleRequested?.Invoke(this, requested);
        }
    }

    // Web: the delete menu item opens the destructive ConfirmDialog; confirming calls onDelete.
    private void OnDeleteClick(object sender, RoutedEventArgs e)
    {
        if (XamlRoot is null)
        {
            return;
        }

        AutomationCardDisplay display = _display;
        var dialog = new TsConfirmDialog
        {
            Title = display.DeleteTitle,
            Content = new TextBlock { Text = display.DeleteMessage, TextWrapping = TextWrapping.Wrap },
            PrimaryButtonText = display.DeleteConfirmLabel,
            CloseButtonText = display.CancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };
        dialog.PrimaryButtonClick += OnDeleteConfirmed;
        _ = dialog.ShowAsync();
    }

    private void OnDeleteConfirmed(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        DeleteRequested?.Invoke(this, EventArgs.Empty);

    // A token brush at reduced opacity for a chip / banner fill — the web `bg-{color}/10` tint. The shared
    // token brush instance is never mutated; a fresh brush carries the reduced opacity.
    private static Brush Tint(Brush brush, double opacity) =>
        brush is SolidColorBrush solid ? new SolidColorBrush(solid.Color) { Opacity = opacity } : brush;

    /// <summary>
    /// A minimal flow panel that lays its children left to right and wraps to a new row when the next child
    /// would overflow — the native analogue of the web meta rows' <c>flex-wrap</c>, so the card never clips
    /// its chips on a narrow surface.
    /// </summary>
    private sealed partial class WrapRow : Panel
    {
        /// <summary>Horizontal gap between items on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (UIElement child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                Size desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (UIElement child in Children)
            {
                Size desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}
