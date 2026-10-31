import httpx
import pytest

from .test_service import system
from .test_curator import configure, wait


@pytest.mark.parametrize('status', [402, 500])
def test_provider_http_receipt_survives_reads_without_tools_or_retry(system, status):
    app, client, remote, _ = system
    configure(app)
    calls = []

    def refused(request):
        calls.append(request)
        return httpx.Response(status, text='<html>sk-private /private/account</html>')

    app.state.curator.transport = httpx.MockTransport(refused)
    nas_before = list(remote.calls)
    with client:
        rid = client.post('/api/curator/runs', json={'prompt': '找在云南拍的车的照片'}).json()['id']
        run = wait(client, rid)
        assert run['status'] == 'failed'
        assert run['error'] == f'Provider返回HTTP {status}'
        assert run['exhibition_id'] is None
        for _ in range(2):
            assert client.get(f'/api/curator/runs/{rid}').json()['error'] == run['error']
            events = client.get(f'/api/curator/runs/{rid}/events').json()['items']
        assert [e['kind'] for e in events] == ['phase', 'phase', 'done']
        assert events[-1]['data']['error'] == run['error']
        assert len(calls) == 1
        assert remote.calls == nas_before
        assert 'private' not in str(events)
