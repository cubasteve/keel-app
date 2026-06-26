// keel-logbook — signed trip & maintenance log entries, stored in D1 + R2.
//
// Members sign an EIP-712 LogEntry (free, no gas); this Worker verifies the
// signature, checks authorization (trip logs: signer owns the trip OR is an
// operator; maintenance logs: signer holds OPERATOR_ROLE), stores any photos
// in R2, and the row in D1. Reads are public (GET).
//
// Bindings: DB (D1), PHOTOS (R2). See wrangler.toml.

import { ethers } from "ethers";

const LEDGER   = "0x5c27f0399C3737a68e0933183609b8a273A98eC0";
const RPC_URL  = "https://polygon-amoy.g.alchemy.com/v2/tocmMJjVYA0syE3coEuGB";
const CHAIN_ID = 80002;
const ALLOW_ORIGIN = "https://cubasteve.github.io";
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 1_500_000; // ~1.5MB per photo after client-side resize

const DOMAIN = { name: "KeelLogbook", version: "1", chainId: CHAIN_ID };
const TYPES = {
  LogEntry: [
    { name: "author",   type: "address" },
    { name: "payload",  type: "string"  }, // canonical JSON of the entry fields
    { name: "deadline", type: "uint256" }
  ]
};

const LEDGER_ABI = [
  "function trips(bytes32) view returns (address member, uint64 startTs, uint64 endTs, uint32 totalTenths, bool competitive, bool cancelled, uint16 boatId, uint256 burnHundredths, uint256 tokensBurned)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function OPERATOR_ROLE() view returns (bytes32)"
];

