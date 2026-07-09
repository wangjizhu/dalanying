# 大蓝营 · 散帅集中营 💙

> 一个「小红书镜像」风格的社区网站:界面照着小红书 web 版一比一还原,但**红换蓝**——品牌色 `#2442FF` 恰好是小红书红 `#FF2442` 的 RGB 通道对调。主打「散帅」文化与 boys help boys:散帅(Sunshine 谐音)是与「集美」(姐妹)镜像对应的网络热词,指心态阳光、经济独立、不被标签束缚的男生。

在线地址(内网):**http://10.5.10.95:38383/**

## 功能

- 🧱 **瀑布流首页**:从左到右按高度贪心分列(与小红书阅读顺序一致),频道 tabs(推荐 / 兄弟树洞 / 健身 / 数码 / 游戏 / 穿搭 / 搞钱 / 美食),实时搜索
- 👤 **真实用户体系**:注册 / 登录 / 退出,scrypt 密码哈希,HttpOnly Cookie 会话(30 天有效)
- 📝 **发布笔记**:标题 + 正文 + 频道 + 封面 emoji,发布后立即进入瀑布流
- 💙 **互动**:点赞、收藏(前端乐观更新,失败自动回滚)、评论、关注作者,全部按用户落库
- 🔔 **通知**:谁赞了我、谁评论了我、谁关注了我(实时查询,含侧栏未读徽标)
- 🌗 **明暗双主题**:跟随系统 + 手动切换(CSS 变量 token 化),`color-scheme` 同步原生控件
- 📱 **响应式**:窄屏侧栏收缩为图标栏,手机宽度变为底部导航
- 🌱 **种子内容**:内置 20 篇散帅笔记、46 条评论、24 个「元老账号」,首次启动自动灌库

## 技术栈(刻意极简)

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | 单文件 HTML/CSS/JS,零框架零依赖 | 一个文件就是整个前端,任何浏览器直接跑 |
| 后端 | Python 3.9+ 纯标准库(`http.server` + `sqlite3`) | 服务器上有 python3 就能跑,**零 pip 依赖** |
| 数据 | SQLite(WAL 模式) | 单文件持久化,重启不丢 |
| 密码 | `hashlib.scrypt`(n=16384, r=8, p=1)+ 每用户随机盐 | 标准库自带的抗暴力破解哈希 |
| 会话 | 服务端 session 表 + HttpOnly / SameSite=Lax Cookie | 不信任客户端,登出即失效 |

## 文件说明

```
├── app.py              # 后端:全部 API + 静态托管 + 建库/灌种子,单文件 ~500 行
├── dalanying.html      # 前端源文件(静态演示版,claude.ai Artifact 同源)
├── dlyapp.html         # 前端源文件(应用版,由 build.mjs 生成,对接 API)
├── index.html          # 部署产物:dlyapp.html 包装成完整 HTML 文档(charset/viewport)
├── js_part1.js         # 应用版 JS 前半:状态/工具/API 封装/登录注册/个人信息
├── js_part2.js         # 应用版 JS 后半:瀑布流/详情/点赞收藏/评论/关注/通知/发布
├── build.mjs           # 构建脚本:HTML 改造 + 脚本替换 + 语法校验 + 打包 index.html
├── seed.json           # 种子数据(20 篇笔记 / 46 条评论 / 24 个账号)
├── test_smoke.py       # 冒烟测试:线程内起服务打全流程 API,24 项断言
├── dalanying.service   # systemd 服务单元
└── README.md
```

## API 一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/` | - | 前端页面(`text/html; charset=utf-8`) |
| GET | `/api/me` | - | 当前登录用户(含关注/粉丝/获赞统计),未登录返回 `{user: null}` |
| GET | `/api/posts` | - | 笔记列表(倒序;登录时附带我是否赞过/藏过) |
| GET | `/api/posts/:id` | - | 笔记详情(正文、标签、评论、是否已关注作者) |
| GET | `/api/notifications` | ✅ | 通知:赞 / 评论 / 关注,最近 30 条 |
| POST | `/api/auth/register` | - | `{username, password, avatar?}`,2-20 字用户名,6-64 位密码,注册即登录 |
| POST | `/api/auth/login` | - | `{username, password}` |
| POST | `/api/auth/logout` | - | 清除会话 |
| POST | `/api/posts` | ✅ | 发布笔记 `{title, body, cat, emoji}` |
| POST | `/api/posts/:id/like` | ✅ | 点赞开关,返回 `{liked, likes}` |
| POST | `/api/posts/:id/star` | ✅ | 收藏开关,返回 `{starred, stars}` |
| POST | `/api/posts/:id/comments` | ✅ | 发评论 `{text}`(1-500 字) |
| POST | `/api/users/:id/follow` | ✅ | 关注开关(禁止自我关注) |

错误统一返回 `{"error": "中文提示"}`,未登录操作返回 401,前端自动弹登录框。

## 本地开发

```bash
node build.mjs        # 前端有改动时:重新生成 dlyapp.html + index.html
python test_smoke.py  # 跑冒烟测试(24 项,起在 127.0.0.1:38399,用完即销)
python app.py         # 本地起服务(默认 :38383,PORT 环境变量可改)
```

改前端 = 改 `dalanying.html`(界面/样式)或 `js_part1/2.js`(逻辑),然后跑 `build.mjs`。
**不要直接改 `dlyapp.html` / `index.html`**,它们是构建产物。

## 部署(当前:dashuai@10.5.10.95)

首次部署(已完成,记录备查):

```bash
scp index.html app.py seed.json dashuai@10.5.10.95:~/dalanying/
scp dalanying.service dashuai@10.5.10.95:~
ssh dashuai@10.5.10.95 'sudo mv ~/dalanying.service /etc/systemd/system/ &&
  sudo systemctl daemon-reload && sudo systemctl enable --now dalanying &&
  sudo ufw allow 38383/tcp comment dalanying'
```

日常更新:

```bash
node build.mjs
scp index.html app.py dashuai@10.5.10.95:~/dalanying/
ssh dashuai@10.5.10.95 'sudo systemctl restart dalanying'
```

运维:`systemctl status dalanying` 看状态,`journalctl -u dalanying -f` 看日志。
数据在 `~/dalanying/dalanying.db`,备份拷走这一个文件即可(连同 `-wal` 更稳)。

## 账号

- **种子账号 × 24**(铁块搬运工、蓝营指导员、干饭大王、帅气散入星河……):初始密码统一 `sanshuai`
- 新用户注册即用,头像可选一个 emoji,不填随机分配

## 安全边界(内网玩具站的自知之明)

- 已做:scrypt 加盐哈希、HttpOnly/SameSite Cookie、SQL 全参数化、输入长度/格式校验、前端输出转义、会话过期清理、自我关注/越权基本防护
- 未做(公网部署前必须补):HTTPS、CSRF token、验证码/限流、密码找回、内容审核
- 建议只在内网使用;`38383` 仅对局域网开放

## 彩蛋

- 端口 `38383`:三八 ↔ 八三,呼应「八三散帅节」(三八节的日期镜像,8 月 3 日)
- 收藏 toast:「记进你的小蓝书 📘」——小红书 ↔ 小蓝书
- 空评论区文案、退出登录文案……到处都是梗,自己找
