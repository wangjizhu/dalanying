"use strict";

/* ================= 常量 ================= */
const CATS = { 兄弟树洞: "brother", 健身: "fitness", 数码: "digital", 游戏: "game", 穿搭: "fashion", 搞钱: "money", 美食: "food" };
const TABS = ["推荐", "兄弟树洞", "健身", "数码", "游戏", "穿搭", "搞钱", "美食"];
const CAT_NAME = { brother: "兄弟树洞", fitness: "健身", digital: "数码", game: "游戏", fashion: "穿搭", money: "搞钱", food: "美食" };

/* ================= 状态 ================= */
let ME = null;            // 当前登录用户 {id, name, avatar, bio, stats}
let ALL = [];             // 服务器返回的笔记列表
let activeTab = "推荐";
let query = "";
let currentPost = null;   // 详情弹窗当前笔记(含 body/tags/comments/followed)
let authMode = "login";

const $ = (id) => document.getElementById(id);
const feedEl = $("feed");
const tabsEl = $("tabs");

/* ================= 工具 ================= */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmt(n) {
  if (n >= 10000) {
    const v = (n / 10000).toFixed(1);
    return (v.endsWith(".0") ? v.slice(0, -2) : v) + "万";
  }
  return String(n);
}
function graphemes(s) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(s), (x) => x.segment);
  }
  return [...s];
}
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ================= API ================= */
async function api(path, method, body) {
  const opts = { method: method || "GET", headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let r;
  try { r = await fetch(path, opts); }
  catch (e) { throw new Error("网络不给力,稍后再试"); }
  let data = {};
  try { data = await r.json(); } catch (e) { /* 空响应 */ }
  if (!r.ok) {
    const err = new Error(data.error || "请求失败(" + r.status + ")");
    err.status = r.status;
    throw err;
  }
  return data;
}
function isAuthErr(e) {
  if (e && e.status === 401) { openAuth("login"); toast("请先登录,散帅"); return true; }
  return false;
}

/* ================= 登录 / 注册 ================= */
function openAuth(mode) {
  authMode = mode || "login";
  syncAuthUI();
  openMask("authMask");
  $("authUser").focus();
}
function syncAuthUI() {
  const login = authMode === "login";
  $("authTitle").textContent = login ? "登录大蓝营 💙" : "注册散帅账号 ✨";
  $("authSubmit").textContent = login ? "登 录" : "注 册";
  $("authAvatarField").style.display = login ? "none" : "block";
  $("authHint").textContent = login ? "还没有账号?" : "已有账号?";
  $("authToggle").textContent = login ? "注册一个" : "去登录";
  $("authError").textContent = "";
}
async function submitAuth() {
  const username = $("authUser").value.trim();
  const password = $("authPass").value;
  if (!username || !password) { $("authError").textContent = "用户名和密码都要填"; return; }
  const payload = { username, password };
  if (authMode === "register") {
    const av = graphemes($("authAvatar").value.trim())[0];
    if (av) payload.avatar = av;
  }
  const btn = $("authSubmit");
  btn.disabled = true;
  try {
    const d = await api("/api/auth/" + authMode, "POST", payload);
    ME = d.user;
    $("authPass").value = "";
    closeMasks();
    updateMeUI();
    await refreshPosts();
    renderFeed();
    refreshBadge();
    toast(authMode === "login" ? "欢迎回来," + ME.name + " 💙" : "注册成功,欢迎入营," + ME.name + " 💙");
  } catch (e) {
    $("authError").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ================= 我 / 会话 ================= */
async function loadMe() {
  try { ME = (await api("/api/me")).user; } catch (e) { ME = null; }
  updateMeUI();
}
function updateMeUI() {
  $("topAvatar").textContent = ME ? ME.avatar : "👤";
  if (ME) {
    $("pfAvatar").textContent = ME.avatar;
    $("pfName").textContent = ME.name;
    $("pfId").textContent = "蓝营号:" + ME.id + " · IP属地:蓝营";
    $("pfBio").textContent = ME.bio || "阳光 · 乐观 · 独立|帅气散入星河";
    $("pfFollowing").textContent = fmt(ME.stats.following);
    $("pfFans").textContent = fmt(ME.stats.followers);
    $("pfPraise").textContent = fmt(ME.stats.praise);
    $("pfAction").textContent = "退出登录";
  } else {
    $("pfAvatar").textContent = "👤";
    $("pfName").textContent = "未登录";
    $("pfId").textContent = "登录后开启散帅身份";
    $("pfBio").textContent = "大蓝营 · 散帅集中营 · boys help boys";
    $("pfFollowing").textContent = "-";
    $("pfFans").textContent = "-";
    $("pfPraise").textContent = "-";
    $("pfAction").textContent = "登录 / 注册";
    $("notifBadge").style.display = "none";
  }
}
function notifSeenKey() {
  return "dly_notif_seen_" + (ME ? ME.id : "anon");
}
async function refreshBadge() {
  if (!ME) return;
  try {
    const d = await api("/api/notifications");
    let seen = "";
    try { seen = localStorage.getItem(notifSeenKey()) || ""; } catch (e) { /* 隐私模式 */ }
    const unread = d.items.filter((n) => n.date > seen).length; // 日期是 YYYY-MM-DD HH:MM,可直接字典序比较
    if (unread) {
      $("notifBadge").textContent = Math.min(unread, 99);
      $("notifBadge").style.display = "";
    } else {
      $("notifBadge").style.display = "none";
    }
  } catch (e) { /* 静默 */ }
}
