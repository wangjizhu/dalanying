# 大蓝营 · 散帅集中营 💙

一个"小红书镜像"风格的社区站:红换蓝(品牌色 `#2442FF`,恰好是小红书红 `#FF2442` 的 RGB 通道对调),主打散帅文化与 boys help boys。

## 文件说明

| 文件 | 用途 |
|---|---|
| `dalanying.html` | 前端源文件(静态演示版,亦为 claude.ai Artifact 源) |
| `dlyapp.html` | 前端源文件(应用版:注册/登录/发帖/点赞/评论/关注,对接后端 API) |
| `app.py` | 后端,纯 Python 标准库(http.server + sqlite3 + scrypt),零依赖 |
| `seed.json` | 种子数据:20 篇笔记、46 条评论、24 个元老账号 |
| `dalanying.service` | systemd 服务单元(部署到 `/etc/systemd/system/`) |
| `build.mjs` | 构建脚本:把前端片段包装成完整 HTML 文档 `index.html` |

## 部署

当前部署于 `dashuai@10.5.10.95`,端口 `38383`(ufw 已放行):

```bash
node build.mjs                                   # 生成 index.html
scp index.html app.py seed.json dashuai@10.5.10.95:~/dalanying/
ssh dashuai@10.5.10.95 'sudo systemctl restart dalanying'
```

访问:http://10.5.10.95:38383/

## 账号

- 种子账号(铁块搬运工、蓝营指导员等 24 个)初始密码:`sanshuai`
- 新用户可自行注册,数据存 SQLite(`dalanying.db`,已 gitignore)
