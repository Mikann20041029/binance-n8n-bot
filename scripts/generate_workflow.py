import os, json, sys, textwrap, subprocess
from typing import Tuple

# Requirements:
# - env: OPENAI_API_KEY
# - optional env: OPENAI_BASE_URL (default https://api.openai.com/v1)
# - optional env: OPENAI_MODEL (default gpt-4.1-mini or gpt-4.1)
#
# This script:
# 1) Asks model to output STRICT JSON only (no markdown)
# 2) Writes workflows/workflow.json
# 3) Runs n8n import validation
# 4) If fail, feeds error back and retries up to MAX_TRIES

MAX_TRIES = int(os.getenv("MAX_TRIES", "3"))
OUT_PATH = os.getenv("OUT_PATH", "workflows/workflow.json")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1")

if not OPENAI_API_KEY:
    print("Missing OPENAI_API_KEY", file=sys.stderr)
    sys.exit(2)

SPEC = os.getenv("WORKFLOW_SPEC", "").strip()
if not SPEC:
    print("Missing WORKFLOW_SPEC env", file=sys.stderr)
    sys.exit(2)

SYSTEM = (
    "You generate n8n importable workflow JSON. Output MUST be valid JSON only. "
    "No markdown. No comments. Use ASCII quotes only. No ellipsis char. "
    "Target n8n version 2.6.3. "
    "Avoid unknown properties: do not use 'option' if node expects 'options'. "
    "Use correct node typeVersion and parameter schema."
)

def call_openai(messages) -> str:
    # Uses curl to avoid adding dependencies.
    payload = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": 0.2,
    }
    p = subprocess.run(
        ["curl", "-sS", f"{OPENAI_BASE_URL}/chat/completions",
         "-H", f"Authorization: Bearer {OPENAI_API_KEY}",
         "-H", "Content-Type: application/json",
         "-d", json.dumps(payload)],
        capture_output=True, text=True
    )
    if p.returncode != 0:
        print(p.stderr, file=sys.stderr)
        sys.exit(3)
    data = json.loads(p.stdout)
    return data["choices"][0]["message"]["content"]

def validate_with_n8n(path: str) -> Tuple[bool, str]:
    # Validate by importing into a temp n8n user folder
    env = os.environ.copy()
    env["N8N_USER_FOLDER"] = os.path.abspath(".n8n_tmp")
    env["N8N_ENCRYPTION_KEY"] = env.get("N8N_ENCRYPTION_KEY", "test-encryption-key-32chars!!")
    # n8n import will exit non-zero if schema invalid
    p = subprocess.run(
        ["npx", "--yes", "n8n", "import:workflow", "--input", path],
        capture_output=True, text=True, env=env
    )
    ok = (p.returncode == 0)
    out = (p.stdout or "") + "\n" + (p.stderr or "")
    return ok, out.strip()

def main():
    last_error = ""
    for i in range(1, MAX_TRIES + 1):
        user_prompt = SPEC
        if last_error:
            user_prompt += "\n\nFAILED IMPORT ERROR (fix and output corrected JSON):\n" + last_error

        messages = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user_prompt},
        ]

        content = call_openai(messages).strip()

        # Hard guard: must be JSON object
        try:
            obj = json.loads(content)
        except Exception as e:
            last_error = f"Model output was not valid JSON. json.loads error: {e}"
            print(f"[try {i}] invalid JSON from model", file=sys.stderr)
            continue

        os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)

        ok, log = validate_with_n8n(OUT_PATH)
        if ok:
            print(f"OK: validated and wrote {OUT_PATH}")
            return  # success

        last_error = log
        print(f"[try {i}] n8n import failed:\n{log}\n", file=sys.stderr)

    print("FAILED: could not produce a valid importable workflow JSON", file=sys.stderr)
    print("Last error:\n" + last_error, file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    main()
