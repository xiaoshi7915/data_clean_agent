import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { saveUploadedFile, MAX_UPLOAD_BYTES, type UploadKind } from "./services/uploadService";
import { checkRateLimit, rateLimitKeyFromRequest, RateLimitError } from "./lib/rateLimit";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// File upload endpoint
app.post("/api/upload", async (c) => {
  try {
    const rateKey = rateLimitKeyFromRequest(c.req.raw, "upload");
    checkRateLimit(rateKey, 30);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return c.json({ success: false, error: error.message }, 429);
    }
    throw error;
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const sessionId = formData.get("sessionId") as string | null;
    const uploadKind = formData.get("uploadKind") as string | null;

    if (!file) {
      return c.json({ success: false, error: "No file provided" }, 400);
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json(
        { success: false, error: `文件过大，最大允许 ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` },
        413
      );
    }

    const result = await saveUploadedFile(sessionId || undefined, file, {
      uploadKind: uploadKind ? (uploadKind as UploadKind) : undefined,
    });

    return c.json({
      success: true,
      filePath: result.filePath,
      fileType: result.fileType,
      fileName: result.fileName,
      fileSize: result.fileSize,
      uploadKind: result.uploadKind,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

// 下载清洗后的文件（仅允许 uploads 目录内）
app.get("/api/download", async (c) => {
  const fileName = c.req.query("file");
  if (!fileName) {
    return c.json({ success: false, error: "缺少 file 参数" }, 400);
  }

  const safeName = path.basename(fileName);
  const uploadRoot = path.resolve(env.uploadDir);
  const filePath = path.resolve(uploadRoot, safeName);

  if (!filePath.startsWith(uploadRoot) || !existsSync(filePath)) {
    return c.json({ success: false, error: "文件不存在" }, 404);
  }

  const buffer = readFileSync(filePath);
  const ext = path.extname(safeName).toLowerCase();
  const contentTypeMap: Record<string, string> = {
    ".csv": "text/csv; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  return new Response(buffer, {
    headers: {
      "Content-Type": contentTypeMap[ext] || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    },
  });
});

// tRPC handler
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    const appLabel = env.appId ? `[${env.appId}] ` : "";
    console.log(`${appLabel}Server running on http://localhost:${port}/`);
  });
}
