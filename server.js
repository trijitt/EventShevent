const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "eventshevent-data")
  : path.join(__dirname, "data");
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH)
  : DEFAULT_DATA_DIR;
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const BODY_LIMIT = 16 * 1024 * 1024;

const MASTER_ACCOUNT = {
  email: "trijitdas2005@gmail.com",
  password: "trijit007",
};

const SESSION_SECRET = process.env.SESSION_SECRET || `eventshevent-demo-${MASTER_ACCOUNT.email}`;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const defaultDb = {
  applications: [],
  users: [],
  events: [],
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function loadDb() {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });

  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    return { ...defaultDb, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await saveDb(defaultDb);
    return structuredClone(defaultDb);
  }
}

async function saveDb(db) {
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function publicUser(session) {
  return {
    id: session.userId,
    email: session.email,
    role: session.role,
    status: session.status || "active",
  };
}

function createSession(payload) {
  const session = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function getSession(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !token.includes(".")) return null;

  const [encoded, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encoded)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

function invalidateUserSessions(userId) {
  return userId;
}

function requireAuth(req, res, role, db, options = {}) {
  const session = getSession(req);
  if (!session) {
    sendError(res, 401, "Please log in again.");
    return null;
  }

  if (session.role !== "master" && db) {
    const user = db.users.find((entry) => entry.id === session.userId);
    if (!user) {
      sendError(res, 401, "This account no longer exists.");
      return null;
    }

    const status = user.status || "active";
    if (status === "blocked") {
      sendError(res, 403, "This account is blocked by master control.");
      return null;
    }

    session.email = user.email;
    session.role = user.role;
    session.status = status;

    if (options.activeOnly && status !== "active") {
      sendError(res, 403, "This account is restricted by master control.");
      return null;
    }
  }

  if (role && session.role !== role) {
    sendError(res, 403, "This account cannot access that area.");
    return null;
  }

  return session;
}

function isMasterEmail(email) {
  return normalizeEmail(email) === MASTER_ACCOUNT.email;
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("Uploads are too large. Try fewer or smaller images."));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("The request body is not valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || "").trim());
  if (missing.length) {
    return `Missing required field: ${missing.join(", ")}`;
  }
  return "";
}

function toMinutes(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
}

function timeIsValid(startTime, endTime) {
  return toMinutes(startTime) >= 480 &&
    toMinutes(startTime) <= 1050 &&
    toMinutes(endTime) >= 510 &&
    toMinutes(endTime) <= 1080 &&
    toMinutes(endTime) > toMinutes(startTime);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

function findVenueConflict(db, eventToApprove) {
  return db.events.find((event) => {
    if (event.id === eventToApprove.id || event.status !== "approved") return false;
    if (event.date !== eventToApprove.date) return false;
    if (event.venueGroup !== eventToApprove.venueGroup) return false;
    if (event.venue !== eventToApprove.venue) return false;
    return overlaps(
      event.startTime,
      event.endTime,
      eventToApprove.startTime,
      eventToApprove.endTime,
    );
  });
}

function serializeEvent(event, session) {
  const registrations = event.registrations || [];
  const votes = event.votes || [];
  const myVote = votes.find((entry) => entry.userId === session?.userId)?.value || 0;
  return {
    ...event,
    registrations,
    votes,
    registrationCount: registrations.length,
    upvotes: votes.filter((entry) => entry.value === 1).length,
    downvotes: votes.filter((entry) => entry.value === -1).length,
    voteScore: votes.reduce((total, entry) => total + entry.value, 0),
    myVote,
    isHostedByMe: session?.userId === event.hostId,
    isRegisteredByMe: registrations.some((entry) => entry.userId === session?.userId),
  };
}

function cleanImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image) => typeof image === "string" && image.startsWith("data:image/") && image.length <= 900000)
    .slice(0, 3);
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const requestedPath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!requestedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(requestedPath);
    const ext = path.extname(requestedPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    throw error;
  }
}

