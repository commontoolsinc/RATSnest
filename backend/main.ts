import { Hono, Context } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from "hono/cors";

const app = new Hono();

// Custom request logging - single line with status and timing
app.use("/*", async (c: Context, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`);
});

// CORS middleware for development
app.use("/*", cors());

// API endpoint
app.get("/api/hello", (c: Context) => {
  return c.json({ message: "world" });
});

// Determine if running from compiled binary
const isCompiled = Deno.execPath().includes("ratsnest");
const staticRoot = isCompiled
  ? new URL("../frontend/dist", Deno.mainModule).pathname
  : "../frontend/dist";

console.log(`Static files root: ${staticRoot} (compiled: ${isCompiled})`);

// Static file serving for SPA
app.get("*", serveStatic({ root: staticRoot }));

const port = 3000;
console.log(`Server running on http://localhost:${port}`);

Deno.serve({ port }, app.fetch);
