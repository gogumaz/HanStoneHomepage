import { createServer } from "vite";

const port = Number.parseInt(process.env.PORT || "4173", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const server = await createServer({
  root: process.cwd(),
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
});

await server.listen();
server.printUrls();
