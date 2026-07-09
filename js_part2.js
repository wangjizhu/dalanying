/* ================= Tabs ================= */
function renderTabs() {
  tabsEl.innerHTML = TABS.map((t) =>
    `<button class="tab${t === activeTab ? " active" : ""}" role="tab" aria-selected="${t === activeTab}" data-tab="${t}">${t}</button>`
  ).join("");
}
tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  activeTab = btn.dataset.tab;
  renderTabs();
  renderFeed();
});

/* ================= 瀑布流 ================= */
async function refreshPosts() {
  ALL = (await api("/api/posts")).posts;
}
function visiblePosts() {
  let list = ALL;
  if (activeTab !== "推荐") {
    const cat = CATS[activeTab];
    list = list.filter((p) => p.cat === cat);
  }
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((p) =>
      [p.title, p.author.name, p.coverText].join("\n").toLowerCase().includes(q)
    );
  }
  return list;
}
function cardHTML(p) {
  return `
    <article class="card" data-id="${p.id}">
      <div class="cover ${p.g}" style="aspect-ratio:${p.ratio}">
        <span class="cover-emoji">${esc(p.emoji)}</span>
        <span class="cover-text">${esc(p.coverText)}</span>
      </div>
      <div class="card-title">${esc(p.title)}</div>
      <div class="card-foot">
        <span class="card-author"><span class="avatar">${esc(p.author.avatar)}</span><span class="name">${esc(p.author.name)}</span></span>
        <button class="like-btn${p.liked ? " liked" : ""}" data-like="${p.id}" aria-label="点赞">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
          <span>${fmt(p.likes)}</span>
        </button>
      </div>
    </article>
  `;
}
function colCount() {
  const w = window.innerWidth;
  if (w >= 1700) return 5;
  if (w > 1250) return 4;
  if (w > 860) return 3;
  return 2;
}
let lastCols = 0;
function renderFeed() {
  const list = visiblePosts();
  lastCols = colCount();
  if (!list.length) {
    feedEl.innerHTML = `<div class="empty"><div class="empty-emoji">🫥</div>没有找到相关笔记,换个关键词试试?<br>或者点「发布」,第一篇让你来写</div>`;
    return;
  }
  const cols = Array.from({ length: lastCols }, () => ({ h: 0, html: "" }));
  for (const p of list) {
    const target = cols.reduce((a, b) => (b.h < a.h ? b : a));
    const [rw, rh] = p.ratio.split("/").map(Number);
    target.h += rh / rw + 0.35;
    target.html += cardHTML(p);
  }
  feedEl.innerHTML = cols.map((c) => `<div class="feed-col">${c.html}</div>`).join("");
}
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (colCount() !== lastCols) renderFeed(); }, 150);
});
feedEl.addEventListener("click", (e) => {
  const likeBtn = e.target.closest("[data-like]");
  if (likeBtn) { toggleLike(Number(likeBtn.dataset.like)); return; }
  const card = e.target.closest(".card[data-id]");
  if (card) openPost(Number(card.dataset.id));
});

/* ================= 点赞 / 收藏 ================= */
function syncCardLike(p) {
  const btn = feedEl.querySelector(`[data-like="${p.id}"]`);
  if (btn) {
    btn.classList.toggle("liked", p.liked);
    btn.querySelector("span").textContent = fmt(p.likes);
  }
}
function syncModalActs(p) {
  $("pmLike").classList.toggle("on", p.liked);
  $("pmStar").classList.toggle("on", p.starred);
  $("pmLikeCount").textContent = fmt(p.likes);
  $("pmStarCount").textContent = fmt(p.stars);
}
async function toggleLike(id) {
  if (!ME) return openAuth("login");
  const p = ALL.find((x) => x.id === id) || (currentPost && currentPost.id === id ? currentPost : null);
  if (!p) return;
  const prevLiked = p.liked, prevLikes = p.likes; // 先快照,apply 会变异 p 本身
  const apply = (liked, likes) => {
    const item = ALL.find((x) => x.id === id);
    if (item) { item.liked = liked; item.likes = likes; syncCardLike(item); }
    if (currentPost && currentPost.id === id) { currentPost.liked = liked; currentPost.likes = likes; syncModalActs(currentPost); }
  };
  apply(!prevLiked, prevLikes + (prevLiked ? -1 : 1)); // 乐观更新
  try {
    const d = await api("/api/posts/" + id + "/like", "POST");
    apply(d.liked, d.likes);
    if (d.liked) toast("已点赞,散帅眼光不错 💙");
  } catch (e) {
    apply(prevLiked, prevLikes); // 用快照回滚
    if (!isAuthErr(e)) toast(e.message);
  }
}
$("pmLike").addEventListener("click", () => { if (currentPost) toggleLike(currentPost.id); });
$("pmStar").addEventListener("click", async () => {
  if (!currentPost) return;
  if (!ME) return openAuth("login");
  try {
    const d = await api("/api/posts/" + currentPost.id + "/star", "POST");
    currentPost.starred = d.starred;
    currentPost.stars = d.stars;
    const item = ALL.find((x) => x.id === currentPost.id);
    if (item) { item.starred = d.starred; item.stars = d.stars; }
    syncModalActs(currentPost);
    if (d.starred) toast("已收藏,记进你的小蓝书 📘");
  } catch (e) { if (!isAuthErr(e)) toast(e.message); }
});

