// index.ts — Entry point. Starts the platform server.

import { startServer } from "./server.js";

const port = parseInt(process.env.PORT ?? "3000", 10);
const clientDir = process.env.CLIENT_DIR ?? undefined;
const secretsFile = process.env.SECRETS_FILE ?? undefined;

startServer({ port, clientDir, secretsFile });
