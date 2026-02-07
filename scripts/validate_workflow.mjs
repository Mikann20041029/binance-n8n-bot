import fs from "fs";

const raw = fs.readFileSync("workflow.json", "utf-8");
let obj;
try {
  obj = JSON.parse(raw);
} catch (e) {
  console.error("workflow.json is not valid JSON:", e.message);
  process.exit(1);
}

// 必須トップレベル
for (const k of ["name", "nodes", "connections"]) {
  if (!(k in obj)) {
    console.error(`missing top-level key: ${k}`);
    process.exit(1);
  }
}
if (!Array.isArray(obj.nodes) || obj.nodes.length === 0) {
  console.error("nodes must be non-empty array");
  process.exit(1);
}

// ノード最低要件
for (const n of obj.nodes) {
  for (const k of ["id", "name", "type", "typeVersion", "position", "parameters"]) {
    if (!(k in n)) {
      console.error(`node missing key '${k}':`, n?.name || n?.id);
      process.exit(1);
    }
  }
  if (!Array.isArray(n.position) || n.position.length !== 2) {
    console.error("node.position must be [x,y]:", n.name);
    process.exit(1);
  }
}

// n8n importで死にがちなスマートクォート検査
if (/[“”‘’…]/.test(raw)) {
  console.error("workflow.json contains smart quotes/ellipsis. Replace with plain ASCII quotes.");
  process.exit(1);
}

console.log("OK: workflow.json basic validation passed");

