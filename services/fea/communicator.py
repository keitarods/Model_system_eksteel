"""Desktop loopback communicator for Windows and Linux; no server credentials."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sys
import tempfile
import threading

from local_bridge import LocalAuthority, PORT, install_local_bridge, normalize_origin


def data_directory():
    base = Path(os.environ.get('LOCALAPPDATA', Path.home()/'AppData/Local')) if os.name == 'nt' else Path(os.environ.get('XDG_CONFIG_HOME', Path.home()/'.config'))
    path = base/'EksteelFEA'
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def configure_runtime(calculix=''):
    folder = Path(__file__).resolve().parent
    bundled = Path(getattr(sys, '_MEIPASS', folder))/'native'
    local = folder/'.runtime/usr'
    candidates = [bundled/('ccx.exe' if os.name=='nt' else 'ccx'), local/'bin/ccx']
    executable = calculix or next((str(p) for p in candidates if p.is_file()), '') or shutil.which('ccx')
    if not executable or not Path(executable).is_file():
        raise ValueError('Selecione o executável CalculiX (ccx.exe no Windows ou ccx no Linux).')
    os.environ['CCX_BIN'] = str(Path(executable).resolve())
    libraries = [p for p in (bundled, local/'lib/x86_64-linux-gnu') if p.is_dir()]
    if libraries:
        key = 'PATH' if os.name == 'nt' else 'LD_LIBRARY_PATH'
        os.environ[key] = os.pathsep.join(map(str,libraries)) + os.pathsep + os.environ.get(key,'')
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    os.environ['OMP_NUM_THREADS'] = '1'
    os.environ['CCX_NPROC_RESULTS'] = '1'
    os.environ['CCX_NPROC_EQUATION_SOLVER'] = '1'
    return os.environ['CCX_BIN']


def autostart(enabled):
    command = [sys.executable] if getattr(sys,'frozen',False) else [sys.executable,str(Path(__file__).resolve())]
    if os.name == 'nt':
        import subprocess
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run') as key:
            if enabled:winreg.SetValueEx(key,'EksteelFEA',0,winreg.REG_SZ,subprocess.list2cmdline(command))
            else:
                try:winreg.DeleteValue(key,'EksteelFEA')
                except FileNotFoundError:pass
    else:
        folder=Path(os.environ.get('XDG_CONFIG_HOME',Path.home()/'.config'))/'autostart'
        path=folder/'eksteel-fea.desktop'
        if enabled:
            folder.mkdir(parents=True,exist_ok=True)
            # Desktop Entry Exec quoting (not a shell command).
            escaped=['"'+arg.replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')+'"' for arg in command]
            path.write_text('[Desktop Entry]\nType=Application\nName=Eksteel Comunicador FEA\nExec='+' '.join(escaped)+'\nTerminal=false\n')
        else:path.unlink(missing_ok=True)


class LocalServer:
    def __init__(self, origin='', calculix='', directory=None, trusted_origins=()):
        configure_runtime(calculix)
        self.authority=LocalAuthority(origin,trusted_origins=trusted_origins)
        self.temp=tempfile.TemporaryDirectory(prefix='jobs-',dir=directory)
        os.environ['FEA_JOB_DIR']=self.temp.name
        # Used only by the original server API; never shared with the browser.
        os.environ['FEA_API_TOKEN']=secrets.token_urlsafe(32)
        import app as service
        import uvicorn
        self.service=service
        install_local_bridge(service.app,self.authority,service.cancel_owner)
        self.socket=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
        if os.name=='nt':self.socket.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
        else:self.socket.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        try:self.socket.bind(('127.0.0.1',PORT))
        except OSError:
            self.socket.close();self.temp.cleanup()
            raise ValueError('A porta 8091 já está em uso. Verifique se o comunicador já está aberto.')
        self.server=uvicorn.Server(uvicorn.Config(service.app,host='127.0.0.1',port=PORT,workers=1,access_log=False,log_config=None))
        self.thread=threading.Thread(target=self.server.run,kwargs={'sockets':[self.socket]},daemon=True)
        self.thread.start()

    def revoke(self):
        for owner in self.authority.revoke_all():self.service.cancel_owner(owner)

    def stop(self):
        self.revoke()
        self.server.should_exit=True
        self.thread.join(timeout=15)
        self.socket.close()
        if not self.thread.is_alive():self.temp.cleanup()


class DesktopApp:
    def __init__(self, root, directory=None):
        import tkinter as tk
        from tkinter import ttk, messagebox, filedialog
        self.tk=tk;self.messagebox=messagebox
        self.root=root;self.directory=directory or data_directory();self.config=self.directory/'settings.json'
        try:settings=json.loads(self.config.read_text())
        except (OSError,ValueError):settings={}
        self.trusted=[]
        for origin in settings.get('trusted_sites',[])[:32]:
            try:self.trusted.append(normalize_origin(origin))
            except (ValueError,AttributeError):pass
        self.server=None;self.dialog=None;self.request_id=None;self.closing=False
        root.title('Eksteel · Comunicador FEA');root.geometry('660x430')
        frame=ttk.Frame(root,padding=18);frame.pack(fill='both',expand=True)
        ttk.Label(frame,text='Cálculos neste computador',font=('',15,'bold')).pack(anchor='w')
        ttk.Label(frame,text='Abra a Simulação no site e aceite a solicitação nesta janela.\nNão é necessário copiar códigos nem digitar o endereço do site.',wraplength=615).pack(anchor='w',pady=12)
        self.status=tk.StringVar(value='Iniciando o comunicador…')
        ttk.Label(frame,textvariable=self.status,wraplength=615).pack(anchor='w',pady=6)
        self.startup=tk.BooleanVar(value=settings.get('autostart',False))
        ttk.Checkbutton(frame,text='Abrir automaticamente ao entrar no Windows/Linux',variable=self.startup,command=self.set_startup).pack(anchor='w',pady=10)
        ttk.Label(frame,text='Sites lembrados:').pack(anchor='w')
        self.sites=tk.Listbox(frame,height=4);self.sites.pack(fill='x');self.refresh_sites()
        actions=ttk.Frame(frame);actions.pack(fill='x',pady=8)
        ttk.Button(actions,text='Esquecer sites e revogar acessos',command=self.forget).pack(side='left')
        ttk.Button(actions,text='Tentar iniciar novamente',command=self.start).pack(side='left',padx=8)
        self.ccx=tk.StringVar(value='' if getattr(sys,'frozen',False) else settings.get('calculix',''))
        self.native_frame=ttk.LabelFrame(frame,text='CalculiX não encontrado',padding=8)
        if getattr(sys,'frozen',False):
            ttk.Label(self.native_frame,text='Não foi possível iniciar. Feche e abra o aplicativo novamente.\nSe persistir, reinstale o pacote completo pelo site.',wraplength=600).pack(anchor='w')
        else:
            ttk.Label(self.native_frame,text='Selecione o executável do solver ou instale o pacote completo.').pack(anchor='w')
            ttk.Button(self.native_frame,text='Selecionar CalculiX',command=lambda:self.choose_calculix(filedialog)).pack(anchor='w')
        ttk.Label(frame,text='Minimizar mantém o cálculo ativo. Fechar encerra o comunicador.\nNenhuma porta é publicada na rede.',wraplength=615).pack(anchor='w',pady=8)
        root.protocol('WM_DELETE_WINDOW',self.close)
        root.after(100,self.start);root.after(300,self.poll)

    def save(self):
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        temporary=self.config.with_suffix('.tmp')
        temporary.write_text(json.dumps({'trusted_sites':sorted(self.trusted),'calculix':self.ccx.get(),'autostart':self.startup.get()}))
        temporary.replace(self.config)

    def refresh_sites(self):
        self.sites.delete(0,'end')
        for origin in sorted(self.trusted):self.sites.insert('end',origin)
        if not self.trusted:self.sites.insert('end','Nenhum site lembrado. A primeira conexão exige sua aprovação.')

    def set_startup(self):
        try:autostart(self.startup.get());self.save()
        except Exception as error:self.messagebox.showerror('Não foi possível salvar',str(error),parent=self.root)

    def choose_calculix(self, filedialog):
        value=filedialog.askopenfilename(title='Executável CalculiX',parent=self.root)
        if value:self.ccx.set(value);self.start()

    def start(self):
        if self.server:return
        try:
            self.server=LocalServer('',self.ccx.get(),self.directory,trusted_origins=self.trusted)
            self.native_frame.pack_forget()
            self.status.set('Pronto. Aguardando conexão do site. Sites lembrados conectam automaticamente.')
        except Exception as error:
            self.status.set(str(error));self.native_frame.pack(fill='x')

    def forget(self):
        previous=self.trusted;self.trusted=[]
        try:self.save()
        except OSError as error:
            self.trusted=previous;self.messagebox.showerror('Não foi possível esquecer os sites',str(error),parent=self.root);return
        if self.server:
            for owner in self.server.authority.forget_sites():self.server.service.cancel_owner(owner)
        if self.dialog:self.dialog.destroy();self.dialog=None;self.request_id=None
        self.refresh_sites();self.status.set('Permissões removidas e trabalhos cancelados. Novas conexões exigem aprovação.')

    def decide(self, allow, remember=False):
        if not self.server or not self.request_id:return
        authority=self.server.authority
        with authority.lock:
            request=authority.requests.get(self.request_id)
            if request and request['status']=='pending' and request['expires']>authority.clock() and allow and remember:
                if len(self.trusted)>=32:
                    self.messagebox.showerror('Limite de sites', 'Remova permissões antigas antes de lembrar outro site.',parent=self.dialog);return
                previous=self.trusted[:]
                self.trusted=sorted(set(self.trusted+[request['origin']]))
                try:self.save()
                except OSError as error:
                    self.trusted=previous;self.messagebox.showerror('Não foi possível lembrar o site',str(error),parent=self.dialog);return
            accepted=authority.decide(self.request_id,allow,remember)
        if self.dialog:self.dialog.destroy()
        self.dialog=None;self.request_id=None;self.refresh_sites()
        self.status.set('Conexão autorizada. Continue no site.' if accepted and allow else 'Solicitação recusada ou expirada.')

    def poll(self):
        from tkinter import ttk
        if self.closing:return
        if self.server:
            pending=self.server.authority.pending()
            if self.dialog and self.request_id not in dict(pending):
                self.dialog.destroy();self.dialog=None;self.request_id=None
            if pending and not self.dialog:
                self.request_id,origin=pending[0]
                self.dialog=self.tk.Toplevel(self.root);self.dialog.title('Autorizar site · Eksteel');self.dialog.geometry('560x235');self.dialog.transient(self.root)
                box=ttk.Frame(self.dialog,padding=18);box.pack(fill='both',expand=True)
                ttk.Label(box,text='Permitir que este site use seu computador para cálculos?',wraplength=510,font=('',11,'bold')).pack(anchor='w')
                ttk.Label(box,text=origin,wraplength=510).pack(anchor='w',pady=14)
                remember=self.tk.BooleanVar(value=False)
                ttk.Checkbutton(box,text='Lembrar este site e conectar automaticamente nas próximas visitas',variable=remember).pack(anchor='w')
                actions=ttk.Frame(box);actions.pack(anchor='e',pady=18)
                ttk.Button(actions,text='Recusar',command=lambda:self.decide(False)).pack(side='left',padx=8)
                ttk.Button(actions,text='Permitir',command=lambda:self.decide(True,remember.get())).pack(side='left')
                self.dialog.protocol('WM_DELETE_WINDOW',lambda:self.decide(False))
                # Make the request visible even if the main window was minimized.
                self.root.deiconify();self.dialog.lift();self.dialog.focus_set()
        self.root.after(300,self.poll)

    def close(self):
        self.closing=True
        if self.server:self.server.stop()
        self.root.destroy()


def desktop():
    import tkinter as tk
    root=tk.Tk();DesktopApp(root);root.mainloop()


def main():
    if len(sys.argv)>1 and sys.argv[1]=='--worker':
        # Runtime settings are inherited from the desktop parent.
        from worker import main as worker_main
        worker_main(sys.argv[2]);return
    parser=argparse.ArgumentParser(description='Eksteel Comunicador FEA')
    parser.add_argument('--headless',action='store_true',help='Para testes e integração técnica')
    parser.add_argument('--origin')
    parser.add_argument('--calculix',default='')
    parser.add_argument('--pairing-file',type=Path,help='Arquivo privado para testes locais; nunca publicar')
    args=parser.parse_args()
    if not args.headless:desktop();return
    if not args.origin or not args.pairing_file:parser.error('--headless exige --origin e --pairing-file')
    with tempfile.TemporaryDirectory(prefix='eksteel-communicator-') as directory:
        server=LocalServer(args.origin,args.calculix,directory)
        created=False
        try:
            fd=os.open(args.pairing_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            created=True
            with os.fdopen(fd,'w') as output:json.dump({'code':server.authority.code,'origin':server.authority.origin},output)
            server.thread.join()
        except KeyboardInterrupt:pass
        finally:
            server.stop()
            if created:args.pairing_file.unlink(missing_ok=True)


if __name__=='__main__':
    main()
