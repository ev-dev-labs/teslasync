package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Provider converts text into embedding vectors. Implementations must be
// safe for concurrent use by multiple goroutines.
type Provider interface {
	// Embed computes the vector for a single piece of text.
	Embed(ctx context.Context, text string) ([]float32, error)
	// EmbedBatch computes vectors for a batch of inputs. Implementations may
	// split the request internally; the returned slice is always aligned
	// positionally with the input slice.
	EmbedBatch(ctx context.Context, texts []string) ([][]float32, error)
	// Dimensions returns the embedding dimensionality produced by this
	// provider. Used to sanity-check against the `vector(N)` column type.
	Dimensions() int
	// Model returns the underlying model identifier (stored alongside the
	// embedding for auditability and future re-embeds).
	Model() string
}

// OpenAIProvider calls the OpenAI embeddings REST API.
//
// Docs: https://platform.openai.com/docs/api-reference/embeddings
type OpenAIProvider struct {
	apiKey     string
	model      string
	dimensions int
	baseURL    string
	client     *http.Client
}

// OpenAIConfig are the knobs required to build an OpenAIProvider.
type OpenAIConfig struct {
	APIKey     string
	Model      string        // default: "text-embedding-3-small"
	Dimensions int           // default: 1536
	BaseURL    string        // default: "https://api.openai.com/v1"
	Timeout    time.Duration // default: 30s
}

// NewOpenAIProvider constructs a provider. Returns an error if APIKey is empty.
func NewOpenAIProvider(cfg OpenAIConfig) (*OpenAIProvider, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("openai embedding: api key is required")
	}
	if cfg.Model == "" {
		cfg.Model = "text-embedding-3-small"
	}
	if cfg.Dimensions == 0 {
		cfg.Dimensions = 1536
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://api.openai.com/v1"
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	return &OpenAIProvider{
		apiKey:     cfg.APIKey,
		model:      cfg.Model,
		dimensions: cfg.Dimensions,
		baseURL:    strings.TrimRight(cfg.BaseURL, "/"),
		client:     &http.Client{Timeout: cfg.Timeout},
	}, nil
}

func (p *OpenAIProvider) Dimensions() int { return p.dimensions }
func (p *OpenAIProvider) Model() string   { return p.model }

func (p *OpenAIProvider) Embed(ctx context.Context, text string) ([]float32, error) {
	vecs, err := p.EmbedBatch(ctx, []string{text})
	if err != nil {
		return nil, err
	}
	if len(vecs) != 1 {
		return nil, fmt.Errorf("openai embedding: expected 1 vector, got %d", len(vecs))
	}
	return vecs[0], nil
}

type openAIEmbedRequest struct {
	Input          []string `json:"input"`
	Model          string   `json:"model"`
	EncodingFormat string   `json:"encoding_format,omitempty"`
}

type openAIEmbedResponse struct {
	Data []struct {
		Index     int       `json:"index"`
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

func (p *OpenAIProvider) EmbedBatch(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	reqBody, err := json.Marshal(openAIEmbedRequest{
		Input:          texts,
		Model:          p.model,
		EncodingFormat: "float",
	})
	if err != nil {
		return nil, fmt.Errorf("openai embedding: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/embeddings", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("openai embedding: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openai embedding: http call: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("openai embedding: read body: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("openai embedding: http %d: %s", resp.StatusCode, truncate(string(body), 500))
	}

	var parsed openAIEmbedResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("openai embedding: decode response: %w", err)
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("openai embedding: %s: %s", parsed.Error.Type, parsed.Error.Message)
	}
	if len(parsed.Data) != len(texts) {
		return nil, fmt.Errorf("openai embedding: expected %d vectors, got %d", len(texts), len(parsed.Data))
	}

	// API returns items in an arbitrary order with an explicit Index field.
	out := make([][]float32, len(texts))
	for _, item := range parsed.Data {
		if item.Index < 0 || item.Index >= len(out) {
			return nil, fmt.Errorf("openai embedding: invalid index %d", item.Index)
		}
		if len(item.Embedding) != p.dimensions {
			return nil, fmt.Errorf("openai embedding: model returned dim %d, configured %d", len(item.Embedding), p.dimensions)
		}
		out[item.Index] = item.Embedding
	}
	return out, nil
}

// StubProvider is a deterministic, offline provider used in tests. It
// hashes the input text into a fixed-dimension float32 vector. It is NOT
// semantically meaningful — its only guarantee is that identical inputs
// produce identical vectors so test assertions are stable.
type StubProvider struct {
	dim   int
	model string
}

// NewStubProvider returns a StubProvider with the given dimensionality.
func NewStubProvider(dim int) *StubProvider {
	if dim <= 0 {
		dim = 1536
	}
	return &StubProvider{dim: dim, model: "stub"}
}

func (p *StubProvider) Dimensions() int { return p.dim }
func (p *StubProvider) Model() string   { return p.model }

func (p *StubProvider) Embed(_ context.Context, text string) ([]float32, error) {
	vec := make([]float32, p.dim)
	// Simple deterministic hash spread across dimensions.
	for i, r := range text {
		vec[i%p.dim] += float32(r) / 1000.0
	}
	return vec, nil
}

func (p *StubProvider) EmbedBatch(ctx context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i, t := range texts {
		v, err := p.Embed(ctx, t)
		if err != nil {
			return nil, err
		}
		out[i] = v
	}
	return out, nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
