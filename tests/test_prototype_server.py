from __future__ import annotations

import http.client
import json
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from tools.prototype_server import make_handler


class PrototypeServerTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        root=Path(self.temp.name)
        self.data=root/"data";self.data.mkdir()
        dist=root/"dist";dist.mkdir();(dist/"index.html").write_text("<html>fixture</html>")
        (self.data/"image.jpg").write_bytes(b"0123456789abcdef")
        self.url="/media/test/rev1/original"
        (self.data/"manifest.json").write_text(json.dumps({
            "collections":{"demo":{"events":[],"assets":[{"id":"test"}]},"private":{"events":[],"assets":[]}},
            "files":{self.url:{"path":"image.jpg","revision":"rev1","contentType":"image/jpeg"}},
            "mediaBytes":16,"budgetBytes":1000}))
        self.server=ThreadingHTTPServer(("127.0.0.1",0),make_handler(self.data,dist))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()

    def request(self,path,headers=None,method="GET"):
        connection=http.client.HTTPConnection("127.0.0.1",self.server.server_port,timeout=5)
        connection.request(method,path,headers=headers or {})
        response=connection.getresponse();result=(response.status,dict(response.getheaders()),response.read())
        connection.close();return result

    def test_catalog_does_not_expose_internal_paths(self):
        status,headers,body=self.request("/api/catalog")
        self.assertEqual(status,200);self.assertEqual(json.loads(body)["assets"],[{"id":"test"}])
        self.assertNotIn(b"image.jpg",body);self.assertIn("no-store",headers["Cache-Control"])

    def test_range_and_if_range_contract(self):
        status,headers,body=self.request(self.url,{"Range":"bytes=3-7"})
        self.assertEqual((status,body),(206,b"34567"));self.assertEqual(headers["Content-Range"],"bytes 3-7/16")
        self.assertEqual(headers["X-Content-Version"],"rev1")
        self.assertEqual(self.request(self.url,{"Range":"bytes=-3"})[2],b"def")
        self.assertEqual(self.request(self.url,{"Range":"bytes=10-"})[2],b"abcdef")
        self.assertEqual(self.request(self.url,{"Range":"bytes=3-7","If-Range":"old"})[0],200)
        self.assertEqual(self.request(self.url,{"Range":"bytes=3-7","If-Range":headers["ETag"]})[0],206)

    def test_unsatisfiable_and_multiple_ranges(self):
        for value in ("bytes=99-", "bytes=8-3", "bytes=-0", "bytes=0-1,5-7"):
            status,headers,body=self.request(self.url,{"Range":value})
            self.assertEqual(status,416,value);self.assertEqual(headers["Content-Range"],"bytes */16")

    def test_unknown_asset_revision_and_traversal_are_rejected(self):
        for path in ("/media/test/rev0/original","/media/other/rev1/original","/data/manifest.json"):
            self.assertEqual(self.request(path)[0],404)
        for path in ("/../data/manifest.json","/%2e%2e/data/manifest.json","/media/test%5c../image.jpg"):
            self.assertEqual(self.request(path)[0],400)

    def test_local_boundary_and_cross_site_rejection(self):
        self.assertEqual(self.request("/api/catalog",{"Host":"attacker.example"})[0],403)
        self.assertEqual(self.request(self.url,{"Origin":"https://attacker.example"})[0],403)
        self.assertEqual(self.request(self.url,{"Sec-Fetch-Site":"cross-site"})[0],403)

    def test_faults_exercise_real_http_or_decode_failures(self):
        self.assertEqual(self.request(self.url+"?fault=offline")[0],503)
        self.assertEqual(self.request(self.url+"?fault=expired")[0],401)
        status,headers,body=self.request(self.url+"?fault=changed")
        self.assertEqual(status,200);self.assertNotEqual(headers["X-Content-Version"],"rev1")
        self.assertEqual(self.request(self.url+"?fault=decode")[2],b"deliberately-invalid-image")
        start=time.monotonic();self.request(self.url+"?delay=30")
        self.assertGreaterEqual(time.monotonic()-start,.025)

    def test_head_has_length_without_payload(self):
        status,headers,body=self.request(self.url,method="HEAD")
        self.assertEqual((status,headers["Content-Length"],body),(200,"16",b""))


if __name__=="__main__":unittest.main()
