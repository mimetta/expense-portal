// Red asterisk appended to a required field's label. One shared component
// so the color/spacing stays consistent everywhere instead of copy-pasted
// inline spans drifting apart over time.
export default function RequiredMark() {
  return <span style={{ color: "#DC2626" }}> *</span>;
}
