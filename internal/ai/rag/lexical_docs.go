package rag

import (
	"context"
	"errors"
	"io/fs"
	"math"
	"path"
	"sort"
	"strings"
	"unicode"
)

// ErrReadOnlyRetriever is returned when callers try to mutate an embedded
// documentation corpus.
var ErrReadOnlyRetriever = errors.New("rag: embedded documentation retriever is read-only")

type lexicalDocument struct {
	chunk     Chunk
	terms     map[string]int
	termCount int
	pathTerms map[string]struct{}
}

// LexicalDocsRetriever is an in-process BM25-style retriever over embedded
// TeslaSync documentation. It has no database or provider dependency, so app
// help remains available when AI is enabled after process startup.
type LexicalDocsRetriever struct {
	documents []lexicalDocument
	docFreq   map[string]int
	avgLength float64
}

// NewLexicalDocsRetriever loads and indexes Markdown files from fsys.
func NewLexicalDocsRetriever(fsys fs.FS) (*LexicalDocsRetriever, error) {
	if fsys == nil {
		return nil, errors.New("rag: lexical docs retriever requires a filesystem")
	}

	r := &LexicalDocsRetriever{docFreq: make(map[string]int)}
	err := fs.WalkDir(fsys, ".", func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			name := entry.Name()
			if filePath != "." && (strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_")) {
				return fs.SkipDir
			}
			return nil
		}
		if strings.ToLower(path.Ext(filePath)) != ".md" {
			return nil
		}
		body, readErr := fs.ReadFile(fsys, filePath)
		if readErr != nil {
			return readErr
		}
		sourceType := SourceDocs
		if strings.HasPrefix(filePath, "runbooks/") {
			sourceType = "runbooks"
		}
		for index, text := range ChunkText(string(body), DefaultChunkBytes) {
			tokens := lexicalTokens(text)
			terms := termFrequency(tokens)
			pathTerms := make(map[string]struct{})
			for _, token := range lexicalTokens(filePath) {
				pathTerms[token] = struct{}{}
			}
			r.documents = append(r.documents, lexicalDocument{
				chunk: Chunk{
					SourceType: sourceType,
					SourceID:   filePath,
					ChunkIdx:   index,
					Text:       text,
				},
				terms:     terms,
				termCount: len(tokens),
				pathTerms: pathTerms,
			})
			for term := range terms {
				r.docFreq[term]++
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(r.documents) == 0 {
		return nil, errors.New("rag: embedded documentation corpus is empty")
	}
	var totalTerms int
	for _, document := range r.documents {
		totalTerms += document.termCount
	}
	r.avgLength = float64(totalTerms) / float64(len(r.documents))
	return r, nil
}

func (r *LexicalDocsRetriever) Retrieve(
	ctx context.Context,
	_ string,
	query string,
	sourceTypes []string,
	k int,
) ([]Chunk, error) {
	if err := validateRetrieveArgs(query, k); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	queryTokens := lexicalTokens(query)
	if len(queryTokens) == 0 {
		return []Chunk{}, nil
	}
	queryTerms := make(map[string]struct{}, len(queryTokens))
	for _, token := range queryTokens {
		queryTerms[token] = struct{}{}
	}
	allowedSources := make(map[string]struct{}, len(sourceTypes))
	for _, sourceType := range sourceTypes {
		allowedSources[sourceType] = struct{}{}
	}

	type scoredChunk struct {
		chunk Chunk
		score float64
	}
	scored := make([]scoredChunk, 0, len(r.documents))
	for _, document := range r.documents {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if len(allowedSources) > 0 {
			if _, ok := allowedSources[document.chunk.SourceType]; !ok {
				continue
			}
		}
		score := r.score(document, queryTerms)
		if score <= 0 {
			continue
		}
		normalized := score / (score + 1)
		chunk := document.chunk
		chunk.Score = float32(normalized)
		scored = append(scored, scoredChunk{chunk: chunk, score: score})
	}
	sort.Slice(scored, func(i, j int) bool {
		if scored[i].score != scored[j].score {
			return scored[i].score > scored[j].score
		}
		if scored[i].chunk.SourceID != scored[j].chunk.SourceID {
			return scored[i].chunk.SourceID < scored[j].chunk.SourceID
		}
		return scored[i].chunk.ChunkIdx < scored[j].chunk.ChunkIdx
	})
	if len(scored) > k {
		scored = scored[:k]
	}
	out := make([]Chunk, len(scored))
	for index, result := range scored {
		out[index] = result.chunk
	}
	return out, nil
}

func (r *LexicalDocsRetriever) Index(context.Context, string, string, string, []string) error {
	return ErrReadOnlyRetriever
}

func (r *LexicalDocsRetriever) Forget(context.Context, string, string, string) error {
	return ErrReadOnlyRetriever
}

func (r *LexicalDocsRetriever) score(document lexicalDocument, queryTerms map[string]struct{}) float64 {
	const (
		k1        = 1.2
		b         = 0.75
		pathBoost = 0.8
	)
	documentCount := float64(len(r.documents))
	lengthRatio := 1.0
	if r.avgLength > 0 {
		lengthRatio = float64(document.termCount) / r.avgLength
	}
	var score float64
	for term := range queryTerms {
		frequency := float64(document.terms[term])
		documentFrequency := float64(r.docFreq[term])
		if frequency == 0 || documentFrequency == 0 {
			continue
		}
		idf := math.Log(1 + (documentCount-documentFrequency+0.5)/(documentFrequency+0.5))
		denominator := frequency + k1*(1-b+b*lengthRatio)
		score += idf * (frequency * (k1 + 1) / denominator)
		if _, ok := document.pathTerms[term]; ok {
			score += pathBoost * idf
		}
	}
	return score
}

func termFrequency(tokens []string) map[string]int {
	out := make(map[string]int, len(tokens))
	for _, token := range tokens {
		out[token]++
	}
	return out
}

func lexicalTokens(text string) []string {
	raw := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	out := make([]string, 0, len(raw))
	for _, token := range raw {
		if len(token) < 2 {
			continue
		}
		if _, stop := lexicalStopWords[token]; stop {
			continue
		}
		out = append(out, token)
	}
	return out
}

var lexicalStopWords = map[string]struct{}{
	"and": {}, "are": {}, "for": {}, "from": {}, "how": {}, "into": {},
	"that": {}, "the": {}, "this": {}, "to": {}, "use": {}, "what": {},
	"when": {}, "where": {}, "with": {}, "you": {}, "your": {},
}
