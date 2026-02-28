export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#2196F3"/><path d="M50 25c-6 0-11 5-11 11v14c0 6 5 11 11 11s11-5 11-11V36c0-6-5-11-11-11z" fill="white"/><path d="M71 50c0 11-9 21-21 21s-21-10-21-21h-6c0 14 10 25 24 27v8h6v-8c14-2 24-13 24-27h-6z" fill="white"/></svg>`;

export function renderAgentPage(name: string, basePath = ""): string {
  const safeName = escapeHtml(name);
  const safePath = escapeHtml(basePath);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeName}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
  <div id="app"></div>
  <script type="module">
    const { VoiceAgent } = await import("${safePath}/client.js");
    VoiceAgent.start({ element: "#app", platformUrl: window.location.origin + "${safePath}" });
  </script>
</body>
</html>`;
}
