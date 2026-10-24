"""Actual HTTP WebDAV fixture, synthetic names and bytes only."""
import base64
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time
import socket
from urllib.parse import quote, unquote, urlsplit
from xml.sax.saxutils import escape

ROOT = '/工程/拍照片'
EVENT = ROOT + '/2024-10-合成展览'
class State:
    def __init__(self):
        self.entries = {ROOT: None, EVENT: None, EVENT+'/照片 01.jpg': b'a'*300000,
                        EVENT+'/02.HEIC': b'b'*250000, EVENT+'/03.MOV': b'c'*100000,
                        EVENT+'/原片': None, EVENT+'/原片/01.ARW': b'raw', EVENT+'/04.ARW':b'raw'}
        self.etag = '"v1"'
        self.modified = 'Sat, 24 Oct 2026 08:00:00 GMT'
        self.failure = None
        self.delay = 0
        self.range_mode = 'normal'
        self.calls = []
        self.auth = True


def handler(state):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def log_message(self, *args):
            pass
        def send(self, status, data=b'', headers={}):
            self.send_response(status)
            self.send_header('Content-Length', str(len(data)))
            for k,v in headers.items():
                self.send_header(k, v)
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
        def authorized(self):
            return state.auth and self.headers.get('Authorization') == 'Basic '+base64.b64encode(b'pulsar:fixture-only').decode()
        def do_PROPFIND(self):
            self.rfile.read(int(self.headers.get('Content-Length','0')))
            path=unquote(urlsplit(self.path).path).rstrip('/')
            state.calls.append(('PROPFIND',path,self.headers.get('Depth')))
            if not self.authorized():
                return self.send(401)
            if state.delay:
                time.sleep(state.delay)
            if state.failure == 'disconnect':
                self.close_connection = True
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            if isinstance(state.failure,int):
                return self.send(state.failure)
            if path not in state.entries:
                return self.send(404)
            paths = [p for p in state.entries if p==path or (self.headers['Depth']=='1' and p.rsplit('/',1)[0]==path)]
            xml = '<d:multistatus xmlns:d="DAV:">'
            for p in paths:
                value=state.entries[p]
                tag = '<d:collection/>' if value is None else ''
                size = '' if value is None else f'<d:getcontentlength>{len(value)}</d:getcontentlength>'
                etag = f'<d:getetag>{escape(state.etag)}</d:getetag>' if state.etag else ''
                status = '403 Forbidden' if state.failure=='partial' and p != path else '200 OK'
                xml += f'<d:response><d:href>{quote(p,safe="/")}</d:href><d:propstat><d:prop><d:resourcetype>{tag}</d:resourcetype>{size}{etag}<d:getlastmodified>{state.modified}</d:getlastmodified></d:prop><d:status>HTTP/1.1 {status}</d:status></d:propstat></d:response>'
            xml += '</d:multistatus>'
            self.send(207,xml.encode(),{'Content-Type':'application/xml'})
        def do_GET(self):
            path=unquote(urlsplit(self.path).path)
            state.calls.append(('GET',path,self.headers.get('Range'),self.headers.get('If-Range')))
            if not self.authorized():
                return self.send(401)
            data=state.entries.get(path)
            if data is None:
                return self.send(404)
            headers={'Content-Type':'image/jpeg','Accept-Ranges':'bytes'}
            if state.etag:
                headers['ETag']=state.etag
            if self.headers.get('If-Match') and self.headers['If-Match']!=state.etag:
                return self.send(412,b'',headers)
            range_value=self.headers.get('Range')
            if range_value and state.range_mode=='416':
                return self.send(416,b'',headers)
            if range_value and state.range_mode!='ignore' and self.headers.get('If-Range',state.etag)==state.etag:
                start,end=range_value[6:].split('-')
                start,end=int(start or 0),int(end) if end else len(data)-1
                if start>=len(data):
                    return self.send(416,b'',headers)
                end=min(end,len(data)-1)
                headers['Content-Range']=f'bytes {start}-{end}/{len(data)}'
                if state.range_mode=='invalid':
                    headers['Content-Range']=f'bytes 0-{end}/{len(data)}'
                return self.send(206,data[start:end+1],headers)
            self.send(200,data,headers)
    return Handler

@contextmanager
def fixture():
    state=State()
    server=ThreadingHTTPServer(('127.0.0.1',0),handler(state))
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        yield state, f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
