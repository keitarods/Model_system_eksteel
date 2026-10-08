import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('linux_deb', Path(__file__).parent / 'packaging/linux_deb.py')
linux_deb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(linux_deb)


@unittest.skipUnless(shutil.which('dpkg-deb'), 'Requires dpkg-deb')
class LinuxPackagingTests(unittest.TestCase):
    def test_installed_launcher_and_runtime_paths_match(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / 'package'
            package.mkdir()
            (package / 'EksteelCommunicator').write_text('test fixture')
            runtime = package / '_internal'
            runtime.mkdir()
            (runtime / 'library').write_text('bundled dependency')
            archive = linux_deb.build_deb(package, root, '2026.10.7.1')
            extracted = root / 'extracted'
            subprocess.run(['dpkg-deb', '-x', str(archive), str(extracted)], check=True)
            desktop = (extracted / 'usr/share/applications/eksteel-fea.desktop').read_text()
            self.assertIn('Exec=/opt/eksteel-communicator/EksteelCommunicator\n', desktop)
            self.assertIn('Terminal=false', desktop)
            installed = extracted / 'opt/eksteel-communicator'
            self.assertTrue((installed / 'EksteelCommunicator').stat().st_mode & 0o111)
            self.assertEqual((installed / '_internal/library').read_text(), 'bundled dependency')
            version = subprocess.check_output(['dpkg-deb', '-f', str(archive), 'Version'], text=True)
            self.assertEqual(version.strip(), '2026.10.7.1')

    def test_rejects_control_file_injection(self):
        with self.assertRaises(ValueError):
            linux_deb.build_deb(Path('/unused'), Path('/unused'), '1\nDepends: evil')
