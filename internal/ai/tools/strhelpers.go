package tools

// Lower is an ASCII-fast strings.ToLower replacement that avoids unicode-table
// costs. It lives in the parent package because multiple tool packages share it.
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
