"""Opt-in loopback bridge. No wildcard CORS, remote bind, or server token exposure."""
import hashlib
import hmac
import secrets
import re
import threading
import time
from urllib.parse import urlsplit
from fastapi.responses import JSONResponse, Response

PORT = 8091


def normalize_origin(value):
    parsed = urlsplit(value.strip())
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError('Porta do site inválida.') from error
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Informe somente a origem do site, por exemplo https://app.exemplo.com.')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('Use HTTPS; HTTP é permitido somente para desenvolvimento local.')
    host = parsed.hostname.lower()
    if ':' in host: host = '[' + host + ']'
    default = 443 if parsed.scheme == 'https' else 80
    return f'{parsed.scheme}://{host}' + (f':{port}' if port and port != default else '')


class LocalAuthority:
    def __init__(self, origin='', clock=time.monotonic, trusted_origins=()):
        self.origin = normalize_origin(origin) if origin else ''
        self.trusted_origins = set(normalize_origin(o) for o in trusted_origins)
        self.requests = {}
        self.recent_requests = []
        self.clock = clock
        self.lock = threading.RLock()
        self.sessions = {}
        self.code = ''
        self.deadline = 0
        self.failures = 0
        self.rotate_code()

    def rotate_code(self):
        with self.lock:
            self.code = secrets.token_urlsafe(24)
            self.deadline = self.clock() + 300
            self.failures = 0
            return self.code

    def pair(self, code):
        with self.lock:
            now = self.clock()
            self.sessions = {t:s for t,s in self.sessions.items() if s[1] > now}
            if not self.code or now >= self.deadline or self.failures >= 10 or len(self.sessions) >= 8:
                return None
            if not hmac.compare_digest(code.encode(), self.code.encode()):
                self.failures += 1
                return None
            self.code = ''  # single-use; regenerate from the desktop app only
            return self._issue(self.origin)

    def _issue(self, origin):
        now = self.clock()
        self.sessions = {t:s for t,s in self.sessions.items() if s[1] > now}
        if len(self.sessions) >= 8:return None
        token = secrets.token_urlsafe(32)
        self.sessions[hashlib.sha256(token.encode()).hexdigest()] = (secrets.token_hex(32), now + 12*3600, origin)
        return token

    def allowed(self, origin):
        with self.lock:
            return origin == self.origin or origin in self.trusted_origins or any(s[2] == origin and s[1] > self.clock() for s in self.sessions.values())

    def request_connection(self, origin, automatic=False):
        with self.lock:
            now=self.clock()
            self.requests={i:r for i,r in self.requests.items() if r['expires'] > now}
            # Automatic checks never open a permission dialog for an unknown site.
            if automatic and origin not in self.trusted_origins:return {'status':'approval_required'}
            self.recent_requests=[t for t in self.recent_requests if t > now-60]
            if len(self.requests)>=8 or len(self.recent_requests)>=12:return None
            if any(r['origin']==origin and r['status']=='pending' for r in self.requests.values()):return None
            self.recent_requests.append(now)
            identifier=secrets.token_hex(16);secret=secrets.token_urlsafe(24)
            self.requests[identifier]={'origin':origin,'secret':hashlib.sha256(secret.encode()).hexdigest(),'expires':now+120,
                                      'status':'approved' if origin in self.trusted_origins else 'pending','token':None}
            return {'id':identifier,'requestToken':secret,'status':'requested'}

    def pending(self):
        with self.lock:
            return [(i,r['origin']) for i,r in self.requests.items() if r['status']=='pending' and r['expires']>self.clock()]

    def decide(self, identifier, allow, remember=False):
        # Called only by the desktop UI. There is no HTTP approval endpoint.
        with self.lock:
            request=self.requests.get(identifier)
            if not request or request['status']!='pending' or request['expires']<=self.clock():return False
            request['status']='approved' if allow else 'denied'
            if allow and remember:self.trusted_origins.add(request['origin'])
            return True

    def poll(self, identifier, secret, origin, cancel=False):
        with self.lock:
            request=self.requests.get(identifier)
            if not request or request['expires']<=self.clock() or request['origin']!=origin or not hmac.compare_digest(request['secret'],hashlib.sha256(secret.encode()).hexdigest()):return None
            if cancel:
                owner=self.revoke(request['token']) if request['token'] else None
                request['status']='denied';request['token']=None
                return {'status':'cancelled','owner':owner}
            if request['status']=='approved':
                if not request['token']:request['token']=self._issue(origin)
                if not request['token']:return {'status':'denied','detail':'Limite de conexões atingido. Revogue conexões antigas no comunicador.'}
                return {'status':'approved','token':request['token'],'protocol':2,'expiresIn':43200}
            return {'status':request['status']}

    def forget_sites(self):
        with self.lock:
            self.trusted_origins.clear()
            return self.revoke_all()

    def owner(self, token, origin=None):
        with self.lock:
            session = self.sessions.get(hashlib.sha256(token.encode()).hexdigest())
            return session[0] if session and session[1] > self.clock() and (origin is None or session[2]==origin) else None

    def revoke(self, token):
        with self.lock:
            session = self.sessions.pop(hashlib.sha256(token.encode()).hexdigest(), None)
            return session[0] if session else None

    def revoke_all(self):
        with self.lock:
            owners = [s[0] for s in self.sessions.values()]
            self.sessions.clear()
            self.requests.clear()
            self.code = ''
            return owners


