// Package imaging — Phase-46 / Prompt 54.
//
// Thin facade over the standard library's image codecs. The vehicle
// photo handler is the only consumer today; the package is
// intentionally narrow so a future avatar / charger photo flow can
// reuse it without inheriting handler-specific concerns.
//
// Why a separate package
// ----------------------
// The handler has its own concerns (multipart parsing, body limits,
// disk layout, DB transactions) — pixel decoding and resampling are
// pure functions that compose cleanly behind a stable interface and
// are easier to fuzz / benchmark in isolation. Keeping them here also
// means a future swap of the resampling backend (CGO-backed libvips,
// golang.org/x/image/draw.CatmullRom, etc.) only touches one file.
//
// Pure-stdlib build
// -----------------
// Per the prompt's Blocked Path, this package falls back to the Go
// standard library only — no golang.org/x/image dependency — so
// go.mod stays untouched (the prompt's allowed-files list does not
// include go.mod / go.sum). Tradeoffs accepted:
//
//   - Decode supports JPEG and PNG only. WebP requires an external
//     decoder (golang.org/x/image/webp); operators wanting WebP
//     uploads can transcode client-side or wait for a follow-up
//     prompt that adds the dep through the proper allowlist.
//   - Resize uses bilinear sampling implemented inline below — sharper
//     than nearest-neighbor (which the Blocked Path explicitly
//     authorises) but still pure-Go. Catmull-Rom from x/image/draw
//     would give nicer edges; bilinear is a deliberate compromise
//     between quality and dependency footprint.
//   - EncodeJPEG is the single output path. Quality is fixed at
//     PreferredJPEGQuality so all three rendered sizes ship with the
//     same compression character.
//
// EXIF handling
// -------------
// The image/jpeg decoder discards EXIF metadata at decode time and
// re-encoding as JPEG never re-adds it, so the handler gets EXIF
// stripping for free without an extra parser.
package imaging

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png" // registers PNG decoder with image.Decode / image.DecodeConfig
	"io"
)

// Format names returned by image.DecodeConfig that we accept on
// upload. Centralised so the handler and tests share one source of
// truth.
//
// NOTE: WebP is intentionally absent — see the package doc's
// "Pure-stdlib build" note. A follow-up prompt that adds
// golang.org/x/image to go.mod can re-introduce FormatWebP here
// without touching the handler.
const (
	FormatJPEG = "jpeg"
	FormatPNG  = "png"
)

// PreferredJPEGQuality is the encode quality used for every rendered
// size. 85 sits at the visual-quality / file-size knee for typical
// photos; values above 90 inflate file size sharply with little
// perceptual gain.
const PreferredJPEGQuality = 85

// MaxPixels caps the decoded image area BEFORE we resample. A naive
// image.Decode of an 8 MB PNG can balloon into hundreds of MB of
// pixel buffer (RGBA at 4 bytes/pixel). 64 MP gives a generous
// 8000×8000 ceiling — well above any photo a normal user would take
// — while keeping a single decode under ~256 MB of pixel memory.
const MaxPixels = 64 * 1000 * 1000

// Sentinel errors. Wrap with fmt.Errorf("..%w") if extra context is
// useful at the callsite; the handler maps these directly to 4xx
// responses.
var (
	// ErrUnsupportedFormat is returned by Decode when the source
	// bytes don't decode as JPEG, PNG, or WebP. Maps to
	// 415 Unsupported Media Type at the handler boundary.
	ErrUnsupportedFormat = errors.New("imaging: unsupported format")
	// ErrTooLarge is returned by Decode when the source dimensions
	// exceed MaxPixels. Maps to 413 Request Entity Too Large.
	ErrTooLarge = errors.New("imaging: image too large")
	// ErrInvalidImage is returned by Decode when the source bytes
	// fail to parse even though the format header validated.
	// Maps to 400 Bad Request.
	ErrInvalidImage = errors.New("imaging: invalid image data")
)

// DecodedImage wraps the decoded pixel buffer with the format
// detected by image.DecodeConfig. The format string is echoed so the
// handler can emit it on debug logs without re-sniffing.
type DecodedImage struct {
	Image  image.Image
	Format string
	Width  int
	Height int
}

// Seeker is the input contract for Decode. image.DecodeConfig
// consumes the header so we have to rewind before image.Decode runs;
// any *bytes.Reader / *bytes.Buffer (via NewReader) / *os.File
// satisfies it.
type Seeker interface {
	io.Reader
	io.Seeker
}

