using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The commit + compare seam the date-range picker announces through (P1/S8 state-holder layer) — the native
/// port of the web component's <c>onChange</c> and <c>onCompareChange</c> callback props
/// (web/src/components/forms/RangePicker.tsx L45 + L61). The web control is fully controlled: picking a preset or
/// pressing Apply never mutates its own <c>value</c>, it calls <c>onChange(range, presetId?)</c> and the parent
/// feeds the new range back down; flipping the comparison toggle calls <c>onCompareChange(next)</c> and the
/// parent owns the flag. This seam is those callbacks; a host wires them to its filter state. The view never
/// touches this seam directly — it binds through the <see cref="RangePickerViewModel"/>.
/// </summary>
public interface IRangePickerSink
{
    /// <summary>
    /// Announce a committed range (web <c>onChange(value, presetId?)</c>). <paramref name="presetId"/> carries the
    /// chosen preset id when the commit came from a preset click, or null when it came from the calendar's Apply.
    /// </summary>
    void OnChange(DateRange value, string? presetId);

    /// <summary>Announce that the comparison toggle was flipped (web <c>onCompareChange(next)</c>).</summary>
    void OnCompareChange(bool enabled);
}

/// <summary>
/// A delegate-backed <see cref="IRangePickerSink"/> — the canonical implementation a host builds from its filter
/// state setters (the native analogue of passing <c>onChange</c> / <c>onCompareChange</c> as the web component's
/// props). A <see langword="null"/> delegate degrades to a no-op so a partially-wired host never throws.
/// </summary>
public sealed class DelegateRangePickerSink : IRangePickerSink
{
    private readonly Action<DateRange, string?>? _onChange;
    private readonly Action<bool>? _onCompareChange;

    /// <summary>Creates the sink from its change delegates (web <c>onChange</c> / <c>onCompareChange</c>); null delegates are inert.</summary>
    /// <param name="onChange">The committed-range delegate (web <c>onChange</c>).</param>
    /// <param name="onCompareChange">The comparison-toggle delegate (web <c>onCompareChange</c>); optional, like the web prop.</param>
    public DelegateRangePickerSink(Action<DateRange, string?>? onChange, Action<bool>? onCompareChange = null)
    {
        _onChange = onChange;
        _onCompareChange = onCompareChange;
    }

    /// <inheritdoc />
    public void OnChange(DateRange value, string? presetId) => _onChange?.Invoke(value, presetId);

    /// <inheritdoc />
    public void OnCompareChange(bool enabled) => _onCompareChange?.Invoke(enabled);
}

/// <summary>
/// The inert commit sink — every announcement is dropped. Used as the safe default when a host has not wired the
/// change handlers yet (e.g. a gallery / design host, or the parameterless view), so the picker still renders,
/// stages and toggles its displayed state without an outward seam to drive. This is the native analogue of
/// mounting the web component in isolation with no-op callbacks.
/// </summary>
public sealed class NoOpRangePickerSink : IRangePickerSink
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpRangePickerSink Instance { get; } = new();

    private NoOpRangePickerSink()
    {
    }

    /// <inheritdoc />
    public void OnChange(DateRange value, string? presetId)
    {
        // No host handler wired — the announcement is dropped, like a web onChange that does nothing.
    }

    /// <inheritdoc />
    public void OnCompareChange(bool enabled)
    {
        // No host handler wired — the announcement is dropped, like a web onCompareChange that does nothing.
    }
}
