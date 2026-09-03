import os
import json
import urllib.request
import urllib.error

models = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemma-4-31b-it'
]

for model in models:
    url = f"https://generativelanguage.googleapis.com/v1alpha/interactions?key={api_key}"
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