// Decode reads the image from r, validates the format and
// dimensions, and returns the decoded pixel buffer.
//
// Decoding happens in two passes:
//  1. image.DecodeConfig reads only the header (cheap) so we can
//     reject a 100 MP "image bomb" without allocating its pixel
//     buffer.
//  2. image.Decode does the full decode once we know the dimensions
//     are within MaxPixels.
//
// r must be seekable (image.DecodeConfig consumes the header). The
// handler always passes a *bytes.Reader after reading the multipart
// part into memory; the body limit means that bytes.Reader is
// bounded.
func Decode(r Seeker) (*DecodedImage, error) {
	cfg, format, err := image.DecodeConfig(r)
	if err != nil {
		// image.DecodeConfig returns image.ErrFormat when no
		// registered decoder recognised the header. Other errors
		// (truncated header, etc.) bucket as "invalid image".
		if errors.Is(err, image.ErrFormat) {
			return nil, ErrUnsupportedFormat
		}
		return nil, fmt.Errorf("%w: decode header: %v", ErrInvalidImage, err)
	}
	if !isAcceptedFormat(format) {
		return nil, ErrUnsupportedFormat
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, ErrInvalidImage
	}
	if int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return nil, ErrTooLarge
	}

	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("imaging: rewind: %w", err)
	}
	img, _, err := image.Decode(r)
	if err != nil {
		return nil, fmt.Errorf("%w: decode body: %v", ErrInvalidImage, err)
	}
	bounds := img.Bounds()
	return &DecodedImage{
		Image:  img,
		Format: format,
		Width:  bounds.Dx(),
		Height: bounds.Dy(),
	}, nil
}

func isAcceptedFormat(format string) bool {
	switch format {
	case FormatJPEG, FormatPNG:
		return true
	default:
		return false
	}
}

// Resize returns a new image scaled so the longest side is no more
// than maxDim pixels. Aspect ratio is preserved. If the source is
// already smaller than maxDim along both axes, the source is
// returned UNCHANGED (no upscaling — upscaling JPEGs adds artifacts
// without adding information).
//
// Sampling is bilinear, implemented inline with the standard
// library's image package. See the package doc for the rationale —
// nearest-neighbor (the Blocked-Path baseline) is uglier on photos
// and Catmull-Rom from x/image/draw can't land here without bumping
// go.mod.
func Resize(src image.Image, maxDim int) image.Image {
	if maxDim <= 0 {
		return src
	}
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w <= maxDim && h <= maxDim {
		return src
	}
	var newW, newH int
	if w >= h {
		newW = maxDim
		newH = int(float64(h) * float64(maxDim) / float64(w))
		if newH < 1 {
			newH = 1
		}
	} else {
		newH = maxDim
		newW = int(float64(w) * float64(maxDim) / float64(h))
		if newW < 1 {
			newW = 1
		}
	}
	return resampleBilinear(src, newW, newH)
}

