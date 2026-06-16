namespace TeslaSync.App.Core.Units;

/// <summary>
/// Process-wide ambient display-unit preference. The web resolves units per render via
/// <c>useUnits()</c>; the native shell mirrors that by publishing the account's resolved preference here
/// so that any ViewModel, projection or component constructed WITHOUT an explicit <see cref="UnitPref"/>
/// falls back to the user's choice instead of hard-coded metric. Unit-aware fallbacks therefore read
/// <c>units ?? UnitPrefAmbient.Current</c> rather than <c>units ?? UnitPrefAmbient.Current</c>.
///
/// <para>Defaults to <see cref="UnitPref.Metric"/> (SI) until the shell publishes the resolved preference.
/// Only the shell mutates it (at startup and whenever the settings change), so unit tests — which never
/// touch the shell — keep the metric default and stay deterministic. A <see cref="UnitPref"/> is an
/// immutable record reference, so reads/writes of <see cref="Current"/> are atomic and need no locking.</para>
/// </summary>
public static class UnitPrefAmbient
{
    /// <summary>The current ambient display-unit preference (never null; defaults to metric).</summary>
    public static UnitPref Current { get; set; } = UnitPref.Metric;
}