def install_local_bridge(app, authority, cancel_owner):
    app.state.local_authority = authority

    @app.middleware('http')
    async def local_access(request, call_next):
        origin = request.headers.get('origin', '')
        path=request.url.path
        connect_path=path=='/connect' or re.fullmatch(r'/connect/[a-f0-9]{32}',path) is not None
        try:valid_origin=normalize_origin(origin)==origin
        except (ValueError,AttributeError):valid_origin=False
        if request.headers.get('host') != f'127.0.0.1:{PORT}' or not valid_origin or (not connect_path and not authority.allowed(origin)):
            return JSONResponse({'detail':'Site não autorizado no comunicador.'}, status_code=403)
        cors = {'Access-Control-Allow-Origin':origin, 'Vary':'Origin', 'Cache-Control':'no-store'}
        if request.method == 'OPTIONS':
            method = request.headers.get('access-control-request-method', '')
            headers = {h.strip().lower() for h in request.headers.get('access-control-request-headers', '').split(',') if h.strip()}
            allowed_headers={'authorization','content-type','x-eksteel-pairing'} if not connect_path else {'x-eksteel-connect','x-eksteel-request'}
            if method not in ('GET','POST','DELETE') or not headers.issubset(allowed_headers):
                return JSONResponse({'detail':'Requisição não permitida.'}, status_code=403, headers=cors)
            return Response(status_code=204, headers={**cors, 'Access-Control-Allow-Methods':'GET, POST, DELETE', 'Access-Control-Allow-Headers':', '.join(sorted(allowed_headers)), 'Access-Control-Allow-Private-Network':'true', 'Access-Control-Max-Age':'0'})
        if connect_path:
            if path=='/connect' and request.method=='POST':
                mode=request.headers.get('x-eksteel-connect')
                if mode not in ('request','automatic'):
                    return JSONResponse({'detail':'Solicitação inválida.'},status_code=400,headers=cors)
                body=authority.request_connection(origin,automatic=mode=='automatic')
                return JSONResponse(body or {'detail':'Aguarde a solicitação atual ou tente novamente em um minuto.'},status_code=200 if body else 429,headers=cors)
            if path!='/connect' and request.method in ('GET','DELETE'):
                secret=request.headers.get('x-eksteel-request','')
                body=authority.poll(path.rsplit('/',1)[1],secret,origin,cancel=request.method=='DELETE') if len(secret)<=128 else None
                if body and body.get('owner'):cancel_owner(body['owner'])
                if body:body.pop('owner',None)
                return JSONResponse(body or {'detail':'Solicitação expirada ou inválida. Conecte novamente.'},status_code=200 if body else 401,headers=cors)
            return JSONResponse({'detail':'Método inválido.'},status_code=405,headers=cors)
        if request.url.path == '/pair' and request.method == 'POST':
            code = request.headers.get('x-eksteel-pairing', '')
            token = authority.pair(code) if origin==authority.origin and len(code) <= 128 else None
            return JSONResponse({'token':token,'expiresIn':43200,'protocol':1} if token else {'detail':'Código inválido, expirado ou já usado. Gere outro no comunicador.'}, status_code=200 if token else 401, headers=cors)
        header = request.headers.get('authorization', '')
        token = header[7:] if header.startswith('Bearer ') and len(header) <= 256 else ''
        owner = authority.owner(token,origin) if token else None
        if not owner:
            return JSONResponse({'detail':'Conecte novamente o comunicador local.'}, status_code=401, headers=cors)
        if request.url.path == '/disconnect' and request.method == 'DELETE':
            authority.revoke(token)
            cancel_owner(owner)
            return JSONResponse({'disconnected':True}, headers=cors)
        request.state.local_owner = owner
        response = await call_next(request)
        response.headers.update(cors)
        return response
