import { Hono, Context } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from "hono/cors";
import { createDebugRoutes } from "./debug.ts";

/**
 * Create and configure the Hono app with API routes and static file serving
 */
export function createHonoApp() {
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

  // Debug routes (for development/verification only)
  const debugRoutes = createDebugRoutes();
  app.route("/debug", debugRoutes);

  // Determine if running from compiled binary
  const isCompiled = Deno.execPath().includes("ratsnest");
  const staticRoot = isCompiled
    ? new URL("../frontend/dist", Deno.mainModule).pathname
    : "../frontend/dist";

  console.log(`Static files root: ${staticRoot} (compiled: ${isCompiled})`);
  console.log(`[Build] Test modification v3 - RTMR variability test`);

  // Static file serving for SPA
  app.get("*", serveStatic({ root: staticRoot }));

  return app;
}

// If running this file directly, start the Hono server
if (import.meta.main) {
  const app = createHonoApp();
  const port = 4000;
  console.log(`[Hono] Server running on http://localhost:${port}`);
  Deno.serve({ port }, app.fetch);
}
