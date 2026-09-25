import { setRuntime } from "./lib/runtime.js";

export default class AdaptiveThinkingPlugin {
  onload() {
    setRuntime(this.ctx);
  }

  onunload() {
    setRuntime(null);
  }
}
