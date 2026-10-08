(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = { mode: "login", session: null, user: null, tasks: [], profile: null, editingId: null, toastTimer: null };
  let supabase;

  function toast(message, isError = false) {
    const el = $("toast");
    el.textContent = message;
    el.className = `toast show${isError ? " error" : ""}`;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { el.className = "toast"; }, 3500);
  }

  async function request(path, options = {}) {
    const token = state.session?.access_token;
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body) headers["Content-Type"] = "application/json";
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && state.session) {
        toast("Your session expired. Please sign in again.", true);
      }
      throw new Error(payload.error || "Something went wrong.");
    }
    return payload;
  }

  function showAuth() {
    $("authView").classList.remove("hidden");
    $("appView").classList.add("hidden");
  }
  function showApp() {
    $("authView").classList.add("hidden");
    $("appView").classList.remove("hidden");
  }
  function setMode(mode) {
    state.mode = mode;
    const signup = mode === "signup";
    $("loginTab").classList.toggle("active", !signup);
    $("signupTab").classList.toggle("active", signup);
    $("nameGroup").classList.toggle("hidden", !signup);
    $("authName").required = signup;
    $("authPassword").autocomplete = signup ? "new-password" : "current-password";
    $("authHeading").textContent = signup ? "Create your account" : "Welcome back";
    $("authSubheading").textContent = signup ? "Start building a calmer, clearer day." : "Sign in to continue to your workspace.";
    $("authSubmit").innerHTML = signup ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
    $("resetPassword").classList.toggle("hidden", signup);
  }

  function initials(nameOrEmail) {
    const str = (nameOrEmail || "U").trim();
    return (str.split(/\s+/).length > 1
      ? str.split(/\s+/).slice(0, 2).map(x => x[0]).join("")
      : str[0]).toUpperCase();
  }

  function updateUserUI() {
    const name = state.profile?.display_name || state.user?.user_metadata?.display_name || "Your account";
    const email = state.user?.email || "";
    $("sidebarName").textContent = name;
    $("sidebarEmail").textContent = email;
    $("sidebarAvatar").textContent = initials(name === "Your account" ? email : name);
    $("topAvatar").textContent = initials(name === "Your account" ? email : name);
    $("profileAvatar").textContent = initials(name === "Your account" ? email : name);
    $("welcomeTitle").textContent = `Let's get things done${name !== "Your account" ? `, ${name.split(" ")[0]}` : ""}.`;
    $("profileName").value = state.profile?.display_name || "";
    $("profileEmail").value = email;
  }

  async function loadProfile() {
    const result = await request("/api/profile");
    state.profile = result.profile;
    updateUserUI();
  }

  async function loadTasks() {
    const result = await request("/api/tasks");
    state.tasks = result.tasks || [];
    renderTasks();
  }

  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function isOverdue(task) {
    return !task.completed && task.deadline && task.deadline < localToday();
  }
  function prettyDate(date) {
    if (!date) return "";
    const d = new Date(`${date}T00:00:00`);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function renderTasks() {
    const tasks = state.tasks;
    const completed = tasks.filter(t => t.completed).length;
    $("totalCount").textContent = tasks.length;
    $("pendingCount").textContent = tasks.length - completed;
    $("completedCount").textContent = completed;

    const categories = [...new Set(tasks.map(t => t.category).filter(Boolean))].sort((a,b) => a.localeCompare(b));
    const categorySelect = $("categoryFilter");
    const oldCategory = categorySelect.value;
    categorySelect.innerHTML = '<option value="all">All categories</option>' +
      categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
    if (categories.includes(oldCategory)) categorySelect.value = oldCategory;

    const query = $("searchInput").value.trim().toLowerCase();
    const status = $("statusFilter").value;
    const category = categorySelect.value;
    const sort = $("sortFilter").value;
    let visible = tasks.filter(t => {
      const matchesQuery = [t.title, t.description, t.category, t.priority].some(v => String(v || "").toLowerCase().includes(query));
      const matchesStatus = status === "all" ||
        (status === "pending" && !t.completed) ||
        (status === "completed" && t.completed) ||
        (status === "overdue" && isOverdue(t));
      return matchesQuery && matchesStatus && (category === "all" || t.category === category);
    });

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    if (sort === "deadline") visible.sort((a,b) => (a.deadline || "9999-12-31").localeCompare(b.deadline || "9999-12-31"));
    else if (sort === "priority") visible.sort((a,b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
    else if (sort === "alphabetical") visible.sort((a,b) => a.title.localeCompare(b.title));
    else visible.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

    $("visibleCount").textContent = `${visible.length} ${visible.length === 1 ? "task" : "tasks"}`;
    $("taskSubtitle").textContent = query || status !== "all" || category !== "all" ? "Showing matching tasks." : "Everything you need to focus on.";
    $("taskList").innerHTML = visible.map(task => {
      const due = task.deadline ? `<span class="tag ${isOverdue(task) ? "overdue" : ""}">${isOverdue(task) ? "⚠ Overdue · " : "◷ "}${escapeHTML(prettyDate(task.deadline))}</span>` : "";
      return `<article class="task-card ${task.completed ? "is-complete" : ""}">
        <input class="task-check" type="checkbox" aria-label="Mark ${escapeHTML(task.title)} complete" data-action="toggle" data-id="${task.id}" ${task.completed ? "checked" : ""}>
        <div class="task-main">
          <div class="task-title">${escapeHTML(task.title)}</div>
          ${task.description ? `<div class="task-description">${escapeHTML(task.description)}</div>` : ""}
          <div class="task-meta">
            <span class="tag">${escapeHTML(task.category)}</span>
            <span class="tag priority-${escapeHTML(task.priority)}">${escapeHTML(task.priority[0].toUpperCase() + task.priority.slice(1))} priority</span>
            ${due}
          </div>
        </div>
        <div class="task-actions">
          <button class="icon-button" type="button" title="Edit task" aria-label="Edit task" data-action="edit" data-id="${task.id}">✎</button>
          <button class="icon-button" type="button" title="Delete task" aria-label="Delete task" data-action="delete" data-id="${task.id}">⌫</button>
        </div>
      </article>`;
    }).join("");

    const empty = visible.length === 0;
    $("emptyState").classList.toggle("hidden", !empty);
    if (empty) {
      const hasAny = tasks.length > 0;
      $("emptyTitle").textContent = hasAny ? "No matching tasks" : "A fresh start.";
      $("emptyText").textContent = hasAny ? "Try changing your search or filters." : "Create your first task and make today count.";
      $("emptyAddButton").classList.toggle("hidden", hasAny);
    }
  }

  function openTaskDialog(task = null) {
    state.editingId = task?.id || null;
    $("taskForm").reset();
    $("dialogTitle").textContent = task ? "Edit task" : "Create a task";
    $("saveTask").textContent = task ? "Save changes" : "Save task";
    $("taskTitle").value = task?.title || "";
    $("taskDescription").value = task?.description || "";
    $("taskCategory").value = task?.category || "General";
    $("taskPriority").value = task?.priority || "medium";
    $("taskDeadline").value = task?.deadline || "";
    $("taskDialog").showModal();
    $("taskTitle").focus();
  }

  async function saveTask(event) {
    event.preventDefault();
    const body = {
      title: $("taskTitle").value.trim(),
      description: $("taskDescription").value.trim(),
      category: $("taskCategory").value.trim() || "General",
      priority: $("taskPriority").value,
      deadline: $("taskDeadline").value || null
    };
    const id = state.editingId;
    try {
      $("saveTask").disabled = true;
      if (id) await request(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      else await request("/api/tasks", { method: "POST", body: JSON.stringify(body) });
      $("taskDialog").close();
      await loadTasks();
      toast(id ? "Task updated." : "Task created.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      $("saveTask").disabled = false;
    }
  }

  async function handleTaskAction(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const id = target.dataset.id;
    const action = target.dataset.action;
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    try {
      if (action === "toggle") {
        await request(`/api/tasks/${encodeURIComponent(id)}`, {
          method: "PATCH", body: JSON.stringify({ completed: target.checked })
        });
        await loadTasks();
      } else if (action === "edit") {
        openTaskDialog(task);
      } else if (action === "delete") {
        if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
        await request(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
        await loadTasks();
        toast("Task deleted.");
      }
    } catch (error) {
      toast(error.message, true);
      if (action === "toggle") await loadTasks().catch(() => {});
    }
  }

  function setPage(page) {
    const profile = page === "profile";
    $("tasksPage").classList.toggle("hidden", profile);
    $("profilePage").classList.toggle("hidden", !profile);
    $("pageHeading").textContent = profile ? "My profile" : "My tasks";
    document.querySelectorAll("[data-page]").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) toast(error.message, true);
  }

  async function startApp(session) {
    state.session = session;
    state.user = session?.user || null;
    if (!session) {
      state.tasks = [];
      state.profile = null;
      showAuth();
      return;
    }
    showApp();
    try {
      await Promise.all([loadProfile(), loadTasks()]);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function init() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load application configuration.");
      const config = await response.json();
      supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });

      $("loginTab").addEventListener("click", () => setMode("login"));
      $("signupTab").addEventListener("click", () => setMode("signup"));

      $("authForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = $("authEmail").value.trim();
        const password = $("authPassword").value;
        const button = $("authSubmit");
        button.disabled = true;
        try {
          if (state.mode === "signup") {
            const display_name = $("authName").value.trim();
            if (!display_name) throw new Error("Please enter your name.");
            const { data, error } = await supabase.auth.signUp({
              email, password, options: { data: { display_name } }
            });
            if (error) throw error;
            if (data.session) {
              await startApp(data.session);
              toast("Account created. Welcome to TaskFlow!");
            } else {
              toast("Account created. Check your email to confirm, then sign in.");
              setMode("login");
            }
          } else {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            await startApp(data.session);
            toast("Welcome back!");
          }
        } catch (error) {
          toast(error.message || "Authentication failed.", true);
        } finally {
          button.disabled = false;
        }
      });

      $("resetPassword").addEventListener("click", async () => {
        const email = $("authEmail").value.trim();
        if (!email) return toast("Enter your email address first.", true);
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin
        });
        if (error) toast(error.message, true);
        else toast("If an account exists for that email, a reset link will be sent.");
      });

      $("logoutButton").addEventListener("click", signOut);
      $("profileLogout").addEventListener("click", signOut);
      $("newTaskButton").addEventListener("click", () => openTaskDialog());
      $("emptyAddButton").addEventListener("click", () => openTaskDialog());
      $("closeDialog").addEventListener("click", () => $("taskDialog").close());
      $("cancelTask").addEventListener("click", () => $("taskDialog").close());
      $("taskForm").addEventListener("submit", saveTask);
      $("taskList").addEventListener("click", handleTaskAction);
      $("taskList").addEventListener("change", handleTaskAction);
      ["searchInput", "statusFilter", "categoryFilter", "sortFilter"].forEach(id => {
        $(id).addEventListener(id === "searchInput" ? "input" : "change", renderTasks);
      });

      document.querySelectorAll("[data-page]").forEach(button => {
        button.addEventListener("click", () => setPage(button.dataset.page));
      });

      $("profileForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const result = await request("/api/profile", {
            method: "PUT",
            body: JSON.stringify({ display_name: $("profileName").value.trim() })
          });
          state.profile = result.profile;
          updateUserUI();
          toast("Profile saved.");
        } catch (error) {
          toast(error.message, true);
        }
      });

      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      await startApp(data.session);
      supabase.auth.onAuthStateChange((_event, session) => {
        state.session = session;
        state.user = session?.user || null;
        if (!session) {
          state.tasks = [];
          state.profile = null;
          showAuth();
        } else if (!$("appView").classList.contains("hidden")) {
          // Token refresh: keep current view and refresh account data.
          Promise.all([loadProfile(), loadTasks()]).catch(err => toast(err.message, true));
        } else {
          setTimeout(() => startApp(session), 0);
        }
      });
    } catch (error) {
      console.error(error);
      toast("Could not initialise TaskFlow. Check Render environment variables.", true);
    }
  }

  setMode("login");
  init();
})();
