// Sadə localStorage helper-lər
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("localStorage oxunmadı:", key, e);
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("localStorage yazılmadı:", key, e);
  }
}

// ===== Firebase Auth + Firestore Sync =====
let FB = { app:null, auth:null, db:null, user:null };
function firebaseAvailable(){ return typeof window !== 'undefined' && window.firebase && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && !String(window.FIREBASE_CONFIG.apiKey).includes("PASTE_"); }

function initFirebaseAuth(){
  try{
    if(!firebaseAvailable()) { console.log("Firebase config yoxdur və ya tamamlanmayıb."); return; }
    if (!FB.app) FB.app = firebase.initializeApp(window.FIREBASE_CONFIG);
    if (!FB.auth) FB.auth = firebase.auth();
    if (!FB.db) FB.db = firebase.firestore();
    FB.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    FB.auth.onAuthStateChanged((u)=>{
      FB.user = u || null;
      updateAuthUI();
      if (FB.user) { loadRemoteState().catch(console.warn); }
    });
    // UI listeners
    const gbtn = document.getElementById("googleSignInBtn");
    const sbtn = document.getElementById("signOutBtn");
    if (gbtn) gbtn.addEventListener("click", async ()=>{
      try{
        const provider = new firebase.auth.GoogleAuthProvider();
        await FB.auth.signInWithPopup(provider);
      }catch(err){ console.warn("Google sign-in error", err); alert("Giriş alınmadı: " + err.message); }
    });
    if (sbtn) sbtn.addEventListener("click", ()=> FB.auth.signOut());
  }catch(e){ console.warn("Firebase init error", e); }
}

function updateAuthUI(){
  const gbtn = document.getElementById("googleSignInBtn");
  const badge = document.getElementById("userBadge");
  const nameEl = document.getElementById("userName");
  const photoEl = document.getElementById("userPhoto");
  if (!gbtn || !badge) return;
  if (FB.user){
    gbtn.classList.add("hidden");
    badge.classList.remove("hidden");
    nameEl.textContent = FB.user.displayName || FB.user.email || "İstifadəçi";
    if (FB.user.photoURL) { photoEl.src = FB.user.photoURL; photoEl.classList.remove("hidden"); } else { photoEl.classList.add("hidden"); }
  } else {
    gbtn.classList.remove("hidden");
    badge.classList.add("hidden");
  }
}

// Local state to object
function collectLocalState(){
  const data = {};
  for (let i=0;i<localStorage.length;i++){
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith("quiz_")) {
      try{ data[k] = JSON.parse(localStorage.getItem(k)); }
      catch{ data[k] = localStorage.getItem(k); }
    }
  }
  return data;
}

