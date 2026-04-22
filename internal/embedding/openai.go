package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
)

// OpenAIProvider implements EmbeddingProvider against the OpenAI HTTP API
// (https://api.openai.com/v1/embeddings). It uses the model and dimension
// configured via EmbeddingConfig.
//
// The provider does not retry on transient errors; callers should wrap
// invocations with their own retry/backoff (the embedding worker does so).
type OpenAIProvider struct {
	apiKey     string
	model      string
	dimensions int
	endpoint   string
	client     *http.Client
}

// NewOpenAIProvider constructs an OpenAI-backed embedding provider.
func NewOpenAIProvider(apiKey, model string, dimensions int) *OpenAIProvider {
	if model == "" {
		model = "text-embedding-3-small"
	}
	if dimensions <= 0 {
		dimensions = 1536
	}
	return &OpenAIProvider{
		apiKey:     apiKey,
		model:      model,
		dimensions: dimensions,
		endpoint:   "https://api.openai.com/v1/embeddings",
		client:     &http.Client{Timeout: 30 * time.Second},
	}
}

// Dimensions returns the embedding vector size.
func (p *OpenAIProvider) Dimensions() int { return p.dimensions }

type openaiRequest struct {
	Input []string `json:"input"`
	Model string   `json:"model"`
}

type openaiResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

// Embed returns a single vector for one piece of text.
func (p *OpenAIProvider) Embed(ctx context.Context, text string) ([]float32, error) {
	out, err := p.EmbedBatch(ctx, []string{text})
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("openai: no embedding returned")
	}
	return out[0], nil
}

// EmbedBatch returns vectors for a batch of texts in input order.
func (p *OpenAIProvider) EmbedBatch(ctx context.Context, texts []string) ([][]float32, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("openai: API key not configured")
	}
	if len(texts) == 0 {
		return nil, nil
	}

	body, err := json.Marshal(openaiRequest{Input: texts, Model: p.model})
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openai request: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		log.Warn().Int("status", resp.StatusCode).Str("body", string(raw)).Msg("openai embedding error")
		return nil, fmt.Errorf("openai status %d", resp.StatusCode)
	}

	var parsed openaiResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("decode openai response: %w", err)
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("openai: %s", parsed.Error.Message)
	}
	if len(parsed.Data) != len(texts) {
		return nil, fmt.Errorf("openai: expected %d embeddings, got %d", len(texts), len(parsed.Data))
	}

	// Returned in arbitrary order; sort by index.
	out := make([][]float32, len(texts))
	for _, d := range parsed.Data {
		if d.Index < 0 || d.Index >= len(out) {
			return nil, fmt.Errorf("openai: out-of-range index %d", d.Index)
		}
		out[d.Index] = d.Embedding
	}
	return out, nil
}