/* ================= 搜索 ================= */
$("searchInput").addEventListener("input", (e) => {
  query = e.target.value.trim();
  renderFeed();
});

/* ================= 弹窗开关 ================= */
function openMask(id) {
  $(id).classList.add("open");
  document.body.classList.add("no-scroll");
}
function closeMasks() {
  document.querySelectorAll(".modal-mask.open").forEach((m) => m.classList.remove("open"));
  document.body.classList.remove("no-scroll");
  currentPost = null;
}
document.querySelectorAll(".modal-mask").forEach((mask) => {
  let downOnMask = false;
  mask.addEventListener("mousedown", (e) => { downOnMask = e.target === mask; });
  mask.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { closeMasks(); return; }
    if (e.target === mask && downOnMask) closeMasks();
    downOnMask = false;
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) closeMasks();
});

/* ================= 笔记详情 ================= */
function setFollowUI(followed) {
  const b = $("pmFollow");
  b.textContent = followed ? "已关注" : "关注";
  b.classList.toggle("followed", followed);
}
function renderComments(p) {
  $("pmCommentCount").textContent = "共 " + p.comments.length + " 条评论";
  $("pmCmtCount").textContent = p.comments.length;
  $("pmComments").innerHTML = p.comments.length ? p.comments.map((c) => `
    <div class="comment">
      <span class="avatar">${esc(c.avatar)}</span>
      <div class="c-main">
        <div class="c-name">${esc(c.name)}</div>
        <div class="c-text">${esc(c.text)}</div>
        <div class="c-meta">${esc(c.date)} · 回复</div>
      </div>
    </div>
  `).join("") : `<div class="comments-title" style="text-align:center;padding:14px 0">还没有评论,来抢沙发 🛋️</div>`;
}
async function openPost(id) {
  let p;
  try { p = (await api("/api/posts/" + id)).post; }
  catch (e) { toast(e.message); return; }
  currentPost = p;
  const cover = $("pmCover");
  cover.className = "post-cover " + p.g;
  $("pmEmoji").textContent = p.emoji;
  $("pmCoverText").textContent = p.coverText;
  $("pmAvatar").textContent = p.author.avatar;
  $("pmAuthor").textContent = p.author.name;
  $("pmTitle").textContent = p.title;
  $("pmBody").textContent = p.body;
  $("pmTags").innerHTML = p.tags.map((t) => `<span># ${esc(t)}</span>`).join("");
  $("pmDate").textContent = "编辑于 " + p.date + " · IP属地:蓝营 · " + (CAT_NAME[p.cat] || "推荐");
  const fBtn = $("pmFollow");
  if (ME && ME.id === p.author.id) { fBtn.style.display = "none"; }
  else { fBtn.style.display = ""; setFollowUI(p.followed); }
  syncModalActs(p);
  renderComments(p);
  $("pmInput").value = "";
  openMask("postMask");
  document.querySelector(".post-scroll").scrollTop = 0;
}
$("pmFollow").addEventListener("click", async () => {
  if (!currentPost) return;
  if (!ME) return openAuth("login");
  try {
    const d = await api("/api/users/" + currentPost.author.id + "/follow", "POST");
    currentPost.followed = d.followed;
    setFollowUI(d.followed);
    ME.stats.following += d.followed ? 1 : -1; // 「我」面板的关注数同步
    updateMeUI();
    toast(d.followed ? "已关注 " + currentPost.author.name + ",兄弟常来 🤝" : "已取消关注");
  } catch (e) { if (!isAuthErr(e)) toast(e.message); }
});
$("pmCmt").addEventListener("click", () => {
  $("pmCommentCount").scrollIntoView({ behavior: "smooth", block: "start" });
  $("pmInput").focus();
});
async function sendComment() {
  if (!currentPost) return;
  if (!ME) return openAuth("login");
  const input = $("pmInput");
  const text = input.value.trim();
  if (!text) { toast("说点什么再发,兄弟"); return; }
  try {
    const d = await api("/api/posts/" + currentPost.id + "/comments", "POST", { text });
    currentPost.comments.push(d.comment);
    input.value = "";
    renderComments(currentPost);
    const item = ALL.find((x) => x.id === currentPost.id);
    if (item) item.commentCount += 1;
    const scroll = document.querySelector(".post-scroll");
    scroll.scrollTop = scroll.scrollHeight;
    toast("评论成功 💙");
  } catch (e) { if (!isAuthErr(e)) toast(e.message); }
}
$("pmSend").addEventListener("click", sendComment);
$("pmInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) sendComment(); });

/* ================= 发布 ================= */
$("pubSubmit").addEventListener("click", async () => {
  if (!ME) return openAuth("login");
  const title = $("pubTitle").value.trim();
  const body = $("pubBody").value.trim();
  if (!title) { toast("标题不能为空,散帅要有排面"); return; }
  try {
    const d = await api("/api/posts", "POST", {
      title, body,
      cat: $("pubCat").value,
      emoji: graphemes($("pubEmoji").value.trim())[0] || "📝"
    });
    ALL.unshift(d.post);
    $("pubTitle").value = ""; $("pubBody").value = ""; $("pubEmoji").value = "";
    closeMasks();
    activeTab = "推荐";
    query = "";
    $("searchInput").value = "";
    renderTabs();
    renderFeed();
    toast("发布成功,散帅们看得到你 💙");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) { if (!isAuthErr(e)) toast(e.message); }
});

/* ================= 通知 ================= */
$("navNotif").addEventListener("click", async () => {
  if (!ME) return openAuth("login");
  openMask("notifMask");
  $("notifList").innerHTML = `<div class="notif-empty">加载中…</div>`;
  try {
    const d = await api("/api/notifications");
    $("notifBadge").style.display = "none";
    if (d.items.length) localStorage.setItem(notifSeenKey(), d.items[0].date); // 最新一条即最大时间戳
    if (!d.items.length) {
      $("notifList").innerHTML = `<div class="notif-empty">还没有通知,先去发一篇笔记攒人气 💙</div>`;
      return;
    }
    $("notifList").innerHTML = d.items.map((n) => {
      const act = n.type === "like" ? "赞了你的笔记" : n.type === "comment" ? "评论了你" : "关注了你";
      const detail = n.type === "comment" ? ":" + esc(n.extra) : (n.title ? "《" + esc(n.title) + "》" : "");
      return `<div class="notif-item"><span class="avatar">${esc(n.avatar)}</span><div><div class="n-text"><b>${esc(n.name)}</b> ${act}${detail}</div><div class="n-meta">${esc(n.date)}</div></div></div>`;
    }).join("");
  } catch (e) {
    $("notifList").innerHTML = "";
    if (!isAuthErr(e)) toast(e.message);
  }
});

/* ================= 侧边栏 / 其他 ================= */
$("navHome").addEventListener("click", async () => {
  activeTab = "推荐";
  query = "";
  $("searchInput").value = "";
  try { await refreshPosts(); } catch (e) { /* 保留旧数据 */ }
  renderTabs();
  renderFeed();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("navPublish").addEventListener("click", () => { ME ? openMask("pubMask") : openAuth("login"); });
$("navMe").addEventListener("click", () => openMask("meMask"));
$("topAvatar").addEventListener("click", () => { ME ? openMask("meMask") : openAuth("login"); });
$("btnCreator").addEventListener("click", () => toast("散帅创作中心装修中,敬请期待 🚧"));
$("pfAction").addEventListener("click", async () => {
  if (!ME) { closeMasks(); openAuth("login"); return; }
  try { await api("/api/auth/logout", "POST"); } catch (e) { /* 忽略 */ }
  ME = null;
  closeMasks();
  updateMeUI();
  try { await refreshPosts(); }
  catch (e) { ALL.forEach((p) => { p.liked = false; p.starred = false; }); } // 刷新失败也不残留上个用户的状态
  renderFeed();
  toast("已退出,江湖再见 👋");
});
$("authSubmit").addEventListener("click", submitAuth);
$("authToggle").addEventListener("click", () => { authMode = authMode === "login" ? "register" : "login"; syncAuthUI(); });
$("authPass").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) submitAuth(); });

/* ================= 启动 ================= */
renderTabs();
(async () => {
  await loadMe();
  try {
    await refreshPosts();
    renderFeed();
  } catch (e) {
    feedEl.innerHTML = `<div class="empty"><div class="empty-emoji">📡</div>加载失败:${esc(e.message)}<br>刷新页面重试一下</div>`;
    return;
  }
  refreshBadge();
})();
