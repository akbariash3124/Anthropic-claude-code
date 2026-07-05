/* ============================================================
   backup.js — protects the coach's memory. Auto-commits a
   snapshot (API key + token stripped) to a private GitHub repo
   after workouts and weekly reviews, debounced. Manual push,
   restore, and a weekly download-nudge helper.
   ============================================================ */

const Backup = (function () {
  "use strict";

  const API = "https://api.github.com";
  const PATH = "coach-backup.json";
  const DEBOUNCE_MIN = 10;

  const cfg = () => Store.get().settings.backup || {};
  const configured = () => !!(cfg().token && cfg().repo);

  function headers() {
    return { authorization: `Bearer ${cfg().token}`, accept: "application/vnd.github+json", "content-type": "application/json" };
  }
  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(str) { return decodeURIComponent(escape(atob(str.replace(/\n/g, "")))); }

  async function currentSha() {
    const res = await fetch(`${API}/repos/${cfg().repo}/contents/${PATH}`, { headers: headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
    return (await res.json()).sha;
  }

  async function push(reason) {
    if (!configured()) { const e = new Error("NOT_CONFIGURED"); throw e; }
    const content = JSON.stringify(Store.exportData(), null, 1);
    const sha = await currentSha();
    const res = await fetch(`${API}/repos/${cfg().repo}/contents/${PATH}`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify(Object.assign({ message: `coach backup — ${reason} — ${new Date().toISOString()}`, content: b64encode(content) }, sha ? { sha } : {})),
    });
    if (!res.ok) {
      let d = ""; try { d = (await res.json()).message || ""; } catch {}
      throw new Error(`GitHub backup failed (${res.status}${d ? ": " + d : ""})`);
    }
    const s = Store.get();
    s.settings.backup.lastPushedAt = new Date().toISOString();
    s.settings.lastBackupAt = new Date().toISOString();
    Store.save();
    return true;
  }

  // Fire-and-forget after training events; debounced; never interrupts the user.
  function auto(reason) {
    if (!configured()) return;
    const last = cfg().lastPushedAt;
    if (last && (Date.now() - new Date(last).getTime()) < DEBOUNCE_MIN * 60000) return;
    push(reason).catch((e) => { const s = Store.get(); s.settings.backup.lastError = e.message; Store.save(); });
  }

  async function restore() {
    if (!configured()) throw new Error("Set your GitHub token + repo first");
    const res = await fetch(`${API}/repos/${cfg().repo}/contents/${PATH}`, { headers: headers() });
    if (res.status === 404) throw new Error("No backup found in that repo yet");
    if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
    const data = JSON.parse(b64decode((await res.json()).content));
    const keep = Object.assign({}, Store.get().settings.backup); // keep local token
    Store.importData(data);
    const s = Store.get();
    s.settings.backup = Object.assign({}, data.settings && data.settings.backup, keep);
    Store.save();
    return true;
  }

  // Weekly nudge: true when there is data worth protecting and no fresh backup anywhere.
  function nudgeDue() {
    const s = Store.get();
    if (!s.sessions.length && !s.weighIns.length) return false;
    const last = s.settings.lastBackupAt;
    return !last || (Date.now() - new Date(last).getTime()) > 7 * 86400000;
  }
  function markDownloaded() { const s = Store.get(); s.settings.lastBackupAt = new Date().toISOString(); Store.save(); }

  return { push, auto, restore, configured, nudgeDue, markDownloaded };
})();

if (typeof window !== "undefined") window.Backup = Backup;
