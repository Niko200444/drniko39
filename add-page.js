import { db } from "./firebase-init.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const ADMIN_PASSWORD = "rezident2025";
const answersWrap = document.getElementById("answers");
const correctInput = document.getElementById("correct");

function newAnswerRow(value="") {
  const row = document.createElement("div");
  row.className = "answer-row";
  const label = document.createElement("span");
  label.textContent = String.fromCharCode(65 + answersWrap.children.length) + ")";
  label.style.minWidth = "20px";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Cavab...";
  input.value = value;
  row.appendChild(label);
  row.appendChild(input);
  answersWrap.appendChild(row);
  renumber();
}
function renumber() {
  [...answersWrap.children].forEach((row, i) => row.querySelector("span").textContent = String.fromCharCode(65+i)+")");
  const n = answersWrap.children.length || 1;
  correctInput.max = n;
  if (parseInt(correctInput.value,10) > n) correctInput.value = String(n);
}

// default 4 answers
for (let i=0;i<4;i++) newAnswerRow();

document.getElementById("btnAddAnswer").addEventListener("click", () => newAnswerRow());
document.getElementById("btnRmAnswer").addEventListener("click", () => {
  if (answersWrap.children.length>1) {
    answersWrap.removeChild(answersWrap.lastElementChild);
    renumber();
  }
});

document.getElementById("btnUnlock").addEventListener("click", () => {
  const pwd = (document.getElementById("adminPwd").value||"").trim();
  if (pwd === ADMIN_PASSWORD) {
    document.getElementById("formCard").style.display = "block";
    document.getElementById("status").textContent = "✔ Admin aktivdir";
  } else {
    document.getElementById("status").textContent = "Yanlış şifrə";
  }
});

document.getElementById("btnSave").addEventListener("click", async () => {
  const cat = (document.getElementById("cat").value||"").trim().toLowerCase();
  const q = (document.getElementById("q").value||"").trim();
  const answers = [...answersWrap.querySelectorAll("input")].map(i=>i.value.trim()).filter(Boolean);
  const cIdx = Math.max(0, Math.min((answers.length||1)-1, (parseInt(correctInput.value,10)||1)-1));
  if (!cat || !q || answers.length<1) return alert("Kateqoriya, sual və ən azı 1 cavab tələb olunur.");
  try {
    await addDoc(collection(db,"Suallar"), {
      category: cat, question: q, answers, correctIndex: cIdx, createdAt: serverTimestamp()
    });
    alert("✅ Sual əlavə olundu!");
    document.getElementById("q").value = "";
    answersWrap.innerHTML = ""; for (let i=0;i<4;i++) newAnswerRow();
    correctInput.value = "1";
  } catch(e){ alert("Xəta: "+e.message); }
});

document.getElementById("btnImport").addEventListener("click", async () => {
  const file = document.getElementById("json").files?.[0];
  const cat = (document.getElementById("cat").value||"").trim().toLowerCase();
  const info = document.getElementById("importStatus");
  if (!file) return alert("JSON seçin.");
  if (!cat) return alert("Öncə kateqoriya yazın.");
  const text = await file.text();
  let arr; try{arr=JSON.parse(text)}catch{return alert("JSON düzgün deyil.")}
  if (!Array.isArray(arr)) return alert("Massiv olmalıdır.");
  let ok=0;
  for (const item of arr) {
    const question = String(item.question||"").trim();
    const answers = Array.isArray(item.answers)? item.answers.map(x=>String(x)) : [];
    const correctIndex = typeof item.correctIndex==="number" ? item.correctIndex : 0;
    if (!question || answers.length===0 || correctIndex<0 || correctIndex>answers.length-1) continue;
    await addDoc(collection(db,"Suallar"), { category:cat, question, answers, correctIndex, createdAt: serverTimestamp() });
    ok++;
  }
  info.textContent = `✅ ${ok} sual yükləndi`;
});