// resampleBilinear is a small, allocation-light bilinear resampler
// that works on any image.Image (not just *image.RGBA). It samples
// the source at the four neighbours of each destination pixel's
// centre and blends them by area weight. Output is *image.RGBA so
// the JPEG encoder can pack pixels efficiently downstream.
//
// The implementation favours readability over micro-optimisation —
// the 8 MB / 64 MP body cap means even worst-case input downscales
// in well under 100 ms on commodity hardware, which is plenty for a
// once-per-vehicle upload flow.
func resampleBilinear(src image.Image, dstW, dstH int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	if dstW <= 0 || dstH <= 0 {
		return dst
	}
	srcBounds := src.Bounds()
	srcW := srcBounds.Dx()
	srcH := srcBounds.Dy()
	if srcW <= 0 || srcH <= 0 {
		return dst
	}
	// Map each destination pixel's centre back to a source-space
	// floating-point coordinate. The +0.5 offsets centre the sample
	// in the destination pixel; they are necessary to avoid the
	// half-pixel shift bias that "naive" mappings produce on
	// non-integer scale factors.
	scaleX := float64(srcW) / float64(dstW)
	scaleY := float64(srcH) / float64(dstH)
	maxX := srcW - 1
	maxY := srcH - 1
	for y := 0; y < dstH; y++ {
		fy := (float64(y)+0.5)*scaleY - 0.5
		y0 := int(fy)
		if y0 < 0 {
			y0 = 0
		}
		y1 := y0 + 1
		if y1 > maxY {
			y1 = maxY
		}
		dy := fy - float64(y0)
		if dy < 0 {
			dy = 0
		} else if dy > 1 {
			dy = 1
		}
		for x := 0; x < dstW; x++ {
			fx := (float64(x)+0.5)*scaleX - 0.5
			x0 := int(fx)
			if x0 < 0 {
				x0 = 0
			}
			x1 := x0 + 1
			if x1 > maxX {
				x1 = maxX
			}
			dx := fx - float64(x0)
			if dx < 0 {
				dx = 0
			} else if dx > 1 {
				dx = 1
			}
			r00, g00, b00, a00 := src.At(srcBounds.Min.X+x0, srcBounds.Min.Y+y0).RGBA()
			r10, g10, b10, a10 := src.At(srcBounds.Min.X+x1, srcBounds.Min.Y+y0).RGBA()
			r01, g01, b01, a01 := src.At(srcBounds.Min.X+x0, srcBounds.Min.Y+y1).RGBA()
			r11, g11, b11, a11 := src.At(srcBounds.Min.X+x1, srcBounds.Min.Y+y1).RGBA()
			r := bilinear(float64(r00), float64(r10), float64(r01), float64(r11), dx, dy)
			g := bilinear(float64(g00), float64(g10), float64(g01), float64(g11), dx, dy)
			b := bilinear(float64(b00), float64(b10), float64(b01), float64(b11), dx, dy)
			a := bilinear(float64(a00), float64(a10), float64(a01), float64(a11), dx, dy)
			dst.SetRGBA(x, y, color.RGBA{
				R: uint8(clamp(r) >> 8),
				G: uint8(clamp(g) >> 8),
				B: uint8(clamp(b) >> 8),
				A: uint8(clamp(a) >> 8),
			})
		}
	}
	return dst
}

// bilinear blends the four neighbour samples by horizontal weight dx
// and vertical weight dy, both ∈ [0,1].
func bilinear(c00, c10, c01, c11, dx, dy float64) float64 {
	top := c00*(1-dx) + c10*dx
	bot := c01*(1-dx) + c11*dx
	return top*(1-dy) + bot*dy
}

// clamp constrains a 16-bit-premultiplied component back into the
// valid range. image.Color.RGBA() returns 16-bit values; floating
// point intermediates can drift slightly above 0xffff or below 0
// due to rounding.
func clamp(v float64) uint32 {
	if v <= 0 {
		return 0
	}
	if v >= 0xffff {
		return 0xffff
	}
	return uint32(v + 0.5)
}

// FlattenAlpha composites src onto a solid background of bg and
// returns an opaque RGBA image. JPEG has no alpha channel, so any
// transparent pixels would otherwise be encoded as black or noise.
//
// When src is already fully opaque the function still allocates a
// fresh RGBA — encoders like jpeg.Encode prefer a packed RGBA over
// arbitrary image.Image implementations, and the cost (one full
// blit) is negligible at our size cap.
func FlattenAlpha(src image.Image, bg color.Color) *image.RGBA {
	bounds := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	// Fill background first so transparent / partially transparent
	// source pixels blend against it.
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)
	draw.Draw(dst, dst.Bounds(), src, bounds.Min, draw.Over)
	return dst
}

// EncodeJPEG writes img to w as a JPEG at PreferredJPEGQuality.
// Callers wrapping a *os.File can fsync after to guarantee
// durability before the DB row commits.
func EncodeJPEG(w io.Writer, img image.Image) error {
	if err := jpeg.Encode(w, img, &jpeg.Options{Quality: PreferredJPEGQuality}); err != nil {
		return fmt.Errorf("imaging: encode jpeg: %w", err)
	}
	return nil
}

// whiteBackground is the opaque white background used when
// flattening a transparent source for JPEG output. Kept as a package
// var (not const) so a future config knob could swap it without
// changing the public WhiteBackground() signature.
var whiteBackground = color.RGBA{R: 255, G: 255, B: 255, A: 255}

// WhiteBackground is the canonical opaque background used when
// flattening a transparent source for JPEG output. Exported so the
// handler tests can assert the colour without duplicating the
// literal.
func WhiteBackground() color.Color { return whiteBackground }
