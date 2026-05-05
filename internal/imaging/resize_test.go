package imaging

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// makePNG returns a w×h PNG with optional alpha. When alpha=false
// the resulting image is opaque red; when alpha=true the centre
// pixel is fully transparent so FlattenAlpha can prove it composites
// onto the chosen background.
func makePNG(t *testing.T, w, h int, alpha bool) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 200, G: 50, B: 50, A: 255})
		}
	}
	if alpha {
		// Carve a transparent 2×2 block in the middle so the
		// flatten test has something concrete to assert.
		cx, cy := w/2, h/2
		for dy := 0; dy < 2 && cy+dy < h; dy++ {
			for dx := 0; dx < 2 && cx+dx < w; dx++ {
				img.Set(cx+dx, cy+dy, color.RGBA{R: 0, G: 0, B: 0, A: 0})
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode test png: %v", err)
	}
	return buf.Bytes()
}

func TestDecode_PNG_OK(t *testing.T) {
	src := makePNG(t, 100, 80, false)
	dec, err := Decode(bytes.NewReader(src))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if dec.Format != FormatPNG {
		t.Errorf("format = %q, want %q", dec.Format, FormatPNG)
	}
	if dec.Width != 100 || dec.Height != 80 {
		t.Errorf("dimensions = %d×%d, want 100×80", dec.Width, dec.Height)
	}
}

func TestDecode_UnsupportedFormat(t *testing.T) {
	// Bytes that don't match any registered decoder header.
	src := []byte("THIS_IS_NOT_AN_IMAGE_AT_ALL_xxxxxxxxxxxxxxxxxxxxx")
	_, err := Decode(bytes.NewReader(src))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err != ErrUnsupportedFormat {
		t.Errorf("err = %v, want ErrUnsupportedFormat", err)
	}
}

func TestDecode_InvalidImage_TruncatedPNG(t *testing.T) {
	full := makePNG(t, 50, 50, false)
	// Truncate the body — the header survives DecodeConfig but
	// image.Decode will fail when it tries to parse pixel data.
	truncated := full[:len(full)/2]
	_, err := Decode(bytes.NewReader(truncated))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err == ErrUnsupportedFormat || err == ErrTooLarge {
		t.Errorf("err = %v, want ErrInvalidImage wrap", err)
	}
}

func TestResize_NoUpscale(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 200, 100))
	dst := Resize(src, 1024)
	bounds := dst.Bounds()
	if bounds.Dx() != 200 || bounds.Dy() != 100 {
		t.Errorf("upscaled to %dx%d, want unchanged 200x100", bounds.Dx(), bounds.Dy())
	}
	// Verify the same pointer comes back — Resize should return src
	// verbatim, no copy.
	if dst != image.Image(src) {
		t.Error("Resize returned a copy when no resize was needed; expected source pass-through")
	}
}

func TestResize_DownscaleLandscape(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 4000, 2000))
	dst := Resize(src, 1024)
	bounds := dst.Bounds()
	if bounds.Dx() != 1024 {
		t.Errorf("width = %d, want 1024", bounds.Dx())
	}
	// Aspect ratio: 4000/2000 = 2.0 → 1024/x = 2.0 → x = 512.
	if bounds.Dy() != 512 {
		t.Errorf("height = %d, want 512 (aspect-preserved)", bounds.Dy())
	}
}

func TestResize_DownscalePortrait(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 2000, 4000))
	dst := Resize(src, 1024)
	bounds := dst.Bounds()
	if bounds.Dy() != 1024 {
		t.Errorf("height = %d, want 1024", bounds.Dy())
	}
	if bounds.Dx() != 512 {
		t.Errorf("width = %d, want 512 (aspect-preserved)", bounds.Dx())
	}
}

func TestFlattenAlpha_TransparentSourceGetsBackground(t *testing.T) {
	// Build a 4x4 fully transparent source.
	src := image.NewRGBA(image.Rect(0, 0, 4, 4))
	flattened := FlattenAlpha(src, color.RGBA{R: 255, G: 255, B: 255, A: 255})
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			r, g, b, a := flattened.At(x, y).RGBA()
			if r>>8 != 255 || g>>8 != 255 || b>>8 != 255 || a>>8 != 255 {
				t.Fatalf("pixel(%d,%d) = (%d,%d,%d,%d), want opaque white",
					x, y, r>>8, g>>8, b>>8, a>>8)
			}
		}
	}
}

func TestFlattenAlpha_OpaqueSourcePreserved(t *testing.T) {
	// Opaque red source — FlattenAlpha should preserve the colour
	// even though it copies into a fresh RGBA.
	src := image.NewRGBA(image.Rect(0, 0, 2, 2))
	red := color.RGBA{R: 220, G: 30, B: 30, A: 255}
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			src.Set(x, y, red)
		}
	}
	flattened := FlattenAlpha(src, color.RGBA{R: 255, G: 255, B: 255, A: 255})
	r, g, b, a := flattened.At(0, 0).RGBA()
	if r>>8 != 220 || g>>8 != 30 || b>>8 != 30 || a>>8 != 255 {
		t.Errorf("opaque pixel mutated: got (%d,%d,%d,%d), want (220,30,30,255)",
			r>>8, g>>8, b>>8, a>>8)
	}
}

func TestEncodeJPEG_RoundTrip(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			src.Set(x, y, color.RGBA{R: uint8(x * 8), G: uint8(y * 8), B: 100, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := EncodeJPEG(&buf, src); err != nil {
		t.Fatalf("encode: %v", err)
	}
	dec, err := Decode(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatalf("re-decode: %v", err)
	}
	if dec.Format != FormatJPEG {
		t.Errorf("round-trip format = %q, want %q", dec.Format, FormatJPEG)
	}
	if dec.Width != 32 || dec.Height != 32 {
		t.Errorf("round-trip dims = %dx%d, want 32x32", dec.Width, dec.Height)
	}
}

func TestWhiteBackground_IsOpaqueWhite(t *testing.T) {
	r, g, b, a := WhiteBackground().RGBA()
	if r>>8 != 255 || g>>8 != 255 || b>>8 != 255 || a>>8 != 255 {
		t.Errorf("WhiteBackground = (%d,%d,%d,%d), want (255,255,255,255)",
			r>>8, g>>8, b>>8, a>>8)
	}
}
