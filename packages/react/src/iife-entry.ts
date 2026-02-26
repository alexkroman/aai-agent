import React from "react";
import ReactDOM from "react-dom/client";
import { VoiceWidget } from "./VoiceWidget";
import "./styles.css";

/**
 * Registers <aai-voice-agent> as a custom element so it can be used
 * in plain HTML pages without a build step.
 */
class AAIVoiceAgentElement extends HTMLElement {
  private _root: ReactDOM.Root | null = null;

  connectedCallback() {
    const baseUrl = this.getAttribute("backend-url") || "/api";
    const title = this.getAttribute("title") || "Voice Assistant";
    const maxMessages = Number(this.getAttribute("max-messages")) || undefined;

    const container = document.createElement("div");
    container.style.width = this.getAttribute("width") || "420px";
    container.style.height = this.getAttribute("height") || "600px";
    this.appendChild(container);

    this._root = ReactDOM.createRoot(container);
    this._root.render(
      React.createElement(VoiceWidget, {
        baseUrl,
        title,
        maxMessages,
      }),
    );
  }

  disconnectedCallback() {
    // Unmount React tree so hooks run cleanup (disconnect WebSocket, mic, etc.)
    if (this._root) {
      this._root.unmount();
      this._root = null;
    }
  }
}

if (!customElements.get("aai-voice-agent")) {
  customElements.define("aai-voice-agent", AAIVoiceAgentElement);
}
