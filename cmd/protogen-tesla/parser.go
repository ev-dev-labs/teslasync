// Hand-rolled proto3 parser tuned for the vendored Tesla vehicle_data.proto.
//
// Only the subset actually used by the proto is recognized: enum and message
// definitions (with optional repeated fields and oneof groups). syntax,
// package, import, and option statements at the top level are tolerated and
// skipped. Comments (// and /* */) are skipped everywhere outside of strings.
package main

import (
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// ProtoFile is the parsed representation of a single proto3 source file.
type ProtoFile struct {
	Package  string
	Enums    []EnumDef
	Messages []MessageDef
}

// EnumDef is a single proto3 enum.
type EnumDef struct {
	Name   string
	Values []EnumValue
}

// EnumValue is a single named entry in an enum.
type EnumValue struct {
	Name   string
	Number int32
}

// MessageDef is a single proto3 message.
type MessageDef struct {
	Name   string
	Fields []FieldDef
	Oneofs []OneofDef
}

// FieldDef is a single proto3 field. Repeated indicates the `repeated` modifier.
type FieldDef struct {
	Name     string
	Type     string
	Number   int32
	Repeated bool
}

// OneofDef is a single proto3 oneof group inside a message.
type OneofDef struct {
	Name     string
	Variants []FieldDef
}

// ParseProtoFile parses the proto3 file at path into a ProtoFile structure.
func ParseProtoFile(path string) (*ProtoFile, error) {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read proto file %s: %w", path, err)
	}
	tokens, err := tokenize(string(src))
	if err != nil {
		return nil, fmt.Errorf("tokenize %s: %w", path, err)
	}
	p := &parser{tokens: tokens, source: path}
	pf, err := p.parseFile()
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	canonicalize(pf)
	return pf, nil
}

// canonicalize sorts everything by its declared number / name so the emitter
// receives a deterministic in-memory model.
func canonicalize(pf *ProtoFile) {
	sort.SliceStable(pf.Enums, func(i, j int) bool { return pf.Enums[i].Name < pf.Enums[j].Name })
	for i := range pf.Enums {
		sort.SliceStable(pf.Enums[i].Values, func(a, b int) bool {
			return pf.Enums[i].Values[a].Number < pf.Enums[i].Values[b].Number
		})
	}
	sort.SliceStable(pf.Messages, func(i, j int) bool { return pf.Messages[i].Name < pf.Messages[j].Name })
	for i := range pf.Messages {
		sort.SliceStable(pf.Messages[i].Fields, func(a, b int) bool {
			return pf.Messages[i].Fields[a].Number < pf.Messages[i].Fields[b].Number
		})
		sort.SliceStable(pf.Messages[i].Oneofs, func(a, b int) bool {
			return pf.Messages[i].Oneofs[a].Name < pf.Messages[i].Oneofs[b].Name
		})
		for j := range pf.Messages[i].Oneofs {
			sort.SliceStable(pf.Messages[i].Oneofs[j].Variants, func(a, b int) bool {
				return pf.Messages[i].Oneofs[j].Variants[a].Number < pf.Messages[i].Oneofs[j].Variants[b].Number
			})
		}
	}
}

// FindEnum returns the enum with the given name, or nil if not present.
func (pf *ProtoFile) FindEnum(name string) *EnumDef {
	for i := range pf.Enums {
		if pf.Enums[i].Name == name {
			return &pf.Enums[i]
		}
	}
	return nil
}

// FindMessage returns the message with the given name, or nil if not present.
func (pf *ProtoFile) FindMessage(name string) *MessageDef {
	for i := range pf.Messages {
		if pf.Messages[i].Name == name {
			return &pf.Messages[i]
		}
	}
	return nil
}

// ---- token kinds ----

type tokKind int

const (
	tokIdent tokKind = iota + 1
	tokNumber
	tokString
	tokPunct
	tokEOF
)

type token struct {
	kind  tokKind
	value string
	line  int
	col   int
}

