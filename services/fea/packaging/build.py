"""Build on the target OS. Output is a portable folder/zip and optional Linux .deb; Python is bundled.

Provide a trusted CalculiX executable and its license/source notices. Windows
DLLs shipped with that executable can be supplied with --native-dir.
"""
import argparse
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--calculix',type=Path,required=True)
    parser.add_argument('--notices',type=Path,required=True,help='Directory with native solver licenses and corresponding source information')
    parser.add_argument('--native-dir',type=Path,help='Extra DLL/shared-library directory from the trusted solver distribution')
    parser.add_argument('--output',type=Path,default=Path('dist/communicator'))
    parser.add_argument('--deb',action='store_true',help='Gerar instalador gráfico Debian/Ubuntu (requer dpkg-deb)')
    parser.add_argument('--version',default=datetime.now(timezone.utc).strftime('%Y.%m.%d.%H%M%S'))
    args=parser.parse_args()
    if platform.system() not in ('Windows','Linux'):parser.error('Build suportado em Windows e Linux.')
    if args.deb and (platform.system() != 'Linux' or not shutil.which('dpkg-deb')):
        parser.error('--deb exige Linux com dpkg-deb instalado.')
    if not args.calculix.is_file() or not args.notices.is_dir():parser.error('Executável CalculiX e diretório de avisos são obrigatórios.')
    if not any(args.notices.iterdir()):parser.error('Inclua as licenças e informações do código-fonte correspondente.')
    root=Path(__file__).resolve().parents[1]
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    import gmsh
    with tempfile.TemporaryDirectory(prefix='eksteel-build-') as temp:
        work=Path(temp);native=work/'native';native.mkdir()
        ccx=native/('ccx.exe' if os.name=='nt' else 'ccx');shutil.copy2(args.calculix,ccx)
        command=[sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','EksteelCommunicator',
            '--distpath',str(out),'--workpath',str(work/'work'),'--specpath',str(work),
            '--paths',str(root),'--collect-all','uvicorn','--collect-all','numpy',
            '--hidden-import','app','--hidden-import','worker','--hidden-import','engine',
            '--hidden-import','elements','--hidden-import','contacts','--hidden-import','unilateral',
            '--add-binary',f'{ccx}{os.pathsep}native',
            '--add-binary',f'{gmsh.libpath}{os.pathsep}.',
            '--add-data',f'{args.notices.resolve()}{os.pathsep}THIRD_PARTY_NOTICES']
        if args.native_dir:
            for binary in args.native_dir.iterdir():
                if binary.is_file() and (binary.suffix.lower()=='.dll' or '.so' in binary.name):
                    command += ['--add-binary',f'{binary.resolve()}{os.pathsep}native']
        if os.name=='nt':command.append('--windowed')
        command.append(str(root/'communicator.py'))
        subprocess.run(command,check=True)
    folder=out/'EksteelCommunicator'
    # PyInstaller resolves input symlinks; retain the SONAME aliases used by
    # the native solver (for example libarpack.so.2) as well as versioned files.
    if args.native_dir and platform.system() == 'Linux':
        destination=folder/'_internal/native'
        for binary in args.native_dir.iterdir():
            if binary.is_file() and '.so' in binary.name:
                shutil.copy2(binary, destination/binary.name)
    shutil.copy2(root/'packaging/README.txt',folder/'LEIA-ME.txt')
    # Keep the Gmsh license provided by its wheel in the redistributable notices.
    import importlib.metadata
    distribution=importlib.metadata.distribution('gmsh')
    notices=folder/'THIRD_PARTY_NOTICES';notices.mkdir(exist_ok=True)
    for entry in distribution.files or []:
        if any(word in entry.name.lower() for word in ('license','copying')):
            source=Path(distribution.locate_file(entry))
            if source.is_file():shutil.copy2(source,notices/('gmsh-'+source.name))
    target=out/('EksteelCommunicator-'+platform.system().lower()+'-'+platform.machine())
    shutil.make_archive(str(target),'zip',out,folder.name)
    print('Pacote criado:',str(target)+'.zip')
    if args.deb:
        from linux_deb import build_deb
        print('Instalador criado:', build_deb(folder, out, args.version))


if __name__=='__main__':main()
