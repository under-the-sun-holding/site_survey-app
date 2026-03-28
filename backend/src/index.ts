import path from "path";
import fs from "fs";

// Load .env before anything else
if (process.env.NODE_ENV !== "production") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  } catch {
    /* dotenv optional */
  }
}

import express from "express";
import cors from "cors";
import multer from "multer";
import surveysRouter from "./routes/surveys";
import categoriesRouter from "./routes/categories";
import usersRouter from "./routes/users";
import { requireAuth } from "./middleware/auth";
import { pool } from "./database";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      cb(null, name);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only image files are allowed"));
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

// ----------------------------------------------------------------
// CORS
// ----------------------------------------------------------------
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:5173,http://localhost:4173,http://localhost:8081"
)
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ----------------------------------------------------------------
// Body parsing
// ----------------------------------------------------------------
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ----------------------------------------------------------------
// Serve uploaded photos statically
// ----------------------------------------------------------------
app.use("/uploads", express.static(UPLOADS_DIR));

// ----------------------------------------------------------------
// Health check
// ----------------------------------------------------------------
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: "error",
      database: "disconnected",
      timestamp: new Date().toISOString(),
    });
  }
});

// ----------------------------------------------------------------
// Survey image upload
// ----------------------------------------------------------------
app.post("/api/surveys/upload", requireAuth, (req, res) => {
  upload.single("image")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Image exceeds 10MB limit" });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }

    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(400).json({ error: message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No image file uploaded" });
      return;
    }

    const filePath = `/uploads/${req.file.filename}`;
    res.status(201).json({ filePath });
  });
});

// ----------------------------------------------------------------
// API routes
// ----------------------------------------------------------------
app.use("/api/surveys", requireAuth, surveysRouter);
app.use("/api/categories", requireAuth, categoriesRouter);
app.use("/api/users", usersRouter);

// ----------------------------------------------------------------
// 404
// ----------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ----------------------------------------------------------------
// Start server
// ----------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Site Survey API running on http://localhost:${PORT}`);
    console.log(`Photo uploads served from /uploads`);
  });
}

export default app;
