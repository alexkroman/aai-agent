import React from "react";
import ReactDOM from "react-dom/client";
import { VoiceWidget } from "./VoiceWidget";
import "./styles.css";

/**
 * Registers <aai-voice-agent> as a custom element so it can be used
 * in plain HTML pages without a build step.
 */
class AAIVoiceAgentElement extends HTMLElement {
  connectedCallback() {
    const baseUrl = this.getAttribute("backend-url") || "/api";
    const title = this.getAttribute("title") || "Voice Assistant";
    const debounceMs = Number(this.getAttribute("debounce-ms")) || undefined;
    const autoGreet = this.getAttribute("auto-greet") !== "false";
    const bargeInMinChars =
      Number(this.getAttribute("barge-in-min-chars")) || undefined;
    const enableBargeIn = this.getAttribute("enable-barge-in") !== "false";
    const maxMessages = Number(this.getAttribute("max-messages")) || undefined;
    const reconnect = this.getAttribute("reconnect") !== "false";
    const maxReconnectAttempts =
      Number(this.getAttribute("max-reconnect-attempts")) || undefined;
    const fetchTimeout =
      Number(this.getAttribute("fetch-timeout")) || undefined;

    const container = document.createElement("div");
    container.style.width = this.getAttribute("width") || "420px";
    container.style.height = this.getAttribute("height") || "600px";
    this.appendChild(container);

    ReactDOM.createRoot(container).render(
      React.createElement(VoiceWidget, {
        baseUrl,
        title,
        debounceMs,
        autoGreet,
        bargeInMinChars,
        enableBargeIn,
        maxMessages,
        reconnect,
        maxReconnectAttempts,
        fetchTimeout,
      }),
    );
  }
}

if (!customElements.get("aai-voice-agent")) {
  customElements.define("aai-voice-agent", AAIVoiceAgentElement);
}
