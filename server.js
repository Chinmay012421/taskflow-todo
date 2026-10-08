import express from "express";
import helmet from "helmet";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variable.");
  process.exit(1);
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
});

async function requireUser(req, res, next) {
  try {
    const match = (req.get("authorization") || "").match(/^Bearer\s+(\S+)$/i);
    if (!match) return res.status(401).json({ error: "Please sign in." });

    const token = match[1];
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: "Session expired. Please sign in again." });
    }
    req.supabase = supabase;
    req.user = data.user;
    next();
  } catch (error) {
    console.error("Auth error:", error.message);
    res.status(500).json({ error: "Authentication failed." });
  }
}

const validString = (v, max) =>
  typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
const validOptionalString = (v, max) =>
  typeof v === "string" && v.length <= max;
const validPriority = (v) => ["low", "medium", "high"].includes(v);
function validDeadline(v) {
  if (v === null || v === "") return true;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function dbError(res, error) {
  console.error("Database error:", error.code, error.message);
  return res.status(400).json({ error: "The request could not be completed. Check your input and database setup." });
}

app.get("/api/tasks", requireUser, async (req, res) => {
  const { data, error } = await req.supabase.from("tasks")
    .select("id,title,description,category,priority,deadline,completed,created_at,updated_at")
    .order("created_at", { ascending: false });
  if (error) return dbError(res, error);
  res.json({ tasks: data });
});

app.post("/api/tasks", requireUser, async (req, res) => {
  const b = req.body || {};
  const title = b.title;
  const description = b.description ?? "";
  const category = b.category ?? "General";
  const priority = b.priority ?? "medium";
  const deadline = b.deadline || null;

  if (!validString(title, 160)) return res.status(400).json({ error: "Title must be 1–160 characters." });
  if (!validOptionalString(description, 2000)) return res.status(400).json({ error: "Description must be 2,000 characters or fewer." });
  if (!validString(category, 60)) return res.status(400).json({ error: "Category must be 1–60 characters." });
  if (!validPriority(priority) || !validDeadline(deadline)) return res.status(400).json({ error: "Invalid priority or deadline." });

  const { data, error } = await req.supabase.from("tasks").insert({
    title: title.trim(), description: description.trim(), category: category.trim(), priority, deadline
  }).select("id,title,description,category,priority,deadline,completed,created_at,updated_at").single();
  if (error) return dbError(res, error);
  res.status(201).json({ task: data });
});

app.patch("/api/tasks/:id", requireUser, async (req, res) => {
  const b = req.body || {};
  const allowed = ["title", "description", "category", "priority", "deadline", "completed"];
  const updates = {};
  for (const key of allowed) if (Object.hasOwn(b, key)) updates[key] = b[key];
  if (!Object.keys(updates).length) return res.status(400).json({ error: "No valid changes supplied." });

  if (Object.hasOwn(updates, "title") && !validString(updates.title, 160)) return res.status(400).json({ error: "Invalid title." });
  if (Object.hasOwn(updates, "description") && !validOptionalString(updates.description, 2000)) return res.status(400).json({ error: "Invalid description." });
  if (Object.hasOwn(updates, "category") && !validString(updates.category, 60)) return res.status(400).json({ error: "Invalid category." });
  if (Object.hasOwn(updates, "priority") && !validPriority(updates.priority)) return res.status(400).json({ error: "Invalid priority." });
  if (Object.hasOwn(updates, "deadline") && !validDeadline(updates.deadline)) return res.status(400).json({ error: "Invalid deadline." });
  if (Object.hasOwn(updates, "completed") && typeof updates.completed !== "boolean") return res.status(400).json({ error: "Invalid completion status." });

  for (const key of ["title", "description", "category"]) {
    if (typeof updates[key] === "string") updates[key] = updates[key].trim();
  }
  const { data, error } = await req.supabase.from("tasks").update(updates)
    .eq("id", req.params.id)
    .select("id,title,description,category,priority,deadline,completed,created_at,updated_at")
    .maybeSingle();
  if (error) return dbError(res, error);
  if (!data) return res.status(404).json({ error: "Task not found." });
  res.json({ task: data });
});

app.delete("/api/tasks/:id", requireUser, async (req, res) => {
  const { data, error } = await req.supabase.from("tasks").delete()
    .eq("id", req.params.id).select("id").maybeSingle();
  if (error) return dbError(res, error);
  if (!data) return res.status(404).json({ error: "Task not found." });
  res.json({ success: true });
});

app.get("/api/profile", requireUser, async (req, res) => {
  const { data, error } = await req.supabase.from("profiles")
    .select("id,display_name,created_at").eq("id", req.user.id).maybeSingle();
  if (error) return dbError(res, error);
  res.json({
    profile: data || { id: req.user.id, display_name: "", created_at: null },
    email: req.user.email
  });
});

app.put("/api/profile", requireUser, async (req, res) => {
  const name = req.body?.display_name;
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 80) {
    return res.status(400).json({ error: "Name must contain 1–80 characters." });
  }
  const { data, error } = await req.supabase.from("profiles")
    .update({ display_name: name.trim() }).eq("id", req.user.id)
    .select("id,display_name,created_at").single();
  if (error) return dbError(res, error);
  res.json({ profile: data });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use(express.static(path.join(__dirname, "public")));
app.get("*path", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((error, _req, res, _next) => {
  console.error("Server error:", error.message);
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ error: "Invalid JSON." });
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, "0.0.0.0", () => console.log(`TaskFlow listening on ${PORT}`));
