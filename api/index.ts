import { app } from "../apps/api/src/server.js";
// NODEJS_HELPERS=0 preserves the raw stream for Express JSON/image parsers.
// This handler never starts a listening socket.
export default app;
export const config = { supportsResponseStreaming: true };
