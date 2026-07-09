// 构建:dalanying.html(静态版) + js_part1/2 → dlyapp.html(应用版片段) + index.html(可部署完整文档)
import fs from 'node:fs';

function must(cond, msg) { if (!cond) { console.error('BUILD FAIL: ' + msg); process.exit(1); } }

let s = fs.readFileSync('dalanying.html', 'utf8');
const js1 = fs.readFileSync('js_part1.js', 'utf8');
const js2 = fs.readFileSync('js_part2.js', 'utf8');

/* ---------- 1. 通知徽标默认隐藏 ---------- */
const badgeOld = '<span class="nav-badge" id="notifBadge">4</span>';
must(s.includes(badgeOld), 'badge anchor');
s = s.replace(badgeOld, '<span class="nav-badge" id="notifBadge" style="display:none">0</span>');

/* ---------- 2. 通知弹窗改为动态容器 ---------- */
must(/<h2>通知 🔔<\/h2>/.test(s), 'notif h2 anchor');
const notifItems = s.match(/^\s*<div class="notif-item">.*$/gm);
must(notifItems && notifItems.length === 4, 'notif items (expect 4, got ' + (notifItems ? notifItems.length : 0) + ')');
s = s.replace(/^\s*<div class="notif-item">.*\n/gm, '');
s = s.replace('<h2>通知 🔔</h2>', '<h2>通知 🔔</h2>\n    <div id="notifList"></div>');

/* ---------- 3. 个人主页弹窗改为动态 ---------- */
const pfStart = s.indexOf('<div class="profile-top">');
must(pfStart !== -1, 'profile-top anchor');
const pfChipsEnd = s.indexOf('</div>', s.indexOf('八三散帅节'));
must(pfChipsEnd !== -1, 'profile-chips end anchor');
const pfNew = `<div class="profile-top">
      <div class="profile-avatar" id="pfAvatar">👤</div>
      <div class="profile-name" id="pfName">未登录</div>
      <div class="profile-id" id="pfId">登录后开启散帅身份</div>
      <div class="profile-bio" id="pfBio">大蓝营 · 散帅集中营 · boys help boys</div>
    </div>
    <div class="profile-stats">
      <div><div class="num" id="pfFollowing">-</div><div class="lbl">关注</div></div>
      <div><div class="num" id="pfFans">-</div><div class="lbl">粉丝</div></div>
      <div><div class="num" id="pfPraise">-</div><div class="lbl">获赞与收藏</div></div>
    </div>
    <div class="profile-chips">
      <span>经济独立</span><span>心态乐观</span><span>boys help boys</span><span>八三散帅节</span>
    </div>
    <button class="btn-primary" id="pfAction" style="margin-top:16px">登录 / 注册</button>`;
s = s.slice(0, pfStart) + pfNew + s.slice(pfChipsEnd + 6);

/* ---------- 4. 插入登录/注册弹窗 ---------- */
const toastAnchor = '<div class="toast" id="toast"';
must(s.includes(toastAnchor), 'toast anchor');
const authModal = `<!-- ================= 登录/注册弹窗 ================= -->
<div class="modal-mask" id="authMask">
  <div class="panel-modal" role="dialog" aria-modal="true" aria-label="登录或注册">
    <button class="modal-close" data-close aria-label="关闭">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"></path></svg>
    </button>
    <h2 id="authTitle">登录大蓝营 💙</h2>
    <div class="field">
      <label for="authUser">用户名</label>
      <input id="authUser" type="text" maxlength="20" placeholder="2-20 个字符" autocomplete="username">
    </div>
    <div class="field">
      <label for="authPass">密码</label>
      <input id="authPass" type="password" maxlength="64" placeholder="至少 6 位" autocomplete="current-password">
    </div>
    <div class="field" id="authAvatarField" style="display:none">
      <label for="authAvatar">头像表情(选填,一个 emoji)</label>
      <input id="authAvatar" type="text" maxlength="8" placeholder="😎">
    </div>
    <div class="auth-error" id="authError"></div>
    <button class="btn-primary" id="authSubmit">登 录</button>
    <div class="auth-switch"><span id="authHint">还没有账号?</span><button class="linklike" id="authToggle">注册一个</button></div>
    <div class="auth-seed">元老账号(铁块搬运工 / 蓝营指导员 / 干饭大王…)密码统一:sanshuai</div>
  </div>
</div>

`;
s = s.replace(toastAnchor, authModal + toastAnchor);

/* ---------- 5. 追加 CSS ---------- */
const cssAnchor = '  @media (prefers-reduced-motion: reduce)';
must(s.includes(cssAnchor), 'css anchor');
const cssAdd = `  /* ---------- 登录/注册 ---------- */
  .auth-error { color: #E5484D; font-size: 13px; min-height: 20px; margin-bottom: 6px; }
  .auth-switch { text-align: center; font-size: 13px; color: var(--text-3); margin-top: 14px; }
  .linklike { color: var(--brand); font-size: 13px; padding: 0 4px; }
  .auth-seed {
    margin-top: 12px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--brand-softer);
    color: var(--text-3);
    font-size: 12px;
    text-align: center;
  }
  .notif-empty { text-align: center; color: var(--text-3); padding: 28px 0; font-size: 13px; }
`;
s = s.replace(cssAnchor, cssAdd + cssAnchor);

/* ---------- 6. 替换脚本:两个块合并为一个 API 驱动版 ---------- */
const blocks = [...s.matchAll(/<script>[\s\S]*?<\/script>/g)];
must(blocks.length === 2, 'expect 2 script blocks, got ' + blocks.length);
const combined = js1 + '\n' + js2;
s = s.slice(0, blocks[0].index) + '<script>\n' + combined + '</script>'
  + s.slice(blocks[0].index + blocks[0][0].length).replace(/<script>[\s\S]*?<\/script>\s*/, '');

/* ---------- 7. JS 语法校验 ---------- */
try { new Function(combined); } catch (e) { console.error('BUILD FAIL: JS syntax — ' + e.message); process.exit(1); }

/* ---------- 8. 输出:片段 + 完整文档 ---------- */
fs.writeFileSync('dlyapp.html', s);
const full = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n'
  + s.slice(0, s.indexOf('</style>') + 8) + '\n</head>\n<body>\n' + s.slice(s.indexOf('</style>') + 8) + '\n</body>\n</html>\n';
fs.writeFileSync('index.html', full);
console.log('BUILD OK → dlyapp.html (' + s.length + ' chars), index.html (' + full.length + ' chars)');
