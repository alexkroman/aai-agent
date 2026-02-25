import React from "react";
import { createRoot } from "react-dom/client";
import { VoiceWidget } from "./VoiceWidget";
import cssText from "./styles.css?inline";

const STYLE_ID = "aai-voice-agent-styles";

class AAIVoiceAgentElement extends HTMLElement {
  static get observedAttributes() {
    return ["backend-url", "title", "debounce-ms", "auto-greet"];
  }

  connectedCallback() {
    // Inject styles once (aai- prefix prevents collisions)
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = cssText;
      document.head.appendChild(style);
    }

    this._mountPoint = document.createElement("div");
    this.appendChild(this._mountPoint);

    this._reactRoot = createRoot(this._mountPoint);
    this._render();
  }

  attributeChangedCallback() {
    if (this._reactRoot) this._render();
  }

  _render() {
    this._reactRoot.render(
      React.createElement(VoiceWidget, {
        baseUrl: this.getAttribute("backend-url") || "",
        title: this.getAttribute("title") || undefined,
        debounceMs: this.hasAttribute("debounce-ms")
          ? Number(this.getAttribute("debounce-ms"))
          : undefined,
        autoGreet: this.hasAttribute("auto-greet")
          ? this.getAttribute("auto-greet") !== "false"
          : undefined,
      }),
    );
  }

  disconnectedCallback() {
    if (this._reactRoot) {
      this._reactRoot.unmount();
      this._reactRoot = null;
    }
  }
}

customElements.define("aai-voice-agent", AAIVoiceAgentElement);
