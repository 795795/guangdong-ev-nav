#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
广东新能源导航 - 本地代理服务器
功能：静态文件服务 + 高德API代理转发（多线程并发）
解决浏览器端直接调用高德REST API的跨域/Key白名单限制问题
"""

import http.server
import socketserver
import urllib.request
import urllib.parse
import urllib.error
import json
import os
import ssl
import socket
import sys
from datetime import datetime

# ==================== 配置 ====================
PORT = 3000
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')
AMAP_KEY = '8429788d2971b1eb0b278b878180ce92'
AMAP_RESTAPI_BASE = 'https://restapi.amap.com'
UPSTREAM_TIMEOUT = 15  # 上游API超时（秒）

# 全局SSL上下文，避免每次请求都创建
ssl_ctx = ssl.create_default_context()
ssl_ctx.check_hostname = False
ssl_ctx.verify_mode = ssl.CERT_NONE  # 忽略证书验证，提高兼容性


def log(msg):
    """简单日志：带时间戳"""
    now = datetime.now().strftime('%H:%M:%S')
    print('[%s] %s' % (now, msg))


# ==================== API代理 ====================

def proxy_amap_api(path, query_string):
    """将请求转发到高德REST API并返回JSON
    Returns: (status_code, body_bytes, content_type)
    """
    target_url = '%s%s' % (AMAP_RESTAPI_BASE, path)

    # 解析浏览器传来的query参数
    flat_params = {}
    try:
        params = urllib.parse.parse_qs(query_string, keep_blank_values=True, encoding='utf-8')
        for k, v in params.items():
            flat_params[k] = v[0] if len(v) == 1 else v
    except Exception:
        pass

    # 服务端注入Key
    flat_params['key'] = AMAP_KEY

    try:
        encoded_params = urllib.parse.urlencode(flat_params, encoding='utf-8')
        full_url = '%s?%s' % (target_url, encoded_params)
        log('PROXY -> %s?%s=%s' % (
            target_url,
            '&'.join([k + '=' + (v[:20] if isinstance(v, str) else str(v)) for k, v in list(flat_params.items())[:3]]),
            '...'
        ))
    except Exception as e:
        error_body = json.dumps({'status': '0', 'info': '参数编码失败: %s' % str(e)}, ensure_ascii=False).encode('utf-8')
        return 400, error_body, 'application/json'

    try:
        req = urllib.request.Request(full_url, headers={
            'User-Agent': 'Mozilla/5.0 GuangdongEVNav/1.0',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Accept-Language': 'zh-CN,zh;q=0.9'
        })

        with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT, context=ssl_ctx) as resp:
            data = resp.read()
            log('PROXY <- %s, %d bytes' % (resp.status, len(data)))
            return resp.status, data, resp.headers.get_content_type() or 'application/json'

    except urllib.error.HTTPError as e:
        error_body = e.read() if e.fp else b'{}'
        log('PROXY <- HTTP %s' % e.code)
        return e.code, error_body, 'application/json'

    except socket.timeout:
        error_body = json.dumps({'status': '0', 'info': '请求高德API超时 (%ds)' % UPSTREAM_TIMEOUT}, ensure_ascii=False).encode('utf-8')
        log('PROXY <- TIMEOUT')
        return 504, error_body, 'application/json'

    except urllib.error.URLError as e:
        error_body = json.dumps({'status': '0', 'info': '网络连接失败: %s' % str(e.reason)}, ensure_ascii=False).encode('utf-8')
        log('PROXY <- URL_ERROR: %s' % e.reason)
        return 502, error_body, 'application/json'

    except Exception as e:
        error_body = json.dumps({'status': '0', 'info': '代理错误: %s' % str(e)}, ensure_ascii=False).encode('utf-8')
        log('PROXY <- EXCEPTION: %s' % e)
        return 500, error_body, 'application/json'


# ==================== HTTP Handler ====================

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    """自定义HTTP请求处理器：/api/amap/* 走代理，其余走静态文件"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API代理路由: /api/amap/v3/place/around  ->  https://restapi.amap.com/v3/place/around
        if path.startswith('/api/amap/'):
            amap_path = path[len('/api/amap'):]  # 得到 /v3/place/around
            if not amap_path.startswith('/'):
                amap_path = '/' + amap_path
            status, body, content_type = proxy_amap_api(amap_path, parsed.query)

            self.send_response(status)
            self.send_header('Content-Type', '%s; charset=utf-8' % content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.end_headers()
            try:
                self.wfile.write(body)
            except Exception:
                pass
            return

        # 其他请求走静态文件
        super().do_GET()

    def do_HEAD(self):
        super().do_HEAD()

    def log_message(self, format, *args):
        # 只打印API请求日志，减少静态文件日志噪音
        if '/api/amap/' in (args[0] if args else ''):
            log('REQ ' + (args[0] if args else ''))


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """支持并发的HTTP服务器：每个请求在独立线程中处理"""
    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self):
        # 设置TCP_NODELAY，减少小包延迟
        socketserver.TCPServer.server_bind(self)
        try:
            self.socket.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass


# ==================== 启动 ====================

if __name__ == '__main__':
    print('\n' + '=' * 60)
    print('  广东新能源导航 - 本地开发服务器 (多线程版)')
    print('=' * 60)
    print('  静态文件: %s' % WEB_DIR)
    print('  API代理:   /api/amap/*  ->  restapi.amap.com')
    print('  访问地址:  http://localhost:%d' % PORT)
    print('=' * 60)
    print()

    try:
        server = ThreadedHTTPServer(('0.0.0.0', PORT), ProxyHandler)
        log('服务器已启动，按 Ctrl+C 停止')
        print()
        server.serve_forever()
    except KeyboardInterrupt:
        log('服务器正在停止...')
        server.shutdown()
        server.server_close()
        log('服务器已停止')
        sys.exit(0)
    except OSError as e:
        log('无法启动服务器: %s' % e)
        log('请检查端口 %d 是否已被占用' % PORT)
        sys.exit(1)
