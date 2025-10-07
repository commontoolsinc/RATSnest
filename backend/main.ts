import { Hono, Context } from "hono";
import { serveStatic } from "hono/deno";
import { cors } from "hono/cors";
import { createDebugRoutes } from "./debug.ts";
import { readIMALog, getIMACount, parseIMALog, getIMAMetadata } from "./ima.ts";

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

  // API endpoints
  app.get("/api/hello", (c: Context) => {
    return c.json({ message: "world" });
  });

  // IMA (Integrity Measurement Architecture) endpoints for verification
  app.get("/api/ima/log", async (c: Context) => {
    try {
      const log = await readIMALog();
      return c.text(log, 200, {
        "Content-Type": "text/plain",
      });
    } catch (error) {
      return c.json({ error: `IMA log not available: ${error}` }, 503);
    }
  });

  app.get("/api/ima/count", async (c: Context) => {
    try {
      const count = await getIMACount();
      return c.json({ count });
    } catch (error) {
      return c.json({ error: `IMA count not available: ${error}` }, 503);
    }
  });

  app.get("/api/ima/metadata", async (c: Context) => {
    try {
      const metadata = await getIMAMetadata();
      return c.json(metadata);
    } catch (error) {
      return c.json({ error: `IMA metadata not available: ${error}` }, 503);
    }
  });

  app.get("/api/ima/search", async (c: Context) => {
    try {
      const path = c.req.query("path");
      if (!path) {
        return c.json({ error: "Missing 'path' query parameter" }, 400);
      }

      const log = await readIMALog();
      const entries = parseIMALog(log);
      const matches = entries.filter(entry => entry.filePath.includes(path));

      return c.json({
        query: path,
        matches,
        count: matches.length,
      });
    } catch (error) {
      return c.json({ error: `IMA search failed: ${error}` }, 503);
    }
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
