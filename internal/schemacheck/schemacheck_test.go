package schemacheck

import "testing"

func TestDiff_NoChange(t *testing.T) {
	a := Fingerprint{SHA256: "abc", TableCount: 10, ColumnCount: 100, IndexCount: 50}
	d := Diff(a, a, "")
	if d.HasDrift {
		t.Fatal("identical fingerprints should not drift")
	}
	if d.TableCountDelta != 0 || d.ColumnCountDelta != 0 || d.IndexCountDelta != 0 {
		t.Fatal("identical fingerprints must report zero deltas")
	}
}

func TestDiff_DetectsTableAdditive(t *testing.T) {
	expected := Fingerprint{SHA256: "old", TableCount: 10, ColumnCount: 100, IndexCount: 50}
	current := Fingerprint{SHA256: "new", TableCount: 12, ColumnCount: 100, IndexCount: 50}
	d := Diff(current, expected, "")
	if !d.HasDrift {
		t.Fatal("different SHA must report drift")
	}
	if d.TableCountDelta != 2 {
		t.Fatalf("expected +2 tables, got %d", d.TableCountDelta)
	}
	if d.ColumnCountDelta != 0 || d.IndexCountDelta != 0 {
		t.Fatal("only table delta should be non-zero")
	}
}

func TestDiff_DetectsRemoval(t *testing.T) {
	expected := Fingerprint{SHA256: "old", TableCount: 10, ColumnCount: 100, IndexCount: 50}
	current := Fingerprint{SHA256: "new", TableCount: 9, ColumnCount: 95, IndexCount: 45}
	d := Diff(current, expected, "")
	if d.TableCountDelta != -1 {
		t.Fatalf("expected -1 tables, got %d", d.TableCountDelta)
	}
	if d.ColumnCountDelta != -5 {
		t.Fatalf("expected -5 columns, got %d", d.ColumnCountDelta)
	}
	if d.IndexCountDelta != -5 {
		t.Fatalf("expected -5 indexes, got %d", d.IndexCountDelta)
	}
}

func TestDiff_ExpectedGeneratedAtThreaded(t *testing.T) {
	d := Diff(Fingerprint{}, Fingerprint{}, "2026-01-01T00:00:00Z")
	if d.ExpectedGeneratedAt != "2026-01-01T00:00:00Z" {
		t.Fatalf("expectedGeneratedAt not threaded through: %q", d.ExpectedGeneratedAt)
	}
}
