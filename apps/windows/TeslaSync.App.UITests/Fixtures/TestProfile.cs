namespace TeslaSync.App.UITests.Fixtures;

/// <summary>
/// The deterministic test profile injected into the app under test as process environment variables.
/// It pins the app to the in-process <see cref="FakeApiServer"/>, selects an authenticated or
/// signed-out session (with fake tokens that never touch a real identity provider or secure store),
/// and isolates settings to a throwaway profile directory so a run cannot read or mutate real user
/// state. WinAppDriver forwards this map to the launched process at session creation.
/// </summary>
public sealed class TestProfile
{
    private TestProfile(IReadOnlyDictionary<string, string> environment, string profileDirectory)
    {
        Environment = environment;
        ProfileDirectory = profileDirectory;
    }

    /// <summary>The environment variables passed to the app process.</summary>
    public IReadOnlyDictionary<string, string> Environment { get; }

    /// <summary>The throwaway settings/secure-store directory for this run.</summary>
    public string ProfileDirectory { get; }

    /// <summary>
    /// Build a profile pointing the app at <paramref name="apiBaseUrl"/>. When
    /// <paramref name="authenticated"/> is true the app boots with a fake live session; otherwise it
    /// boots signed-out so route-guard and sign-in coverage can drive the real auth flow.
    /// </summary>
    public static TestProfile Create(string apiBaseUrl, bool authenticated)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(apiBaseUrl);

        var profileDir = Path.Combine(
            Path.GetTempPath(),
            "teslasync-uia",
            DateTime.UtcNow.ToString("yyyyMMddHHmmss") + "-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(profileDir);

        var environment = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["TESLASYNC_TEST_MODE"] = "1",
            ["TESLASYNC_API_BASE_URL"] = apiBaseUrl,
            ["TESLASYNC_OIDC_AUTHORITY"] = apiBaseUrl + "/oauth",
            ["TESLASYNC_PROFILE_DIR"] = profileDir,
            ["TESLASYNC_DISABLE_TELEMETRY"] = "1",
            ["TESLASYNC_REDUCE_MOTION"] = "1",
            ["TESLASYNC_AUTH_MODE"] = authenticated ? "fake-authenticated" : "signed-out",
        };

        if (authenticated)
        {
            environment["TESLASYNC_FAKE_ACCESS_TOKEN"] = "fixture-access-token";
            environment["TESLASYNC_FAKE_REFRESH_TOKEN"] = "fixture-refresh-token";
        }

        return new TestProfile(environment, profileDir);
    }

    /// <summary>Remove the throwaway profile directory (best-effort) at the end of a run.</summary>
    public void Cleanup()
    {
        try
        {
            if (Directory.Exists(ProfileDirectory))
            {
                Directory.Delete(ProfileDirectory, recursive: true);
            }
        }
        catch (IOException)
        {
            // Leftover temp profiles are harmless; never fail teardown over them.
        }
        catch (UnauthorizedAccessException)
        {
            // Same — best-effort cleanup only.
        }
    }
}
