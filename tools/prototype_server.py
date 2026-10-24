#!/usr/bin/env python3
"""Loopback-only P0.5 fixture server, not the production NAS/authentication API."""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import select
import socket
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


def parse_range(value: str, length: int) -> tuple[int,int]:
    match=re.fullmatch(r"bytes=(\d*)-(\d*)",value)
    if not match or not any(match.groups()):raise ValueError("Unsupported byte range")
    first,last=match.groups()
    if not first:
        suffix=int(last)
        if suffix<=0:raise ValueError("Empty suffix range")
        start,end=max(0,length-suffix),length-1
    else:
        start=int(first);end=min(length-1,int(last)) if last else length-1
    if start>=length or end<start or length<=0:raise ValueError("Unsatisfiable range")
    return start,end


def make_handler(data_root: Path, dist_root: Path):
    data_root,dist_root=data_root.resolve(),dist_root.resolve()
    manifest=json.loads((data_root/"manifest.json").read_text())
    files=manifest["files"]
    file_hashes: dict[tuple[str,int,int],str] = {}

    class Handler(BaseHTTPRequestHandler):
        server_version="PhotoMuseumPrototype/0.5"
        protocol_version="HTTP/1.1"

        def log_message(self,format,*args):
            # Do not log URLs, query strings, asset IDs, or source filenames.
            pass

        def response_headers(self,status:int,content_type:str,length:int,extra:dict|None=None):
            self.send_response(status)
            self.send_header("Content-Type",content_type)
            self.send_header("Content-Length",str(length))
            self.send_header("Cache-Control","private, no-store")
            self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Referrer-Policy","no-referrer")
            self.send_header("Cross-Origin-Resource-Policy","same-origin")
            self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'")
            for key,value in (extra or {}).items():self.send_header(key,value)
            self.end_headers()

        def payload(self,status:int,payload:bytes,content_type:str="application/json; charset=utf-8",extra=None):
            self.response_headers(status,content_type,len(payload),extra)
            if self.command!="HEAD":
                try:self.wfile.write(payload)
                except (BrokenPipeError,ConnectionResetError):pass

        def error(self,status:int,message:str):
            self.payload(status,json.dumps({"error":message}).encode())

        def local_request(self) -> bool:
            try:
                host=urlsplit("http://"+self.headers.get("Host","")).hostname
                origin=self.headers.get("Origin")
                if host not in {"127.0.0.1","localhost","::1"}:return False
                if self.headers.get("Sec-Fetch-Site")=="cross-site":return False
                if origin and urlsplit(origin).hostname not in {"127.0.0.1","localhost","::1"}:return False
                return True
            except ValueError:return False

        def do_HEAD(self):self.do_GET()

        def wait_delay(self,milliseconds:int) -> bool:
            deadline=time.monotonic()+milliseconds/1000
            while time.monotonic()<deadline:
                try:
                    ready,_,_=select.select([self.connection],[],[],min(.05,max(0,deadline-time.monotonic())))
                    if ready and not self.connection.recv(1,socket.MSG_PEEK):return False
                except (OSError,ValueError):return False
            return True

        def do_GET(self):
            if not self.local_request():return self.error(403,"Local prototype only")
            parsed=urlsplit(self.path)
            path=unquote(parsed.path)
            if any(part in {".",".."} for part in path.split("/")) or "\\" in path or "\x00" in path:
                return self.error(400,"Invalid path")
            query=parse_qs(parsed.query)
            if path=="/api/health":
                return self.payload(200,json.dumps({"stage":"P0.5","source":"local fixtures",
                    "authentication":"not implemented","mediaBytes":manifest.get("mediaBytes",0),
                    "budgetBytes":manifest.get("budgetBytes",0)}).encode())
            if path=="/api/catalog":
                collection=query.get("collection",["demo"])[0]
                catalog=manifest["collections"].get(collection)
                if catalog is None:return self.error(400,"Unknown collection")
                return self.payload(200,json.dumps(catalog,ensure_ascii=False).encode())
            if path.startswith("/media/"):
                entry=files.get(path)
                if entry is None:return self.error(404,"Unknown media or revision")
                try:delay=min(10000,max(0,int(query.get("delay",["0"])[0])))
                except ValueError:return self.error(400,"Invalid delay")
                if delay and not self.wait_delay(delay):return
                fault=query.get("fault",[""])[0]
                if fault=="offline":return self.error(503,"Fixture source unavailable")
                if fault=="expired":return self.error(401,"Fixture session expired")
                revision=entry["revision"] if fault!="changed" else "changed-fixture-revision"
                extra={"X-Content-Version":revision}
                if fault=="decode":return self.payload(200,b"deliberately-invalid-image",entry["contentType"],extra)
                target=(data_root/entry["path"]).resolve()
                if data_root not in target.parents or not target.is_file():return self.error(404,"Media unavailable")
                return self.send_file(target,entry["contentType"],extra)
            if path.startswith("/api/"):return self.error(404,"Unknown API")
            relative="index.html" if path=="/" else path.lstrip("/")
            target=(dist_root/relative).resolve()
            if dist_root not in target.parents or not target.is_file():return self.error(404,"Build prototype frontend first or use a valid asset URL")
            return self.send_file(target,mimetypes.guess_type(target.name)[0] or "application/octet-stream")

        def send_file(self,path:Path,content_type:str,extra:dict|None=None):
            stat=path.stat();length=stat.st_size
            signature=(str(path),stat.st_mtime_ns,length)
            if signature not in file_hashes:
                digest=hashlib.sha256()
                with path.open("rb") as handle:
                    for chunk in iter(lambda:handle.read(1024*1024),b""):digest.update(chunk)
                file_hashes[signature]='"'+digest.hexdigest()+'"'
            etag=file_hashes[signature]
            extra=dict(extra or {},ETag=etag)
            extra["Accept-Ranges"]="bytes"
            if self.headers.get("If-None-Match")==etag and not self.headers.get("Range"):
                self.response_headers(304,content_type,0,extra);return
            start,end,status=0,length-1,200
            range_header=self.headers.get("Range")
            if_range=self.headers.get("If-Range")
            if range_header and (not if_range or if_range==etag):
                try:start,end=parse_range(range_header,length)
                except ValueError:
                    extra["Content-Range"]=f"bytes */{length}"
                    return self.payload(416,b"",content_type,extra)
                status=206;extra["Content-Range"]=f"bytes {start}-{end}/{length}"
            count=max(0,end-start+1)
            self.response_headers(status,content_type,count,extra)
            if self.command=="HEAD":return
            try:
                with path.open("rb") as handle:
                    handle.seek(start)
                    while count:
                        chunk=handle.read(min(65536,count))
                        if not chunk:break
                        self.wfile.write(chunk);count-=len(chunk)
            except (BrokenPipeError,ConnectionResetError):pass

    return Handler


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port",type=int,default=8787)
    parser.add_argument("--data",type=Path,default=Path("data/prototype"))
    parser.add_argument("--dist",type=Path,default=Path("prototype/dist"))
    args=parser.parse_args()
    server=ThreadingHTTPServer(("127.0.0.1",args.port),make_handler(args.data,args.dist))
    print(f"P0.5 local fixture viewer: http://127.0.0.1:{server.server_port} (not production authentication or WebDAV)",flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=="__main__":main()
