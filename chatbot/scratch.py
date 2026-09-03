import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path

# Fix Windows console UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

# Load api_key from environment or .env file
api_key = os.environ.get('api_key') or os.environ.get('GEMINI_API_KEY')
if not api_key:
    for env_file in ['.env', '.env.local']:
        env_path = Path(__file__).parent / env_file
        if env_path.exists():
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('api_key=') or line.startswith('GEMINI_API_KEY='):
                        api_key = line.split('=', 1)[1].strip().strip('"').strip("'")
                        break
        if api_key:
            break

models = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemma-4-31b-it'
]

for model in models:
    url = f"https://generativelanguage.googleapis.com/v1beta/interactions?key={api_key}"
    headers = {'Content-Type': 'application/json'}
    payload = {
        "model": model,
        "input": "Hello"
    }
    
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                print(f"✅ {model} worked.")
    except urllib.error.HTTPError as e:
        error_info = e.read().decode('utf-8')
        print(f"❌ {model} failed: {e.code} - {error_info}")
    except Exception as e:
        print(f"❌ {model} exception: {e}")
