FROM denoland/deno:latest

WORKDIR /app

# Cache dependencies
COPY deno.json deno.lock* ./
RUN deno install

# Copy source
COPY server/ server/
COPY browser/ browser/
COPY scripts/ scripts/
COPY mod.ts ./
COPY agents/ agents/

# Build client bundles
RUN deno task build:client

EXPOSE 3000

# Default agent — override with fly.toml or docker run args
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "agents/code-interpreter/agent.ts"]
