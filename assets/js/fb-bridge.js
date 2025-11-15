// Firestore bridge for existing quiz
import "./firebase-init.js";

const db = globalThis.firebaseDB;
const F  = globalThis.Firebase;
const ADMIN_PASS = "rezident2025";

function filenameToCategory(name) {
  if (!name) return null;
  return String(name).replace(/\.json$/i,'').toLowerCase();
}

// Try to load from Firestore; if empty, fallback to original loader
const _origLoadQuizData = window.loadQuizData;
window.loadQuizData = async function() {
  try {
    const file = window.currentCategory; // same var used in your app.js
    const cat = filenameToCategory(file);
    if (!db || !cat) return _origLoadQuizData ? _origLoadQuizData() : null;

    // Single category
    const q = F.query(F.collection(db, "Suallar"), F.where("category","==", cat));
    const snap = await F.getDocs(q);
    const rows = [];
    snap.forEach(d => rows.push({...d.data(), _id: d.id}));

    if (rows.length > 0) {
      window.allQuestions = rows.map(q => (typeof window.shuffleAnswers === "function") ? window.shuffleAnswers(q) : q);
      window.applyOrderMode?.();
      window.renderQuiz?.();
      // side panels
      window.updateWrongQuestionsList?.();
      window.updateFlaggedQuestionsList?.();
      window.updateRepeatedMistakesList?.();
      window.updateProgressInfo?.();
      window.updatePageNavigation?.();
      return;
    }
    // Fallback to local JSON if Firestore is empty
    return _origLoadQuizData ? _origLoadQuizData() : null;
  } catch (e) {
    console.error("Firestore load error:", e);
    return _origLoadQuizData ? _origLoadQuizData() : null;
  }
};

// Patch edit to write to Firestore if possible
const _origHandleEdit = window.handleEditQuestion;
window.handleEditQuestion = async function(questionNumber, questionObj) {
  const pwd = prompt("Admin şifrəsini daxil edin:");
  if (pwd !== ADMIN_PASS) { alert("Yanlış şifrə!"); return; }

  const currentQuestion = questionObj.question || "";
  const newQuestion = prompt("Sual mətnini dəyiş:", currentQuestion);
  if (newQuestion && newQuestion.trim()) questionObj.question = newQuestion.trim();

  const answers = questionObj.answers || [];
  if (answers.length) {
    const list = answers.map((a,i)=>`${i+1}) ${a}`).join("\n");
    const maxN = answers.length;
    const currentCorrect = (typeof questionObj.correctIndex === "number" ? (questionObj.correctIndex + 1) : 1);
    const sel = prompt(`Düzgün cavab (1-${maxN}). Hazır: ${currentCorrect}\n\n${list}`, String(currentCorrect));
    if (sel) {
      const idx = parseInt(sel,10) - 1;
      if (!Number.isNaN(idx) && idx>=0 && idx<maxN) questionObj.correctIndex = idx;
    }
  }

  try {
    if (questionObj._id && db) {
      const ref = F.doc(db, "Suallar", questionObj._id);
      await F.updateDoc(ref, {
        question: questionObj.question,
        answers: questionObj.answers,
        correctIndex: questionObj.correctIndex,
        updatedAt: F.serverTimestamp()
      });
      alert("Sual Firestore-da yeniləndi.");
    } else if (_origHandleEdit) {
      return _origHandleEdit(questionNumber, questionObj);
    }
  } catch (e) {
    console.error(e);
    alert("Firestore yenilənmədi, lokal saxlanıldı.");
    _origHandleEdit?.(questionNumber, questionObj);
  }
  window.saveEditedQuestion?.(questionNumber, {
    question: questionObj.question,
    answers: questionObj.answers,
    correctIndex: questionObj.correctIndex
  });
  window.renderQuiz?.();
};

// Quick open any category by typing
document.addEventListener("DOMContentLoaded", () => {
  const cont = document.getElementById("categoryContainer");
  if (!cont) return;
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap;";
  const input = document.createElement("input");
  input.placeholder = "Yeni kateqoriya (məs: cardio)";
  input.style.cssText = "padding:8px;border:1px solid #ddd;border-radius:8px;";
  const btn = document.createElement("button");
  btn.className = "category-btn";
  btn.textContent = "AÇ";
  btn.addEventListener("click", () => {
    const val = (input.value || "").trim().toLowerCase();
    if (!val) { alert("Kateqoriya yazın."); return; }
    window.selectCategory(val + ".json");
  });
  wrap.appendChild(input);
  wrap.appendChild(btn);
  cont.appendChild(wrap);
});