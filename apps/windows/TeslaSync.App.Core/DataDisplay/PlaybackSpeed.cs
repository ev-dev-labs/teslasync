namespace TeslaSync.App.Core.DataDisplay;

/// <summary>
/// Trip-replay playback speed slots and stepping logic (port of the web
/// <c>PlaybackSpeedMenu</c> constants/helpers). Backs <c>TsPlaybackSpeedMenu</c>
/// and <c>TsPlaybackControls</c>.
/// </summary>
public static class PlaybackSpeed
{
    /// <summary>Available replay speed multipliers, slowest → fastest.</summary>
    public static IReadOnlyList<int> Speeds { get; } = new[] { 1, 10, 25, 50, 100 };

    /// <summary>Step the speed up/down by <paramref name="delta"/> slots (clamped).</summary>
    public static int Shift(int current, int delta)
    {
        int idx = IndexOf(current);
        int safeIdx = idx == -1 ? 0 : idx;
        int nextIdx = Math.Max(0, Math.Min(Speeds.Count - 1, safeIdx + delta));
        return Speeds[nextIdx];
    }

    /// <summary>Cycle to the next-fastest speed, wrapping back to the slowest.</summary>
    public static int Next(int current)
    {
        int idx = IndexOf(current);
        return Speeds[(idx + 1) % Speeds.Count];
    }

    private static int IndexOf(int speed)
    {
        for (int i = 0; i < Speeds.Count; i++)
        {
            if (Speeds[i] == speed)
            {
                return i;
            }
        }

        return -1;
    }
}