// tokenize scans the proto3 source into a flat token stream. Comments and
// whitespace are dropped; strings preserve their literal content (without the
// surrounding quotes).
func tokenize(src string) ([]token, error) {
	var out []token
	i := 0
	line, col := 1, 1
	advance := func(n int) {
		for k := 0; k < n; k++ {
			if i+k >= len(src) {
				return
			}
			if src[i+k] == '\n' {
				line++
				col = 1
			} else {
				col++
			}
		}
		i += n
	}
	for i < len(src) {
		c := src[i]
		// whitespace
		if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
			advance(1)
			continue
		}
		// line comment
		if c == '/' && i+1 < len(src) && src[i+1] == '/' {
			for i < len(src) && src[i] != '\n' {
				advance(1)
			}
			continue
		}
		// block comment
		if c == '/' && i+1 < len(src) && src[i+1] == '*' {
			advance(2)
			for i+1 < len(src) && !(src[i] == '*' && src[i+1] == '/') {
				advance(1)
			}
			if i+1 >= len(src) {
				return nil, fmt.Errorf("unterminated block comment at line %d", line)
			}
			advance(2)
			continue
		}
		// string literal
		if c == '"' || c == '\'' {
			quote := c
			startLine, startCol := line, col
			advance(1)
			var buf strings.Builder
			for i < len(src) && src[i] != quote {
				if src[i] == '\\' && i+1 < len(src) {
					buf.WriteByte(src[i])
					buf.WriteByte(src[i+1])
					advance(2)
					continue
				}
				buf.WriteByte(src[i])
				advance(1)
			}
			if i >= len(src) {
				return nil, fmt.Errorf("unterminated string literal starting at line %d col %d", startLine, startCol)
			}
			advance(1)
			out = append(out, token{kind: tokString, value: buf.String(), line: startLine, col: startCol})
			continue
		}
		// identifier (letters, digits, underscore; allow embedded dots for qualified names)
		if isIdentStart(c) {
			startLine, startCol := line, col
			start := i
			for i < len(src) && (isIdentPart(src[i]) || src[i] == '.') {
				advance(1)
			}
			out = append(out, token{kind: tokIdent, value: src[start:i], line: startLine, col: startCol})
			continue
		}
		// number (signed integer or float)
		if c == '-' || isDigit(c) {
			startLine, startCol := line, col
			start := i
			if c == '-' {
				advance(1)
			}
			for i < len(src) && (isDigit(src[i]) || src[i] == '.') {
				advance(1)
			}
			out = append(out, token{kind: tokNumber, value: src[start:i], line: startLine, col: startCol})
			continue
		}
		// punctuation
		if isPunct(c) {
			out = append(out, token{kind: tokPunct, value: string(c), line: line, col: col})
			advance(1)
			continue
		}
		return nil, fmt.Errorf("unexpected character %q at line %d col %d", c, line, col)
	}
	out = append(out, token{kind: tokEOF, value: "", line: line, col: col})
	return out, nil
}

func isIdentStart(c byte) bool { return c == '_' || unicode.IsLetter(rune(c)) }
func isIdentPart(c byte) bool {
	return c == '_' || unicode.IsLetter(rune(c)) || unicode.IsDigit(rune(c))
}
func isDigit(c byte) bool { return c >= '0' && c <= '9' }
func isPunct(c byte) bool {
	switch c {
	case '{', '}', '(', ')', '[', ']', '<', '>', '=', ';', ',':
		return true
	}
	return false
}

// ---- parser ----

type parser struct {
	tokens []token
	pos    int
	source string
}

func (p *parser) peek() token { return p.tokens[p.pos] }
func (p *parser) next() token {
	t := p.tokens[p.pos]
	if t.kind != tokEOF {
		p.pos++
	}
	return t
}

func (p *parser) errAt(t token, format string, args ...any) error {
	return fmt.Errorf("%s:%d:%d: %s", p.source, t.line, t.col, fmt.Sprintf(format, args...))
}

func (p *parser) expectPunct(s string) (token, error) {
	t := p.next()
	if t.kind != tokPunct || t.value != s {
		return t, p.errAt(t, "expected %q, got %q", s, t.value)
	}
	return t, nil
}

func (p *parser) expectIdent() (token, error) {
	t := p.next()
	if t.kind != tokIdent {
		return t, p.errAt(t, "expected identifier, got %q", t.value)
	}
	return t, nil
}

func (p *parser) expectNumber() (int32, error) {
	t := p.next()
	if t.kind != tokNumber {
		return 0, p.errAt(t, "expected number, got %q", t.value)
	}
	n, err := strconv.ParseInt(t.value, 10, 32)
	if err != nil {
		return 0, p.errAt(t, "invalid number %q: %v", t.value, err)
	}
	return int32(n), nil
}

func (p *parser) parseFile() (*ProtoFile, error) {
	pf := &ProtoFile{}
	for {
		t := p.peek()
		if t.kind == tokEOF {
			return pf, nil
		}
		if t.kind != tokIdent {
			return nil, p.errAt(t, "expected top-level keyword, got %q", t.value)
		}
		switch t.value {
		case "syntax", "package", "import", "option":
			p.skipStatement()
		case "enum":
			p.next()
			ed, err := p.parseEnum()
			if err != nil {
				return nil, err
			}
			pf.Enums = append(pf.Enums, ed)
		case "message":
			p.next()
			md, err := p.parseMessage()
			if err != nil {
				return nil, err
			}
			pf.Messages = append(pf.Messages, md)
		default:
			return nil, p.errAt(t, "unexpected top-level keyword %q", t.value)
		}
	}
}

// skipStatement consumes tokens until the next top-level semicolon. It is used
// for syntax/package/import/option declarations whose bodies we ignore.
func (p *parser) skipStatement() {
	depth := 0
	for {
		t := p.next()
		if t.kind == tokEOF {
			return
		}
		if t.kind == tokPunct {
			switch t.value {
			case "{", "(", "[":
				depth++
			case "}", ")", "]":
				depth--
			case ";":
				if depth == 0 {
					return
				}
			}
		}
	}
}

