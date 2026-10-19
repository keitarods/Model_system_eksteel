"""Package the frozen runtime for graphical installation on Debian/Ubuntu."""
import platform
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


def build_deb(package: Path, output: Path, version: str):
    if not re.fullmatch(r'[0-9][0-9A-Za-z.+~]*', version):
        raise ValueError('Versão Debian inválida.')
    architecture = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine())
    if not architecture:
        raise ValueError('Arquitetura Linux não suportada.')
    if not (package / 'emekaengCommunicator').is_file():
        raise ValueError('Compile primeiro o comunicador Linux.')
    destination = output / f'eksteel-comunicador_{version}_{architecture}.deb'
    with tempfile.TemporaryDirectory(prefix='eksteel-deb-') as temporary:
        root = Path(temporary)
        application = root / 'opt/eksteel-communicator'
        shutil.copytree(package, application)
        (application / 'emekaengCommunicator').chmod(0o755)
        control = root / 'DEBIAN'
        control.mkdir()
        (control / 'control').write_text(
            f'Package: eksteel-comunicador\nVersion: {version}\nArchitecture: {architecture}\n'
            'Maintainer: Emeka Engenharia\nSection: science\nPriority: optional\n'
            'Depends: libc6, libgl1, libglu1-mesa, libx11-6, libxext6, libxrender1, libfontconfig1\n'
            'Description: emekaengCommunicator\n'
            ' Calculos locais com Python, Gmsh e CalculiX incluidos.\n'
        )
        applications = root / 'usr/share/applications'
        applications.mkdir(parents=True)
        (applications / 'eksteel-fea.desktop').write_text(
            '[Desktop Entry]\nType=Application\nName=emekaengCommunicator\n'
            'Comment=Conectar as simulações ao computador\n'
            'Exec=/opt/eksteel-communicator/emekaengCommunicator\n'
            'Icon=applications-engineering\nTerminal=false\nCategories=Education;Science;\n'
        )
        subprocess.run(['dpkg-deb', '--root-owner-group', '-Zxz', '-z9', '--build', str(root), str(destination)], check=True)
    return destination