async function saveRemoteState(){
  if (!FB.user || !FB.db) return;
  const data = collectLocalState();
  const ref = FB.db.collection("users").doc(FB.user.uid).collection("appState").doc("state");
  await ref.set({ data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

async function loadRemoteState(){
  if (!FB.user || !FB.db) return;
  const ref = FB.db.collection("users").doc(FB.user.uid).collection("appState").doc("state");
  const snap = await ref.get();
  if (snap.exists){
    const remote = snap.data().data || {};
    // Merge: remote üstünlük alsın
    Object.keys(remote).forEach((k)=>{
      try{ localStorage.setItem(k, JSON.stringify(remote[k])); }
      catch{ localStorage.setItem(k, String(remote[k])); }
    });
    // Yerli parametrləri yenilə
    loadCategoryState();
    renderAll();
  } else {
    // Uzağa ilkin yükləmə
    await saveRemoteState();
  }
}

// sadə debounce
function debounce(fn, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

const saveRemoteStateDebounced = debounce(saveRemoteState, 1500);




// Global state
let allQuestions = [];
let currentCategory = null;
let currentPage = 1;
let questionsPerPage = 10;
let baseQuestionsPerPage = 10;
let singleQuestionMode = false;   // Flashcard üçün ON/OFF
let searchQuery = "";
let filterMode = "all"; // all | wrong | flagged | noted

let selectedAnswers = {};
let wrongQuestions = [];
let flaggedQuestions = [];
let questionWrongCount = {};
let editedQuestions = {}; // id -> {before, after, active, updatedAt}
let questionNotes = {}; // id -> "text"

let isAdmin = false;

// Auto sync (default: OFF)
let autoSyncEnabled = localStorage.getItem('quiz_autoSync') === '1';

// PWA install prompt holder
let _deferredInstallPrompt = null;

// Flashcard sıralama
let flashOrderMode = "sequential"; // "sequential" | "random"
let orderedIds = []; // flashcard rejimində göstərmə sırası
let randomOrderIds = []; // normal (multi-sual) rejim üçün stabil random sıra

// İmtahan state
let exam = {
  running: false,
  durationSec: 1800,
  endTime: null,
  timerId: null,
  lastResult: null, // { total, answered, correct, wrong }
  questionIds: []
};

let appStarted = false;

// Helpers
function storageKey(name) {
  if (!currentCategory) return "quiz_global_" + name;
  return "quiz_" + currentCategory + "_" + name;
}
try {
  // ...
}
catch (e) {
  // ...
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// Random qarışdırma
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// JSON-da düzgün cavab həmişə A-dadır (answers[0]) – ekranda random
function normalizeQuestion(raw, index) {
  const originalAnswers = Array.isArray(raw.answers) ? raw.answers.slice() : [];
  const correctAnswer = originalAnswers[0] || "";
  const shuffled = shuffleArray(originalAnswers);
  let correctIndex = shuffled.indexOf(correctAnswer);
  if (correctIndex === -1) correctIndex = 0;

  return {
    id: index,
    question: raw.question || "",
    answers: shuffled,
    correctIndex
  };
}

function applyEditedQuestions() {
  Object.values(editedQuestions || {}).forEach((entry) => {
    const q = allQuestions.find((qq) => qq.id === entry.id);
    if (!q) return;
    const src = entry.active === "before" ? entry.before : entry.after;
    q.question = src.question;
    q.answers = src.answers.slice();
    q.correctIndex = src.correctIndex;
  });
}

function loadCategoryState() {
  selectedAnswers = loadJSON(storageKey("selectedAnswers"), {});
  wrongQuestions = loadJSON(storageKey("wrongQuestions"), []);
  flaggedQuestions = loadJSON(storageKey("flaggedQuestions"), []);
  questionWrongCount = loadJSON(storageKey("questionWrongCount"), {});
  editedQuestions = loadJSON(storageKey("editedQuestions"), {});
  questionNotes = loadJSON(storageKey("questionNotes"), {});
}

function saveCategoryState() {
  try { if (autoSyncEnabled && FB.user) saveRemoteStateDebounced(); } catch(e){}
  saveJSON(storageKey("selectedAnswers"), selectedAnswers);
  saveJSON(storageKey("wrongQuestions"), wrongQuestions);
  saveJSON(storageKey("flaggedQuestions"), flaggedQuestions);
  saveJSON(storageKey("questionWrongCount"), questionWrongCount);
  saveJSON(storageKey("editedQuestions"), editedQuestions);
  saveJSON(storageKey("questionNotes"), questionNotes);
}

function updateQuestionsPerPageFromSelect() {
  const select = document.getElementById("questionsPerPage");
  if (!select) return;
  const v = parseInt(select.value, 10);
  baseQuestionsPerPage = isNaN(v) ? 10 : v;
  localStorage.setItem("quiz_questionsPerPage", String(baseQuestionsPerPage));
  if (!singleQuestionMode) {
    questionsPerPage = baseQuestionsPerPage;
  }
  currentPage = 1;
  recomputeOrderedIds(); // flashcard sırası dəyişə bilər
  renderAll();
}

// Stats helpers
function computeStats() {
  const total = allQuestions.length;
  const answered = Object.keys(selectedAnswers).length;
  let correct = 0;
  let wrong = 0;

  for (const [idStr, answerInfo] of Object.entries(selectedAnswers)) {
    const id = Number(idStr);
    const q = allQuestions.find((qq) => qq.id === id);
    if (!q) continue;
    if (answerInfo.index === q.correctIndex) {
      correct++;
    } else {
      wrong++;
    }
  }

  return { total, answered, correct, wrong, flagged: flaggedQuestions.length };
}

// ======== Flashcard köməkçilər ========

// hazırki filtrlənmiş suallar (id sırası ilə)
function getFilteredQuestionsRaw() {
  let list = allQuestions.slice();
  const query = searchQuery.trim().toLowerCase();

  if (query) {
    list = list.filter((q) => {
      if (q.question && q.question.toLowerCase().includes(query)) return true;
      if (Array.isArray(q.answers)) {
        return q.answers.some((a) => a.toLowerCase().includes(query));
      }
      return false;
    });
  }

  if (filterMode === "wrong") {
    list = list.filter((q) => wrongQuestions.includes(q.id));
  } else if (filterMode === "flagged") {
    list = list.filter((q) => flaggedQuestions.includes(q.id));
  } else if (filterMode === "noted") {
    list = list.filter((q) => !!questionNotes[q.id]);
  }

  if ((exam.running || exam.lastResult) && Array.isArray(exam.questionIds) && exam.questionIds.length) {
    list = list.filter((q) => exam.questionIds.includes(q.id));
  }

  // Əlavə: random/ardıcıl seçimi burada tətbiq et
  if (!singleQuestionMode) {
    // Normal rejimdə random/ardıcıl
    const orderRadio = document.querySelector('input[name="quizOrder"]:checked');
    if (orderRadio && orderRadio.value === "random") {
      // Random sıralama yalnız list dəyişəndə qurulsun
      const currentIds = list.map(q => q.id);
      const sameMembership = (randomOrderIds.length === currentIds.length) && currentIds.every(id => randomOrderIds.includes(id));
      if (!sameMembership) {
        randomOrderIds = shuffleArray(currentIds);
      }
      // Random sıralamaya uyğun düzülüş
      list = randomOrderIds.map(id => list.find(q => q.id === id)).filter(Boolean);
    } else {
      // Ardıcıl rejimdə random sıralamanı sıfırla
      randomOrderIds = [];
    }
  }
  return list;
}

// flashcard üçün göstərmə sırasını qur
function recomputeOrderedIds() {
  const list = getFilteredQuestionsRaw().map(q => q.id);
  if (!singleQuestionMode) {
    orderedIds = list;
    return;
  }
  if (flashOrderMode === "random") {
    orderedIds = shuffleArray(list);
  } else {
    orderedIds = list; // ardıcıl
  }
  // cari səhifəni 1-ə çək
  currentPage = 1;
}

// Filtrlənmiş suallar (səhifələmə ilə)
function getFilteredQuestions() {
  const rawList = getFilteredQuestionsRaw();

  // Flashcard aktivdirsə sıralamaya hörmət edək
  let list = rawList;
  if (singleQuestionMode) {
    const idSet = new Set(orderedIds);
    list = rawList.filter(q => idSet.has(q.id))
                  .sort((a,b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
  }

  return list;
}

function renderAll() {
  renderQuiz();
  renderPagination();
  renderSidePanel();
  renderTinyStats();
  updateFlashcardUI();
}

// Rendering
function renderQuiz() {
  const container = document.getElementById("quizContainer");
  if (!container) return;

  const filtered = getFilteredQuestions();

  if (!currentCategory) {
    container.innerHTML = `
      <div class="empty-hint">
        <div class="emoji">👈</div>
        <p>Soldan bir kateqoriya seçərək başla</p>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-hint">
        <div class="emoji">🔍</div>
        <p>Bu axtarış / rejim üçün sual tapılmadı.</p>
      </div>`;
    return;
  }

  // Səhifələmə
  if (singleQuestionMode) {
    questionsPerPage = 1;
  } else {
    questionsPerPage = baseQuestionsPerPage;
  }

  const maxPage = Math.max(1, Math.ceil(filtered.length / questionsPerPage));
  if (currentPage > maxPage) currentPage = maxPage;

  const start = (currentPage - 1) * questionsPerPage;
  const end = Math.min(start + questionsPerPage, filtered.length);
  const pageQuestions = filtered.slice(start, end);

  container.innerHTML = "";
  pageQuestions.forEach((q) => {
    const card = document.createElement("div");
    card.className = "question";
    card.id = "question-" + q.id;

    // Header
    const header = document.createElement("div");
    header.className = "question-header";

    const title = document.createElement("div");
    const questionNumberSpan = document.createElement("span");
    questionNumberSpan.className = "question-number";
    questionNumberSpan.textContent = q.id + ".";

    const titleText = document.createElement("span");
    titleText.textContent = q.question;

    title.appendChild(questionNumberSpan);
    title.appendChild(titleText);

    const meta = document.createElement("div");
    meta.className = "question-meta";
    const wrongCount = questionWrongCount[q.id] || 0;
    if (wrongCount > 0) {
      const wc = document.createElement("span");
      wc.innerHTML = `<i class="fa fa-fire"></i> ${wrongCount} səhv`;
      meta.appendChild(wc);
    }
    if (flaggedQuestions.includes(q.id)) {
      const fl = document.createElement("span");
      fl.innerHTML = `<i class="fa fa-flag"></i> flag`;
      meta.appendChild(fl);
    }
    if (editedQuestions[q.id]) {
      const ed = document.createElement("span");
      ed.innerHTML = `<i class="fa fa-pen"></i> dəyişib`;
      meta.appendChild(ed);
    }

    header.appendChild(title);
    header.appendChild(meta);
    card.appendChild(header);

    // Cavablar
    const answersDiv = document.createElement("div");
    answersDiv.className = "answers";

    const answerInfo = selectedAnswers[q.id];

    q.answers.forEach((ans, idx) => {
      const btn = document.createElement("button");
      btn.className = "answer-btn";

      const letterSpan = document.createElement("span");
      letterSpan.className = "answer-letter";
      letterSpan.textContent = String.fromCharCode(65 + idx);

      const textSpan = document.createElement("span");
      textSpan.textContent = ans;

      btn.appendChild(letterSpan);
      btn.appendChild(textSpan);

      if (answerInfo) {
        if (exam.running) {
          if (idx === answerInfo.index) btn.classList.add("exam-selected");
        } else {
          if (idx === answerInfo.index) {
            if (idx === q.correctIndex) btn.classList.add("correct");
            else btn.classList.add("wrong");
          }
        }
      }

      btn.addEventListener("click", () => onAnswerClick(q.id, idx));
      answersDiv.appendChild(btn);
    });

    card.appendChild(answersDiv);

    // Footer
    const footer = document.createElement("div");
    footer.className = "question-footer";

    const actions = document.createElement("div");
    actions.className = "question-actions";

    const flagBtn = document.createElement("button");
    flagBtn.className = "icon-btn";
    if (flaggedQuestions.includes(q.id)) flagBtn.classList.add("flagged");
    flagBtn.innerHTML = `<i class="fa fa-flag"></i> Flag`;
    flagBtn.addEventListener("click", () => toggleFlag(q.id));
    actions.appendChild(flagBtn);

    const showBtn = document.createElement("button");
    showBtn.className = "icon-btn";
    showBtn.innerHTML = `<i class="fa fa-check-circle"></i> Düzgün cavab`;
    showBtn.addEventListener("click", () => toggleCorrectAnswer(q.id));
    actions.appendChild(showBtn);

    const noteBtn = document.createElement("button");
    noteBtn.className = "icon-btn";
    if (questionNotes[q.id]) noteBtn.classList.add("has-note");
    noteBtn.innerHTML = `<i class="fa fa-sticky-note"></i> Qeyd`;
    noteBtn.addEventListener("click", () => toggleNoteEditor(q.id));
    actions.appendChild(noteBtn);

    if (wrongQuestions.includes(q.id)) {
      const rmWrongBtn = document.createElement("button");
      rmWrongBtn.className = "icon-btn";
      rmWrongBtn.innerHTML = `<i class="fa fa-minus-circle"></i> Səhv siyahısından çıxar`;
      rmWrongBtn.addEventListener("click", () => removeFromWrong(q.id));
      actions.appendChild(rmWrongBtn);
    }

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn admin-only";
    editBtn.innerHTML = `<i class="fa fa-pen"></i> Redaktə (admin)`;
    editBtn.addEventListener("click", () => editQuestion(q.id));
    actions.appendChild(editBtn);

    footer.appendChild(actions);

    const info = document.createElement("div");
    const noteSpan = document.createElement("span");
    noteSpan.className = "note-pill";

    let noteText = "";
    const answerInfoNow = selectedAnswers[q.id];
    if (exam.running) {
      noteText = "İmtahan gedir – düzgün/səhv imtahan bitəndə görünəcək.";
    } else if (answerInfoNow) {
      noteText = answerInfoNow.index === q.correctIndex ? "✅ Düzgün cavab vermisən" : "❌ Bu sualda səhvin var idi";
    } else {
      noteText = filterMode === "all" ? "Cavab seçmək üçün variantlardan birinə kliklə" : "Bu rejimdə sualları yenidən 0-dan işləyirsən";
    }
    noteSpan.textContent = noteText;
    info.appendChild(noteSpan);
    footer.appendChild(info);

    card.appendChild(footer);

    // Qeyd bloku
    const noteBlock = document.createElement("div");
    noteBlock.id = "note-" + q.id;
    noteBlock.className = "note-block";
    const existingNote = questionNotes[q.id] || "";
    if (existingNote) noteBlock.classList.add("open");
    noteBlock.innerHTML = `
      <textarea placeholder="Bu sual üçün öz qeydlərini yaz..." rows="2">${existingNote}</textarea>
      <button type="button" class="note-save-btn">Qeydi yadda saxla</button>
    `;
    const textarea = noteBlock.querySelector("textarea");
    const saveBtn = noteBlock.querySelector("button");
    saveBtn.addEventListener("click", () => {
      const val = textarea.value.trim();
      if (val) questionNotes[q.id] = val;
      else delete questionNotes[q.id];
      saveCategoryState();
      renderAll();
    });
    card.appendChild(noteBlock);

    // Correct answer text
    const correctDiv = document.createElement("div");
    correctDiv.id = "correct-answer-" + q.id;
    correctDiv.className = "correct-answer-text";
    correctDiv.textContent = "Düzgün cavab: " + (q.answers[q.correctIndex] || "");
    card.appendChild(correctDiv);

    // Flashcard rejimində swipe ipucu
    if (singleQuestionMode) {
      const hint = document.createElement("div");
      hint.className = "swipe-hint";
      hint.innerHTML = "◀️ sağa/sola sürüşdür: növbəti/əvvəlki";
      card.appendChild(hint);
    }

    container.appendChild(card);
  });
}

function renderPagination() {
  const nav = document.getElementById("pageNavigation");
  if (!nav) return;

  const filtered = getFilteredQuestions();
  if (filtered.length === 0 || !currentCategory) {
    nav.innerHTML = "";
    return;
  }

  const maxPage = Math.max(1, Math.ceil(filtered.length / questionsPerPage));
  const buttons = [];
  for (let p = 1; p <= maxPage; p++) {
    const btn = document.createElement("button");
    btn.textContent = p;
    if (p === currentPage) btn.classList.add("active");
    btn.addEventListener("click", () => {
      currentPage = p;
      renderAll();
      const top = document.querySelector(".quiz-container");
      if (top) top.scrollIntoView({ behavior: "smooth" });
    });
    buttons.push(btn);
  }

  nav.innerHTML = "";
  buttons.forEach((b) => nav.appendChild(b));
}

function renderSidePanel() {
  const statsDiv = document.getElementById("statsInfo");
  const wrongList = document.getElementById("wrongQuestionsList");
  const flaggedList = document.getElementById("flaggedQuestionsList");
  const notedList = document.getElementById("notedQuestionsList");
  const repeatedList = document.getElementById("repeatedMistakesList");
  const editedList = document.getElementById("editedQuestionsList");

  const stats = computeStats();

  if (statsDiv) {
    statsDiv.innerHTML = `
      <span class="label">Ümumi sual:</span><span class="value">${stats.total}</span>
      <span class="label">Cavab verdiyin:</span><span class="value">${stats.answered}</span>
      <span class="label">Düzgün:</span><span class="value" style="color:var(--success);">${stats.correct}</span>
      <span class="label">Səhv:</span><span class="value" style="color:var(--danger);">${stats.wrong}</span>
      <span class="label">Flag:</span><span class="value">${stats.flagged}</span>
    `;
  }

  // Wrong questions
  if (wrongList) {
    wrongList.innerHTML = "";
    if (!wrongQuestions.length) {
      wrongList.classList.add("empty");
      wrongList.textContent = "Səhv sual yoxdur 🎉";
    } else {
      wrongList.classList.remove("empty");
      wrongQuestions.forEach((id) => {
        const btn = document.createElement("button");
        btn.className = "mini-pill";
        btn.textContent = "#" + id;
        btn.addEventListener("click", () => scrollToQuestion(id));
        wrongList.appendChild(btn);
      });
    }
  }

  // Flagged
  if (flaggedList) {
    flaggedList.innerHTML = "";
    if (!flaggedQuestions.length) {
      flaggedList.classList.add("empty");
      flaggedList.textContent = "Heç bir sual işarələnməyib";
    } else {
      flaggedList.classList.remove("empty");
      flaggedQuestions.forEach((id) => {
        const btn = document.createElement("button");
        btn.className = "mini-pill";
        btn.textContent = "#" + id;
        btn.addEventListener("click", () => scrollToQuestion(id));
        flaggedList.appendChild(btn);
      });
    }
  }

  // Noted
  if (notedList) {
    notedList.innerHTML = "";
    const notedIds = Object.keys(questionNotes || {})
      .map((id) => Number(id))
      .sort((a, b) => a - b);
    if (!notedIds.length) {
      notedList.classList.add("empty");
      notedList.textContent = "Qeyd olan sual yoxdur";
    } else {
      notedList.classList.remove("empty");
      notedIds.forEach((id) => {
        const btn = document.createElement("button");
        btn.className = "mini-pill";
        btn.textContent = "#" + id;
        btn.addEventListener("click", () => scrollToQuestion(id));
        notedList.appendChild(btn);
      });
    }
  }

  // Repeated mistakes (2+ wrong)
  if (repeatedList) {
    repeatedList.innerHTML = "";
    const repeated = Object.entries(questionWrongCount || {})
      .filter(([id, count]) => count >= 2)
      .map(([id, count]) => ({ id: Number(id), count }));

    if (!repeated.length) {
      repeatedList.classList.add("empty");
      repeatedList.textContent = "Təkrar səhv etdiyin sual yoxdur";
    } else {
      repeatedList.classList.remove("empty");
      repeated.sort((a, b) => b.count - a.count);
      repeated.forEach((item) => {
        const btn = document.createElement("button");
        btn.className = "mini-pill";
        btn.textContent = "#" + item.id + " · " + item.count + " dəfə";
        btn.addEventListener("click", () => scrollToQuestion(item.id));
        repeatedList.appendChild(btn);
      });
    }
  }

  // Edited questions section
  if (editedList) {
    editedList.innerHTML = "";
    const entries = Object.values(editedQuestions || {}).sort((a, b) => a.id - b.id);
    if (!entries.length) {
      editedList.classList.add("empty");
      editedList.textContent = "";
    } else {
      editedList.classList.remove("empty");
      entries.forEach((entry) => {
        const wrapper = document.createElement("div");
        wrapper.className = "edited-item";

        const header = document.createElement("div");
        header.className = "edited-header";

        const left = document.createElement("div");
        left.textContent = "Sual #" + entry.id;

        const right = document.createElement("div");
        right.textContent =
          entry.active === "after" ? "Aktiv: yeni versiya" : "Aktiv: orijinal";

        header.appendChild(left);
        header.appendChild(right);
        wrapper.appendChild(header);

        const diff = document.createElement("div");
        diff.className = "edited-diff";
        diff.innerHTML =
          "<b>Köhnə:</b> " +
          truncate(entry.before.question, 40) +
          "<br/><b>Yeni:</b> " +
          truncate(entry.after.question, 40);
        wrapper.appendChild(diff);

        const btn = document.createElement("button");
        btn.className = "edited-switch-btn";
        btn.textContent =
          entry.active === "after" ? "Orijinalı bərpa et" : "Dəyişmiş versiyanı aktiv et";
        btn.addEventListener("click", () => toggleEditedVersion(entry.id));
        wrapper.appendChild(btn);

        editedList.appendChild(wrapper);
      });
    }
  }
}

function renderTinyStats() {
  const stats = computeStats();
  const t = document.getElementById("tinyTotal");
  const a = document.getElementById("tinyAnswered");
  const c = document.getElementById("tinyCorrect");
  if (t) t.textContent = stats.total;
  if (a) a.textContent = stats.answered;
  if (c) c.textContent = stats.correct;
}

// İmtahan UI
function updateExamUI() {
  const statusEl = document.getElementById("examStatusText");
  const timerEl = document.getElementById("examTimer");
  const startBtn = document.getElementById("examStartBtn");
  const finishBtn = document.getElementById("examFinishBtn");
  const summaryEl = document.getElementById("examSummary");

  if (!statusEl || !timerEl || !startBtn || !finishBtn || !summaryEl) return;

  if (!currentCategory) {
    statusEl.textContent = "Əvvəlcə soldan bir kateqoriya seç.";
  } else if (exam.running) {
    if (exam.questionIds && exam.questionIds.length) {
      const mins = Math.round(exam.durationSec / 60);
      statusEl.textContent = `İmtahan gedir (${exam.questionIds.length} sual, təxmini ${mins} dəq)`;
    } else {
      statusEl.textContent = "İmtahan gedir...";
    }
  } else if (exam.lastResult) {
    statusEl.textContent = "İmtahan bitdi. Nəticələr aşağıdadır.";
  } else {
    statusEl.textContent = "Praktika rejimindəsən və ya imtahana başlaya bilərsən.";
  }

  if (!currentCategory) {
    timerEl.classList.add("hidden");
    startBtn.classList.add("hidden");
    finishBtn.classList.add("hidden");
  } else if (exam.running) {
    timerEl.classList.remove("hidden");
    startBtn.classList.add("hidden");
    finishBtn.classList.remove("hidden");
  } else {
    timerEl.classList.remove("hidden");
    startBtn.classList.remove("hidden");
    finishBtn.classList.add("hidden");
  }

  if (!exam.running) {
    timerEl.textContent = formatTime(exam.durationSec);
  }

  if (exam.lastResult) {
    const { total, answered, correct, wrong } = exam.lastResult;
    summaryEl.classList.remove("hidden");
    summaryEl.innerHTML = `
      <div><strong>İmtahan nəticəsi</strong></div>
      <div>Ümumi sual: ${total}</div>
      <div>Cavab verdiyin: ${answered}</div>
      <div>Düzgün: ${correct}</div>
      <div>Səhv: ${wrong}</div>
    `;
  } else {
    summaryEl.classList.add("hidden");
    summaryEl.innerHTML = "";
  }
}

// Actions
function onAnswerClick(id, index) {
  const q = allQuestions.find((qq) => qq.id === id);
  if (!q) return;

  selectedAnswers[id] = { index };

  if (index !== q.correctIndex) {
    if (!wrongQuestions.includes(id)) wrongQuestions.push(id);
    questionWrongCount[id] = (questionWrongCount[id] || 0) + 1;
  }

  saveCategoryState();
  renderAll();
}

function toggleFlag(id) {
  if (flaggedQuestions.includes(id)) {
    flaggedQuestions = flaggedQuestions.filter((x) => x !== id);
  } else {
    flaggedQuestions.push(id);
  }
  saveCategoryState();
  renderSidePanel();
  renderQuiz();
}

function removeFromWrong(id) {
  if (!wrongQuestions.includes(id)) return;
  if (!confirm("Bu sualı 'səhv suallar' siyahısından çıxarmaq istəyirsən?")) return;
  wrongQuestions = wrongQuestions.filter((x) => x !== id);
  saveCategoryState();
  renderAll();
}

function toggleCorrectAnswer(id) {
  const el = document.getElementById("correct-answer-" + id);
  if (!el) return;
  el.classList.toggle("visible");
}

function toggleNoteEditor(id) {
  const el = document.getElementById("note-" + id);
  if (!el) return;
  el.classList.toggle("open");
}

function scrollToQuestion(id) {
  const el = document.getElementById("question-" + id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function toggleEditedVersion(id) {
  const entry = editedQuestions[id];
  if (!entry) return;
  const q = allQuestions.find((qq) => qq.id === id);
  if (!q) return;

  if (entry.active === "after") {
    entry.active = "before";
    q.question = entry.before.question;
    q.answers = entry.before.answers.slice();
    q.correctIndex = entry.before.correctIndex;
  } else {
    entry.active = "after";
    q.question = entry.after.question;
    q.answers = entry.after.answers.slice();
    q.correctIndex = entry.after.correctIndex;
  }

  delete selectedAnswers[id];

  saveCategoryState();
  renderAll();
}


function editQuestion(id) {
  if (!isAdmin) {
    alert("Bu funksiyanı istifadə etmək üçün admin girişi lazımdır.");
    adminLoginPrompt();
    return;
  }
  const q = allQuestions.find((qq) => qq.id === id);
  if (!q) return;
  const card = document.getElementById("question-" + id);
  if (!card) return;

  // Daxili redaktə sahəsi
  const originalHTML = card.innerHTML;
  card.dataset.original = originalHTML;

  const makeAnswerRow = (idx, val) => {
    const letter = String.fromCharCode(65 + idx);
    const checked = (idx === q.correctIndex) ? 'checked' : '';
    return `
      <div class="edit-answer-row">
        <label class="edit-letter">${letter}</label>
        <input type="text" class="edit-answer-input" data-idx="${idx}" value="${val.replace(/"/g,'&quot;')}" />
        <label class="edit-correct">
          <input type="radio" name="correct-${id}" value="${idx}" ${checked} /> Düzgün
        </label>
      </div>`;
  };

  card.innerHTML = `
    <div class="edit-area">
      <div class="edit-header">
        <span class="badge">Redaktə rejimi</span>
        <div class="edit-actions">
          <button class="save-btn"><i class="fa fa-save"></i> Yadda saxla</button>
          <button class="cancel-btn"><i class="fa fa-times"></i> Ləğv et</button>
        </div>
      </div>
      <div class="edit-question-block">
        <label>Sual mətni</label>
        <textarea class="edit-question-input" rows="3">${q.question.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
      </div>
      <div class="edit-answers-block">
        ${q.answers.map((a, i) => makeAnswerRow(i, a)).join("")}
      </div>
    </div>
  `;

  const saveBtn = card.querySelector(".save-btn");
  const cancelBtn = card.querySelector(".cancel-btn");

  cancelBtn.addEventListener("click", () => {
    // geri qaytar
    card.innerHTML = card.dataset.original || originalHTML;
    renderAll();
  });

  saveBtn.addEventListener("click", () => {
    const qTextEl = card.querySelector(".edit-question-input");
    const ansEls = Array.from(card.querySelectorAll(".edit-answer-input"));
    const corrEl = card.querySelector('input[name="correct-' + id + '"]:checked');

    const newQuestionText = (qTextEl.value || "").trim();
    const newAnswers = ansEls.map((el) => (el.value || "").trim()).filter(x => x.length);
    const corrIdx = corrEl ? parseInt(corrEl.value, 10) : -1;

    if (!newQuestionText) { alert("Sual mətni boş ola bilməz."); return; }
    if (newAnswers.length < 2) { alert("Ən azı 2 cavab variantı lazımdır."); return; }
    if (corrIdx < 0 || corrIdx >= newAnswers.length) { alert("Düzgün cavabı seç."); return; }

    const before = editedQuestions[id]
      ? editedQuestions[id].before
      : { question: q.question, answers: q.answers.slice(), correctIndex: q.correctIndex };

    const after = { question: newQuestionText, answers: newAnswers, correctIndex: corrIdx };

    editedQuestions[id] = { id, before, after, active: "after", updatedAt: Date.now() };
    // tətbiq et
    q.question = after.question;
    q.answers = after.answers.slice();
    q.correctIndex = after.correctIndex;

    delete selectedAnswers[id];
    saveCategoryState();
    renderAll();
    alert("Sual yerində redaktə olundu ✅");
  });
}

function resetAnswersForCurrentFilter() {
  const filtered = getFilteredQuestions(); // filterMode artıq dəyişib
  filtered.forEach((q) => {
    if (selectedAnswers[q.id]) delete selectedAnswers[q.id];
  });
  saveCategoryState();
}

// Kateqoriya üzrə bütün cavabları sıfırla (imtahan üçün)
function resetAllAnswersInCategory() {
  selectedAnswers = {};
  saveCategoryState();
}

// İmtahan start/finish (heç nəyi dəyişmədim)
function startExam() {
  if (!currentCategory) { alert("Əvvəlcə soldan bir kateqoriya seç."); return; }
  if (exam.running) return;

  const totalQuestions = allQuestions.length;
  if (!totalQuestions) { alert("Bu kateqoriyada sual tapılmadı."); return; }

  let minutesStr = prompt("İmtahan müddəti (dəqiqə):", "30");
  if (minutesStr === null) return;
  let minutes = parseInt(minutesStr, 10);
  if (isNaN(minutes) || minutes <= 0) minutes = 30;

  let countStr = prompt(`İmtahanda neçə sual olsun? (1 - ${totalQuestions})`, String(totalQuestions));
  if (countStr === null) return;
  let qCount = parseInt(countStr, 10);
  if (isNaN(qCount) || qCount <= 0) qCount = totalQuestions;
  if (qCount > totalQuestions) qCount = totalQuestions;

  if (!confirm(`İmtahan başlayır: ${qCount} sual, ${minutes} dəqiqə.\nMövcud cavabların silinəcək. Davam edək?`)) return;

  exam.running = true;
  exam.lastResult = null;
  exam.durationSec = minutes * 60;

  const shuffledIds = shuffleArray(allQuestions.map((q) => q.id));
  exam.questionIds = shuffledIds.slice(0, qCount);

  exam.endTime = Date.now() + exam.durationSec * 1000;

  resetAllAnswersInCategory();

  if (exam.timerId) clearInterval(exam.timerId);
  exam.timerId = setInterval(() => {
    const now = Date.now();
    let remaining = Math.max(0, Math.floor((exam.endTime - now) / 1000));
    const timerEl = document.getElementById("examTimer");
    if (timerEl) timerEl.textContent = formatTime(remaining);
    if (remaining <= 0) {
      finishExam(false);
    }
  }, 1000);

  updateExamUI();
  renderAll();
}

function finishExam(manual) {
  if (!exam.running) return;
  exam.running = false;
  if (exam.timerId) { clearInterval(exam.timerId); exam.timerId = null; }

  let list = allQuestions;
  if (Array.isArray(exam.questionIds) && exam.questionIds.length) {
    const idSet = new Set(exam.questionIds);
    list = allQuestions.filter((q) => idSet.has(q.id));
  }
  const total = list.length;

  let answered = 0, correct = 0, wrong = 0;

  list.forEach((q) => {
    const ans = selectedAnswers[q.id];
    if (!ans) return;
    answered++;
    if (ans.index === q.correctIndex) correct++;
    else wrong++;
  });

  exam.lastResult = { total, answered, correct, wrong };

  updateExamUI();
  renderAll();

  if (manual) {
    alert("İmtahan bitdi. Nəticəni yuxarıdakı paneldə görə bilərsən.");
  }
}

// Category loading
async function selectCategory(filename) {
  currentCategory = filename;
  currentPage = 1;
  filterMode = "all";

  // İmtahanı sıfırla
  exam.running = false;
  exam.lastResult = null;
  exam.questionIds = [];
  if (exam.timerId) { clearInterval(exam.timerId); exam.timerId = null; }

  document.querySelectorAll(".category-btn").forEach((btn) => btn.classList.remove("selected"));
  const activeBtn = document.querySelector(`.category-btn[data-category="${filename}"]`);
  if (activeBtn) activeBtn.classList.add("selected");

  const container = document.getElementById("quizContainer");
  if (container) {
    container.innerHTML = `
      <div class="empty-hint">
        <div class="emoji">⏳</div>
        <p>Suallar yüklənir...</p>
      </div>`;
  }

  try {
    const resp = await fetch(filename);
    if (!resp.ok) throw new Error("Fayl tapılmadı");
    const data = await resp.json();
    allQuestions = (data || []).map((q, idx) => normalizeQuestion(q, idx + 1));

    loadCategoryState();
    applyEditedQuestions();
    recomputeOrderedIds();

    renderAll();
    updateExamUI();
  } catch (e) {
    console.error("Kateqoriya yüklənmədi:", e);
    if (container) {
      container.innerHTML = `
        <div class="empty-hint">
          <div class="emoji">⚠️</div>
          <p>Faylı yükləmək alınmadı: ${filename}</p>
        </div>`;
    }
  }
}

// Reset & clear
function resetCurrentCategory() {
  if (!currentCategory) return;
  if (!confirm("Bu kateqoriyadakı nəticələri sıfırlamaq istəyirsən?")) return;

  selectedAnswers = {};
  wrongQuestions = [];
  flaggedQuestions = [];
  questionWrongCount = {};
  editedQuestions = {};
  questionNotes = {};

  exam.running = false;
  exam.lastResult = null;
  exam.questionIds = [];
  if (exam.timerId) { clearInterval(exam.timerId); exam.timerId = null; }

  localStorage.removeItem(storageKey("selectedAnswers"));
  localStorage.removeItem(storageKey("wrongQuestions"));
  localStorage.removeItem(storageKey("flaggedQuestions"));
  localStorage.removeItem(storageKey("questionWrongCount"));
  localStorage.removeItem(storageKey("editedQuestions"));
  localStorage.removeItem(storageKey("questionNotes"));

  recomputeOrderedIds();
  renderAll();
  updateExamUI();
}

function clearAllData() {
  if (!confirm("BÜTÜN məlumatlar silinəcək. Davam edək?")) return;
  if (!confirm("Əminsən? Bu əməliyyat geri qaytarılmır.")) return;

  localStorage.clear();

  exam.running = false;
  exam.lastResult = null;
  exam.questionIds = [];
  if (exam.timerId) { clearInterval(exam.timerId); exam.timerId = null; }

  location.reload();
}

// Admin login
function adminLoginPrompt() {
  const pwd = prompt("Admin parolu:");
  if (pwd === null) return;
  if (pwd === "drniko") {
    isAdmin = true;
    localStorage.setItem("quiz_isAdmin", "true");
    updateAdminButtonUI();
    alert("Admin rejimi aktivdir.");
  } else {
    alert("Yanlış parol.");
  }
}

function toggleAdminFromButton() {
  if (isAdmin) {
    if (confirm("Admin rejimindən çıxmaq istəyirsən?")) {
      isAdmin = false;
      localStorage.setItem("quiz_isAdmin", "false");
      updateAdminButtonUI();
    }
  } else {
    adminLoginPrompt();
  }
}

function updateAdminButtonUI() {
  const btn = document.getElementById("adminLoginBtn");
  if (!btn) return;
  if (isAdmin) {
    btn.classList.add("admin-on");
    btn.querySelector("span").textContent = "Admin: ON";
  } else {
    btn.classList.remove("admin-on");
    btn.querySelector("span").textContent = "Admin girişi";
  }
}

// Dark mode
function initDarkMode() {
  const darkBtn = document.getElementById("darkModeToggle");
  if (!darkBtn) return;
  const saved = localStorage.getItem("quiz_darkMode");
  if (saved === "on") {
    document.body.classList.add("dark-mode");
  }
  updateDarkButtonUI();

  darkBtn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-mode");
    localStorage.setItem("quiz_darkMode", isDark ? "on" : "off");
    updateDarkButtonUI();
  });
}

function updateDarkButtonUI() {
  const darkBtn = document.getElementById("darkModeToggle");
  if (!darkBtn) return;
  const icon = darkBtn.querySelector("i");
  const span = darkBtn.querySelector("span");
  const isDark = document.body.classList.contains("dark-mode");
  if (isDark) {
    if (icon) icon.className = "fa fa-sun";
    if (span) span.textContent = "İşıqlı rejim";
  } else {
    if (icon) icon.className = "fa fa-moon";
    if (span) span.textContent = "Qaranlıq rejim";
  }
}

// ===== Flashcard UI və Naviqasiya =====
function updateFlashcardUI() {
  const controls = document.getElementById("flashcardControls");
  const body = document.body;
  if (singleQuestionMode) {
    body.classList.add("flashcard-mode");
    if (controls) controls.classList.remove("hidden");
  } else {
    body.classList.remove("flashcard-mode");
    if (controls) controls.classList.add("hidden");
  }

  // Sayğac
  const filtered = getFilteredQuestions();
  const counter = document.getElementById("cardCounter");
  if (counter && filtered.length) {
    counter.textContent = `${currentPage}/${Math.max(1, Math.ceil(filtered.length / questionsPerPage))}`;
  }
}

function goNextCard() {
  const filtered = getFilteredQuestions();
  const maxPage = Math.max(1, Math.ceil(filtered.length / questionsPerPage));
  currentPage = Math.min(maxPage, currentPage + 1);
  renderAll();
}
function goPrevCard() {
  currentPage = Math.max(1, currentPage - 1);
  renderAll();
}

function attachSwipeHandlers() {
  const area = document.getElementById("quizContainer");
  if (!area) return;

  let startX = 0, startY = 0, isTouch = false;
  area.addEventListener("touchstart", (e) => {
    if (!singleQuestionMode) return;
    isTouch = true;
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
  }, {passive:true});

  area.addEventListener("touchend", (e) => {
    if (!singleQuestionMode || !isTouch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > 40 && Math.abs(dy) < 40) {
      if (dx < 0) goNextCard(); else goPrevCard();
    }
    isTouch = false;
  });

  // Klaviatura oxları
  document.addEventListener("keydown", (e) => {
    if (!singleQuestionMode) return;
    if (e.key === "ArrowRight") goNextCard();
    else if (e.key === "ArrowLeft") goPrevCard();
  });
}

// ===== PWA Install düyməsi =====
let deferredPrompt = null;
function initPWAInstall(){
  const btn = document.getElementById('installBtn');
  const show = ()=>{ if(btn) btn.classList.remove('hidden'); };
  const hide = ()=>{ if(btn) btn.classList.add('hidden'); };
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) hide();
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    show();
  });
  window.addEventListener('appinstalled', hide);
  if (btn){
    btn.addEventListener('click', async ()=>{
      if (!deferredPrompt){
        try{ showSyncStatus('Quraşdırma hazır deyil. iOS: Share → Add to Home Screen.', true);}catch(_){ }
        return;
      }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      hide();
    });
  }
}
// Init
// ===== Sync controls UI helpers =====
function setSyncUIEnabled(enabled){
  const up = document.getElementById('syncUpBtn');
  const down = document.getElementById('pullDownBtn');
  if (up) up.disabled = !enabled;
  if (down) down.disabled = !enabled;
}
function showSyncStatus(text, isError){
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = text || '';
  el.style.background = isError ? 'rgba(239,68,68,0.15)' : '';
  el.style.borderColor = isError ? '#ef4444' : '';
}

document.addEventListener("DOMContentLoaded", () => {
  initFirebaseAuth();

  // Prev/Next flashcard düymələri
  const prevBtn = document.getElementById("prevCard");
  const nextBtn = document.getElementById("nextCard");
  if (prevBtn) prevBtn.addEventListener("click", () => { goPrevCard(); updateFlashcardUI(); });
  if (nextBtn) nextBtn.addEventListener("click", () => { goNextCard(); updateFlashcardUI(); });

  // Üstdəki "🗂️ Flashcard" üzən düymə
  const floatFlashBtn = document.getElementById("flashcardFloatingToggle");
  if (floatFlashBtn) {
    const syncLabel = () => {
      floatFlashBtn.textContent = "🗂️ " + (singleQuestionMode ? "Flashcard ON" : "Flashcard");
    };
    syncLabel();
    floatFlashBtn.addEventListener("click", () => {
      singleQuestionMode = !singleQuestionMode;
      const sqToggleEl = document.getElementById("singleQuestionModeToggle");
      if (sqToggleEl) sqToggleEl.checked = singleQuestionMode;
      questionsPerPage = singleQuestionMode ? 1 : baseQuestionsPerPage;
      currentPage = 1;
      recomputeOrderedIds();
      renderAll();
      updateFlashcardUI();
      syncLabel();
    });
  }

 
  // Start button
  const startBtn = document.getElementById("startBtn");
  const welcome = document.getElementById("welcomeScreen");
  const main = document.getElementById("mainContent");
  if (startBtn && welcome && main) {
    startBtn.addEventListener("click", () => {
      const fbtn = document.getElementById('flashcardFloatingToggle');
      if (fbtn) fbtn.classList.remove('hidden');

      welcome.style.display = "none";
      main.style.display = "block";
      appStarted = true;
      const evt = new Event("app-started");
      document.dispatchEvent(evt);
      const floatBtn = document.getElementById("flashcardFloatingToggle");
      if (floatBtn) floatBtn.classList.remove("hidden");
    });
  }
  // Category buttons
  document.querySelectorAll(".category-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const file = btn.getAttribute("data-category");
      if (file) selectCategory(file);
    });
  });

  // Quiz filter düymələri
  document.querySelectorAll(".quiz-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-filter") || "all";
      filterMode = mode;
      if (mode === "wrong" || mode === "flagged") resetAnswersForCurrentFilter();

      document.querySelectorAll(".quiz-filter-btn").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );

      currentPage = 1;
      recomputeOrderedIds();
      renderAll();
    });
  });

  // Questions per page
  const select = document.getElementById("questionsPerPage");
  if (select) {
    const saved = parseInt(localStorage.getItem("quiz_questionsPerPage") || "10", 10);
    if (!isNaN(saved)) {
      baseQuestionsPerPage = saved;
      questionsPerPage = saved;
      select.value = String(saved);
    }
    select.addEventListener("change", updateQuestionsPerPageFromSelect);
  }

  // Single question mode (flashcard)
  const sqToggle = document.getElementById("singleQuestionModeToggle");
  if (sqToggle) {
    sqToggle.addEventListener("change", () => {
      singleQuestionMode = sqToggle.checked;
      questionsPerPage = singleQuestionMode ? 1 : baseQuestionsPerPage;
      currentPage = 1;
      recomputeOrderedIds();
      renderAll();
    });
  }

  // Order mode radio (Ardıcıl/Random)
  document.querySelectorAll('input[name="orderMode"]').forEach((r) => {
    r.addEventListener("change", () => {
      flashOrderMode = r.value;
      if (singleQuestionMode) {
        recomputeOrderedIds();
        renderAll();
      }
    });
  });
  document.querySelectorAll('input[name="quizOrder"]').forEach(radio => {
    radio.addEventListener('change', function() {
      renderAll();
    });
  });

  // Search
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value || "";
      currentPage = 1;
      recomputeOrderedIds();
      renderAll();
    });
  }

  // Reset & clear
  const resetBtn = document.getElementById("categoryResetBtn");
  if (resetBtn) resetBtn.addEventListener("click", resetCurrentCategory);
  const clearBtn = document.getElementById("clearAllBtn");
  if (clearBtn) clearBtn.addEventListener("click", clearAllData);

  // Yan panel toggle
  const sideToggle = document.getElementById("sidePanelToggle");
  if (sideToggle) {
    sideToggle.addEventListener("click", () => {
      document.body.classList.toggle("side-collapsed");
    });
  }

  // İmtahan düymələri
  const examStartBtn = document.getElementById("examStartBtn");
  if (examStartBtn) {
    examStartBtn.classList.remove("hidden");
    examStartBtn.addEventListener("click", () => startExam());
  }
  const examFinishBtn = document.getElementById("examFinishBtn");
  if (examFinishBtn) {
    examFinishBtn.addEventListener("click", () => {
      if (!exam.running) return;
      if (!confirm("İmtahanı bitirmək istəyirsən?")) return;
      finishExam(true);
    });
  }
  updateExamUI();

  // Admin button
  const adminBtn = document.getElementById("adminLoginBtn");
  if (adminBtn) adminBtn.addEventListener("click", toggleAdminFromButton);
  isAdmin = localStorage.getItem("quiz_isAdmin") === "true";
  updateAdminButtonUI();

  // Dark mode
  initDarkMode();

  // Tiny stats
  renderTinyStats();

  // Flashcard swipe/keys
  attachSwipeHandlers();

  // Service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("sw.js")
      .catch((err) => console.warn("Service worker qeydiyyatdan keçmədi:", err));
  }

  // PWA install
  initPWAInstall();
});

function toggleMobileMode() {
  document.body.classList.toggle('flashcard-mode');
}
