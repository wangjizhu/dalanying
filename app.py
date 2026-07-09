#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""大蓝营 · 散帅集中营 — 单文件后端(纯 Python 标准库,3.9+)

注册 / 登录 / 发笔记 / 点赞 / 收藏 / 评论 / 关注 / 通知,SQLite 持久化。
首次启动自动建库,并把 seed.json 里的 20 篇笔记灌成真实种子账号的内容。
"""
import json
import os
import re
import sqlite3
import hashlib
import hmac
import secrets
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, 'dalanying.db')
INDEX_PATH = os.path.join(BASE, 'index.html')
SEED_PATH = os.path.join(BASE, 'seed.json')
PORT = int(os.environ.get('PORT', '38383'))
SESSION_SECONDS = 30 * 86400
SEED_PASSWORD = 'sanshuai'
GRADS = ['g1', 'g2', 'g3', 'g4', 'g6', 'g9', 'g10']
CATS = {'brother', 'fitness', 'digital', 'game', 'fashion', 'money', 'food'}

SCHEMA = '''
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  pw TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '😎',
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  cat TEXT NOT NULL,
  g TEXT NOT NULL,
  ratio TEXT NOT NULL DEFAULT '3/4',
  emoji TEXT NOT NULL DEFAULT '📝',
  cover_text TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  base_likes INTEGER NOT NULL DEFAULT 0,
  base_stars INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS likes(
  user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS stars(
  user_id INTEGER NOT NULL, post_id INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS follows(
  follower INTEGER NOT NULL, followee INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(follower, followee)
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_stars_post ON stars(post_id);
'''


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=10000')
    return conn


def now():
    return time.strftime('%Y-%m-%d %H:%M')


def hash_pw(pw, salt_hex):
    return hashlib.scrypt(pw.encode('utf-8'), salt=bytes.fromhex(salt_hex),
                          n=16384, r=8, p=1, dklen=64).hex()


def create_user(conn, username, password, avatar, bio=''):
    salt = secrets.token_hex(16)
    cur = conn.execute(
        'INSERT INTO users(username, salt, pw, avatar, bio, created_at) VALUES(?,?,?,?,?,?)',
        (username, salt, hash_pw(password, salt), avatar, bio, now()))
    return cur.lastrowid


def seed(conn):
    with open(SEED_PATH, encoding='utf-8') as f:
        posts = json.load(f)
    uid_cache = {}

    def uid(name, avatar):
        if name not in uid_cache:
            uid_cache[name] = create_user(conn, name, SEED_PASSWORD, avatar,
                                          '大蓝营元老 · 散帅认证 · boys help boys')
        return uid_cache[name]

    # 反序插入:数组越靠前的笔记 id 越大,显示越靠前;新用户发帖排最前
    for p in reversed(posts):
        author = uid(p['author'], p['avatar'])
        cur = conn.execute(
            'INSERT INTO posts(user_id, cat, g, ratio, emoji, cover_text, title, body, tags,'
            ' base_likes, base_stars, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            (author, p['cat'], p['g'], p['ratio'], p['emoji'], p['coverText'], p['title'],
             p['body'], json.dumps(p['tags'], ensure_ascii=False),
             p['likes'], p['stars'], p['date'] + ' 12:00'))
        pid = cur.lastrowid
        year = p['date'][:4]
        for c in p['comments']:
            cdate = c['date'] if len(c['date']) == 10 else year + '-' + c['date']
            conn.execute(
                'INSERT INTO comments(post_id, user_id, text, created_at) VALUES(?,?,?,?)',
                (pid, uid(c['name'], c['avatar']), c['text'], cdate + ' 18:00'))
    print('seeded: %d posts, %d users' % (len(posts), len(uid_cache)))


def init_db():
    conn = db()
    conn.executescript(SCHEMA)
    if conn.execute('SELECT COUNT(*) FROM posts').fetchone()[0] == 0:
        seed(conn)
    conn.commit()
    conn.close()


POST_LIST_SQL = '''
SELECT p.id, p.cat, p.g, p.ratio, p.emoji, p.cover_text, p.title, p.created_at,
       u.id AS author_id, u.username AS author_name, u.avatar AS author_avatar,
       p.base_likes + (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
       p.base_stars + (SELECT COUNT(*) FROM stars s WHERE s.post_id = p.id) AS stars,
       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
       EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = :me) AS liked,
       EXISTS(SELECT 1 FROM stars WHERE post_id = p.id AND user_id = :me) AS starred
FROM posts p JOIN users u ON u.id = p.user_id
'''


def post_dict(r):
    return {
        'id': r['id'], 'cat': r['cat'], 'g': r['g'], 'ratio': r['ratio'],
        'emoji': r['emoji'], 'coverText': r['cover_text'], 'title': r['title'],
        'date': r['created_at'], 'likes': r['likes'], 'stars': r['stars'],
        'commentCount': r['comment_count'],
        'liked': bool(r['liked']), 'starred': bool(r['starred']),
        'author': {'id': r['author_id'], 'name': r['author_name'], 'avatar': r['author_avatar']},
    }


def user_stats(conn, uid):
    following = conn.execute('SELECT COUNT(*) FROM follows WHERE follower=?', (uid,)).fetchone()[0]
    followers = conn.execute('SELECT COUNT(*) FROM follows WHERE followee=?', (uid,)).fetchone()[0]
    praise = conn.execute(
        'SELECT COALESCE(SUM(base_likes + base_stars), 0)'
        ' + (SELECT COUNT(*) FROM likes l JOIN posts pp ON pp.id = l.post_id WHERE pp.user_id = :u)'
        ' + (SELECT COUNT(*) FROM stars s JOIN posts pp ON pp.id = s.post_id WHERE pp.user_id = :u)'
        ' FROM posts WHERE user_id = :u', {'u': uid}).fetchone()[0]
    return {'following': following, 'followers': followers, 'praise': praise}


def user_dict(conn, u):
    return {'id': u['id'], 'name': u['username'], 'avatar': u['avatar'],
            'bio': u['bio'], 'stats': user_stats(conn, u['id'])}
class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'Dalanying/2'

    def log_message(self, fmt, *args):
        pass  # 交给 systemd journal 的只留异常

    # ---------- 基础 ----------
    def send_json(self, obj, status=200, cookie=None):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def fail(self, msg, status=400):
        self.send_json({'error': msg}, status)

    def read_json(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            return None
        if n <= 0 or n > 200000:
            return None
        try:
            data = json.loads(self.rfile.read(n).decode('utf-8'))
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def get_sid(self):
        c = SimpleCookie(self.headers.get('Cookie') or '')
        return c['sid'].value if 'sid' in c else None

    def current_user(self, conn):
        sid = self.get_sid()
        if not sid:
            return None
        return conn.execute(
            'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id'
            ' WHERE s.token = ? AND s.expires > ?', (sid, time.time())).fetchone()

    def make_session_cookie(self, conn, user_id):
        token = secrets.token_hex(32)
        conn.execute('INSERT INTO sessions(token, user_id, expires) VALUES(?,?,?)',
                     (token, user_id, time.time() + SESSION_SECONDS))
        return 'sid=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax' % (token, SESSION_SECONDS)

    def serve_index(self, head_only=False):
        try:
            with open(INDEX_PATH, 'rb') as f:
                body = f.read()
        except OSError:
            self.fail('index.html 缺失', 500)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    # ---------- 路由 ----------
    def do_HEAD(self):
        path = urlparse(self.path).path
        if path in ('/', '/index.html'):
            self.serve_index(head_only=True)
        else:
            self.send_response(404)
            self.send_header('Content-Length', '0')
            self.end_headers()

    def do_GET(self):
        try:
            self.route_get()
        except Exception:
            traceback.print_exc()
            self.fail('服务器开小差了,稍后再试', 500)

    def do_POST(self):
        try:
            self.route_post()
        except Exception:
            traceback.print_exc()
            self.fail('服务器开小差了,稍后再试', 500)

    def route_get(self):
        path = urlparse(self.path).path
        if path in ('/', '/index.html'):
            return self.serve_index()
        if path == '/favicon.ico':
            self.send_response(204)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        conn = db()
        try:
            me = self.current_user(conn)
            mid = me['id'] if me else -1
            if path == '/api/me':
                return self.send_json({'user': user_dict(conn, me) if me else None})
            if path == '/api/posts':
                rows = conn.execute(POST_LIST_SQL + ' ORDER BY p.id DESC', {'me': mid}).fetchall()
                return self.send_json({'posts': [post_dict(r) for r in rows]})
            m = re.match(r'^/api/posts/(\d+)$', path)
            if m:
                pid = int(m.group(1))
                r = conn.execute(POST_LIST_SQL + ' WHERE p.id = :pid', {'me': mid, 'pid': pid}).fetchone()
                if not r:
                    return self.fail('笔记不存在或已被删除', 404)
                extra = conn.execute('SELECT body, tags, user_id FROM posts WHERE id=?', (pid,)).fetchone()
                comments = conn.execute(
                    'SELECT c.text, c.created_at, u.username, u.avatar FROM comments c'
                    ' JOIN users u ON u.id = c.user_id WHERE c.post_id=? ORDER BY c.id', (pid,)).fetchall()
                d = post_dict(r)
                d['body'] = extra['body']
                d['tags'] = json.loads(extra['tags'])
                d['comments'] = [{'name': c['username'], 'avatar': c['avatar'],
                                  'text': c['text'], 'date': c['created_at'][5:]} for c in comments]
                d['followed'] = bool(conn.execute(
                    'SELECT 1 FROM follows WHERE follower=? AND followee=?',
                    (mid, extra['user_id'])).fetchone())
                return self.send_json({'post': d})
            if path == '/api/notifications':
                if not me:
                    return self.fail('请先登录', 401)
                rows = conn.execute('''
SELECT 'like' AS type, u.username AS name, u.avatar AS avatar, p.title AS title, '' AS extra, l.created_at AS t
  FROM likes l JOIN posts p ON p.id = l.post_id JOIN users u ON u.id = l.user_id
  WHERE p.user_id = :me AND l.user_id <> :me
UNION ALL
SELECT 'comment', u.username, u.avatar, p.title, c.text, c.created_at
  FROM comments c JOIN posts p ON p.id = c.post_id JOIN users u ON u.id = c.user_id
  WHERE p.user_id = :me AND c.user_id <> :me
UNION ALL
SELECT 'follow', u.username, u.avatar, '', '', f.created_at
  FROM follows f JOIN users u ON u.id = f.follower WHERE f.followee = :me
ORDER BY t DESC LIMIT 30''', {'me': mid}).fetchall()
                return self.send_json({'items': [
                    {'type': r['type'], 'name': r['name'], 'avatar': r['avatar'],
                     'title': r['title'], 'extra': r['extra'], 'date': r['t']} for r in rows]})
            self.fail('接口不存在', 404)
        finally:
            conn.close()

    def route_post(self):
        path = urlparse(self.path).path
        conn = db()
        try:
            if path == '/api/auth/register':
                data = self.read_json()
                if data is None:
                    return self.fail('请求格式不对')
                username = str(data.get('username') or '').strip()
                password = str(data.get('password') or '')
                avatar = str(data.get('avatar') or '').strip() or secrets.choice(
                    ['😎', '🐺', '🦁', '🐯', '🦊', '🐻', '🦅', '🐬', '⚡', '🔥'])
                if not re.match(r'^\S{2,20}$', username):
                    return self.fail('用户名要 2-20 个字符,且不能带空格')
                if not (6 <= len(password) <= 64):
                    return self.fail('密码要 6-64 位')
                if conn.execute('SELECT 1 FROM users WHERE username=?', (username,)).fetchone():
                    return self.fail('这个名字已经被别的散帅占了,换一个')
                uid = create_user(conn, username, password, avatar[:8])
                cookie = self.make_session_cookie(conn, uid)
                conn.commit()
                u = conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
                return self.send_json({'user': user_dict(conn, u)}, cookie=cookie)

            if path == '/api/auth/login':
                data = self.read_json()
                if data is None:
                    return self.fail('请求格式不对')
                username = str(data.get('username') or '').strip()
                password = str(data.get('password') or '')
                u = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
                if not u or not hmac.compare_digest(hash_pw(password, u['salt']), u['pw']):
                    return self.fail('用户名或密码不对', 401)
                conn.execute('DELETE FROM sessions WHERE expires < ?', (time.time(),))
                cookie = self.make_session_cookie(conn, u['id'])
                conn.commit()
                return self.send_json({'user': user_dict(conn, u)}, cookie=cookie)

            if path == '/api/auth/logout':
                sid = self.get_sid()
                if sid:
                    conn.execute('DELETE FROM sessions WHERE token=?', (sid,))
                    conn.commit()
                return self.send_json({'ok': True},
                                      cookie='sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax')

            # ---- 以下都需要登录 ----
            me = self.current_user(conn)
            if not me:
                return self.fail('请先登录', 401)
            mid = me['id']

            if path == '/api/posts':
                data = self.read_json()
                if data is None:
                    return self.fail('请求格式不对')
                title = str(data.get('title') or '').strip()
                body = str(data.get('body') or '').strip()
                cat = str(data.get('cat') or '')
                emoji = str(data.get('emoji') or '📝').strip()[:8] or '📝'
                if not (1 <= len(title) <= 40):
                    return self.fail('标题要 1-40 个字')
                if len(body) > 5000:
                    return self.fail('正文太长了,兄弟精简一下')
                if cat not in CATS:
                    return self.fail('频道不对')
                if not body:
                    body = '这个散帅很酷,什么正文都没写。'
                cur = conn.execute(
                    'INSERT INTO posts(user_id, cat, g, ratio, emoji, cover_text, title, body,'
                    ' tags, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                    (mid, cat, secrets.choice(GRADS), '3/4', emoji, title[:10], title, body,
                     json.dumps([{'brother': '兄弟树洞', 'fitness': '健身', 'digital': '数码',
                                  'game': '游戏', 'fashion': '穿搭', 'money': '搞钱',
                                  'food': '美食'}[cat], '散帅日常'], ensure_ascii=False), now()))
                conn.commit()
                r = conn.execute(POST_LIST_SQL + ' WHERE p.id = :pid',
                                 {'me': mid, 'pid': cur.lastrowid}).fetchone()
                return self.send_json({'post': post_dict(r)})

            m = re.match(r'^/api/posts/(\d+)/(like|star|comments)$', path)
            if m:
                pid, action = int(m.group(1)), m.group(2)
                if not conn.execute('SELECT 1 FROM posts WHERE id=?', (pid,)).fetchone():
                    return self.fail('笔记不存在', 404)
                if action in ('like', 'star'):
                    table = 'likes' if action == 'like' else 'stars'
                    base = 'base_likes' if action == 'like' else 'base_stars'
                    on = conn.execute('SELECT 1 FROM %s WHERE user_id=? AND post_id=?' % table,
                                      (mid, pid)).fetchone()
                    if on:
                        conn.execute('DELETE FROM %s WHERE user_id=? AND post_id=?' % table, (mid, pid))
                    else:
                        conn.execute('INSERT INTO %s(user_id, post_id, created_at) VALUES(?,?,?)' % table,
                                     (mid, pid, now()))
                    conn.commit()
                    total = conn.execute(
                        'SELECT %s + (SELECT COUNT(*) FROM %s WHERE post_id=?) FROM posts WHERE id=?'
                        % (base, table), (pid, pid)).fetchone()[0]
                    key = 'liked' if action == 'like' else 'starred'
                    cnt = 'likes' if action == 'like' else 'stars'
                    return self.send_json({key: not on, cnt: total})
                # comments
                data = self.read_json()
                if data is None:
                    return self.fail('请求格式不对')
                text = str(data.get('text') or '').strip()
                if not (1 <= len(text) <= 500):
                    return self.fail('评论要 1-500 个字')
                conn.execute('INSERT INTO comments(post_id, user_id, text, created_at) VALUES(?,?,?,?)',
                             (pid, mid, text, now()))
                conn.commit()
                return self.send_json({'comment': {'name': me['username'], 'avatar': me['avatar'],
                                                   'text': text, 'date': '刚刚'}})

            m = re.match(r'^/api/users/(\d+)/follow$', path)
            if m:
                target = int(m.group(1))
                if target == mid:
                    return self.fail('自己关注自己?散帅要脸')
                if not conn.execute('SELECT 1 FROM users WHERE id=?', (target,)).fetchone():
                    return self.fail('用户不存在', 404)
                on = conn.execute('SELECT 1 FROM follows WHERE follower=? AND followee=?',
                                  (mid, target)).fetchone()
                if on:
                    conn.execute('DELETE FROM follows WHERE follower=? AND followee=?', (mid, target))
                else:
                    conn.execute('INSERT INTO follows(follower, followee, created_at) VALUES(?,?,?)',
                                 (mid, target, now()))
                conn.commit()
                return self.send_json({'followed': not on})

            self.fail('接口不存在', 404)
        finally:
            conn.close()


def main():
    init_db()
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('大蓝营 backend listening on :%d' % PORT)
    srv.serve_forever()


if __name__ == '__main__':
    main()
