FROM denoland/deno:latest

WORKDIR /app

# Cache dependencies
COPY deno.json deno.lock* ./
RUN deno install

# Copy source
COPY platform/ platform/
COPY sdk/ sdk/
COPY ui/ ui/
COPY cli/ cli/
COPY mod.ts main.ts ./
COPY examples/ examples/

# Build client bundles
RUN deno task build:client

EXPOSE 3000

CMD ["deno", "run", "--allow-all", "--unstable-worker-options", "main.ts"]
