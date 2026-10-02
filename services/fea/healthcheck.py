"""Authenticated container health probe; never print credentials."""
import json
import os
import sys
from urllib.request import Request, urlopen


def check():
    request = Request('http://127.0.0.1:8090/health', headers={
        'Authorization': 'Bearer ' + os.environ.get('FEA_API_TOKEN', ''),
        'X-FEA-Owner': '0' * 64,
    })
    try:
        with urlopen(request, timeout=3) as response:
            return response.status == 200 and json.load(response).get('ready') is True
    except Exception:
        return False


if __name__ == '__main__':
    sys.exit(0 if check() else 1)
