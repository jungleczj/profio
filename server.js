import "dotenv/config";

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import express from "express";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  APP_BASE_URL = "http://localhost:3000",
  PORT = 3000,
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_STORAGE_BUCKET = "portfolio-materials",
  SUPABASE_URL
} = process.env;

const supabaseUrl = SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SECRET_KEY;

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10
  }
});

let supabaseClient;

const hasSupabaseConfig = () =>
  Boolean(
    supabaseUrl &&
      supabaseServiceKey &&
      !supabaseServiceKey.includes("your-service-role-key")
  );

const getSupabase = () => {
  if (!hasSupabaseConfig()) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return supabaseClient;
};

const roleLabels = {
  product: "Product / Operations",
  design: "Design / Creative",
  engineering: "Engineering / Data",
  marketing: "Marketing / Growth",
  other: "Other"
};

app.use(express.static(path.join(__dirname, "landing")));
app.use(express.urlencoded({ extended: false }));

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const makeSlug = () => crypto.randomBytes(5).toString("hex");

const safeFileName = (fileName) =>
  fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "material";

const safePathSegment = (value) =>
  value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}@._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "unknown";

app.post("/api/submissions", upload.array("materials", 10), async (req, res) => {
  try {
    const fullName = String(req.body.fullName ?? "").trim();
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const role = String(req.body.role ?? "other");
    const note = String(req.body.note ?? "").trim();
    const files = req.files ?? [];

    if (!fullName) {
      return res.status(400).json({ error: "Please enter your full name." });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    if (!files.length) {
      return res.status(400).json({ error: "Please upload at least one file." });
    }

    const supabase = getSupabase();
    const slug = makeSlug();
    const portfolioUrl = `${APP_BASE_URL.replace(/\/$/, "")}/p/${slug}`;

    const { data: submission, error: submissionError } = await supabase
      .from("portfolio_submissions")
      .insert({
        slug,
        full_name: fullName,
        email,
        role,
        note,
        portfolio_url: portfolioUrl
      })
      .select("id, slug, portfolio_url")
      .single();

    if (submissionError) {
      throw submissionError;
    }

    const uploadedFiles = [];
    const ownerFolder = `${safePathSegment(fullName)}_${safePathSegment(email)}`;

    for (const file of files) {
      const storagePath = `${ownerFolder}/${submission.id}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(
        file.originalname
      )}`;

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype || "application/octet-stream",
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      uploadedFiles.push({
        submission_id: submission.id,
        storage_path: storagePath,
        original_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size
      });
    }

    const { error: filesError } = await supabase.from("portfolio_files").insert(uploadedFiles);

    if (filesError) {
      throw filesError;
    }

    console.log(`Portfolio link created for ${email}: ${portfolioUrl}`);

    return res.status(201).json({
      message: "Portfolio link created.",
      portfolioUrl
    });
  } catch (error) {
    console.error(error);

    if (error.message === "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.") {
      return res.status(500).json({
        error: "Supabase environment variables are not configured. Please fill in .env first."
      });
    }

    return res.status(500).json({ error: "Submission failed. Please try again." });
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found." });
});

app.use("/api", (error, req, res, next) => {
  console.error(error);

  if (error instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: "Each file must be 25 MB or smaller.",
      LIMIT_FILE_COUNT: "Please upload no more than 10 files.",
      LIMIT_UNEXPECTED_FILE: "Please upload files using the materials field."
    };

    return res.status(400).json({
      error: messages[error.code] || "Upload failed. Please check your files and try again."
    });
  }

  return res.status(500).json({ error: "Submission failed. Please try again." });
});

app.get("/p/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const supabase = getSupabase();

    const { data: submission, error: submissionError } = await supabase
      .from("portfolio_submissions")
      .select("id, full_name, email, role, note, created_at")
      .eq("slug", slug)
      .single();

    if (submissionError || !submission) {
      return res.status(404).send("Portfolio not found");
    }

    const { data: files, error: filesError } = await supabase
      .from("portfolio_files")
      .select("original_name, storage_path, mime_type, size_bytes")
      .eq("submission_id", submission.id)
      .order("created_at", { ascending: true });

    if (filesError) {
      return res.status(500).send("Unable to load portfolio");
    }

    const filesWithUrls = await Promise.all(
      files.map(async (file) => {
        const { data } = await supabase.storage
          .from(SUPABASE_STORAGE_BUCKET)
          .createSignedUrl(file.storage_path, 60 * 60);

        return {
          ...file,
          signedUrl: data?.signedUrl
        };
      })
    );

    res.send(renderPortfolioPage({ submission, files: filesWithUrls, slug }));
  } catch (error) {
    console.error(error);
    res.status(500).send("Server is not configured.");
  }
});

