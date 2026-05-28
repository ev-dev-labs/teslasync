package tools

// Lower is an ASCII-fast strings.ToLower replacement avoiding the
// unicode-table cost. Promoted to a parent file during R6.26
// (charging_diagnosis → diagnosis/ carve) because automation_builder.go,
// schema.go, and tool.go all consume it. Exported per R6.26 because diagnosis/ subpkg also calls it.
func Lower(s string) string {
	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}