func (p *parser) parseEnum() (EnumDef, error) {
	nameTok, err := p.expectIdent()
	if err != nil {
		return EnumDef{}, err
	}
	if _, err := p.expectPunct("{"); err != nil {
		return EnumDef{}, err
	}
	ed := EnumDef{Name: nameTok.value}
	for {
		t := p.peek()
		if t.kind == tokPunct && t.value == "}" {
			p.next()
			return ed, nil
		}
		if t.kind == tokIdent && t.value == "option" {
			p.skipStatement()
			continue
		}
		if t.kind == tokIdent && t.value == "reserved" {
			p.skipStatement()
			continue
		}
		if t.kind != tokIdent {
			return EnumDef{}, p.errAt(t, "expected enum value or '}', got %q", t.value)
		}
		valNameTok := p.next()
		if _, err := p.expectPunct("="); err != nil {
			return EnumDef{}, err
		}
		num, err := p.expectNumber()
		if err != nil {
			return EnumDef{}, err
		}
		// Optional [field options]
		if p.peek().kind == tokPunct && p.peek().value == "[" {
			p.skipBracketGroup()
		}
		if _, err := p.expectPunct(";"); err != nil {
			return EnumDef{}, err
		}
		ed.Values = append(ed.Values, EnumValue{Name: valNameTok.value, Number: num})
	}
}

func (p *parser) parseMessage() (MessageDef, error) {
	nameTok, err := p.expectIdent()
	if err != nil {
		return MessageDef{}, err
	}
	if _, err := p.expectPunct("{"); err != nil {
		return MessageDef{}, err
	}
	md := MessageDef{Name: nameTok.value}
	for {
		t := p.peek()
		if t.kind == tokPunct && t.value == "}" {
			p.next()
			return md, nil
		}
		if t.kind == tokIdent {
			switch t.value {
			case "option", "reserved":
				p.skipStatement()
				continue
			case "oneof":
				p.next()
				od, err := p.parseOneof()
				if err != nil {
					return MessageDef{}, err
				}
				md.Oneofs = append(md.Oneofs, od)
				continue
			case "message", "enum":
				// Nested types aren't used by the Tesla proto; tolerate by
				// skipping the entire declaration to be safe.
				p.next()
				if _, err := p.expectIdent(); err != nil {
					return MessageDef{}, err
				}
				if _, err := p.expectPunct("{"); err != nil {
					return MessageDef{}, err
				}
				p.skipBraceGroup()
				continue
			case "repeated":
				p.next()
				fd, err := p.parseField(true)
				if err != nil {
					return MessageDef{}, err
				}
				md.Fields = append(md.Fields, fd)
				continue
			}
		}
		// regular field declaration: <type> <name> = <number>;
		fd, err := p.parseField(false)
		if err != nil {
			return MessageDef{}, err
		}
		md.Fields = append(md.Fields, fd)
	}
}

func (p *parser) parseOneof() (OneofDef, error) {
	nameTok, err := p.expectIdent()
	if err != nil {
		return OneofDef{}, err
	}
	if _, err := p.expectPunct("{"); err != nil {
		return OneofDef{}, err
	}
	od := OneofDef{Name: nameTok.value}
	for {
		t := p.peek()
		if t.kind == tokPunct && t.value == "}" {
			p.next()
			return od, nil
		}
		if t.kind == tokIdent && (t.value == "option" || t.value == "reserved") {
			p.skipStatement()
			continue
		}
		fd, err := p.parseField(false)
		if err != nil {
			return OneofDef{}, err
		}
		od.Variants = append(od.Variants, fd)
	}
}

func (p *parser) parseField(repeated bool) (FieldDef, error) {
	typeTok, err := p.expectIdent()
	if err != nil {
		return FieldDef{}, err
	}
	nameTok, err := p.expectIdent()
	if err != nil {
		return FieldDef{}, err
	}
	if _, err := p.expectPunct("="); err != nil {
		return FieldDef{}, err
	}
	num, err := p.expectNumber()
	if err != nil {
		return FieldDef{}, err
	}
	if p.peek().kind == tokPunct && p.peek().value == "[" {
		p.skipBracketGroup()
	}
	if _, err := p.expectPunct(";"); err != nil {
		return FieldDef{}, err
	}
	return FieldDef{Name: nameTok.value, Type: typeTok.value, Number: num, Repeated: repeated}, nil
}

func (p *parser) skipBracketGroup() {
	depth := 0
	for {
		t := p.next()
		if t.kind == tokEOF {
			return
		}
		if t.kind == tokPunct {
			switch t.value {
			case "[":
				depth++
			case "]":
				depth--
				if depth == 0 {
					return
				}
			}
		}
	}
}

func (p *parser) skipBraceGroup() {
	depth := 1
	for depth > 0 {
		t := p.next()
		if t.kind == tokEOF {
			return
		}
		if t.kind == tokPunct {
			switch t.value {
			case "{":
				depth++
			case "}":
				depth--
			}
		}
	}
}
