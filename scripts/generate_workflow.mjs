import fs from "fs";
import OpenAI from "openai";

function pickEnv(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function extractFirstJsonObject(text) {
  // 余計な前後テキストが混ざっても、最初の { から最後の } を抜く
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) {
    throw new Error("Model output does not contain a JSON object");
  }
  return text.slice(s, e + 1);
}

const provider = (pickEnv(["MODEL_PROVIDER"]) || "deepseek").toLowerCase();

// DeepSeek用：DEEPSEEK_API_KEY を最優先
const apiKey =
  provider === "deepseek"
    ? pickEnv(["DEEPSEEK_API_KEY"])
    : pickEnv(["OPENAI_API_KEY", "DEEPSEEK_API_KEY"]);

if (!apiKey) {
  console.error("Missing API key. Set DEEPSEEK_API_KEY (recommended) or OPENAI_API_KEY.");
  process.exit(1);
}

// DeepSeekは OpenAI互換の baseURL を https://api.deepseek.com にする
const baseURL =
  provider === "deepseek"
    ? pickEnv(["OPENAI_BASE_URL", "DEEPSEEK_BASE_URL"]) || "https://api.deepseek.com"
    : pickEnv(["OPENAI_BASE_URL"]);

const model =
  pickEnv(["MODEL_NAME", "OPENAI_MODEL"]) ||
  (provider === "deepseek" ? "deepseek-chat" : "gpt-4.1-mini");

const client = new OpenAI({
  apiKey,
  ...(baseURL ? { baseURL } : {}),
});

const n8nVersion = pickEnv(["N8N_VERSION"]) || "2.6.3";

// workflow_spec は「指示文章」(長文仕様) でOK。JSONそのものでもOK。
// ただし最終出力は“n8n import JSON”に強制する。
const spec = fs.readFileSync("workflow_spec.txt", "utf-8");

const system = `You generate a single n8n workflow IMPORT JSON compatible with n8n version ${n8nVersion}.
Hard rules:
- Output MUST be a single JSON object only. No markdown. No code fences. No commentary.
- Use only plain ASCII quotes (").
- Do NOT include smart quotes or ellipsis.
- Do NOT include unknown properties like "option". Use "options" only if that node supports it.
- Every node must have: id, name, type, typeVersion, position [x,y], parameters.
- Top-level must include: name, nodes, connections.
- Ensure it is directly importable into n8n without "Could not find property option" errors.`;

const user = `WORKFLOW_SPEC:
${spec}
`;

async function main() {
  let text = "";

  if (provider === "deepseek" || (baseURL || "").includes("deepseek")) {
    // DeepSeek: /v1/chat/completions を使う
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 6000,
    });

    text = res?.choices?.[0]?.message?.content || "";
  } else {
    // OpenAI: Responses API
    const res = await client.responses.create({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_output_tokens: 6000,
    });

    // SDKの返り形式差異に耐える
    text =
      res?.output_text ||
      res?.output?.[0]?.content?.map((c) => c?.text).filter(Boolean).join("") ||
      "";
  }

  if (!text) throw new Error("Empty model output");

  // JSON抽出→parseで確実に「JSONだけ」にする
  const jsonStr = extractFirstJsonObject(text);

  let obj;
  try {
    obj = JSON.parse(jsonStr);
  } catch (e) {
    console.error("Model output was not valid JSON after extraction.");
    console.error("First 400 chars:", jsonStr.slice(0, 400));
    throw e;
  }

  // ここで整形して “純JSON” として保存（変な文字混入を減らす）
  fs.writeFileSync("workflow.json", JSON.stringify(obj, null, 2) + "\n", "utf-8");
  console.log("workflow.json generated.");
}

main().catch((e) => {
  console.error("FAILED:", e?.message || e);
  process.exit(1);
});
