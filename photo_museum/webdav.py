"""Read-only DAV, strict successful Depth:1 snapshots, no credential redirects."""
from dataclasses import dataclass
import hashlib
import json
import posixpath
import ssl
import time
from urllib.parse import quote, unquote, urljoin, urlsplit
import httpx
from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

DAV = '{DAV:}'
PROPS = b'''<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>'''

class DAVError(Exception):
    def __init__(self, code, retryable=False):
        super().__init__(code)
        self.code, self.retryable = code, retryable


def normalize(path):
    if not isinstance(path, str) or not path.startswith('/') or '\\' in path or any(ord(c) < 32 for c in path):
        raise ValueError('无效的绝对路径')
    if any(p in ('.', '..') for p in path.split('/')):
        raise ValueError('禁止相对路径段')
    return '/' + '/'.join(p for p in path.split('/') if p)


def within(path, root):
    return path == root or path.startswith(root.rstrip('/') + '/')


def strong(etag):
    return bool(etag and etag.startswith('"') and etag.endswith('"') and '\r' not in etag and '\n' not in etag)


@dataclass
class Entry:
    path: str
    is_dir: bool
    size: int | None
    modified: str | None
    etag: str | None

    @property
    def revision(self):
        return hashlib.sha256(json.dumps([self.etag, self.size, self.modified], separators=(',', ':')).encode()).hexdigest()[:32]

    @property
    def quality(self):
        return 'strong_etag' if strong(self.etag) else 'weak_metadata' if self.etag else 'metadata_only'


class WebDAV:
    def __init__(self, source, password, transport=None):
        self.source = source
        parts = urlsplit(source['url'])
        if parts.scheme not in ('https', 'http') or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ('', '/'):
            raise ValueError('请输入不含路径或凭据的 HTTP(S) 源站地址')
        if parts.scheme == 'http' and not source.get('allow_http'):
            raise ValueError('HTTP 需要显式允许内网明文传输')
        self.origin = source['url'].rstrip('/')
        self.root = normalize(source['root'])
        context = ssl.create_default_context()
        if source.get('ca_pem'):
            context.load_verify_locations(cadata=source['ca_pem'])
        self.client = httpx.Client(auth=(source['username'], password), verify=context,
            timeout=httpx.Timeout(20, connect=5), follow_redirects=False, trust_env=False, transport=transport,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2))

    def close(self):
        self.client.close()

    def url(self, path):
        path = normalize(path)
        if not within(path, self.root):
            raise DAVError('path_outside_root')
        return self.origin + quote(path, safe='/')

    @staticmethod
    def check(status):
        if status in (401, 403):
            raise DAVError('credentials_or_permission')
        if 300 <= status < 400:
            raise DAVError('redirect_refused')
        if status == 404:
            raise DAVError('source_not_found')
        if status >= 400:
            raise DAVError('upstream_http_' + str(status), status in (408, 429) or status >= 500)

    def list(self, path, depth=1):
        path = normalize(path)
        try:
            started = time.monotonic()
            with self.client.stream('PROPFIND', self.url(path) + ('/' if depth else ''), headers={'Depth': str(depth), 'Content-Type': 'application/xml', 'Accept-Encoding': 'identity'}, content=PROPS) as response:
                self.check(response.status_code)
                if response.status_code != 207:
                    raise DAVError('expected_multistatus')
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if time.monotonic() - started > 60:
                        raise DAVError('directory_deadline', True)
                    if len(data) > 16 * 1024 * 1024:
                        raise DAVError('directory_response_too_large')
            tree = ElementTree.fromstring(data)
            if tree.tag != DAV + 'multistatus':
                raise DAVError('invalid_multistatus')
            result, seen, found_self = [], set(), False
            for item in tree.findall(DAV + 'response'):
                href = item.findtext(DAV + 'href')
                if not href:
                    raise DAVError('missing_href')
                target = urlsplit(urljoin(self.url(path) + '/', href))
                if (target.scheme, target.netloc) != (urlsplit(self.origin).scheme, urlsplit(self.origin).netloc) or target.query or target.fragment:
                    raise DAVError('foreign_href')
                # Decode once; reject encoded slash because it changes path segmentation.
                if '%2f' in target.path.lower() or '%5c' in target.path.lower():
                    raise DAVError('ambiguous_href')
                child = normalize(unquote(target.path, errors='strict'))
                if child in seen:
                    raise DAVError('duplicate_href')
                seen.add(child)
                if not within(child, self.root) or (child != path and (depth == 0 or posixpath.dirname(child) != path)):
                    raise DAVError('unexpected_descendant')
                status = item.findtext(DAV + 'status')
                if status and ' 200 ' not in status:
                    raise DAVError('partial_listing')
                props = {}
                for ps in item.findall(DAV + 'propstat'):
                    ps_status = ps.findtext(DAV + 'status', '')
                    prop = ps.find(DAV + 'prop')
                    if ' 200 ' in ps_status and prop is not None:
                        props.update({el.tag: el for el in prop})
                    elif ' 404 ' not in ps_status:
                        raise DAVError('partial_listing')
                rt = props.get(DAV + 'resourcetype')
                if rt is None:
                    raise DAVError('missing_resource_type')
                is_dir = rt.find(DAV + 'collection') is not None
                def val(key):
                    el = props.get(DAV + key)
                    return el.text if el is not None else None
                length = val('getcontentlength')
                entry = Entry(child, is_dir, int(length) if length else None, val('getlastmodified'), val('getetag'))
                if entry.size is not None and entry.size < 0:
                    raise DAVError('invalid_size')
                if child == path:
                    found_self = True
                    if depth == 1 and not is_dir:
                        raise DAVError('expected_directory')
                    if depth == 0:
                        result.append(entry)
                else:
                    result.append(entry)
                if len(seen) > 100000:
                    raise DAVError('too_many_entries')
            if not found_self:
                raise DAVError('incomplete_listing')
            return result
        except DAVError:
            raise
        except httpx.TransportError as exc:
            # Exception text can contain paths/URLs. Never expose it to logs or UI.
            cause = 'tls_verification_failed' if 'CERTIFICATE_VERIFY_FAILED' in str(exc) else 'network_unavailable'
            raise DAVError(cause, cause == 'network_unavailable') from None
        except (ValueError, ElementTree.ParseError, DefusedXmlException):
            raise DAVError('invalid_directory_response') from None
