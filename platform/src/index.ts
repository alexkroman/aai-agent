// index.ts — Entry point. Starts the platform server.

import { startServer } from "./server.js";

const port = parseInt(process.env.PORT ?? "3001", 10);
const clientDir = process.env.CLIENT_DIR ?? undefined;

startServer({ port, clientDir });
