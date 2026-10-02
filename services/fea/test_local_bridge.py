import unittest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from local_bridge import LocalAuthority, install_local_bridge, normalize_origin, PORT

ORIGIN='https://app.example.com'
BASE=f'http://127.0.0.1:{PORT}'


class LocalBridgeTests(unittest.TestCase):
    def setUp(self):
        self.now=100.
        self.auth=LocalAuthority(ORIGIN,clock=lambda:self.now)
        self.revoked=[]
        app=FastAPI()
        install_local_bridge(app,self.auth,self.revoked.append)
        @app.get('/health')
        def health(request:Request):return {'owner':request.state.local_owner,'ready':True}
        self.client=TestClient(app,base_url=BASE)
    def pair(self):
        return self.client.post('/pair',headers={'Origin':ORIGIN,'X-Eksteel-Pairing':self.auth.code})
    def test_pair_is_single_use_and_tokens_have_isolated_owners(self):
        code=self.auth.code
        first=self.pair();self.assertEqual(first.status_code,200)
        self.assertEqual(first.headers['access-control-allow-origin'],ORIGIN)
        token=first.json()['token'];self.assertNotEqual(token,code)
        self.assertEqual(self.client.post('/pair',headers={'Origin':ORIGIN,'X-Eksteel-Pairing':code}).status_code,401)
        self.auth.rotate_code();second=self.pair().json()['token']
        self.assertNotEqual(self.auth.owner(token),self.auth.owner(second))
    def test_host_origin_and_auth_cannot_be_bypassed(self):
        token=self.pair().json()['token']
        headers={'Origin':ORIGIN,'Authorization':'Bearer '+token}
        self.assertEqual(self.client.get('/health',headers=headers).status_code,200)
        for patch in ({'Origin':'https://evil.example'},{'Origin':'null'},{'Host':'evil.example:8091'},{'Authorization':'Bearer invalid'}):
            self.assertIn(self.client.get('/health',headers={**headers,**patch}).status_code,(401,403))
        self.assertEqual(self.client.get('/health',headers={'Authorization':'Bearer '+token}).status_code,403)
        self.assertEqual(self.client.get('/health',headers={'Origin':ORIGIN,'X-FEA-Owner':'a'*64}).status_code,401)
    def test_private_network_preflight_is_origin_restricted(self):
        headers={'Origin':ORIGIN,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,authorization','Access-Control-Request-Private-Network':'true'}
        response=self.client.options('/jobs',headers=headers)
        self.assertEqual(response.status_code,204)
        self.assertEqual(response.headers['access-control-allow-private-network'],'true')
        self.assertNotIn('access-control-allow-credentials',response.headers)
        denied=self.client.options('/jobs',headers={**headers,'Origin':'https://evil.example'})
        self.assertEqual(denied.status_code,403);self.assertNotIn('access-control-allow-origin',denied.headers)
        self.assertEqual(self.client.options('/jobs',headers={**headers,'Access-Control-Request-Headers':'x-fea-owner'}).status_code,403)
    def test_expiry_rate_limit_and_revocation(self):
        self.now+=301;self.assertEqual(self.pair().status_code,401)
        self.auth.rotate_code()
        for _ in range(10):self.client.post('/pair',headers={'Origin':ORIGIN,'X-Eksteel-Pairing':'incorrect'})
        self.assertEqual(self.pair().status_code,401)
        self.auth.rotate_code();token=self.pair().json()['token'];owner=self.auth.owner(token)
        response=self.client.delete('/disconnect',headers={'Origin':ORIGIN,'Authorization':'Bearer '+token})
        self.assertEqual(response.status_code,200);self.assertEqual(self.revoked,[owner]);self.assertIsNone(self.auth.owner(token))
        self.auth.rotate_code();token=self.pair().json()['token'];self.now+=43201
        self.assertIsNone(self.auth.owner(token))
    def test_origin_validation(self):
        self.assertEqual(normalize_origin('https://APP.example.com:443/'),ORIGIN)
        self.assertEqual(normalize_origin('http://localhost:3000'),'http://localhost:3000')
        for value in ('null','http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com?x=y','file:///tmp/x'):
            with self.assertRaises(ValueError):normalize_origin(value)

class ApprovalFlowTests(unittest.TestCase):
    def setUp(self):
        self.now=0.;self.auth=LocalAuthority(clock=lambda:self.now);self.revoked=[]
        app=FastAPI();install_local_bridge(app,self.auth,self.revoked.append)
        @app.get('/health')
        def health(request:Request):return {'ready':True,'owner':request.state.local_owner}
        self.client=TestClient(app,base_url=BASE)
    def begin(self,origin=ORIGIN,automatic=False):
        return self.client.post('/connect',headers={'Origin':origin,'X-Eksteel-Connect':'automatic' if automatic else 'request'})
    def poll(self,request,origin=ORIGIN,method='GET'):
        return self.client.request(method,'/connect/'+request['id'],headers={'Origin':origin,'X-Eksteel-Request':request['requestToken']})
    def test_unknown_site_needs_desktop_approval(self):
        automatic=self.begin(automatic=True)
        self.assertEqual(automatic.json()['status'],'approval_required');self.assertFalse(self.auth.pending())
        request=self.begin().json()
        self.assertEqual(self.poll(request).json()['status'],'pending')
        self.assertEqual(self.client.get('/health',headers={'Origin':ORIGIN}).status_code,403)
        self.assertTrue(self.auth.decide(request['id'],True))
        result=self.poll(request).json();self.assertEqual(result['status'],'approved');self.assertEqual(result['protocol'],2)
        token=result['token']
        self.assertEqual(self.client.get('/health',headers={'Origin':ORIGIN,'Authorization':'Bearer '+token}).status_code,200)
        self.assertFalse(self.auth.trusted_origins)
        self.assertEqual(self.begin(automatic=True).json()['status'],'approval_required')
    def test_remember_reconnect_and_forget(self):
        request=self.begin().json();self.auth.decide(request['id'],True,remember=True)
        old=self.poll(request).json()['token']
        next_request=self.begin(automatic=True).json()
        new=self.poll(next_request).json()['token']
        self.assertNotEqual(self.auth.owner(old),self.auth.owner(new));self.assertFalse(self.auth.pending())
        # Only approved origins, not session tokens, are persisted on disk.
        restored=LocalAuthority(trusted_origins=list(self.auth.trusted_origins))
        self.assertFalse(restored.sessions)
        self.assertEqual(restored.request_connection(ORIGIN,automatic=True)['status'],'requested')
        self.assertEqual(len(self.auth.forget_sites()),2)
        self.assertIsNone(self.auth.owner(old));self.assertIsNone(self.auth.owner(new))
        self.assertEqual(self.begin(automatic=True).json()['status'],'approval_required')
    def test_poll_is_secret_and_origin_bound(self):
        request=self.begin().json();self.auth.decide(request['id'],True,remember=True)
        self.assertEqual(self.poll(request,origin='https://other.example').status_code,401)
        self.assertEqual(self.poll({**request,'requestToken':'wrong'}).status_code,401)
        token=self.poll(request).json()['token'];self.auth.trusted_origins.add('https://other.example')
        self.assertEqual(self.client.get('/health',headers={'Origin':'https://other.example','Authorization':'Bearer '+token}).status_code,401)
        self.assertEqual(self.client.post('/connect',headers={'Origin':ORIGIN}).status_code,400)
        self.assertEqual(self.client.post('/connect',headers={'Origin':'null','X-Eksteel-Connect':'request'}).status_code,403)
    def test_denied_cancelled_and_expired_requests_never_authorize(self):
        request=self.begin().json();self.auth.decide(request['id'],False,remember=True)
        self.assertEqual(self.poll(request).json()['status'],'denied');self.assertFalse(self.auth.trusted_origins)
        request=self.begin().json();self.poll(request,method='DELETE')
        self.assertFalse(self.auth.decide(request['id'],True));self.assertFalse(self.auth.pending())
        request=self.begin().json();self.now=121
        self.assertFalse(self.auth.decide(request['id'],True,True));self.assertEqual(self.poll(request).status_code,401)
        self.assertFalse(self.auth.sessions)
    def test_cancel_after_approval_revokes_token_and_cancels_jobs(self):
        request=self.begin().json();self.auth.decide(request['id'],True)
        token=self.poll(request).json()['token'];owner=self.auth.owner(token)
        self.assertEqual(self.poll(request,method='DELETE').json()['status'],'cancelled')
        self.assertIsNone(self.auth.owner(token));self.assertEqual(self.revoked,[owner])
    def test_preflight_only_exposes_connection_requests_before_approval(self):
        headers={'Origin':ORIGIN,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-eksteel-connect'}
        self.assertEqual(self.client.options('/connect',headers=headers).status_code,204)
        self.assertEqual(self.client.options('/jobs',headers=headers).status_code,403)
        self.assertEqual(self.client.options('/connect',headers={**headers,'Access-Control-Request-Headers':'authorization'}).status_code,403)
    def test_pending_requests_are_bounded(self):
        self.assertEqual(self.begin().status_code,200)
        self.assertEqual(self.begin().status_code,429)
        for i in range(7):self.assertEqual(self.begin(origin=f'https://site{i}.example').status_code,200)
        self.assertEqual(self.begin(origin='https://overflow.example').status_code,429)
