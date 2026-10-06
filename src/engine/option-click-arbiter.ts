export const OPTION_CLICK_WINDOW_MS = 600;
// One pending interaction per card. Different options replace a pending single click.
export class OptionClickArbiter {
  private pending: ReturnType<typeof setTimeout> | null = null;
  private gesture: { identity: string; at: number } | null = null;
  cancel() {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = null;
  }
  dispose() {
    this.cancel();
    this.gesture = null;
  }
  click(identity: string, detail: number, answer: () => void, toggle: () => void) {
    this.cancel();
    if (detail >= 2) {
      if (
        detail === 2 &&
        !(
          this.gesture?.identity === identity &&
          Date.now() - this.gesture.at <= OPTION_CLICK_WINDOW_MS
        )
      ) {
        this.gesture = { identity, at: Date.now() };
        toggle();
      }
      return;
    }
    if (
      this.gesture?.identity === identity &&
      Date.now() - this.gesture.at <= OPTION_CLICK_WINDOW_MS
    )
      return;
    this.gesture = null;
    this.pending = setTimeout(() => {
      this.pending = null;
      answer();
    }, OPTION_CLICK_WINDOW_MS);
  }
}
