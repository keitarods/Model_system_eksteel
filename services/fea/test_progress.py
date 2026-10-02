import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

class ProgressTests(unittest.TestCase):
    def test_job_progress_is_scoped_and_completion_is_not_reported_early(self):
        import app
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            job={'id':'job','action':'solve','status':'running','folder':folder}
            with patch.object(app,'authorize',return_value='owner'),patch.object(app,'find_job',return_value=job) as find:
                self.assertNotIn('progress',app.status('job',None))
                (folder/'progress.json').write_text(json.dumps({'percent':80,'stage':'Resultados'}))
                self.assertEqual(app.status('job',None)['progress']['percent'],80)
                find.assert_called_with('job','owner')
                job['status']='failed'
                self.assertEqual(app.status('job',None)['progress']['percent'],80)
                job['status']='completed'
                self.assertEqual(app.status('job',None)['progress']['percent'],100)
                job['status']='queued'
                self.assertEqual(app.status('job',None)['progress']['percent'],0)

    def test_partial_or_invalid_progress_does_not_break_polling(self):
        import app
        with tempfile.TemporaryDirectory() as directory:
            job={'id':'job','status':'running','folder':Path(directory)}
            with patch.object(app,'authorize',return_value='owner'),patch.object(app,'find_job',return_value=job):
                for text in ('{','null','{"percent":500,"stage":"invalid"}'):
                    (job['folder']/'progress.json').write_text(text)
                    self.assertNotIn('progress',app.status('job',None))
