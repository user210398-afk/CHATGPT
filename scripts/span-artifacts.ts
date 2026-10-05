// The sole authorized academic text cleanup. No whitespace or punctuation normalization.
export function removeSpanArtifacts(text: string): string {
  return text.replace(/\[span_[0-9]+\]\((?:start|end)_span\)/g, '');
}
