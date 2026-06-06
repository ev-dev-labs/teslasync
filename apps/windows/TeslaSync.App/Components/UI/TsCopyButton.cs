using Microsoft.UI.Xaml;
using Windows.ApplicationModel.DataTransfer;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized copy-to-clipboard button (mirrors the web <c>CopyButton</c>). Copies
/// <see cref="ValueToCopy"/> on click and briefly swaps its label to
/// <see cref="CopiedLabel"/> for confirmation before reverting. Labels are
/// consumer-supplied (localized).
/// </summary>
public partial class TsCopyButton : TsButton
{
    private readonly DispatcherTimer _revertTimer = new() { Interval = TimeSpan.FromMilliseconds(1500) };

    public static readonly DependencyProperty ValueToCopyProperty = DependencyProperty.Register(
        nameof(ValueToCopy), typeof(string), typeof(TsCopyButton),
        new PropertyMetadata(null));

    public static readonly DependencyProperty CopyLabelProperty = DependencyProperty.Register(
        nameof(CopyLabel), typeof(string), typeof(TsCopyButton),
        new PropertyMetadata(null, OnLabelChanged));

    public static readonly DependencyProperty CopiedLabelProperty = DependencyProperty.Register(
        nameof(CopiedLabel), typeof(string), typeof(TsCopyButton),
        new PropertyMetadata(null));

    public TsCopyButton()
    {
        Variant = Core.ButtonVariant.Subtle;
        IconGlyph = "\uE8C8";
        Click += OnCopyClick;
        _revertTimer.Tick += (s, e) =>
        {
            _revertTimer.Stop();
            Text = CopyLabel;
        };
    }

    /// <summary>The raw value placed on the clipboard.</summary>
    public string? ValueToCopy
    {
        get => (string?)GetValue(ValueToCopyProperty);
        set => SetValue(ValueToCopyProperty, value);
    }

    /// <summary>Localized idle label.</summary>
    public string? CopyLabel
    {
        get => (string?)GetValue(CopyLabelProperty);
        set => SetValue(CopyLabelProperty, value);
    }

    /// <summary>Localized confirmation label shown briefly after a copy.</summary>
    public string? CopiedLabel
    {
        get => (string?)GetValue(CopiedLabelProperty);
        set => SetValue(CopiedLabelProperty, value);
    }

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var button = (TsCopyButton)d;
        if (!button._revertTimer.IsEnabled)
        {
            button.Text = button.CopyLabel;
        }
    }

    private void OnCopyClick(object sender, RoutedEventArgs e)
    {
        var package = new DataPackage();
        package.SetText(ValueToCopy ?? string.Empty);
        Clipboard.SetContent(package);

        if (!string.IsNullOrEmpty(CopiedLabel))
        {
            Text = CopiedLabel;
        }

        _revertTimer.Stop();
        _revertTimer.Start();
    }
}
