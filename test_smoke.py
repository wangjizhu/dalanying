#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""冒烟测试:线程内起服务,全流程打一遍 API。用法:python test_smoke.py"""
import http.cookiejar
import json
import os
import threading
import urllib.error
import urllib.request

os.environ['PORT'] = '38399'
import app  # noqa: E402

app.init_db()
srv = app.ThreadingHTTPServer(('127.0.0.1', app.PORT), app.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
BASE = 'http://127.0.0.1:38399'


def call(path, data=None, method=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(data).encode('utf-8') if data is not None else None,
        headers={'Content-Type': 'application/json'} if data is not None else {},
        method=method)
    try:
        with op.open(req, timeout=5) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}


checks = []


def ok(name, cond, info=''):
    checks.append((name, cond))
    print(('PASS' if cond else 'FAIL'), name, ('' if cond else '| ' + str(info)[:200]))


with op.open(BASE + '/', timeout=5) as r:
    ok('index html', r.status == 200 and 'charset=utf-8' in (r.headers.get('Content-Type') or ''))

s, d = call('/api/posts')
ok('posts list = 20', s == 200 and len(d['posts']) == 20, d)
first = d['posts'][0]
ok('order: 卧推 first', '卧推' in first['title'], first['title'])
ok('likes carried', first['likes'] == 4231, first['likes'])

s, d = call('/api/me')
ok('me anonymous', s == 200 and d['user'] is None, d)
s, d = call('/api/posts/%d/like' % first['id'], {}, 'POST')
ok('like needs auth (401)', s == 401, s)

s, d = call('/api/auth/register', {'username': '测试散帅', 'password': 'test123', 'avatar': '🧪'})
ok('register', s == 200 and d.get('user', {}).get('name') == '测试散帅', d)
s, d = call('/api/me')
ok('session works', s == 200 and d['user'] and d['user']['name'] == '测试散帅', d)

pid = first['id']
s, d = call('/api/posts/%d/like' % pid, {}, 'POST')
ok('like +1', s == 200 and d.get('liked') and d.get('likes') == first['likes'] + 1, d)
s, d = call('/api/posts/%d/like' % pid, {}, 'POST')
ok('unlike back', s == 200 and not d.get('liked') and d.get('likes') == first['likes'], d)
s, d = call('/api/posts/%d/star' % pid, {}, 'POST')
ok('star', s == 200 and d.get('starred'), d)
s, d = call('/api/posts/%d/comments' % pid, {'text': '测试评论,兄弟们顶'}, 'POST')
ok('comment', s == 200 and d.get('comment', {}).get('text'), d)
s, d = call('/api/posts/%d' % pid)
ok('detail + my comment', s == 200 and any(c['text'] == '测试评论,兄弟们顶' for c in d['post']['comments']), d)
aid = d['post']['author']['id']
s, d = call('/api/users/%d/follow' % aid, {}, 'POST')
ok('follow', s == 200 and d.get('followed'), d)

s, d = call('/api/posts', {'title': '冒烟测试笔记', 'body': '内容', 'cat': 'brother', 'emoji': '🧪'}, 'POST')
ok('publish', s == 200 and d.get('post', {}).get('title') == '冒烟测试笔记', d)
new_id = d['post']['id']
s, d = call('/api/posts')
ok('new post on top, total 21', d['posts'][0]['id'] == new_id and len(d['posts']) == 21, len(d['posts']))

s, d = call('/api/auth/logout', {}, 'POST')
ok('logout', s == 200, d)
s, d = call('/api/me')
ok('me cleared', d['user'] is None, d)

s, d = call('/api/auth/login', {'username': '铁块搬运工', 'password': 'sanshuai'})
ok('seed account login', s == 200, d)
s, d = call('/api/notifications')
ok('notifications (comment on his post)', s == 200 and len(d.get('items', [])) >= 1
   and any(i['type'] == 'comment' for i in d['items']), d)

s, d = call('/api/auth/login', {'username': '测试散帅', 'password': 'wrong'})
ok('wrong pw = 401', s == 401, s)
s, d = call('/api/auth/register', {'username': '测试散帅', 'password': 'xxxxxx'})
ok('dup name = 400', s == 400, s)
s, d = call('/api/auth/register', {'username': 'x', 'password': '123'})
ok('weak input = 400', s == 400, s)
# 此时会话是铁块搬运工本人,aid 正是他自己 → 应拒绝自我关注
s, d = call('/api/users/%d/follow' % aid, {}, 'POST')
ok('self-follow rejected (400)', s == 400, s)

srv.shutdown()
fails = [n for n, c in checks if not c]
print('-' * 40)
print('ALL %d PASS' % len(checks) if not fails else 'FAILED: %s' % fails)
raise SystemExit(0 if not fails else 1)
