import fs from "fs";
import OpenAI from "openai";

// DeepSeek 固定
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("Missing DEEPSEEK_API_KEY (GitHub Actions Secret)");
  process.exit(1);
}

const baseURL = "https://api.deepseek.com";
const model = process.env.MODEL_NAME || "deepseek-chat";

const client = new OpenAI({ apiKey, baseURL });


const spec = fs.readFileSync("workflow_spec.txt", "utf-8");

// 重要：ここで「JSONだけ返せ」を徹底する
const prompt = `
You are generating an n8n workflow import JSON for n8n version ${process.env.N8N_VERSION || "2.6.3"}.

Hard rules:
- Output MUST be a single JSON object, no markdown, no code fences, no commentary.
- Use only plain ASCII quotes (").
- Do NOT include ellipsis characters.
- Include: name, nodes, connections, settings, active.
- Every node must have: id, name, type, typeVersion, position [x,y], parameters.
- Do not use unknown properties like "option". Use "options" only when the node supports it.

WORKFLOW SPEC:
${spec}
`.trim();

// OpenAIなら response_format を使って強制（DeepSeekで効かない場合があるので後段で抽出もする）
const res = await client.responses.create({
  model,
  input: prompt,
  temperature: 0,
  // OpenAIで強い。DeepSeekで無視されても害は少ない。
  response_format: { type: "json_object" }
});

const text = res.output_text?.trim() ?? "";
if (!text) {
  console.error("Model returned empty output");
  process.exit(1);
}

// DeepSeek等で余計な文字が混じった時の保険：最初の{〜最後の}抽出
const i = text.indexOf("{");
const j = text.lastIndexOf("}");
const sliced = (i >= 0 && j >= 0 && j > i) ? text.slice(i, j + 1) : text;

let obj;
try {
  obj = JSON.parse(sliced);
} catch (e) {
  console.error("invalid JSON from model:", e.message);
  process.exit(1);
}

fs.writeFileSync("workflow.json", JSON.stringify(obj, null, 2));
console.log("Wrote workflow.json");
