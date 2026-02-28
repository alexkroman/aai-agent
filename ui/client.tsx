// client.tsx — Default voice agent client. Bundled as client.js, served by the agent.

import { mount } from "./mount.tsx";
import { App } from "./components/App.tsx";

export const VoiceAgent = mount(App);
