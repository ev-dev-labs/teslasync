package settings

import "testing"

func TestFontPresetsAcceptedBySettings(t *testing.T) {
	for _, id := range []string{
		"inter", "system", "roboto", "source", "plex", "atkinson", "nunito",
		"dm-sans", "manrope", "outfit", "poppins", "work-sans", "public-sans",
		"lato", "open-sans", "noto-sans", "custom",
	} {
		if !validFontFamily[id] {
			t.Errorf("UI font %q must be accepted by settings", id)
		}
	}
	for _, id := range []string{
		"jetbrains", "fira", "plex-mono", "source-code-pro", "roboto-mono",
		"inconsolata", "space-mono", "ubuntu-mono", "system", "custom",
	} {
		if !validFontMono[id] {
			t.Errorf("monospace font %q must be accepted by settings", id)
		}
	}
	if validFontFamily["unknown"] || validFontMono["unknown"] {
		t.Fatal("unrecognized font IDs must be rejected")
	}
}
