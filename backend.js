/* Backend for the Kampfmittel History Map website.
   Gives the page the same small API it had as a Claude artifact (db, assets, sample, user),
   but stores data in Supabase (owner) or in this browser only (visitors).

   Layers, lowest first:  seed.json (shipped with the site)  <  Supabase (owner's data, readable by all)  <  this browser (visitor's own data)
   Only the owner can write to Supabase. The database rules (supabase/schema.sql) enforce this on the server. */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG || {};
  const configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/YOUR-/.test(CFG.supabaseUrl));
  const sb = configured && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  const COLS = ["events", "sources", "ordnance"];
  const state = { session: null, isOwner: false, remote: {}, local: {}, seed: {}, listeners: {}, ready: null };
  COLS.forEach(c => { state.remote[c] = new Map(); state.local[c] = new Map(); state.seed[c] = new Map(); state.listeners[c] = []; });

  /* ---------- IndexedDB (visitor storage) ---------- */
  let idbP = null;
  function idb() {
    if (idbP) return idbP;
    idbP = new Promise((res, rej) => {
      const r = indexedDB.open("khm-local", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("docs"); r.result.createObjectStore("blobs"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return idbP;
  }
  async function idbDo(store, mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => { const tx = db.transaction(store, mode); const st = tx.objectStore(store); const out = fn(st); tx.oncomplete = () => res(out && out.result !== undefined ? out.result : out); tx.onerror = () => rej(tx.error); });
  }
  async function idbAll(store) {
    const db = await idb();
    return new Promise((res, rej) => { const out = []; const tx = db.transaction(store, "readonly"); const c = tx.objectStore(store).openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else res(out); }; c.onerror = () => rej(c.error); });
  }

  /* ---------- auth ---------- */
  async function refreshAuth() {
    if (!sb) { state.session = null; state.isOwner = false; return; }
    const { data } = await sb.auth.getSession();
    state.session = data.session || null;
    const email = state.session?.user?.email || "";
    state.isOwner = !!email && (!CFG.ownerEmail || email.toLowerCase() === String(CFG.ownerEmail).toLowerCase());
    if (state.isOwner) { // double-check with the database rule
      const { data: ok, error } = await sb.rpc("is_owner");
      if (error || ok !== true) state.isOwner = false;
    }
  }

  /* ---------- loading ---------- */
  function emit(col) {
    const merged = new Map();
    for (const layer of [state.seed[col], state.remote[col], state.local[col]]) for (const [id, d] of layer) merged.set(id, d);
    const docs = [];
    for (const [id, d] of merged) {
      if (d && d.deleted && col !== "events") continue; // events: tombstones are handled by the page
      docs.push({ id, data: () => d, metadata: { fromCache: false } });
    }
    state.listeners[col].forEach(fn => { try { fn({ docs, metadata: { fromCache: false } }); } catch (e) { console.error(e); } });
  }
  async function loadSeed() {
    try { const s = await fetch("data/seed.json").then(r => r.json()); COLS.forEach(c => Object.entries(s[c] || {}).forEach(([id, d]) => state.seed[c].set(id, d))); } catch {}
  }
  async function loadRemote(col) {
    if (!sb) return;
    const m = new Map(); let from = 0; const step = 1000;
    for (;;) {
      const { data, error } = await sb.from("docs").select("id,data").eq("collection", col).range(from, from + step - 1);
      if (error) { console.warn("load", col, error); break; }
      data.forEach(r => m.set(r.id, r.data));
      if (data.length < step) break; from += step;
    }
    state.remote[col] = m;
  }
  async function loadLocal() {
    try { const all = await idbAll("docs"); COLS.forEach(c => state.local[c].clear());
      for (const [k, v] of all) { const i = k.indexOf("/"); const c = k.slice(0, i); if (state.local[c]) state.local[c].set(k.slice(i + 1), v); } } catch {}
  }
  async function loadAll() { await refreshAuth(); await Promise.all([loadSeed(), loadLocal(), ...COLS.map(loadRemote)]); COLS.forEach(emit); }
  state.ready = loadAll();

  /* ---------- writes ---------- */
  const writeTo = () => state.isOwner ? "remote" : "local";
  async function putDoc(col, id, data) {
    if (writeTo() === "remote") {
      const { error } = await sb.from("docs").upsert({ collection: col, id, data, updated_at: new Date().toISOString() });
      if (error) throw { code: "permission_denied", message: error.message };
      state.remote[col].set(id, data);
    } else {
      await idbDo("docs", "readwrite", st => st.put(data, col + "/" + id));
      state.local[col].set(id, data);
    }
    emitSoon(col);
  }
  async function delDoc(col, id) {
    if (writeTo() === "remote") {
      const { error } = await sb.from("docs").delete().eq("collection", col).eq("id", id);
      if (error) throw { code: "permission_denied", message: error.message };
      state.remote[col].delete(id);
      if (state.seed[col].has(id)) await putDoc(col, id, { deleted: true }); // hide shipped seed docs too
    } else {
      await idbDo("docs", "readwrite", st => st.delete(col + "/" + id));
      state.local[col].delete(id);
      if (state.seed[col].has(id) || state.remote[col].has(id)) await putDoc(col, id, { deleted: true });
    }
    emitSoon(col);
  }
  const current = (col, id) => state.local[col].get(id) ?? state.remote[col].get(id) ?? state.seed[col].get(id);
  const timers = {};
  function emitSoon(col) { clearTimeout(timers[col]); timers[col] = setTimeout(() => emit(col), 60); }

  const db = {
    collection: col => ({ onSnapshot: (next, err) => { state.listeners[col].push(next); state.ready.then(() => emit(col)).catch(e => err && err({ code: "unavailable" })); return () => {}; } }),
    doc: path => { const i = path.indexOf("/"); const col = path.slice(0, i), id = path.slice(i + 1);
      return {
        set: (data, opt) => putDoc(col, id, opt && opt.merge ? { ...(current(col, id) || {}), ...data } : data),
        update: data => { const c = current(col, id); if (!c) throw { code: "not_found" }; return putDoc(col, id, { ...c, ...data }); },
        delete: () => delDoc(col, id),
        get: async () => ({ exists: !!current(col, id), data: () => current(col, id) })
      }; }
  };

  /* ---------- files ---------- */
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const assets = {
    upload: async (blob, opt) => {
      const type = (opt && opt.type) || blob.type || "application/octet-stream";
      if (writeTo() === "remote") {
        const id = uid() + (type.includes("pdf") ? ".pdf" : type.includes("json") ? ".json" : "");
        const { error } = await sb.storage.from("files").upload(id, blob, { contentType: type, upsert: false });
        if (error) throw { code: "upload_failed", message: error.message };
        return { id };
      }
      const id = "local:" + uid();
      await idbDo("blobs", "readwrite", st => st.put(new Blob([blob], { type }), id));
      return { id };
    },
    delete: async id => {
      if (String(id).startsWith("local:")) return idbDo("blobs", "readwrite", st => st.delete(id));
      if (!state.isOwner) return;
      await sb.storage.from("files").remove([id]);
    }
  };
  async function blob(id) {
    if (!id) throw new Error("missing");
    if (String(id).startsWith("local:")) { const b = await idbDo("blobs", "readonly", st => st.get(id)); if (!b) throw new Error("missing"); return b; }
    if (!sb) throw new Error("missing");
    const { data, error } = await sb.storage.from("files").download(id);
    if (error) throw new Error(state.isOwner ? "missing" : "owner_only");
    return data;
  }
  async function blobUrl(id) {
    if (String(id).startsWith("local:")) return URL.createObjectURL(await blob(id));
    const { data, error } = await sb.storage.from("files").createSignedUrl(id, 3600);
    if (error) throw new Error(state.isOwner ? "missing" : "owner_only");
    return data.signedUrl;
  }

  /* ---------- AI (server function, owner only unless PUBLIC_AI is switched on) ---------- */
  async function ai(prompt, opts = {}) {
    const headers = { "content-type": "application/json" };
    if (state.session?.access_token) headers.authorization = "Bearer " + state.session.access_token;
    let r;
    try { r = await fetch("/api/ai", { method: "POST", headers, signal: opts.signal, body: JSON.stringify({ prompt, json: !!opts.json, tier: opts.modelTier || "default", maxTokens: opts.maxTokens }) }); }
    catch (e) { if (e.name === "AbortError") throw { code: "cancelled" }; throw { code: "network" }; }
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) throw { code: "not_granted" };
    if (r.status === 429) throw { code: "rate_limited" };
    if (!r.ok) throw { code: "error", text: j.error || "" };
    return j.text || "";
  }
  async function sample(prompt, opts = {}) { const text = await ai(prompt, opts); opts.onText && opts.onText({ text }); return { text }; }
  sample.json = async (prompt, opts = {}) => {
    const text = await ai(prompt + "\n\nReply with JSON only, no other text.", { ...opts, json: true });
    const m = text.match(/[\[{][\s\S]*[\]}]/); if (!m) throw { code: "bad_json" };
    return JSON.parse(m[0]);
  };
  let aiAvail = null;
  async function aiAvailable() {
    if (aiAvail !== null) return aiAvail;
    try { const r = await fetch("/api/ai", { method: "GET", headers: state.session ? { authorization: "Bearer " + state.session.access_token } : {} }); const j = await r.json(); aiAvail = !!j.allowed; }
    catch { aiAvail = false; }
    return aiAvail;
  }

  /* ---------- public API used by the page ---------- */
  window.claude = {
    use: async name => {
      await state.ready;
      if (name === "db") return db;
      if (name === "assets") return assets;
      if (name === "user") return { can: async () => true };
      if (name === "sample") return (await aiAvailable()) ? sample : null;
      return null;
    }
  };
  window.KHM = {
    configured, get isOwner() { return state.isOwner; }, get email() { return state.session?.user?.email || ""; },
    blob, blobUrl,
    async signIn(email, password) { if (!sb) throw new Error("Supabase is not configured in config.js"); const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; location.reload(); },
    async signOut() { await sb?.auth.signOut(); location.reload(); },
    async clearLocal() { const db = await idb(); await new Promise(r => { const tx = db.transaction(["docs", "blobs"], "readwrite"); tx.objectStore("docs").clear(); tx.objectStore("blobs").clear(); tx.oncomplete = r; }); location.reload(); },
    async putMany(col, entries) {
      if (!entries.length) return;
      if (state.isOwner) {
        for (let i = 0; i < entries.length; i += 500) {
          const rows = entries.slice(i, i + 500).map(([id, data]) => ({ collection: col, id, data, updated_at: new Date().toISOString() }));
          const { error } = await sb.from("docs").upsert(rows); if (error) throw { code: "permission_denied", message: error.message };
          rows.forEach(r => state.remote[col].set(r.id, r.data));
        }
      } else {
        const db = await idb();
        await new Promise((res, rej) => { const tx = db.transaction("docs", "readwrite"); const st = tx.objectStore("docs"); entries.forEach(([id, d]) => st.put(d, col + "/" + id)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        entries.forEach(([id, d]) => state.local[col].set(id, d));
      }
      emitSoon(col);
    },
    localCount: () => COLS.reduce((n, c) => n + state.local[c].size, 0),
    ready: () => state.ready
  };
})();