const renderPortfolioPage = ({ submission, files, slug }) => {
  const createdAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(submission.created_at));

  const fileItems = files
    .map(
      (file) => `
        <li>
          <div>
            <strong>${escapeHtml(file.original_name)}</strong>
            <span>${escapeHtml(file.mime_type || "File")} · ${Math.round(
        Number(file.size_bytes) / 1024
      )} KB</span>
          </div>
          ${
            file.signedUrl
              ? `<a href="${file.signedUrl}" target="_blank" rel="noreferrer">Open</a>`
              : `<span>Link unavailable</span>`
          }
        </li>
      `
    )
    .join("");

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Portfolio ${escapeHtml(slug)}</title>
        <style>
          body {
            margin: 0;
            background: #f4f7f9;
            color: #17202a;
            font-family: Inter, system-ui, sans-serif;
          }
          main {
            width: min(960px, calc(100% - 32px));
            margin: 0 auto;
            padding: 56px 0;
          }
          header {
            border-radius: 8px;
            padding: 34px;
            background: #0f766e;
            color: white;
          }
          h1 {
            margin: 0 0 12px;
            font-size: clamp(32px, 6vw, 58px);
            line-height: 1.08;
          }
          p {
            margin: 0;
            line-height: 1.7;
          }
          section {
            margin-top: 22px;
            border: 1px solid #d8e0e8;
            border-radius: 8px;
            padding: 24px;
            background: white;
          }
          h2 {
            margin: 0 0 16px;
          }
          ul {
            display: grid;
            gap: 10px;
            margin: 0;
            padding: 0;
            list-style: none;
          }
          li {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            border: 1px solid #d8e0e8;
            border-radius: 8px;
            padding: 14px;
          }
          strong,
          span {
            display: block;
          }
          span {
            margin-top: 4px;
            color: #5b6776;
            font-size: 14px;
          }
          a {
            border-radius: 8px;
            padding: 8px 12px;
            background: #0f766e;
            color: white;
            text-decoration: none;
            white-space: nowrap;
          }
          @media (max-width: 560px) {
            header,
            section {
              padding: 20px;
            }
            li {
              align-items: flex-start;
              flex-direction: column;
            }
          }
        </style>
      </head>
      <body>
        <main>
          <header>
            <p>PortfolioLink</p>
            <h1>${escapeHtml(roleLabels[submission.role] ?? roleLabels.other)} Portfolio</h1>
            <p>${escapeHtml(submission.full_name || submission.email)}</p>
            <p>Created: ${escapeHtml(createdAt)}</p>
          </header>
          <section>
            <h2>Notes</h2>
            <p>${escapeHtml(submission.note || "No additional notes were provided.")}</p>
          </section>
          <section>
            <h2>Portfolio Materials</h2>
            <ul>${fileItems}</ul>
          </section>
        </main>
      </body>
    </html>`;
};

const server = app.listen(PORT, () => {
  if (!hasSupabaseConfig()) {
    console.warn(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Configure .env before submitting forms."
    );
  }

  console.log(`PortfolioLink server running at http://localhost:${PORT}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Set PORT=another_port and try again.`);
    process.exit(1);
  }

  throw error;
});