async function handleApi(req, res, url) {
  const db = await loadDb();
  const method = req.method;
  const route = url.pathname;

  if (method === "GET" && route === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && route === "/api/signup") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const missing = requireFields({ ...body, email }, ["email", "password", "confirmPassword", "idCardImage"]);

    if (missing) return sendError(res, 400, missing);
    if (body.password !== body.confirmPassword) return sendError(res, 400, "Passwords do not match.");
    if (isMasterEmail(email)) return sendError(res, 400, "The master account already exists. Use login.");
    if (!String(body.idCardImage).startsWith("data:image/") || String(body.idCardImage).length > 900000) {
      return sendError(res, 400, "Upload a smaller ID-card image.");
    }

    const hasUser = db.users.some((user) => normalizeEmail(user.email) === email);
    const hasPending = db.applications.some(
      (application) => normalizeEmail(application.email) === email && application.status === "pending",
    );

    if (hasUser) return sendError(res, 409, "An approved account already exists for this email.");
    if (hasPending) return sendError(res, 409, "This email already has a pending application.");

    const application = {
      id: crypto.randomUUID(),
      email,
      password: String(body.password),
      idCardImage: String(body.idCardImage),
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    db.applications.unshift(application);
    await saveDb(db);
    sendJson(res, 201, { application });
    return;
  }

  if (method === "POST" && route === "/api/login") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");

    if (email === MASTER_ACCOUNT.email && password === MASTER_ACCOUNT.password) {
      const token = createSession({ role: "master", userId: "master", email });
      sendJson(res, 200, { token, user: { id: "master", email, role: "master" } });
      return;
    }

    const user = db.users.find((entry) => normalizeEmail(entry.email) === email);
    if (!user || user.password !== password) {
      const pending = db.applications.find(
        (entry) => normalizeEmail(entry.email) === email && entry.status === "pending",
      );
      const message = pending ? "Your signup is still waiting for master approval." : "Email or password is incorrect.";
      return sendError(res, 401, message);
    }

    const status = user.status || "active";
    if (status === "blocked") {
      return sendError(res, 403, "This account is blocked by master control.");
    }

    const token = createSession({ role: user.role, userId: user.id, email: user.email, status });
    sendJson(res, 200, { token, user: { id: user.id, email: user.email, role: user.role, status } });
    return;
  }

  if (method === "GET" && route === "/api/me") {
    const session = requireAuth(req, res, null, db);
    if (!session) return;
    sendJson(res, 200, { user: publicUser(session) });
    return;
  }

  if (method === "GET" && route === "/api/master/applications") {
    const session = requireAuth(req, res, "master", db);
    if (!session) return;
    sendJson(res, 200, {
      applications: db.applications.filter((application) => application.status === "pending"),
    });
    return;
  }

  const applicationDecisionMatch = route.match(/^\/api\/master\/applications\/([^/]+)\/decide$/);
  if (method === "POST" && applicationDecisionMatch) {
    const session = requireAuth(req, res, "master", db);
    if (!session) return;

    const body = await readJson(req);
    const decision = String(body.decision || "");
    const application = db.applications.find((entry) => entry.id === applicationDecisionMatch[1]);

    if (!application || application.status !== "pending") {
      return sendError(res, 404, "That pending application was not found.");
    }

    if (decision === "student" || decision === "administrator") {
      const existing = db.users.find((user) => normalizeEmail(user.email) === normalizeEmail(application.email));
      if (existing) return sendError(res, 409, "A user with this email already exists.");

      const user = {
        id: crypto.randomUUID(),
        email: application.email,
        password: application.password,
        role: decision,
        status: "active",
        idCardImage: application.idCardImage,
        createdAt: application.createdAt,
        approvedAt: new Date().toISOString(),
      };
      application.status = "approved";
      application.role = decision;
      application.decidedAt = user.approvedAt;
      db.users.unshift(user);
      await saveDb(db);
      sendJson(res, 200, { user });
      return;
    }

    if (decision === "reject") {
      application.status = "rejected";
      application.decidedAt = new Date().toISOString();
      await saveDb(db);
      sendJson(res, 200, { application });
      return;
    }

    sendError(res, 400, "Choose student, administrator, or reject.");
    return;
  }

  if (method === "GET" && route === "/api/master/users") {
    const session = requireAuth(req, res, "master", db);
    if (!session) return;

    const role = url.searchParams.get("role");
    const query = normalizeEmail(url.searchParams.get("q"));
    const users = db.users
      .filter((user) => !role || user.role === role)
      .filter((user) => !query || normalizeEmail(user.email).includes(query))
      .map((user) => ({ ...user, status: user.status || "active" }));

    sendJson(res, 200, { users });
    return;
  }

  const passwordMatch = route.match(/^\/api\/master\/users\/([^/]+)\/password$/);
  if (method === "PATCH" && passwordMatch) {
    const session = requireAuth(req, res, "master", db);
    if (!session) return;

    const body = await readJson(req);
    const password = String(body.password || "").trim();
    if (!password) return sendError(res, 400, "Enter a new password.");

    const user = db.users.find((entry) => entry.id === passwordMatch[1]);
    if (!user) return sendError(res, 404, "That user was not found.");

    user.password = password;
    await saveDb(db);
    sendJson(res, 200, { user: { ...user, status: user.status || "active" } });
    return;
  }

  const roleMatch = route.match(/^\/api\/master\/users\/([^/]+)\/role$/);
  if (method === "PATCH" && roleMatch) {
    const session = requireAuth(req, res, "master", db);
    if (!session) return;

    const body = await readJson(req);
    const nextRole = String(body.role || "").trim();
    if (!["student", "administrator"].includes(nextRole)) {
      return sendError(res, 400, "Choose student or administrator.");
    }

    const user = db.users.find((entry) => entry.id === roleMatch[1]);
    if (!user) return sendError(res, 404, "That user was not found.");

    user.role = nextRole;
    user.updatedAt = new Date().toISOString();
    invalidateUserSessions(user.id);
    await saveDb(db);
    sendJson(res, 200, { user: { ...user, status: user.status || "active" } });
    return;
  }

  const statusMatch = route.match(/^\/api\/master\/users\/([^/]+)\/status$/);
  if (method === "PATCH" && statusMatch) {
    const session = requireAuth(req, res, "master", db);
    if (!session) return;

    const body = await readJson(req);
    const nextStatus = String(body.status || "").trim();
    if (!["active", "restricted", "blocked"].includes(nextStatus)) {
      return sendError(res, 400, "Choose active, restricted, or blocked.");
    }

    const user = db.users.find((entry) => entry.id === statusMatch[1]);
    if (!user) return sendError(res, 404, "That user was not found.");

    user.status = nextStatus;
    user.statusUpdatedAt = new Date().toISOString();
    invalidateUserSessions(user.id);
    await saveDb(db);
    sendJson(res, 200, { user: { ...user, status: user.status || "active" } });
    return;
  }

  const deleteUserMatch = route.match(/^\/api\/master\/users\/([^/]+)$/);
  if (method === "DELETE" && deleteUserMatch) {
    const session = requireAuth(req, res, "master", db);
    if (!session) return;

    const userIndex = db.users.findIndex((entry) => entry.id === deleteUserMatch[1]);
    if (userIndex === -1) return sendError(res, 404, "That user was not found.");

    const [deletedUser] = db.users.splice(userIndex, 1);
    for (const event of db.events) {
      if (event.hostId === deletedUser.id) {
        event.hostDeleted = true;
      }
      event.registrations = (event.registrations || []).filter((entry) => entry.userId !== deletedUser.id);
      event.votes = (event.votes || []).filter((entry) => entry.userId !== deletedUser.id);
    }
    invalidateUserSessions(deletedUser.id);
    await saveDb(db);
    sendJson(res, 200, { user: { ...deletedUser, status: deletedUser.status || "active" } });
    return;
  }

  if (method === "POST" && route === "/api/events/request") {
    const session = requireAuth(req, res, "student", db, { activeOnly: true });
    if (!session) return;

    const body = await readJson(req);
    const missing = requireFields(body, ["name", "venueGroup", "venue", "date", "startTime", "endTime", "description"]);
    if (missing) return sendError(res, 400, missing);
    if (!timeIsValid(body.startTime, body.endTime)) {
      return sendError(res, 400, "Choose a valid time between 8:00 AM and 6:00 PM.");
    }

    const event = {
      id: crypto.randomUUID(),
      hostId: session.userId,
      hostEmail: session.email,
      name: String(body.name).trim(),
      venueGroup: String(body.venueGroup).trim(),
      venue: String(body.venue).trim(),
      date: String(body.date).trim(),
      startTime: String(body.startTime).trim(),
      endTime: String(body.endTime).trim(),
      description: String(body.description).trim(),
      remarks: String(body.remarks || "").trim(),
      images: cleanImages(body.images),
      status: "pending",
      createdAt: new Date().toISOString(),
      registrations: [],
      votes: [],
    };

    db.events.unshift(event);
    await saveDb(db);
    sendJson(res, 201, { event: serializeEvent(event, session) });
    return;
  }

  if (method === "GET" && route === "/api/student/requests") {
    const session = requireAuth(req, res, "student", db, { activeOnly: true });
    if (!session) return;
    sendJson(res, 200, {
      events: db.events
        .filter((event) => event.hostId === session.userId)
        .map((event) => serializeEvent(event, session)),
    });
    return;
  }

  if (method === "GET" && route === "/api/events/feed") {
    const session = requireAuth(req, res, null, db, { activeOnly: true });
    if (!session || !["student", "administrator"].includes(session.role)) {
      if (!res.writableEnded) sendError(res, 403, "Only students and administrators can view events.");
      return;
    }

    sendJson(res, 200, {
      events: db.events
        .filter((event) => event.status === "approved")
        .map((event) => serializeEvent(event, session)),
    });
    return;
  }

  const registrationMatch = route.match(/^\/api\/events\/([^/]+)\/register$/);
  if (method === "POST" && registrationMatch) {
    const session = requireAuth(req, res, "student", db, { activeOnly: true });
    if (!session) return;

    const event = db.events.find((entry) => entry.id === registrationMatch[1]);
    if (!event || event.status !== "approved") return sendError(res, 404, "That approved event was not found.");
    if (event.hostId === session.userId) return sendError(res, 400, "You are already the host for this event.");

    event.registrations ||= [];
    const alreadyRegistered = event.registrations.some((entry) => entry.userId === session.userId);
    if (alreadyRegistered) return sendError(res, 409, "You have already applied for this event.");

    event.registrations.push({
      userId: session.userId,
      email: session.email,
      createdAt: new Date().toISOString(),
    });
    await saveDb(db);
    sendJson(res, 200, { event: serializeEvent(event, session) });
    return;
  }

  const unjoinMatch = route.match(/^\/api\/events\/([^/]+)\/unjoin$/);
  if (method === "POST" && unjoinMatch) {
    const session = requireAuth(req, res, "student", db, { activeOnly: true });
    if (!session) return;

    const event = db.events.find((entry) => entry.id === unjoinMatch[1]);
    if (!event || event.status !== "approved") return sendError(res, 404, "That approved event was not found.");

    event.registrations ||= [];
    const originalCount = event.registrations.length;
    event.registrations = event.registrations.filter((entry) => entry.userId !== session.userId);
    if (event.registrations.length === originalCount) {
      return sendError(res, 409, "You have not joined this event.");
    }

    await saveDb(db);
    sendJson(res, 200, { event: serializeEvent(event, session) });
    return;
  }

  const voteMatch = route.match(/^\/api\/events\/([^/]+)\/vote$/);
  if (method === "POST" && voteMatch) {
    const session = requireAuth(req, res, "student", db, { activeOnly: true });
    if (!session) return;

    const body = await readJson(req);
    const value = Number(body.value);
    if (![1, -1, 0].includes(value)) return sendError(res, 400, "Choose upvote, downvote, or clear vote.");

    const event = db.events.find((entry) => entry.id === voteMatch[1]);
    if (!event || event.status !== "approved") return sendError(res, 404, "That approved event was not found.");
    if (event.hostId === session.userId) return sendError(res, 400, "Hosts cannot vote on their own event.");

    event.votes ||= [];
    event.votes = event.votes.filter((entry) => entry.userId !== session.userId);
    if (value !== 0) {
      event.votes.push({
        userId: session.userId,
        email: session.email,
        value,
        createdAt: new Date().toISOString(),
      });
    }

    await saveDb(db);
    sendJson(res, 200, { event: serializeEvent(event, session) });
    return;
  }

  if (method === "GET" && route === "/api/admin/events") {
    const session = requireAuth(req, res, "administrator", db, { activeOnly: true });
    if (!session) return;

    const status = url.searchParams.get("status") || "pending";
    sendJson(res, 200, {
      events: db.events
        .filter((event) => event.status === status)
        .map((event) => serializeEvent(event, session)),
    });
    return;
  }

  const eventDecisionMatch = route.match(/^\/api\/admin\/events\/([^/]+)\/decide$/);
  if (method === "POST" && eventDecisionMatch) {
    const session = requireAuth(req, res, "administrator", db, { activeOnly: true });
    if (!session) return;

    const body = await readJson(req);
    const decision = String(body.decision || "");
    const event = db.events.find((entry) => entry.id === eventDecisionMatch[1]);
    if (!event || event.status !== "pending") return sendError(res, 404, "That pending event was not found.");

    if (decision === "approve") {
      const conflict = findVenueConflict(db, event);
      if (conflict) {
        return sendError(
          res,
          409,
          `This venue is already booked by "${conflict.name}" from ${conflict.startTime} to ${conflict.endTime}.`,
        );
      }
      event.status = "approved";
      event.reviewNote = String(body.note || "").trim();
    } else if (decision === "reject") {
      event.status = "rejected";
      event.reviewNote = String(body.note || "").trim();
    } else {
      return sendError(res, 400, "Choose approve or reject.");
    }

    event.reviewedBy = session.email;
    event.reviewedAt = new Date().toISOString();
    await saveDb(db);
    sendJson(res, 200, { event: serializeEvent(event, session) });
    return;
  }

  sendError(res, 404, "API route not found.");
}

async function handleRequest(req, res, options = {}) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (options.apiOnly) {
      sendError(res, 404, "API route not found.");
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    if (!res.writableEnded) {
      sendError(res, 500, error.message || "Something went wrong.");
    }
  }
}

if (require.main === module) {
  const server = http.createServer(handleRequest);

  server.listen(PORT, HOST, () => {
    console.log(`EventShevent is running at http://${HOST}:${PORT}`);
  });
}

module.exports = { handleRequest };
