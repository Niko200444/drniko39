// filepath: /mnt/data/app.js

// ---------- Storage helpers ----------
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ---------- Firebase (optional) ----------
let FB = { app:null, auth:null, db:null, user:null };
function firebaseAvailable(){
  return typeof window !== 'undefined'
    && window.firebase && window.FIREBASE_CONFIG
    && window.FIREBASE_CONFIG.apiKey
    && !String(window.FIREBASE_CONFIG.apiKey).includes("PASTE_");
}
function initFirebaseAuth(){
  try{
    if(!firebaseAvailable()) return;
    if (!FB.app) FB.app = firebase.initializeApp(window.FIREBASE_CONFIG);
    if (!FB.auth) FB.auth = firebase.auth();
    if (!FB.db) FB.db = firebase.firestore();
    FB.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    FB.auth.onAuthStateChanged(async (u)=>{
      FB.user = u || null;
      updateAuthUI();
      if (FB.user) { try{ await loadRemoteState(); }catch{} }
    });
    const gbtn = document.getElementById("googleSignInBtn");
    const sbtn = document.getElementById("signOutBtn");
    if (gbtn) gbtn.addEventListener("click", async ()=>{
      try{
        const provider = new firebase.auth.GoogleAuthProvider();
        await FB.auth.signInWithPopup(provider);
      }catch(err){ alert("Giriş alınmadı: " + err.message); }
    });
    if (sbtn) sbtn.addEventListener("click", ()=> FB.auth.signOut());
  }catch{}
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
    if (nameEl) nameEl.textContent = FB.user.displayName || FB.user.email || "İstifadəçi";
    if (photoEl){
      if (FB.user.photoURL){ photoEl.src = FB.user.photoURL; photoEl.classList.remove("hidden"); }
      else photoEl.classList.add("hidden");
    }
  } else {
    gbtn.classList.remove("hidden");
    badge.classList.add("hidden");
  }
}
function collectLocalState(){
  const data = {};
  for (let i=0;i<localStorage.length;i++){
    const k = localStorage.key(i); if (!k) continue;
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
function debounce(fn, wait){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }
const saveRemoteStateDebounced = debounce(saveRemoteState, 1200);
async function loadRemoteState(){
  if (!FB.user || !FB.db) return;
  const ref = FB.db.collection("users").doc(FB.user.uid).collection("appState").doc("state");
  const snap = await ref.get();
  if (!snap.exists) return;
  const remote = snap.data().data || {};
  Object.keys(remote).forEach((k)=>{
    try{ localStorage.setItem(k, JSON.stringify(remote[k])); }
    catch{ localStorage.setItem(k, String(remote[k])); }
  });
  loadCategoryState();
  renderAll();
}

// ---------- Utils ----------
function hashString(s){ let h=5381; for (let i=0;i<s.length;i++){ h=((h<<5)+h)+s.charCodeAt(i); h|=0; } return h>>>0; }
function mulberry32(a){ return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function stableShuffle(arr, seed){
  const a=arr.slice(); const rnd=mulberry32(seed);
  for (let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function shuffleArray(arr){ const a=arr.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function truncate(t,m){ if(!t) return ""; return t.length>m?t.slice(0,m)+"…":t; }
function formatTime(x){ const m=Math.floor(x/60), s=x%60; return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"); }

// ---------- State ----------
let allQuestions = [];
let currentCategory = null;
let currentPage = 1;
let questionsPerPage = 10;
let baseQuestionsPerPage = 10;
let singleQuestionMode = false;
let searchQuery = "";
let filterMode = "all"; // all | wrong | flagged | noted

let selectedAnswers = {};
let wrongQuestions = [];
let flaggedQuestions = [];
let questionWrongCount = {};
let editedQuestions = {};
let questionNotes = {};

let isAdmin = false;
let autoSyncEnabled = localStorage.getItem('quiz_autoSync') === '1';

let flashOrderMode = "sequential"; // "sequential" | "random"
let orderedIds = [];
let randomOrderIds = [];

let exam = { running:false, durationSec:1800, endTime:null, timerId:null, lastResult:null, questionIds:[] };

// ---------- Helpers ----------
function storageKey(name){ return currentCategory ? ("quiz_"+currentCategory+"_"+name) : ("quiz_global_"+name); }

function normalizeQuestion(raw, index){
  const originalAnswers = Array.isArray(raw.answers) ? raw.answers.slice() : [];
  const correctAnswer = originalAnswers[0] || "";
  const seed = hashString((raw.question||"")+"|"+originalAnswers.join("||"));
  const shuffled = stableShuffle(originalAnswers, seed);
  let correctIndex = Math.max(0, shuffled.indexOf(correctAnswer));
  return { id:index, question: raw.question||"", answers: shuffled, correctIndex };
}

function applyEditedQuestions(){
  Object.values(editedQuestions||{}).forEach((e)=>{
    const q = allQuestions.find(qq=>qq.id===e.id); if(!q) return;
    const src = e.active==="before" ? e.before : e.after;
    q.question = src.question; q.answers = src.answers.slice(); q.correctIndex = src.correctIndex;
  });
}

function loadCategoryState(){
  selectedAnswers     = loadJSON(storageKey("selectedAnswers"), {});
  wrongQuestions      = loadJSON(storageKey("wrongQuestions"), []);
  flaggedQuestions    = loadJSON(storageKey("flaggedQuestions"), []);
  questionWrongCount  = loadJSON(storageKey("questionWrongCount"), {});
  editedQuestions     = loadJSON(storageKey("editedQuestions"), {});
  questionNotes       = loadJSON(storageKey("questionNotes"), {});
}
function saveCategoryState(){
  saveJSON(storageKey("selectedAnswers"), selectedAnswers);
  saveJSON(storageKey("wrongQuestions"), wrongQuestions);
  saveJSON(storageKey("flaggedQuestions"), flaggedQuestions);
  saveJSON(storageKey("questionWrongCount"), questionWrongCount);
  saveJSON(storageKey("editedQuestions"), editedQuestions);
  saveJSON(storageKey("questionNotes"), questionNotes);
  try{ if (autoSyncEnabled && FB.user) saveRemoteStateDebounced(); }catch{}
}

// ---------- Stats ----------
function _resolveSelectedIndex(q, info){
  if (!info) return -1;
  if (typeof info.value === "string"){
    const idx = q.answers.indexOf(info.value);
    return idx>=0 ? idx : (typeof info.index==="number" ? info.index : -1);
  }
  return (typeof info.index==="number") ? info.index : -1;
}
function computeStats(){
  const total = allQuestions.length;
  const answered = Object.keys(selectedAnswers).length;
  let correct=0, wrong=0;
  for (const [idStr, info] of Object.entries(selectedAnswers)){
    const id = Number(idStr); const q = allQuestions.find(qq=>qq.id===id); if(!q) continue;
    const idx = _resolveSelectedIndex(q, info); if (idx===-1) continue;
    if (idx===q.correctIndex) correct++; else wrong++;
  }
  return { total, answered, correct, wrong, flagged: flaggedQuestions.length };
}

// ---------- Filtering / ordering ----------
function getFilteredQuestionsRaw(){
  let list = allQuestions.slice();
  const query = (searchQuery||"").trim().toLowerCase();

  if (query){
    list = list.filter((q)=>{
      if ((q.question||"").toLowerCase().includes(query)) return true;
      return (q.answers||[]).some(a=>a.toLowerCase().includes(query));
    });
  }

  if (filterMode === "wrong")   list = list.filter(q=>wrongQuestions.includes(q.id));
  if (filterMode === "flagged") list = list.filter(q=>flaggedQuestions.includes(q.id));
  if (filterMode === "noted")   list = list.filter(q=>!!questionNotes[q.id]);

  // Normal rejimdə random sıralama üçün stabil sıra saxlayırıq (flashcard deyil)
  if (!singleQuestionMode){
    const orderRadio = document.querySelector('input[name="quizOrder"]:checked');
    if (orderRadio && orderRadio.value === "random"){
      const ids = list.map(q=>q.id);
      const same = (randomOrderIds.length===ids.length) && ids.every(id=>randomOrderIds.includes(id));
      if (!same) randomOrderIds = shuffleArray(ids);
      list = randomOrderIds.map(id => list.find(q=>q.id===id)).filter(Boolean);
    } else {
      randomOrderIds = [];
    }
  }
  return list;
}
function recomputeOrderedIds(){
  const ids = getFilteredQuestionsRaw().map(q=>q.id);
  if (!singleQuestionMode){ orderedIds = ids; return; }
  orderedIds = (flashOrderMode === "random") ? shuffleArray(ids) : ids;
  currentPage = 1;
}
function getFilteredQuestions(){
  const raw = getFilteredQuestionsRaw();
  if (!singleQuestionMode) return raw;
  const set = new Set(orderedIds);
  return raw.filter(q=>set.has(q.id))
            .sort((a,b)=>orderedIds.indexOf(a.id)-orderedIds.indexOf(b.id));
}

// ---------- Render ----------
function renderAll(){ renderQuiz(); renderPagination(); renderSidePanel(); renderTinyStats(); updateFlashcardUI(); }

function renderQuiz(){
  const container = document.getElementById("quizContainer"); if(!container) return;
  const filtered = getFilteredQuestions();

  if (!currentCategory){
    container.innerHTML = `<div class="empty-hint"><div class="emoji">👈</div><p>Soldan bir kateqoriya seç</p></div>`;
    return;
  }
  if (!filtered.length){
    container.innerHTML = `<div class="empty-hint"><div class="emoji">🔍</div><p>Bu axtarış / rejim üçün sual tapılmadı.</p></div>`;
    return;
  }

  questionsPerPage = singleQuestionMode ? 1 : baseQuestionsPerPage;
  const maxPage = Math.max(1, Math.ceil(filtered.length / questionsPerPage));
  if (currentPage > maxPage) currentPage = maxPage;

  const start = (currentPage-1)*questionsPerPage;
  const end = Math.min(start+questionsPerPage, filtered.length);
  const pageQuestions = filtered.slice(start, end);

  container.innerHTML = "";
  pageQuestions.forEach((q)=>{
    const card = document.createElement("div");
    card.className = "question"; card.id = "question-"+q.id;

    const header = document.createElement("div"); header.className = "question-header";
    const title = document.createElement("div");
    const num = document.createElement("span"); num.className="question-number"; num.textContent = q.id+".";
    const tt = document.createElement("span"); tt.textContent = q.question;
    title.appendChild(num); title.appendChild(tt);

    const meta = document.createElement("div"); meta.className="question-meta";
    const wc = questionWrongCount[q.id]||0; if (wc>0){ const s=document.createElement("span"); s.innerHTML=`<i class="fa fa-fire"></i> ${wc} səhv`; meta.appendChild(s); }
    if (flaggedQuestions.includes(q.id)){ const s=document.createElement("span"); s.innerHTML=`<i class="fa fa-flag"></i> flag`; meta.appendChild(s); }
    if (editedQuestions[q.id]){ const s=document.createElement("span"); s.innerHTML=`<i class="fa fa-pen"></i> dəyişib`; meta.appendChild(s); }

    header.appendChild(title); header.appendChild(meta); card.appendChild(header);

    const answersDiv = document.createElement("div"); answersDiv.className="answers";
    const info = selectedAnswers[q.id];
    const selIdx = _resolveSelectedIndex(q, info);

    q.answers.forEach((ans, idx)=>{
      const btn = document.createElement("button"); btn.className="answer-btn";
      const letter = document.createElement("span"); letter.className="answer-letter"; letter.textContent=String.fromCharCode(65+idx);
      const text = document.createElement("span"); text.textContent = ans;
      btn.appendChild(letter); btn.appendChild(text);
      if (info){
        if (exam.running){ if (idx===selIdx) btn.classList.add("exam-selected"); }
        else if (idx===selIdx){ (idx===q.correctIndex?btn.classList.add("correct"):btn.classList.add("wrong")); }
      }
      btn.addEventListener("click", ()=> onAnswerClick(q.id, idx));
      answersDiv.appendChild(btn);
    });
    card.appendChild(answersDiv);

    const footer = document.createElement("div"); footer.className="question-footer";
    const actions = document.createElement("div"); actions.className="question-actions";

    const flagBtn = document.createElement("button"); flagBtn.className="icon-btn"; if (flaggedQuestions.includes(q.id)) flagBtn.classList.add("flagged");
    flagBtn.innerHTML = `<i class="fa fa-flag"></i> Flag`; flagBtn.addEventListener("click", ()=> toggleFlag(q.id)); actions.appendChild(flagBtn);

    const showBtn = document.createElement("button"); showBtn.className="icon-btn";
    showBtn.innerHTML = `<i class="fa fa-check-circle"></i> Düzgün cavab`; showBtn.addEventListener("click", ()=> toggleCorrectAnswer(q.id)); actions.appendChild(showBtn);

    const noteBtn = document.createElement("button"); noteBtn.className="icon-btn"; if (questionNotes[q.id]) noteBtn.classList.add("has-note");
    noteBtn.innerHTML = `<i class="fa fa-sticky-note"></i> Qeyd`; noteBtn.addEventListener("click", ()=> toggleNoteEditor(q.id)); actions.appendChild(noteBtn);

    if (wrongQuestions.includes(q.id)){
      const rmWrongBtn = document.createElement("button"); rmWrongBtn.className="icon-btn";
      rmWrongBtn.innerHTML=`<i class="fa fa-minus-circle"></i> Səhv siyahısından çıxar`; rmWrongBtn.addEventListener("click", ()=> removeFromWrong(q.id)); actions.appendChild(rmWrongBtn);
    }

    const editBtn = document.createElement("button"); editBtn.className="icon-btn admin-only";
    editBtn.innerHTML = `<i class="fa fa-pen"></i> Redaktə (admin)`; editBtn.addEventListener("click", ()=> editQuestion(q.id)); actions.appendChild(editBtn);

    footer.appendChild(actions);

    const infoPillWrap = document.createElement("div");
    const pill = document.createElement("span"); pill.className="note-pill";
    if (exam.running) pill.textContent="İmtahan gedir – nəticə imtahandan sonra görünəcək.";
    else if (info && selIdx!==-1) pill.textContent = (selIdx===q.correctIndex) ? "✅ Düzgün cavab vermisən" : "❌ Bu sualda səhvin var idi";
    else pill.textContent="Cavab seçmək üçün variantlardan birinə kliklə";
    infoPillWrap.appendChild(pill);
    footer.appendChild(infoPillWrap);

    card.appendChild(footer);

    const noteBlock = document.createElement("div"); noteBlock.id="note-"+q.id; noteBlock.className="note-block";
    const existingNote = questionNotes[q.id] || ""; if (existingNote) noteBlock.classList.add("open");
    noteBlock.innerHTML = `<textarea placeholder="Qeyd..." rows="2">${existingNote}</textarea><button type="button" class="note-save-btn">Qeydi yadda saxla</button>`;
    const textarea = noteBlock.querySelector("textarea"); const saveBtn = noteBlock.querySelector("button");
    saveBtn.addEventListener("click", ()=>{
      const val = textarea.value.trim(); if (val) questionNotes[q.id]=val; else delete questionNotes[q.id];
      saveCategoryState(); renderAll();
    });
    card.appendChild(noteBlock);

    const correctDiv = document.createElement("div"); correctDiv.id="correct-answer-"+q.id; correctDiv.className="correct-answer-text";
    correctDiv.textContent = "Düzgün cavab: " + (q.answers[q.correctIndex]||"");
    card.appendChild(correctDiv);

    if (singleQuestionMode){
      const hint = document.createElement("div"); hint.className="swipe-hint"; hint.innerHTML="◀️ sağa/sola sürüşdür: növbəti/əvvəlki";
      card.appendChild(hint);
    }

    container.appendChild(card);
  });
}

function renderPagination(){
  const nav = document.getElementById("pageNavigation"); if(!nav) return;
  const filtered = getFilteredQuestions(); if (!filtered.length || !currentCategory){ nav.innerHTML=""; return; }
  const maxPage = Math.max(1, Math.ceil(filtered.length / questionsPerPage));
  const frag = document.createDocumentFragment();
  for (let p=1;p<=maxPage;p++){
    const btn = document.createElement("button"); btn.textContent = p;
    if (p===currentPage) btn.classList.add("active");
    btn.addEventListener("click", ()=>{ currentPage=p; renderAll(); const top=document.querySelector(".quiz-container"); if(top) top.scrollIntoView({behavior:"smooth"}); });
    frag.appendChild(btn);
  }
  nav.innerHTML=""; nav.appendChild(frag);
}

function renderSidePanel(){
  const statsDiv = document.getElementById("statsInfo");
  const wrongList = document.getElementById("wrongQuestionsList");
  const flaggedList = document.getElementById("flaggedQuestionsList");
  const notedList = document.getElementById("notedQuestionsList");
  const repeatedList = document.getElementById("repeatedMistakesList");
  const editedList = document.getElementById("editedQuestionsList");

  const s = computeStats();
  if (statsDiv){
    statsDiv.innerHTML = `
      <span class="label">Ümumi sual:</span><span class="value">${s.total}</span>
      <span class="label">Cavab verdiyin:</span><span class="value">${s.answered}</span>
      <span class="label">Düzgün:</span><span class="value" style="color:var(--success);">${s.correct}</span>
      <span class="label">Səhv:</span><span class="value" style="color:var(--danger);">${s.wrong}</span>
      <span class="label">Flag:</span><span class="value">${s.flagged}</span>
    `;
  }

  if (wrongList){
    wrongList.innerHTML=""; 
    if (!wrongQuestions.length){ wrongList.classList.add("empty"); wrongList.textContent="Səhv sual yoxdur 🎉"; }
    else {
      wrongList.classList.remove("empty");
      wrongQuestions.forEach(id=>{ const b=document.createElement("button"); b.className="mini-pill"; b.textContent="#"+id; b.addEventListener("click",()=>scrollToQuestion(id)); wrongList.appendChild(b); });
    }
  }

  if (flaggedList){
    flaggedList.innerHTML="";
    if (!flaggedQuestions.length){ flaggedList.classList.add("empty"); flaggedList.textContent="Heç bir sual işarələnməyib"; }
    else {
      flaggedList.classList.remove("empty");
      flaggedQuestions.forEach(id=>{ const b=document.createElement("button"); b.className="mini-pill"; b.textContent="#"+id; b.addEventListener("click",()=>scrollToQuestion(id)); flaggedList.appendChild(b); });
    }
  }

  if (notedList){
    notedList.innerHTML="";
    const ids = Object.keys(questionNotes||{}).map(Number).sort((a,b)=>a-b);
    if (!ids.length){ notedList.classList.add("empty"); notedList.textContent="Qeyd olan sual yoxdur"; }
    else {
      notedList.classList.remove("empty");
      ids.forEach(id=>{ const b=document.createElement("button"); b.className="mini-pill"; b.textContent="#"+id; b.addEventListener("click",()=>scrollToQuestion(id)); notedList.appendChild(b); });
    }
  }

  if (repeatedList){
    repeatedList.innerHTML="";
    const rep = Object.entries(questionWrongCount||{}).filter(([_,c])=>c>=2).map(([id,c])=>({id:Number(id), c}));
    if (!rep.length){ repeatedList.classList.add("empty"); repeatedList.textContent="Təkrar səhv etdiyin sual yoxdur"; }
    else {
      repeatedList.classList.remove("empty");
      rep.sort((a,b)=>b.c-a.c).forEach(it=>{ const b=document.createElement("button"); b.className="mini-pill"; b.textContent=`#${it.id} · ${it.c} dəfə`; b.addEventListener("click",()=>scrollToQuestion(it.id)); repeatedList.appendChild(b); });
    }
  }

  if (editedList){
    editedList.innerHTML="";
    const entries = Object.values(editedQuestions||{}).sort((a,b)=>a.id-b.id);
    if (!entries.length){ editedList.classList.add("empty"); editedList.textContent=""; }
    else {
      editedList.classList.remove("empty");
      entries.forEach(e=>{
        const wrap=document.createElement("div"); wrap.className="edited-item";
        const header=document.createElement("div"); header.className="edited-header";
        const left=document.createElement("div"); left.textContent="Sual #"+e.id;
        const right=document.createElement("div"); right.textContent= e.active==="after" ? "Aktiv: yeni versiya" : "Aktiv: orijinal";
        header.appendChild(left); header.appendChild(right); wrap.appendChild(header);
        const diff=document.createElement("div"); diff.className="edited-diff";
        diff.innerHTML = "<b>Köhnə:</b> "+truncate(e.before.question,40)+"<br/><b>Yeni:</b> "+truncate(e.after.question,40);
        wrap.appendChild(diff);
        const btn=document.createElement("button"); btn.className="edited-switch-btn";
        btn.textContent = e.active==="after" ? "Orijinalı bərpa et" : "Dəyişmiş versiyanı aktiv et";
        btn.addEventListener("click",()=>toggleEditedVersion(e.id));
        wrap.appendChild(btn);
        editedList.appendChild(wrap);
      });
    }
  }
}

function renderTinyStats(){
  const s = computeStats();
  const t=document.getElementById("tinyTotal"); const a=document.getElementById("tinyAnswered"); const c=document.getElementById("tinyCorrect");
  if (t) t.textContent = s.total; if (a) a.textContent = s.answered; if (c) c.textContent = s.correct;
}

// ---------- Exam ----------
function updateExamUI(){
  const statusEl = document.getElementById("examStatusText");
  const timerEl = document.getElementById("examTimer");
  const startBtn = document.getElementById("examStartBtn");
  const finishBtn = document.getElementById("examFinishBtn");
  const summaryEl = document.getElementById("examSummary");
  if (!statusEl || !timerEl || !startBtn || !finishBtn || !summaryEl) return;

  if (!currentCategory) statusEl.textContent = "Əvvəlcə soldan bir kateqoriya seç.";
  else if (exam.running) statusEl.textContent = "İmtahan gedir...";
  else if (exam.lastResult) statusEl.textContent = "İmtahan bitdi. Nəticələr aşağıdadır.";
  else statusEl.textContent = "Praktika rejimindəsən və ya imtahana başla.";

  if (!currentCategory){ timerEl.classList.add("hidden"); startBtn.classList.add("hidden"); finishBtn.classList.add("hidden"); }
  else if (exam.running){ timerEl.classList.remove("hidden"); startBtn.classList.add("hidden"); finishBtn.classList.remove("hidden"); }
  else { timerEl.classList.remove("hidden"); startBtn.classList.remove("hidden"); finishBtn.classList.add("hidden"); }

  if (!exam.running) timerEl.textContent = formatTime(exam.durationSec);

  if (exam.lastResult){
    const { total, answered, correct, wrong } = exam.lastResult;
    summaryEl.classList.remove("hidden");
    summaryEl.innerHTML = `<div><strong>İmtahan nəticəsi</strong></div><div>Ümumi sual: ${total}</div><div>Cavab verdiyin: ${answered}</div><div>Düzgün: ${correct}</div><div>Səhv: ${wrong}</div>`;
  } else { summaryEl.classList.add("hidden"); summaryEl.innerHTML=""; }
}

function startExam(){
  if (!currentCategory){ alert("Əvvəlcə soldan bir kateqoriya seç."); return; }
  if (exam.running) return;
  const totalQuestions = allQuestions.length; if (!totalQuestions){ alert("Bu kateqoriyada sual tapılmadı."); return; }
  let minutesStr = prompt("İmtahan müddəti (dəqiqə):", "30"); if (minutesStr===null) return;
  let minutes = parseInt(minutesStr,10); if (isNaN(minutes)||minutes<=0) minutes=30;
  let countStr = prompt(`İmtahanda neçə sual olsun? (1 - ${totalQuestions})`, String(totalQuestions)); if (countStr===null) return;
  let qCount = parseInt(countStr,10); if (isNaN(qCount)||qCount<=0) qCount = totalQuestions; if (qCount>totalQuestions) qCount=totalQuestions;

  if (!confirm(`İmtahan başlayır: ${qCount} sual, ${minutes} dəqiqə.\nMövcud cavabların silinəcək. Davam edək?`)) return;

  exam.running = true; exam.lastResult = null; exam.durationSec = minutes*60;
  const shuffledIds = shuffleArray(allQuestions.map(q=>q.id));
  exam.questionIds = shuffledIds.slice(0, qCount);
  exam.endTime = Date.now() + exam.durationSec*1000;

  // İmtahan zamanı nizamlılıq üçün cavabları təmizləyirik (tələbin xaricindədir; istəsən bunu da saxlayım)
  selectedAnswers = {}; saveCategoryState();

  if (exam.timerId) clearInterval(exam.timerId);
  exam.timerId = setInterval(()=>{
    const now=Date.now(); let remaining = Math.max(0, Math.floor((exam.endTime-now)/1000));
    const timerEl = document.getElementById("examTimer"); if (timerEl) timerEl.textContent = formatTime(remaining);
    if (remaining<=0) finishExam(false);
  }, 1000);

  updateExamUI(); renderAll();
}
function finishExam(manual){
  if (!exam.running) return;
  exam.running = false; if (exam.timerId){ clearInterval(exam.timerId); exam.timerId=null; }
  let list = allQuestions;
  if (Array.isArray(exam.questionIds) && exam.questionIds.length){
    const set = new Set(exam.questionIds); list = allQuestions.filter(q=>set.has(q.id));
  }
  const total = list.length; let answered=0, correct=0, wrong=0;
  list.forEach((q)=>{
    const ans = selectedAnswers[q.id]; if (!ans) return;
    const idx = _resolveSelectedIndex(q, ans); if (idx===-1) return;
    answered++; if (idx===q.correctIndex) correct++; else wrong++;
  });
  exam.lastResult = { total, answered, correct, wrong };
  updateExamUI(); renderAll();
  if (manual) alert("İmtahan bitdi. Nəticəni yuxarıdakı paneldə görə bilərsən.");
}

// ---------- Actions ----------
function updateQuestionCardVisuals(id){
  const q = allQuestions.find(qq=>qq.id===id); if(!q) return;
  const card = document.getElementById("question-"+id); if(!card) return;
  const buttons = card.querySelectorAll(".answers .answer-btn");
  const info = selectedAnswers[id]; const selIdx = _resolveSelectedIndex(q, info);
  buttons.forEach((btn, idx)=>{
    btn.classList.remove("correct","wrong","exam-selected");
    if (info){
      if (exam.running){ if (idx===selIdx) btn.classList.add("exam-selected"); }
      else if (idx===selIdx){ (idx===q.correctIndex?btn.classList.add("correct"):btn.classList.add("wrong")); }
    }
  });
  const pill = card.querySelector(".question-footer .note-pill");
  if (pill){
    if (exam.running) pill.textContent="İmtahan gedir – nəticə imtahandan sonra görünəcək.";
    else if (info && selIdx!==-1) pill.textContent = (selIdx===q.correctIndex) ? "✅ Düzgün cavab vermisən" : "❌ Bu sualda səhvin var idi";
    else pill.textContent="Cavab seçmək üçün variantlardan birinə kliklə";
  }
}

function onAnswerClick(id, index){
  const q = allQuestions.find(qq=>qq.id===id); if (!q) return;

  // Seçimi mətni ilə saxlayırıq ki, cavabların sırasi dəyişsə də itirməyək.
  selectedAnswers[id] = { index, value: q.answers[index], updatedAt: Date.now() };

  if (index !== q.correctIndex){
    if (!wrongQuestions.includes(id)) wrongQuestions.push(id);
    questionWrongCount[id] = (questionWrongCount[id]||0)+1;
  }
  saveCategoryState(); // vacib: dərhal persist

  updateQuestionCardVisuals(id);
  renderTinyStats(); renderSidePanel();
}

function toggleFlag(id){
  if (flaggedQuestions.includes(id)) flaggedQuestions = flaggedQuestions.filter(x=>x!==id);
  else flaggedQuestions.push(id);
  saveCategoryState(); renderSidePanel(); renderQuiz();
}
function removeFromWrong(id){
  if (!wrongQuestions.includes(id)) return;
  if (!confirm("Bu sualı 'səhv suallar' siyahısından çıxarmaq istəyirsən?")) return;
  wrongQuestions = wrongQuestions.filter(x=>x!==id);
  saveCategoryState(); renderAll();
}
function toggleCorrectAnswer(id){
  const el = document.getElementById("correct-answer-"+id); if (!el) return;
  el.classList.toggle("visible");
}
function toggleNoteEditor(id){
  const el = document.getElementById("note-"+id); if (!el) return;
  el.classList.toggle("open");
}
function scrollToQuestion(id){
  const el = document.getElementById("question-"+id); if(!el) return;
  el.scrollIntoView({behavior:"smooth", block:"start"});
}
function toggleEditedVersion(id){
  const e = editedQuestions[id]; if(!e) return;
  const q = allQuestions.find(qq=>qq.id===id); if(!q) return;
  if (e.active==="after"){
    e.active="before"; q.question=e.before.question; q.answers=e.before.answers.slice(); q.correctIndex=e.before.correctIndex;
  } else {
    e.active="after"; q.question=e.after.question; q.answers=e.after.answers.slice(); q.correctIndex=e.after.correctIndex;
  }
  delete selectedAnswers[id]; // niyə: sualın məzmunu dəyişib, əvvəlki seçim səhv ola bilər
  saveCategoryState(); renderAll();
}

// IMPORTANT: Bu funksiya artıq cavabları SİLMİR (no-op).
function resetAnswersForCurrentFilter(){
  // intentionally empty – seçilmiş cavablar yalnız "Kateqoriyanı sıfırla" ilə silinir.
}

function resetAllAnswersInCategory(){
  selectedAnswers = {}; saveCategoryState();
}

function selectCategory(filename){
  currentCategory = filename;
  currentPage = 1;
  filterMode = "all";

  // İmtahanı dayandır
  exam.running=false; exam.lastResult=null; exam.questionIds=[];
  if (exam.timerId){ clearInterval(exam.timerId); exam.timerId=null; }

  document.querySelectorAll(".category-btn").forEach(btn=>btn.classList.remove("selected"));
  const activeBtn = document.querySelector(`.category-btn[data-category="${filename}"]`);
  if (activeBtn) activeBtn.classList.add("selected");

  const container = document.getElementById("quizContainer");
  if (container) container.innerHTML = `<div class="empty-hint"><div class="emoji">⏳</div><p>Suallar yüklənir...</p></div>`;

  fetch(filename).then(r=>{
    if(!r.ok) throw new Error("Fayl tapılmadı");
    return r.json();
  }).then(data=>{
    allQuestions = (data||[]).map((q, idx)=>normalizeQuestion(q, idx+1));
    loadCategoryState();
    applyEditedQuestions();
    // Flashcard sıra parametri hər kateqoriyada yenilənir
    flashOrderMode = getSelectedQuizOrder();
    recomputeOrderedIds();
    renderAll(); updateExamUI();
  }).catch(e=>{
    console.error(e);
    if (container) container.innerHTML = `<div class="empty-hint"><div class="emoji">⚠️</div><p>Faylı yükləmək alınmadı: ${filename}</p></div>`;
  });
}

function getSelectedQuizOrder(){
  const r = document.querySelector('input[name="quizOrder"]:checked');
  return r ? r.value : 'sequential';
}

function resetCurrentCategory(){
  if (!currentCategory) return;
  if (!confirm("Bu kateqoriyadakı nəticələri sıfırlamaq istəyirsən? (Qeyd və flag saxlanacaq)")) return;

  // YALNIZ nəticələr
  selectedAnswers = {};
  wrongQuestions = [];
  questionWrongCount = {};
  editedQuestions = {}; // (istəsən bunu saxlaya da bilərik)

  exam.running=false; exam.lastResult=null; exam.questionIds=[];
  if (exam.timerId){ clearInterval(exam.timerId); exam.timerId=null; }

  localStorage.removeItem(storageKey("selectedAnswers"));
  localStorage.removeItem(storageKey("wrongQuestions"));
  localStorage.removeItem(storageKey("questionWrongCount"));
  localStorage.removeItem(storageKey("editedQuestions"));
  // QƏSDƏN saxlanır: flaggedQuestions, questionNotes

  recomputeOrderedIds(); renderAll(); updateExamUI();
}

function clearAllData(){
  if (!confirm("BÜTÜN məlumatlar silinəcək. Davam edək?")) return;
  if (!confirm("Əminsən? Bu əməliyyat geri qaytarılmır.")) return;
  localStorage.clear();
  exam.running=false; exam.lastResult=null; exam.questionIds=[];
  if (exam.timerId){ clearInterval(exam.timerId); exam.timerId=null; }
  location.reload();
}

// ---------- Admin / Theme ----------
function adminLoginPrompt(){
  const pwd = prompt("Admin parolu:"); if (pwd===null) return;
  if (pwd==="justmee"){ isAdmin=true; localStorage.setItem("quiz_isAdmin","true"); updateAdminButtonUI(); alert("Admin rejimi aktivdir."); }
  else alert("Yanlış parol.");
}
function toggleAdminFromButton(){
  if (isAdmin){ if (confirm("Admin rejimindən çıxmaq istəyirsən?")){ isAdmin=false; localStorage.setItem("quiz_isAdmin","false"); updateAdminButtonUI(); } }
  else adminLoginPrompt();
}
function updateAdminButtonUI(){
  const btn = document.getElementById("adminLoginBtn"); if(!btn) return;
  if (isAdmin){ btn.classList.add("admin-on"); btn.querySelector("span").textContent="Admin: ON"; }
  else { btn.classList.remove("admin-on"); btn.querySelector("span").textContent="Admin girişi"; }
}
function initDarkMode(){
  const darkBtn = document.getElementById("darkModeToggle"); if(!darkBtn) return;
  const saved = localStorage.getItem("quiz_darkMode"); if (saved==="on") document.body.classList.add("dark-mode");
  updateDarkButtonUI();
  darkBtn.addEventListener("click", ()=>{
    const isDark = document.body.classList.toggle("dark-mode");
    localStorage.setItem("quiz_darkMode", isDark ? "on" : "off");
    updateDarkButtonUI();
  });
}
function updateDarkButtonUI(){
  const darkBtn = document.getElementById("darkModeToggle"); if(!darkBtn) return;
  const icon = darkBtn.querySelector("i"); const span = darkBtn.querySelector("span");
  const isDark = document.body.classList.contains("dark-mode");
  if (icon) icon.className = isDark ? "fa fa-sun" : "fa fa-moon";
  if (span) span.textContent = isDark ? "İşıqlı rejim" : "Qaranlıq rejim";
}

// ---------- Flashcard ----------
function updateFlashcardUI(){
  const controls = document.getElementById("flashcardControls"); const body=document.body;
  if (singleQuestionMode){ body.classList.add("flashcard-mode"); if (controls) controls.classList.remove("hidden"); }
  else { body.classList.remove("flashcard-mode"); if (controls) controls.classList.add("hidden"); }
  const filtered = getFilteredQuestions(); const counter = document.getElementById("cardCounter");
  if (counter && filtered.length){ counter.textContent = `${currentPage}/${Math.max(1, Math.ceil(filtered.length / questionsPerPage))}`; }
}
function goNextCard(){ const f=getFilteredQuestions(); const max=Math.max(1, Math.ceil(f.length/questionsPerPage)); currentPage=Math.min(max,currentPage+1); renderAll(); }
function goPrevCard(){ currentPage=Math.max(1,currentPage-1); renderAll(); }
function attachSwipeHandlers(){
  const area=document.getElementById("quizContainer"); if(!area) return;
  let sx=0, sy=0, active=false;
  area.addEventListener("touchstart",(e)=>{ if(!singleQuestionMode) return; active=true; const t=e.touches[0]; sx=t.clientX; sy=t.clientY; },{passive:true});
  area.addEventListener("touchend",(e)=>{ if(!singleQuestionMode||!active) return; const t=e.changedTouches[0]; const dx=t.clientX-sx, dy=t.clientY-sy;
    if (Math.abs(dx)>40 && Math.abs(dy)<40){ if (dx<0) goNextCard(); else goPrevCard(); }
    active=false;
  });
  document.addEventListener("keydown",(e)=>{ if(!singleQuestionMode) return; if(e.key==="ArrowRight") goNextCard(); else if(e.key==="ArrowLeft") goPrevCard(); });
}

// ---------- PWA ----------
let deferredPrompt=null;
function initPWAInstall(){
  const btn=document.getElementById('installBtn');
  const show=()=>{ if(btn) btn.classList.remove('hidden'); };
  const hide=()=>{ if(btn) btn.classList.add('hidden'); };
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) hide();
  window.addEventListener('beforeinstallprompt',(e)=>{ e.preventDefault(); deferredPrompt=e; show(); });
  window.addEventListener('appinstalled', hide);
  if (btn){
    btn.addEventListener('click', async ()=>{
      if (!deferredPrompt){ return; }
      deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; hide();
    });
  }
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", ()=>{
  initFirebaseAuth();

  const prevBtn=document.getElementById("prevCard");
  const nextBtn=document.getElementById("nextCard");
  if (prevBtn) prevBtn.addEventListener("click", ()=>{ goPrevCard(); updateFlashcardUI(); });
  if (nextBtn) nextBtn.addEventListener("click", ()=>{ goNextCard(); updateFlashcardUI(); });

  const floatFlashBtn=document.getElementById("flashcardFloatingToggle");
  if (floatFlashBtn){
    const syncLabel=()=>{ floatFlashBtn.textContent = "🗂️ " + (singleQuestionMode?"Flashcard ON":"Flashcard"); };
    syncLabel();
    floatFlashBtn.addEventListener("click", ()=>{
      singleQuestionMode = !singleQuestionMode;
      const sqToggleEl = document.getElementById("singleQuestionModeToggle");
      if (sqToggleEl) sqToggleEl.checked = singleQuestionMode;
      flashOrderMode = getSelectedQuizOrder(); // WHY: UI ilə sinxron
      questionsPerPage = singleQuestionMode ? 1 : baseQuestionsPerPage;
      currentPage = 1;
      recomputeOrderedIds();
      renderAll();
      updateFlashcardUI();
      syncLabel();
    });
  }

  const startBtn=document.getElementById("startBtn");
  const welcome=document.getElementById("welcomeScreen");
  const main=document.getElementById("mainContent");
  if (startBtn && welcome && main){
    startBtn.addEventListener("click", ()=>{
      const fbtn=document.getElementById('flashcardFloatingToggle'); if (fbtn) fbtn.classList.remove('hidden');
      welcome.style.display="none"; main.style.display="block";
      const evt=new Event("app-started"); document.dispatchEvent(evt);
      const floatBtn=document.getElementById("flashcardFloatingToggle"); if (floatBtn) floatBtn.classList.remove("hidden");
    });
  }

  document.querySelectorAll(".category-btn").forEach((btn)=>{
    btn.addEventListener("click", ()=>{ const file=btn.getAttribute("data-category"); if(file) selectCategory(file); });
  });

  // Filtr – artıq cavabları SİLMİR
  document.querySelectorAll(".quiz-filter-btn").forEach((btn)=>{
    btn.addEventListener("click", ()=>{
      const mode = btn.getAttribute("data-filter") || "all";
      filterMode = mode;

      document.querySelectorAll(".quiz-filter-btn").forEach(b=> b.classList.toggle("active", b===btn));
      currentPage=1; recomputeOrderedIds(); renderAll();
    });
  });

  const select = document.getElementById("questionsPerPage");
  if (select){
    const saved = parseInt(localStorage.getItem("quiz_questionsPerPage")||"10",10);
    if (!isNaN(saved)){ baseQuestionsPerPage=saved; questionsPerPage=saved; select.value=String(saved); }
    select.addEventListener("change", ()=>{
      const v=parseInt(select.value,10); baseQuestionsPerPage=isNaN(v)?10:v;
      localStorage.setItem("quiz_questionsPerPage", String(baseQuestionsPerPage));
      if (!singleQuestionMode) questionsPerPage = baseQuestionsPerPage;
      currentPage=1; recomputeOrderedIds(); renderAll();
    });
  }

  const sqToggle=document.getElementById("singleQuestionModeToggle");
  if (sqToggle){
    sqToggle.addEventListener("change", ()=>{
      singleQuestionMode = sqToggle.checked;
      flashOrderMode = getSelectedQuizOrder();
      questionsPerPage = singleQuestionMode ? 1 : baseQuestionsPerPage;
      currentPage=1; recomputeOrderedIds(); renderAll();
    });
  }

  // YALNIZ quizOrder istifadə olunur (orderMode ləğv edildi)
  document.querySelectorAll('input[name="quizOrder"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      renderAll();
      flashOrderMode = getSelectedQuizOrder();
      if (singleQuestionMode){ recomputeOrderedIds(); renderAll(); }
    });
  });

  const searchInput=document.getElementById("searchInput");
  if (searchInput){
    searchInput.addEventListener("input", ()=>{
      searchQuery = searchInput.value||""; currentPage=1; recomputeOrderedIds(); renderAll();
    });
  }

  const resetBtn=document.getElementById("categoryResetBtn"); if (resetBtn) resetBtn.addEventListener("click", resetCurrentCategory);
  const clearBtn=document.getElementById("clearAllBtn"); if (clearBtn) clearBtn.addEventListener("click", clearAllData);

  const sideToggle=document.getElementById("sidePanelToggle");
  if (sideToggle) sideToggle.addEventListener("click", ()=> document.body.classList.toggle("side-collapsed"));

  const examStartBtn=document.getElementById("examStartBtn");
  if (examStartBtn){ examStartBtn.classList.remove("hidden"); examStartBtn.addEventListener("click", ()=> startExam()); }
  const examFinishBtn=document.getElementById("examFinishBtn");
  if (examFinishBtn){ examFinishBtn.addEventListener("click", ()=>{ if(!exam.running) return; if(!confirm("İmtahanı bitirmək istəyirsən?")) return; finishExam(true); }); }
  updateExamUI();

  const adminBtn=document.getElementById("adminLoginBtn"); if (adminBtn) adminBtn.addEventListener("click", toggleAdminFromButton);
  isAdmin = localStorage.getItem("quiz_isAdmin")==="true"; updateAdminButtonUI();

  initDarkMode();
  renderTinyStats();
  attachSwipeHandlers();

  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
  initPWAInstall();

  // İlk yükləmədə flashcard sırası UI ilə sinxron
  flashOrderMode = getSelectedQuizOrder();
});

// Mobile helper
function toggleMobileMode(){ document.body.classList.toggle('flashcard-mode'); }
