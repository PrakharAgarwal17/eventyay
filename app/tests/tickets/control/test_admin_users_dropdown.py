import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(shutil.which('node') is None, reason='Node.js is required for dropdown JavaScript regression tests')
def test_admin_users_dropdown_behavior():
    script = Path(__file__).with_name('admin_users_dropdown.test.mjs')
    result = subprocess.run(['node', '--test', str(script)], check=False, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