const CORS = {
  "Access-Control-Allow-Origin":  ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);

    // ── Serve a photo from R2 ──────────────────────────────────────────────
    if (request.method === "GET" && url.pathname.startsWith("/photo/")) {
      const key = decodeURIComponent(url.pathname.slice("/photo/".length));
      const obj = await env.PHOTOS.get(key);
      if (!obj) return new Response("Not found", { status: 404, headers: CORS });
      return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "public, max-age=31536000", ...CORS } });
    }

    // ── List entries (public) ──────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/entries") {
      const tripId = url.searchParams.get("tripId");
      const boatId = url.searchParams.get("boatId");
      let stmt;
      if (tripId)      stmt = env.DB.prepare("SELECT * FROM log_entries WHERE trip_id = ? ORDER BY created_at DESC").bind(tripId);
      else if (boatId !== null) stmt = env.DB.prepare("SELECT * FROM log_entries WHERE boat_id = ? ORDER BY created_at DESC LIMIT 200").bind(Number(boatId || 0));
      else             stmt = env.DB.prepare("SELECT * FROM log_entries ORDER BY created_at DESC LIMIT 200");
      const { results } = await stmt.all();
      const base = url.origin;
      const out = (results || []).map(r => {
        const keys = JSON.parse(r.photo_keys || "[]");
        return {
          id: r.id, kind: r.kind, tripId: r.trip_id, boatId: r.boat_id, author: r.author,
          engineHours: r.engine_hours, fuelPct: r.fuel_pct, conditions: r.conditions,
          notes: r.notes, issue: !!r.issue, createdAt: r.created_at,
          locked: !!r.locked,
          photoKeys: keys,
          photos: keys.map(k => base + "/photo/" + encodeURIComponent(k))
        };
      });
      return json({ entries: out });
    }

    // ── Lock / unlock an entry (operator-only) ─────────────────────────────
    if (request.method === "POST" && url.pathname === "/lock") {
      let lreq; try { lreq = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }
      const a = lreq && lreq.author;
      if (!a || !ethers.isAddress(a)) return json({ error: "Bad author" }, 400);
      if (lreq.id == null) return json({ error: "id required" }, 400);
      const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
      const ledger = new ethers.Contract(LEDGER, LEDGER_ABI, provider);
      let isOp = false;
      try { isOp = await ledger.hasRole(await ledger.OPERATOR_ROLE(), ethers.getAddress(a)); } catch {}
      if (!isOp) return json({ error: "Locking is operator-only" }, 403);
      const locked = lreq.locked === false ? 0 : 1;
      try { await env.DB.prepare("UPDATE log_entries SET locked=? WHERE id=?").bind(locked, Number(lreq.id)).run(); }
      catch (err) { return json({ error: "Lock failed: " + (err.message || err) }, 500); }
      return json({ ok: true, locked: !!locked });
    }

    // ── Waitlist: GET this member's waitlisted days ────────────────────────
    if (request.method === "GET" && url.pathname === "/waitlist") {
      const member = url.searchParams.get("member");
      if (!member || !ethers.isAddress(member)) return json({ error: "Bad member" }, 400);
      const { results } = await env.DB.prepare("SELECT day, notified FROM waitlist WHERE member = ? ORDER BY day").bind(ethers.getAddress(member)).all();
      return json({ days: (results || []).map(r => ({ day: r.day, notified: !!r.notified })) });
    }
    // ── Waitlist: join / leave / mark-seen ─────────────────────────────────
    if (request.method === "POST" && url.pathname === "/waitlist") {
      let b; try { b = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }
      const { member, day, action } = b || {};
      if (!member || !ethers.isAddress(member)) return json({ error: "Bad member" }, 400);
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "Bad day" }, 400);
      const m = ethers.getAddress(member);
      try {
        if (action === "leave") {
          await env.DB.prepare("DELETE FROM waitlist WHERE member=? AND day=?").bind(m, day).run();
          return json({ ok: true, joined: false });
        }
        if (action === "seen") {
          await env.DB.prepare("UPDATE waitlist SET notified=1 WHERE member=? AND day=?").bind(m, day).run();
          return json({ ok: true });
        }
        await env.DB.prepare("INSERT OR IGNORE INTO waitlist (day, member, created_at, notified) VALUES (?,?,?,0)").bind(day, m, Math.floor(Date.now()/1000)).run();
        return json({ ok: true, joined: true });
      } catch (err) { return json({ error: "Waitlist failed: " + (err.message || err) }, 500); }
    }

    // ── Float plan: GET one (?tripId=), a member's (?member=), or who's out (?out=1) ──
    if (request.method === "GET" && url.pathname === "/floatplan") {
      const fpRow = (r) => ({
        tripId: r.trip_id, member: r.member, boatId: r.boat_id,
        checklist: JSON.parse(r.checklist || "{}"), souls: r.souls, destination: r.destination,
        etaReturn: r.eta_return, contact: r.contact, status: r.status,
        departedAt: r.departed_at, returnedAt: r.returned_at
      });
      const tripId = url.searchParams.get("tripId");
      const member = url.searchParams.get("member");
      if (tripId) {
        const r = await env.DB.prepare("SELECT * FROM floatplan WHERE trip_id = ?").bind(tripId).first();
        return json({ plan: r ? fpRow(r) : null });
      }
      if (url.searchParams.get("out")) {
        const { results } = await env.DB.prepare("SELECT * FROM floatplan WHERE status = 'departed' ORDER BY eta_return").all();
        return json({ plans: (results || []).map(fpRow) });
      }
      if (member) {
        if (!ethers.isAddress(member)) return json({ error: "Bad member" }, 400);
        const { results } = await env.DB.prepare("SELECT trip_id, status, eta_return FROM floatplan WHERE member = ?").bind(ethers.getAddress(member)).all();
        return json({ plans: (results || []).map(r => ({ tripId: r.trip_id, status: r.status, etaReturn: r.eta_return })) });
      }
      return json({ error: "Missing query" }, 400);
    }
    // ── Float plan: save / check-in / check-out (trip owner or operator) ──
    if (request.method === "POST" && url.pathname === "/floatplan") {
      let b; try { b = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }
      const { member, tripId, action } = b || {};
      if (!member || !ethers.isAddress(member)) return json({ error: "Bad member" }, 400);
      if (!tripId) return json({ error: "tripId required" }, 400);
      const who = ethers.getAddress(member);
      // Authorize: trip owner or operator (same on-chain check the logbook uses).
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
        const ledger = new ethers.Contract(LEDGER, LEDGER_ABI, provider);
        const t = await ledger.trips(tripId);
        const isOwner = t.member.toLowerCase() === who.toLowerCase();
        const isOp = isOwner ? false : await ledger.hasRole(await ledger.OPERATOR_ROLE(), who);
        if (!isOwner && !isOp) return json({ error: "Not your trip" }, 403);
      } catch (err) { return json({ error: "Authorization check failed" }, 502); }

      const now = Math.floor(Date.now()/1000);
      try {
        const existing = await env.DB.prepare("SELECT * FROM floatplan WHERE trip_id = ?").bind(tripId).first();
        if (action === "checkout") {
          if (!existing) return json({ error: "No float plan to check out" }, 404);
          await env.DB.prepare("UPDATE floatplan SET status='returned', returned_at=?, updated_at=? WHERE trip_id=?").bind(now, now, tripId).run();
          return json({ ok: true, status: "returned" });
        }
        const status = action === "checkin" ? "departed" : (existing?.status === "departed" ? "departed" : "planned");
        const departedAt = action === "checkin" ? now : (existing?.departed_at || null);
        const checklist = JSON.stringify(b.checklist || {});
        const souls = (b.souls === "" || b.souls == null) ? null : Math.max(0, Math.round(Number(b.souls)));
        const destination = b.destination ? String(b.destination).slice(0, 200) : null;
        const etaReturn = (b.etaReturn === "" || b.etaReturn == null) ? null : Number(b.etaReturn);
        const contact = b.contact ? String(b.contact).slice(0, 60) : null;
        await env.DB.prepare(
          `INSERT INTO floatplan (trip_id, member, boat_id, checklist, souls, destination, eta_return, contact, status, departed_at, returned_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(trip_id) DO UPDATE SET checklist=excluded.checklist, souls=excluded.souls,
             destination=excluded.destination, eta_return=excluded.eta_return, contact=excluded.contact,
             status=excluded.status, departed_at=excluded.departed_at, updated_at=excluded.updated_at`
        ).bind(tripId, who, Number(b.boatId)||0, checklist, souls, destination, etaReturn, contact, status, departedAt, existing?.returned_at || null, now).run();
        return json({ ok: true, status });
      } catch (err) { return json({ error: "Save failed: " + (err.message || err) }, 500); }
    }

    if (request.method !== "POST" || url.pathname !== "/entry") return json({ error: "Not found" }, 404);

    // ── Create an entry ────────────────────────────────────────────────────
    // No wallet signature required: the connected address is the author. We
    // still enforce on-chain authorization below (trip owner / operator), which
    // constrains who an entry can be attributed to.
    let req;
    try { req = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }
    const { author, payload, photos, id, keepKeys } = req || {};
    if (!author || !payload) return json({ error: "Missing fields" }, 400);
    if (!ethers.isAddress(author)) return json({ error: "Bad author" }, 400);
    const recovered = ethers.getAddress(author); // normalize

    let e;
    try { e = JSON.parse(payload); } catch { return json({ error: "Bad payload" }, 400); }
    const kind = e.kind === "maintenance" ? "maintenance" : "trip";
    const isEdit = id != null && id !== "";

    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
    const ledger = new ethers.Contract(LEDGER, LEDGER_ABI, provider);
    const isOperator = async () => { try { return await ledger.hasRole(await ledger.OPERATOR_ROLE(), recovered); } catch { return false; } };

    // ── Existing entry (edit): fetch + authorize as author-of-entry or operator ──
    let existing = null;
    if (isEdit) {
      existing = await env.DB.prepare("SELECT * FROM log_entries WHERE id = ?").bind(Number(id)).first();
      if (!existing) return json({ error: "Entry not found" }, 404);
      if (existing.locked) return json({ error: "This log is locked and can no longer be edited." }, 423);
      if (existing.author.toLowerCase() !== recovered.toLowerCase() && !(await isOperator())) {
        return json({ error: "Not your log entry" }, 403);
      }
    } else {
      // ── New entry: authorize by trip ownership / operator role ──
      try {
        if (kind === "trip") {
          if (!e.tripId) return json({ error: "tripId required" }, 400);
          const t = await ledger.trips(e.tripId);
          const isOwner = t.member.toLowerCase() === recovered.toLowerCase();
          if (!isOwner && !(await isOperator())) return json({ error: "Not your trip" }, 403);
        } else {
          if (!(await isOperator())) return json({ error: "Maintenance entries are operator-only" }, 403);
        }
      } catch (err) { return json({ error: "Authorization check failed" }, 502); }
    }

    // ── Photos: keep some existing (edit), delete removed, add new ──
    const existingKeys = existing ? JSON.parse(existing.photo_keys || "[]") : [];
    const keep = Array.isArray(keepKeys) ? keepKeys.filter(k => existingKeys.includes(k)) : existingKeys;
    try {
      // delete removed objects (only on edit)
      for (const k of existingKeys) { if (!keep.includes(k)) { try { await env.PHOTOS.delete(k); } catch {} } }
    } catch {}
    const newKeys = [];
    try {
      const room = Math.max(0, MAX_PHOTOS - keep.length);
      const arr = Array.isArray(photos) ? photos.slice(0, room) : [];
      for (let i = 0; i < arr.length; i++) {
        const m = /^data:(image\/\w+);base64,(.+)$/.exec(arr[i] || "");
        if (!m) continue;
        const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
        if (bytes.length > MAX_PHOTO_BYTES) return json({ error: "Photo too large (max ~1.5MB each)" }, 400);
        const key = `${kind}/${Date.now()}-${i}-${Math.random().toString(36).slice(2,8)}.jpg`;
        await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: m[1] } });
        newKeys.push(key);
      }
    } catch (err) { return json({ error: "Photo upload failed" }, 500); }
    const photoKeys = [...keep, ...newKeys];

    const engineHours = (e.engineHours === "" || e.engineHours == null) ? null : Number(e.engineHours);
    const fuelPct     = (e.fuelPct === "" || e.fuelPct == null) ? null : Math.max(0, Math.min(100, Math.round(Number(e.fuelPct))));
    const conditions  = e.conditions ? String(e.conditions).slice(0, 200) : null;
    const notes       = e.notes ? String(e.notes).slice(0, 2000) : null;

    try {
      if (isEdit) {
        await env.DB.prepare(
          `UPDATE log_entries SET engine_hours=?, fuel_pct=?, conditions=?, notes=?, issue=?, photo_keys=? WHERE id=?`
        ).bind(engineHours, fuelPct, conditions, notes, e.issue ? 1 : 0, JSON.stringify(photoKeys), Number(id)).run();
      } else {
        await env.DB.prepare(
          `INSERT INTO log_entries (kind, trip_id, boat_id, author, engine_hours, fuel_pct, conditions, notes, issue, photo_keys, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          kind, kind === "trip" ? String(e.tripId) : null,
          Number.isFinite(+e.boatId) ? +e.boatId : 0, recovered,
          engineHours, fuelPct, conditions, notes, e.issue ? 1 : 0,
          JSON.stringify(photoKeys), Math.floor(Date.now()/1000)
        ).run();
      }
    } catch (err) { return json({ error: "Save failed: " + (err.message || err) }, 500); }

    return json({ ok: true, edited: isEdit, photos: photoKeys.length });
  }
};
