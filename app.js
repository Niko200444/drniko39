// Extracted inline app logic

let allQuestions = [];
  let currentIndex = 0;
  let questionsPerPage = parseInt(safeGetItem("questionsPerPage", 10));
  let questionRange = safeGetItem("questionRange", ""); // Yeni dəyişən
  let wrongQuestions = [];
  let selectedAnswers = {};
  let flaggedQuestions = [];
  let questionNotes = {};
let questionWrongCount = {}; // Hər sualın neçə dəfə səhv cavablandırıldığını izləyir
const ADMIN_PASSWORD = "rezident2025"; // Admin üçün sadə şifrə
let editedQuestions = safeGetItem("editedQuestions", {}) || {};

let adaptiveMode = safeGetItem("adaptiveMode", false); // Adaptiv rejim
  let flashcardMode = false; // Flashcard rejim - default olaraq OFF
  let flashcardAnswers = {}; // Flashcard rejimində cavabların göstərilməsi

  let currentSearchQuery = "";
  let currentCategory = null; // Başlanğıcda heç bir kateqoriya seçilməsin
  let orderMode = safeGetItem("orderMode", "ARDICIL");
  let orderedQuestions = []; // sualların ardıcıllığı üçün
  let isFlaggedMode = false;
  let prevSelectedAnswers = null;
  let prevCurrentIndex = 0;

  let isWrongMode = false;
  let prevWrongSelectedAnswers = null;
  let prevWrongCurrentIndex = 0;

  // Bütün kateqoriyalar üçün dəyişənlər
  let allCategoriesData = {}; // Bütün kateqoriyaların məlumatları
  let categoryDistribution = {}; // Kateqoriya bölgüsü
  let distributionInterval = 10; // Hər neçə sualda bölgü yoxlanılsın
  let isAllCategoriesMode = false; // Bütün kateqoriyalar rejimi aktivdir

  // Firebase sync dəyişənləri
  let currentUser = null;
  let isSyncing = false;
  let lastSyncTime = null;

  // localStorage fallback və təhlükəsizlik funksiyaları
  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }


// Admin dəyişikliklərini yadda saxlamaq
function saveEditedQuestion(questionNumber, data) {
  if (!editedQuestions || typeof editedQuestions !== "object") {
    editedQuestions = {};
  }
  editedQuestions[questionNumber] = {
    ...(editedQuestions[questionNumber] || {}),
    ...data
  };
  safeSetItem("editedQuestions", editedQuestions);
}

// Admin üçün sual redaktə funksiyası
function handleEditQuestion(questionNumber, questionObj) {
  const password = prompt("Admin şifrəsini daxil edin:");
  if (password !== ADMIN_PASSWORD) {
    alert("Yanlış şifrə!");
    return;
  }

  const currentQuestion = questionObj.question || "";
  const newQuestion = prompt("Sual mətnini dəyiş:", currentQuestion);
  if (newQuestion && newQuestion.trim() !== "") {
    questionObj.question = newQuestion.trim();
  }

  const answers = questionObj.answers || [];
  if (!Array.isArray(answers) || answers.length === 0) {
    alert("Bu sualın cavabları tapılmadı.");
  } else {
    const answerList = answers.map((ans, idx) => `${idx + 1}) ${ans}`).join("\n");
    const currentCorrect = (typeof questionObj.correctIndex === "number" ? (questionObj.correctIndex + 1) : 1);
    let selected = prompt(
      "Düzgün cavabın nömrəsini seç (1-" + answers.length + "):\n" +
      answerList + "\n\nHazır düzgün cavab: " + currentCorrect
    );
    if (selected) {
      const idx = parseInt(selected, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= answers.length) {
        questionObj.correctIndex = idx - 1;
      } else {
        alert("Yanlış nömrə daxil edildi, düzgün cavab dəyişdirilmədi.");
      }
    }

    const changeCorrectText = confirm("Düzgün cavabın mətnini də dəyişmək istəyirsən?");
    if (changeCorrectText) {
      const currentCorrectText = answers[questionObj.correctIndex];
      const newCorrectText = prompt("Yeni düzgün cavab mətnini yaz:", currentCorrectText);
      if (newCorrectText && newCorrectText.trim() !== "") {
        answers[questionObj.correctIndex] = newCorrectText.trim();
      }
    }
  }

  saveEditedQuestion(questionNumber, {
    question: questionObj.question,
    answers: questionObj.answers,
    correctIndex: questionObj.correctIndex
  });

  alert("Sual yeniləndi.");
  renderQuiz();
}

  function safeGetItem(key, defaultValue = null) {
    try {
      const localValue = localStorage.getItem(key);
      if (localValue !== null) return JSON.parse(localValue);
      const sessionValue = sessionStorage.getItem(key);
      if (sessionValue !== null) {
        localStorage.setItem(key, sessionValue);
        return JSON.parse(sessionValue);
      }
      return defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }

  function clearOldData() {
    try {
      // 30 gündən köhnə məlumatları təmizlə
      const keys = Object.keys(localStorage);
      const now = Date.now();
      const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
      
      keys.forEach(key => {
        if (key.startsWith('questionNotes_') || key.startsWith('selectedAnswers_')) {
          try {
            const item = localStorage.getItem(key);
            if (item) {
              const data = JSON.parse(item);
              // Əgər məlumatın timestamp-i varsa və köhnədirsə sil
              if (data.timestamp && data.timestamp < thirtyDaysAgo) {
                localStorage.removeItem(key);
              }
            }
          } catch (e) {
            // Xətalı məlumatları sil
            localStorage.removeItem(key);
          }
        }
      });
    } catch (error) {
      console.error('Köhnə məlumatları təmizləmə xətası:', error);
    }
  }

  // Məlumatları avtomatik yadda saxla
  function autoSave() {
    if (currentCategory) {
      safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
      safeSetItem(getStorageKey("wrongQuestions"), wrongQuestions);
      safeSetItem(getStorageKey("flaggedQuestions"), flaggedQuestions);
      safeSetItem(getStorageKey("questionNotes"), questionNotes);
      safeSetItem(getStorageKey("questionWrongCount"), questionWrongCount);
    }
  }

  // Hər 30 saniyədə avtomatik yadda saxla
  setInterval(autoSave, 30000);

  // Səhifə yükləndikdə və bağlanmadan əvvəl yadda saxla
  window.addEventListener('beforeunload', autoSave);
  window.addEventListener('pagehide', autoSave);

  function getStorageKey(base) {
  return base + "_" + (currentCategory || "default");
}

function loadCategoryState() {
  wrongQuestions = safeGetItem(getStorageKey("wrongQuestions"), []);
  selectedAnswers = safeGetItem(getStorageKey("selectedAnswers"), {});
  flaggedQuestions = safeGetItem(getStorageKey("flaggedQuestions"), []);
  questionNotes = safeGetItem(getStorageKey("questionNotes"), {});
  questionWrongCount = safeGetItem(getStorageKey("questionWrongCount"), {});
  adaptiveMode = safeGetItem("adaptiveMode", false);
  flashcardMode = safeGetItem("flashcardMode", false);
}

  async function loadQuizData() {
  if (!currentCategory) {
    document.getElementById('quizContainer').innerHTML = `
      <div style="text-align:center; margin:40px 0;">
        <div style="font-size:4em; animation:bounce 1.2s infinite;">📚</div>
        <div style="font-size:1.4em; color:#2563eb; margin-top:18px; font-weight:bold;">
          Kateqoriya seçin
        </div>
        <div style="font-size:1em; color:#888; margin-top:8px;">
          Axtarış üçün əvvəlcə kateqoriya seçməlisiniz.
        </div>
      </div>
    `;
    updateWrongQuestionsList();
    updateFlaggedQuestionsList();
    updateProgressInfo();
    return;
  }
  try {
    const response = await fetch(currentCategory);
    if (!response.ok) {
      throw new Error('Məlumat yüklənmədi: ' + response.status);
    }
    allQuestions = await response.json();
    allQuestions = allQuestions.map(q => shuffleAnswers(q));
    applyOrderMode();
    renderQuiz();
    updateWrongQuestionsList();
    updateFlaggedQuestionsList();
    updateRepeatedMistakesList();
    updateProgressInfo();
    updatePageNavigation();
  } catch (error) {
    console.error('JSON yüklənərkən xəta:', error);
    document.getElementById('quizContainer').innerHTML = '<p>Məlumat yüklənmədi</p>';
  }
}

  async function selectCategory(filename) {
  // Əvvəlki kateqoriyadakı currentIndex-i yadda saxla
  if (currentCategory) {
    safeSetItem('currentIndex_' + currentCategory, currentIndex);
  }
  console.log("Seçilən kateqoriya:", filename);
  currentCategory = filename;
  currentIndex = safeGetItem('currentIndex_' + filename, 0);
  isFlaggedMode = false;
  currentSearchQuery = "";
  document.getElementById('searchInput').value = "";
  loadCategoryState();
  document.getElementById('questionCountContainer').style.display = 'block';
  document.getElementById('categoryResetContainer').style.display = 'block';
  document.getElementById('searchContainer').style.display = 'block'; // Show search container
  // Focus on search input
  setTimeout(() => {
    document.getElementById('searchInput').focus();
  }, 100);
  document.querySelectorAll('.category-btn').forEach(btn => {
    if (btn.getAttribute('data-category') === filename) {
      btn.classList.add('selected');
      btn.classList.remove('inactive');
    } else {
      btn.classList.remove('selected');
      btn.classList.add('inactive');
    }
  });

  // Əgər bütün patan alt kateqoriyaları üçünsə:
  if (filename === 'patan-all') {
    // Bütün alt kateqoriyaların json-larını yüklə və birləşdir
    const files = ['patan2a.json', 'patan1a.json', 'patandyes.json'];
    let all = [];
    for (let file of files) {
      try {
        const resp = await fetch(file);
        if (resp.ok) {
          const data = await resp.json();
          all = all.concat(data);
        }
      } catch (e) {
        console.error(file, "yüklənmədi:", e);
      }
    }
    allQuestions = all.map(q => shuffleAnswers(q));
    applyOrderMode();
    renderQuiz();
    updateWrongQuestionsList();
    updateFlaggedQuestionsList();
    updateRepeatedMistakesList();
    updateProgressInfo();
    updatePageNavigation();
    return;
  }

  // Standart halda bir json yüklə
  loadQuizData();
}
    function renderQuiz() {
       updateStatsInfo();
  const container = document.getElementById('quizContainer');
  container.innerHTML = '';
  let filteredQuestions;
  
  // Determine which questions to show based on current mode
  if (isFlaggedMode) {
    filteredQuestions = flaggedQuestions
      .map(qNum => allQuestions[qNum - 1])
      .filter(q => !!q);
  } else if (isWrongMode) {
    filteredQuestions = wrongQuestions
      .map(qNum => allQuestions[qNum - 1])
      .filter(q => !!q);
  } else {
    filteredQuestions = orderedQuestions;
  }
  
  console.log("Before search filter:", filteredQuestions.length, "questions");
  console.log("Current search query:", currentSearchQuery);
  
  // Apply search filter
  if (currentSearchQuery) {
    const query = currentSearchQuery.toLowerCase();
    console.log("Searching for:", query);
    filteredQuestions = filteredQuestions.filter(q =>
      (q.question && q.question.toLowerCase().includes(query)) ||
      (q.answers && q.answers.some(ans => ans.toLowerCase().includes(query)))
    );
    console.log("After search filter:", filteredQuestions.length, "questions");
  }
  
  // Show search results count if searching
  if (currentSearchQuery) {
    const searchInfo = document.createElement('div');
    searchInfo.style.cssText = 'text-align:center; margin-bottom:20px; padding:10px; background:#e0e7ff; border-radius:8px; color:#2563eb; font-weight:bold;';
    searchInfo.innerHTML = `🔍 "${currentSearchQuery}" üçün ${filteredQuestions.length} sual tapıldı`;
    container.appendChild(searchInfo);
  }
  
  // Sual aralığı məlumatını göstər
  if (questionRange && questionRange.trim() !== "") {
    const rangeInfo = document.createElement('div');
    rangeInfo.style.cssText = 'text-align:center; margin-bottom:20px; padding:10px; background:#fef3c7; border-radius:8px; color:#d97706; font-weight:bold;';
    rangeInfo.innerHTML = `📊 Sual aralığı: ${questionRange} (${filteredQuestions.length} sual)`;
    container.appendChild(rangeInfo);
  }
  if (!filteredQuestions || filteredQuestions.length === 0) {
    container.innerHTML = `
    <div style="text-align:center; margin:40px 0;">
      <div style="font-size:4em; animation:bounce 1.2s infinite;">🔍</div>
      <div style="font-size:1.4em; color:#dc3545; margin-top:18px; font-weight:bold;">
        Heç bir sual tapılmadı!
      </div>
      <div style="font-size:1em; color:#888; margin-top:8px;">
        Axtarış kriteriyanı dəyiş və ya təmizlə.
      </div>
    </div>
  `;
    return;
  }
  if (currentIndex >= filteredQuestions.length) { currentIndex = 0; }
  const questionsToShow = filteredQuestions.slice(currentIndex, currentIndex + questionsPerPage);
      questionsToShow.forEach((item, index) => {
        const questionEl = document.createElement('div');
        questionEl.className = 'question';
        // Sualların orijinal sırası: allQuestions-dakı index + 1
        const questionNumber = allQuestions.indexOf(item) + 1;
        questionEl.id = 'question-' + questionNumber; // <-- YENİ SƏTR
        
        // Flashcard rejimi üçün xüsusi render
        if (flashcardMode) {
          renderFlashcardQuestion(questionEl, item, questionNumber);
        } else {
          // Normal rejim üçün mövcud kod
          // Təkrarlanan səhv sayını göstər
          const wrongCount = questionWrongCount[questionNumber] || 0;
          const wrongCountDisplay = wrongCount > 0 ? `<span style="color:#dc3545; font-size:0.9em; margin-left:10px;">(Səhv: ${wrongCount})</span>` : '';
          
          // Mənbə kateqoriyasını göstər (əgər qarışıq rejimdədirsə)
          const sourceCategoryDisplay = item.sourceCategory ? 
            `<span style="color:#2563eb; font-size:0.8em; background:#e0e7ff; padding:2px 6px; border-radius:4px; margin-left:8px;">${item.sourceCategory}</span>` : '';
          
          questionEl.innerHTML = `<h2 style="position:relative; padding-right:38px;">${questionNumber}. ${item.question} ${wrongCountDisplay} ${sourceCategoryDisplay}</h2>`;

          // Kiçik, kvadrat, sağ yuxarıda copy iconu
          const copyAllBtn = document.createElement('button');
          copyAllBtn.innerHTML = "&#128203;"; // 📋 unicode
          copyAllBtn.title = "Sualı və variantları kopyala";
          copyAllBtn.style.position = "absolute";
          copyAllBtn.style.top = "8px";
          copyAllBtn.style.right = "8px";
          copyAllBtn.style.width = "32px";
          copyAllBtn.style.height = "32px";
          copyAllBtn.style.display = "flex";
          copyAllBtn.style.alignItems = "center";
          copyAllBtn.style.justifyContent = "center";
          copyAllBtn.style.background = "#f1f5f9";
          copyAllBtn.style.border = "1px solid #cbd5e1";
          copyAllBtn.style.borderRadius = "7px";
          copyAllBtn.style.cursor = "pointer";
          copyAllBtn.style.fontSize = "1.3em";
          copyAllBtn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.07)";
          copyAllBtn.addEventListener('click', () => {
            let text = `${questionNumber}. ${item.question}\n`;
            item.answers.forEach((ans, idx) => {
              const letter = String.fromCharCode(65 + idx);
              text += `${letter}) ${ans}\n`;
            });
            navigator.clipboard.writeText(text);
            copyAllBtn.innerHTML = "✔️";
            setTimeout(() => copyAllBtn.innerHTML = "&#128203;", 1200);
          });
          questionEl.appendChild(copyAllBtn);

          const answersEl = document.createElement('div');
          answersEl.className = 'answers';
          item.answers.forEach(answer => {
            const button = document.createElement('button');
            button.textContent = answer;
            if (selectedAnswers[questionNumber] !== undefined) {
              if (button.textContent === selectedAnswers[questionNumber]) {
                if (button.textContent === item.answers[item.correctIndex]) {
                  button.classList.add('correct');
                } else {
                  button.classList.add('wrong');
                }
              }
            } else {
              button.addEventListener('click', () => {
                if (selectedAnswers[questionNumber] === undefined) {
                  selectedAnswers[questionNumber] = answer;
                  safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
                  if (answer === item.answers[item.correctIndex]) {
                    button.classList.add('correct');
                  } else {
                    button.classList.add('wrong');
                    addWrongQuestion(questionNumber);
                  }
                  updateProgressInfo();
                  updateStatsInfo(); // <-- bunu əlavə et
                }
              });
            }
            answersEl.appendChild(button);
          });
          questionEl.appendChild(answersEl);
          
          // Extra Options: Flag və Qeyd
          const extraOptionsDiv = document.createElement('div');
          extraOptionsDiv.className = 'extra-options';
          // Flag düyməsi
          const flagButton = document.createElement('button');
          flagButton.className = 'flag-btn';
          flagButton.innerHTML = flaggedQuestions.includes(questionNumber) ? '<i class="fa fa-flag"></i> Unflag' : '<i class="fa fa-flag-o"></i> İşarələ';
          flagButton.addEventListener('click', () => toggleFlagged(questionNumber, flagButton));
extraOptionsDiv.appendChild(flagButton);
// Edit düyməsi (admin üçün)
const editButton = document.createElement('button');
editButton.className = 'edit-btn';
editButton.innerHTML = '<i class="fa fa-edit"></i> Dəyiş';
editButton.addEventListener('click', () => handleEditQuestion(questionNumber, item));
extraOptionsDiv.appendChild(editButton);
// Qeyd düyməsi
          const noteButton = document.createElement('button');
          noteButton.className = 'note-btn';
          noteButton.innerHTML = '<i class="fa fa-sticky-note"></i> Qeyd əlavə et';
          noteButton.addEventListener('click', () => toggleNoteArea(questionNumber));
          extraOptionsDiv.appendChild(noteButton);
          // Cavabı sil düyməsi
          const clearAnswerButton = document.createElement('button');
          clearAnswerButton.className = 'clear-answer-btn';
          clearAnswerButton.innerHTML = '<i class="fa fa-eraser"></i> Cavabı sil';
          clearAnswerButton.addEventListener('click', () => {
            // Cavabı sil
            delete selectedAnswers[questionNumber];
            safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
            // Səhv suallar siyahısına əlavə et (əgər yoxdursa)
            if (!wrongQuestions.includes(questionNumber)) {
              wrongQuestions.push(questionNumber);
              safeSetItem(getStorageKey("wrongQuestions"), wrongQuestions);
            }
            renderQuiz();
            updateWrongQuestionsList();
            updateProgressInfo();
          });
          extraOptionsDiv.appendChild(clearAnswerButton);
          
          // Qeyd textarea bölməsi
          const noteDiv = document.createElement('div');
          noteDiv.style.display = 'none';
          noteDiv.id = 'noteDiv-' + questionNumber;
          const noteTextarea = document.createElement('textarea');
          noteTextarea.placeholder = "Qeyd...";
          noteTextarea.rows = 3;
          if (questionNotes[questionNumber]) {
            noteTextarea.value = questionNotes[questionNumber];
            noteDiv.style.display = 'block';
          }
          ['input', 'blur'].forEach(evt =>
    noteTextarea.addEventListener(evt, () => {
      questionNotes[questionNumber] = noteTextarea.value;
      safeSetItem(getStorageKey("questionNotes"), questionNotes);
    })
  );
          noteDiv.appendChild(noteTextarea);
          extraOptionsDiv.appendChild(noteDiv);
          
          questionEl.appendChild(extraOptionsDiv);
        }
        
        container.appendChild(questionEl);
      });
    }

    // Flashcard rejimi üçün sual render funksiyası
    function renderFlashcardQuestion(questionEl, item, questionNumber) {
      questionEl.className = 'flashcard-question';
      
      // Flashcard indikatoru
      const indicator = document.createElement('div');
      indicator.className = 'flashcard-indicator';
      indicator.innerHTML = `<i class="fa fa-credit-card"></i> ${questionNumber}`;
      questionEl.appendChild(indicator);
      
      // Sual mətni
      const questionTitle = document.createElement('h2');
      questionTitle.textContent = item.question;
      questionEl.appendChild(questionTitle);
      
      // Cavablar (başlanğıcda gizli)
      const answersEl = document.createElement('div');
      answersEl.className = 'flashcard-answers';
      answersEl.id = 'flashcard-answers-' + questionNumber;
      
      item.answers.forEach((answer, index) => {
        const button = document.createElement('button');
        button.textContent = `${String.fromCharCode(65 + index)}) ${answer}`;
        
        // Cavab seçildikdə
        button.addEventListener('click', () => {
          if (selectedAnswers[questionNumber] === undefined) {
            selectedAnswers[questionNumber] = answer;
            safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
            
            // Bütün cavabları göstər və düzgün/səhv olanları işarələ
            const allButtons = answersEl.querySelectorAll('button');
            allButtons.forEach(btn => {
              if (btn.textContent.includes(answer)) {
                if (answer === item.answers[item.correctIndex]) {
                  btn.classList.add('correct');
                } else {
                  btn.classList.add('wrong');
                }
              } else if (btn.textContent.includes(item.answers[item.correctIndex])) {
                btn.classList.add('correct');
              }
            });
            
            // Səhv cavab seçildisə səhv suallar siyahısına əlavə et
            if (answer !== item.answers[item.correctIndex]) {
              addWrongQuestion(questionNumber);
            }
            
            updateProgressInfo();
            updateStatsInfo();
          }
        });
        
        answersEl.appendChild(button);
      });
      
      questionEl.appendChild(answersEl);
      
      // Kontrol düymələri
      const controlsEl = document.createElement('div');
      controlsEl.className = 'flashcard-controls';
      
      // Cavabları göstər/gizlə düyməsi
      const showAnswersBtn = document.createElement('button');
      showAnswersBtn.innerHTML = '<i class="fa fa-eye"></i> Cavabları göstər';
      showAnswersBtn.addEventListener('click', () => {
        const answersDiv = document.getElementById('flashcard-answers-' + questionNumber);
        if (answersDiv.classList.contains('show')) {
          answersDiv.classList.remove('show');
          showAnswersBtn.innerHTML = '<i class="fa fa-eye"></i> Cavabları göstər';
        } else {
          answersDiv.classList.add('show');
          showAnswersBtn.innerHTML = '<i class="fa fa-eye-slash"></i> Cavabları gizlət';
        }
      });
      
      // Düzgün cavabı göstər düyməsi
      const showCorrectBtn = document.createElement('button');
      showCorrectBtn.innerHTML = '<i class="fa fa-check-circle"></i> Düzgün cavab';
      showCorrectBtn.addEventListener('click', () => {
        const answersDiv = document.getElementById('flashcard-answers-' + questionNumber);
        answersDiv.classList.add('show');
        
        // Düzgün cavabı işarələ
        const allButtons = answersDiv.querySelectorAll('button');
        allButtons.forEach(btn => {
          if (btn.textContent.includes(item.answers[item.correctIndex])) {
            btn.classList.add('correct');
          }
        });
        
        showAnswersBtn.innerHTML = '<i class="fa fa-eye-slash"></i> Cavabları gizlət';
      });
      
      // Növbəti sual düyməsi
      const nextBtn = document.createElement('button');
      nextBtn.innerHTML = '<i class="fa fa-arrow-right"></i> Növbəti';
      nextBtn.addEventListener('click', () => {
        if (currentIndex + questionsPerPage < orderedQuestions.length) {
          currentIndex += questionsPerPage;
          renderQuiz();
          updatePageNavigation();
          // Yeni suala scroll et
          setTimeout(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }, 100);
        }
      });
      
      controlsEl.appendChild(showAnswersBtn);
      controlsEl.appendChild(showCorrectBtn);
      controlsEl.appendChild(nextBtn);
      questionEl.appendChild(controlsEl);
    }

    function renderQuizFlaggedOnly() {
      const container = document.getElementById('quizContainer');
      container.innerHTML = '';
      let flaggedOnlyQuestions = orderedQuestions.filter((q, idx) => flaggedQuestions.includes(allQuestions.indexOf(q) + 1));
      if (flaggedOnlyQuestions.length === 0) {
        container.innerHTML = "<p>İşarələnmiş sual yoxdur.</p>";
        return;
      }
      flaggedOnlyQuestions.forEach((item, index) => {
        const questionEl = document.createElement('div');
        questionEl.className = 'question';
        const questionNumber = allQuestions.indexOf(item) + 1;
        questionEl.innerHTML = `<h2>${questionNumber}. ${item.question}</h2>`;
        const answersEl = document.createElement('div');
        answersEl.className = 'answers';
        item.answers.forEach(answer => {
          const button = document.createElement('button');
          button.textContent = answer;
          if (selectedAnswers[questionNumber] !== undefined) {
            if (button.textContent === selectedAnswers[questionNumber]) {
              if (button.textContent === item.answers[item.correctIndex]) {
                button.classList.add('correct');
              } else {
                button.classList.add('wrong');
              }
            }
          } else {
            button.addEventListener('click', () => {
              if (selectedAnswers[questionNumber] === undefined) {
                selectedAnswers[questionNumber] = answer;
                safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
                if (answer === item.answers[item.correctIndex]) {
                  button.classList.add('correct');
                } else {
                  button.classList.add('wrong');
                  addWrongQuestion(questionNumber);
                }
                updateProgressInfo();
              }
            });
          }
          answersEl.appendChild(button);
        });
        questionEl.appendChild(answersEl);
        container.appendChild(questionEl);
      });
    }

    function applyOrderMode() {
  if (orderMode === "RANDOM") {
    // Əvvəlcə sual aralığına görə filter et
    let filteredQuestions = filterQuestionsByRange(allQuestions);
    // Adaptiv rejim varsa tətbiq et
    if (adaptiveMode) {
      filteredQuestions = createAdaptiveOrder(filteredQuestions);
    } else {
      // Sonra random sırala
      orderedQuestions = filteredQuestions.slice();
      for (let i = orderedQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [orderedQuestions[i], orderedQuestions[j]] = [orderedQuestions[j], orderedQuestions[i]];
      }
      return;
    }
    orderedQuestions = filteredQuestions;
  } else {
    // Normal ardıcıllıq - əvvəlcə filter et, sonra sırala
    let filteredQuestions = filterQuestionsByRange(allQuestions);
    if (adaptiveMode) {
      orderedQuestions = createAdaptiveOrder(filteredQuestions);
    } else {
      orderedQuestions = filteredQuestions;
    }
  }
}

    function updateProgressInfo() {
      const progressDiv = document.getElementById('progressInfo');
      const answeredCount = Object.keys(selectedAnswers).length;
      const totalCount = allQuestions.length;
      const remainingCount = totalCount - answeredCount;
      }

    function addWrongQuestion(questionNumber) {
      if (!wrongQuestions.includes(questionNumber)) {
        wrongQuestions.push(questionNumber);
        safeSetItem(getStorageKey("wrongQuestions"), wrongQuestions);
        updateWrongQuestionsList();
      }
      
      // Səhv sayını artır
      questionWrongCount[questionNumber] = (questionWrongCount[questionNumber] || 0) + 1;
      safeSetItem(getStorageKey("questionWrongCount"), questionWrongCount);
    }

    function removeWrongQuestion(qNum) {
      wrongQuestions = wrongQuestions.filter(q => q !== qNum);
      safeSetItem(getStorageKey("wrongQuestions"), wrongQuestions);
      updateWrongQuestionsList();
    }

function updateWrongQuestionsList() {
  const listContainer = document.getElementById('wrongQuestionsList');
  listContainer.innerHTML = '';

  const maxVisible = 8; // 1 cərgədə neçə sual görünsün (istəyə görə dəyiş)
  const isExpanded = listContainer.getAttribute('data-expanded') === 'true';

  // Hansı suallar göstəriləcək
  let visibleQuestions = wrongQuestions;
  if (!isExpanded && wrongQuestions.length > maxVisible) {
    visibleQuestions = wrongQuestions.slice(0, maxVisible);
  }

  visibleQuestions.forEach(qNum => {
    const btn = document.createElement('button');
    btn.textContent = qNum;
    btn.style.position = "relative";
    // Remove ikonunu yaradırıq
    const removeIcon = document.createElement('span');
    removeIcon.textContent = "X";
    removeIcon.style.position = "absolute";
    removeIcon.style.top = "0";
    removeIcon.style.right = "0";
    removeIcon.style.backgroundColor = "#000";
    removeIcon.style.color = "#fff";
    removeIcon.style.borderRadius = "0";
    removeIcon.style.width = "10px";
    removeIcon.style.height = "10px";
    removeIcon.style.display = "flex";
    removeIcon.style.justifyContent = "center";
    removeIcon.style.alignItems = "center";
    removeIcon.style.fontSize = "10px";
    removeIcon.style.cursor = "pointer";
    removeIcon.addEventListener('click', function(e) {
      e.stopPropagation();
      removeWrongQuestion(qNum);
    });
    btn.appendChild(removeIcon);

    btn.addEventListener('click', () => {
      currentIndex = qNum - 1;
      renderQuiz();
      updatePageNavigation();
      setTimeout(() => {
        const el = document.getElementById('question-' + qNum);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    });
    listContainer.appendChild(btn);
  });

  // Əgər gizlədilən sual varsa, ... və ya "Daha çox" düyməsi əlavə et
  if (!isExpanded && wrongQuestions.length > maxVisible) {
    const moreBtn = document.createElement('button');
    moreBtn.textContent = '...';
    moreBtn.style.background = '#e5e7eb';
    moreBtn.style.color = '#222';
    moreBtn.style.fontWeight = 'bold';
    moreBtn.style.fontSize = '1.2em';
    moreBtn.style.border = 'none';
    moreBtn.style.cursor = 'pointer';
    moreBtn.style.minWidth = '36px';
    moreBtn.style.minHeight = '36px';
    moreBtn.style.borderRadius = '6px';
    moreBtn.addEventListener('click', function() {
      listContainer.setAttribute('data-expanded', 'true');
      updateWrongQuestionsList();
    });
    listContainer.appendChild(moreBtn);
  }

  // Əgər açıqdırsa və gizlətmək istəyirsə, "Daha az" düyməsi əlavə et
  if (isExpanded && wrongQuestions.length > maxVisible) {
    const lessBtn = document.createElement('button');
    lessBtn.textContent = '▲';
    lessBtn.title = "Gizlət";
    lessBtn.style.background = '#e5e7eb';
    lessBtn.style.color = '#222';
    lessBtn.style.fontWeight = 'bold';
    lessBtn.style.fontSize = '1.2em';
    lessBtn.style.border = 'none';
    lessBtn.style.cursor = 'pointer';
    lessBtn.style.minWidth = '36px';
    lessBtn.style.minHeight = '36px';
    lessBtn.style.borderRadius = '6px';
    lessBtn.addEventListener('click', function() {
      listContainer.setAttribute('data-expanded', 'false');
      updateWrongQuestionsList();
    });
    listContainer.appendChild(lessBtn);
  }

  if (wrongQuestions.length > 0) {
  const wrongModeBtn = document.createElement('button');
  wrongModeBtn.innerHTML = `<i class="fa fa-times-circle" style="font-size:1.3em;"></i> <span>YALNIZ SƏHV SUALLAR</span>`;
  wrongModeBtn.className = "flagged-mode-btn";
  wrongModeBtn.style.background = "linear-gradient(90deg, #dc3545 60%, #fbbf24 100%)";
  wrongModeBtn.style.color = "#fff";
  wrongModeBtn.style.marginTop = "18px";
  wrongModeBtn.style.display = "block";
  wrongModeBtn.addEventListener('click', () => {
    enterWrongMode();
  });
  listContainer.appendChild(wrongModeBtn);
}
}

    function toggleFlagged(questionNumber, flagButton) {
      if (flaggedQuestions.includes(questionNumber)) {
        flaggedQuestions = flaggedQuestions.filter(q => q !== questionNumber);
        flagButton.textContent = "İşarələ";
      } else {
        flaggedQuestions.push(questionNumber);
        flagButton.textContent = "Unflag";
      }
      safeSetItem(getStorageKey("flaggedQuestions"), flaggedQuestions);
      updateFlaggedQuestionsList();
    }

    function updateFlaggedQuestionsList() {
      const container = document.getElementById('flaggedQuestionsList');
      container.innerHTML = '';
      flaggedQuestions.forEach(qNum => {
        const btn = document.createElement('button');
        btn.textContent = qNum;
        btn.addEventListener('click', () => {
          currentIndex = qNum - 1;
          renderQuiz();
          updatePageNavigation();
          setTimeout(() => {
            const el = document.getElementById('question-' + qNum);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 100);
        });
        container.appendChild(btn);
      });

      // Keçid əlavə et
      if (flaggedQuestions.length > 0) {
        const flaggedModeBtn = document.createElement('button');
        flaggedModeBtn.innerHTML = `<i class="fa fa-flag" style="font-size:1.3em;"></i> <span>GO KYLİEE GO</span>`;
        flaggedModeBtn.className = "flagged-mode-btn";
        flaggedModeBtn.addEventListener('click', () => {
          enterFlaggedMode();
        });
        container.appendChild(flaggedModeBtn);
      }
    }

    function updateRepeatedMistakesList() {
      const container = document.getElementById('repeatedMistakesList');
      container.innerHTML = '';
      
      // 2 və ya daha çox dəfə səhv cavablandırılan sualları tap
      const repeatedMistakes = Object.entries(questionWrongCount)
        .filter(([qNum, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1]); // Ən çox səhv cavablandırılanları əvvəldə göstər
      
      repeatedMistakes.forEach(([qNum, count]) => {
        const btn = document.createElement('button');
        btn.innerHTML = `${qNum} <span style="color:#dc3545; font-weight:bold;">(${count})</span>`;
        btn.style.position = "relative";
        btn.style.background = "#fff3f3";
        btn.style.border = "1.5px solid #dc3545";
        btn.style.color = "#dc3545";
        btn.style.fontWeight = "bold";
        
        btn.addEventListener('click', () => {
          currentIndex = parseInt(qNum) - 1;
          renderQuiz();
          updatePageNavigation();
          setTimeout(() => {
            const el = document.getElementById('question-' + qNum);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 100);
        });
        container.appendChild(btn);
      });

      // Əgər təkrarlanan səhv yoxdursa
      if (repeatedMistakes.length === 0) {
        const noMistakes = document.createElement('div');
        noMistakes.innerHTML = '<p style="color:#666; font-style:italic;">Təkrarlanan səhv yoxdur</p>';
        container.appendChild(noMistakes);
      }
    }

    function toggleSidePanel(forceClose = false) {
  const sidePanel = document.getElementById('sidePanel');
  const overlay = document.getElementById('sideOverlay');
  const isMobile = window.innerWidth <= 600;
  if (forceClose || sidePanel.classList.contains('open')) {
    sidePanel.classList.remove('open');
    if (overlay) overlay.style.display = 'none';
  } else {
    sidePanel.classList.add('open');
    if (isMobile && overlay) overlay.style.display = 'block';
  }
}

// Overlay-ə klikləyəndə panel bağlansın
document.addEventListener('DOMContentLoaded', function() {
  const overlay = document.getElementById('sideOverlay');
  if (overlay) {
    overlay.addEventListener('click', function() {
      toggleSidePanel(true);
    });
  }
});

    function nextQuestions() {
      let filteredQuestions = allQuestions;
      if (currentSearchQuery) {
        filteredQuestions = allQuestions.filter(q => q.question.toLowerCase().includes(currentSearchQuery.toLowerCase()));
      }
      if (currentIndex + questionsPerPage < filteredQuestions.length) {
        currentIndex += questionsPerPage;
        renderQuiz();
        updatePageNavigation();
      } else {
        alert("Bütün suallar göstərildi!");
      }
    }

    function resetQuiz() {
      if (confirm("Bütün nəticələri sıfırlamaq istədiyinizə əminsiniz?")) {
    if (confirm("ALA RESET ee?")) {
      if (confirm("BRAT GEDIR HAAA")) {
        if (confirm("BAA RESETTT OLURR")) {
          
        selectedAnswers = {};
        wrongQuestions = [];
        safeRemoveItem(getStorageKey("selectedAnswers"));
        safeRemoveItem(getStorageKey("wrongQuestions"));
      
        currentIndex = 0;
        updateWrongQuestionsList();
        updateFlaggedQuestionsList();
        updateProgressInfo();
        renderQuiz();
        updatePageNavigation();
        alert("Nəticələr sıfırlandı! İşarələnmiş suallar və qeydlər saxlanıldı.");
      }
    }
  }
    }


      function performSearch() {
        console.log("performSearch called");
        currentSearchQuery = document.getElementById('searchInput').value;
        console.log("Search query:", currentSearchQuery);
        currentIndex = 0;
        renderQuiz();
        updatePageNavigation();
        // Axtarış nəticələrində yuxarı qalx
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          const firstQuestion = document.querySelector('.question');
          if (firstQuestion) {
            firstQuestion.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      }
  
      function clearSearch() {
        console.log("clearSearch called");
        currentSearchQuery = "";
        document.getElementById('searchInput').value = "";
        currentIndex = 0;
        renderQuiz();
        updatePageNavigation();
        // Təmizləndikdən sonra yuxarı qalx
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          const firstQuestion = document.querySelector('.question');
          if (firstQuestion) {
            firstQuestion.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      }
  
      function handleSearchInput(event) {
        console.log("handleSearchInput called, key:", event.key);
        // Real-time search on typing
        if (event.key === 'Enter') {
          window.performSearch();
        } else {
          // Debounced search for better performance
          clearTimeout(window.searchTimeout);
          window.searchTimeout = setTimeout(() => {
            currentSearchQuery = document.getElementById('searchInput').value;
            console.log("Debounced search query:", currentSearchQuery);
            currentIndex = 0;
            renderQuiz();
            updatePageNavigation();
            // Debounced axtarışda da yuxarı qalx
            setTimeout(() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              const firstQuestion = document.querySelector('.question');
              if (firstQuestion) {
                firstQuestion.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          }, 300);
        }
      }
  
      // İlk açılışda heç bir sual göstərilməsin
      loadQuizData();
    }

    // Sual sayı inputunu dinlə
    document.addEventListener('DOMContentLoaded', function() {
      const input = document.getElementById('questionsPerPageInput');
      if (input) {
        // İlk açılışda input dəyərini localStorage-dan götür
        input.value = questionsPerPage;
        input.addEventListener('change', function() {
          let val = parseInt(this.value, 10);
          if (isNaN(val) || val < 1) val = 1;
          questionsPerPage = val;
          safeSetItem("questionsPerPage", questionsPerPage); // <-- Yadda saxla
          currentIndex = 0;
          renderQuiz();
          updatePageNavigation();
        });
      }
      
      // Sual aralığı inputunu dinlə
      const rangeInput = document.getElementById('questionRangeInput');
      if (rangeInput) {
        // İlk açılışda input dəyərini localStorage-dan götür
        rangeInput.value = questionRange;
        rangeInput.addEventListener('input', function() {
          questionRange = this.value;
          safeSetItem("questionRange", questionRange);
          currentIndex = 0;
          applyOrderMode(); // Sıralama rejimini yenidən tətbiq et
          renderQuiz();
          updatePageNavigation();
        });
      }
    });

    document.addEventListener('DOMContentLoaded', function() {
      const startBtn = document.getElementById('startBtn');
      if (startBtn) {
        startBtn.addEventListener('click', function() {
          document.getElementById('welcomeScreen').style.display = 'none';
          document.getElementById('mainContent').style.display = 'block';
        });
      }
      
      // Məlumat menyusu üçün event listener
      const dataMenuBtn = document.getElementById('dataMenuBtn');
      const dataMenu = document.getElementById('dataMenu');
      
      if (dataMenuBtn && dataMenu) {
        dataMenuBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          dataMenu.style.display = dataMenu.style.display === 'block' ? 'none' : 'block';
        });
        
        // Menyu xaricində klikləyəndə bağla
        document.body.addEventListener('click', function() {
          dataMenu.style.display = 'none';
        });
        
        // Menyu seçimləri üçün hover effekti
        document.querySelectorAll('.data-menu-option').forEach(option => {
          option.addEventListener('mouseenter', function() {
            this.style.background = '#f8f9fa';
          });
          
          option.addEventListener('mouseleave', function() {
            this.style.background = '#fff';
          });
        });
      }
    });

    document.addEventListener ('DOMContentLoaded', function() {
  const resetBtn = document.getElementById('categoryResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      if (confirm("RESET eləməyə əminsən?")) {
        if (confirm("Bütün nəticələri sıfırlamaq istədiyinizə əminsiniz?")) {
          if (confirm("ALA RESET ee?")) {
            if (confirm("BRAT GEDIR HAAA")) {
              if (confirm("BAA RESETTT OLURR")) {
                selectedAnswers = {};
                wrongQuestions = [];
                safeRemoveItem(getStorageKey("selectedAnswers"));
                safeRemoveItem(getStorageKey("wrongQuestions"));
                
                currentIndex = 0;
                updateWrongQuestionsList();
                updateFlaggedQuestionsList();
                updateProgressInfo();
                renderQuiz();
                updatePageNavigation();
                alert("Nəticələr sıfırlandı! İşarələnmiş suallar və qeydlər saxlanıldı.");
              }
            }
          }
        }
      }
    });
  }
});


document.addEventListener('DOMContentLoaded', function() {
  const orderBtn = document.getElementById('orderModeBtn');
  const orderMenu = document.getElementById('orderModeMenu');
  const orderLabel = document.getElementById('orderModeLabel');
  if (orderBtn && orderMenu && orderLabel) {
    orderBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      orderMenu.style.display = orderMenu.style.display === 'block' ? 'none' : 'block';
    });
    document.querySelectorAll('.order-mode-option').forEach(opt => {
      opt.addEventListener('click', function() {
        orderMode = this.getAttribute('data-mode');
        safeSetItem("orderMode", orderMode);
        orderLabel.textContent = orderMode;
        applyOrderMode();
        currentIndex = 0;
        renderQuiz();
        updatePageNavigation();
        orderMenu.style.display = 'none';
      });
    });
    document.body.addEventListener('click', function() {
      orderMenu.style.display = 'none';
    });
    // İlk açılışda label düz olsun
    orderLabel.textContent = orderMode;
  }
  
  // Adaptiv rejim düyməsi
  const adaptiveBtn = document.getElementById('adaptiveModeBtn');
  const adaptiveLabel = document.getElementById('adaptiveModeLabel');
  if (adaptiveBtn && adaptiveLabel) {
    // İlk açılışda label düz olsun
    adaptiveLabel.textContent = adaptiveMode ? 'ON' : 'OFF';
    adaptiveBtn.style.background = adaptiveMode ? '#dc3545' : '#10b981';
    
    adaptiveBtn.addEventListener('click', function() {
      adaptiveMode = !adaptiveMode;
      safeSetItem("adaptiveMode", adaptiveMode);
      adaptiveLabel.textContent = adaptiveMode ? 'ON' : 'OFF';
      adaptiveBtn.style.background = adaptiveMode ? '#dc3545' : '#10b981';
      
      applyOrderMode();
      currentIndex = 0;
      renderQuiz();
      updatePageNavigation();
    });
  }
  
  // Flashcard rejim düyməsi
  const flashcardBtn = document.getElementById('flashcardModeBtn');
  const flashcardLabel = document.getElementById('flashcardModeLabel');
  if (flashcardBtn && flashcardLabel) {
    // İlk açılışda label düz olsun
    flashcardLabel.textContent = flashcardMode ? 'ON' : 'OFF';
    flashcardBtn.style.background = flashcardMode ? '#dc3545' : '#8b5cf6';
    
    flashcardBtn.addEventListener('click', function() {
      flashcardMode = !flashcardMode;
      safeSetItem("flashcardMode", flashcardMode);
      flashcardLabel.textContent = flashcardMode ? 'ON' : 'OFF';
      flashcardBtn.style.background = flashcardMode ? '#dc3545' : '#8b5cf6';
      
      currentIndex = 0;
      renderQuiz();
      updatePageNavigation();
    });
  }
});

function enterFlaggedMode() {
  isFlaggedMode = true;
  prevSelectedAnswers = { ...selectedAnswers };
  prevCurrentIndex = currentIndex;
  // Yalnız flaglı suallar üçün cavabları sil
  flaggedQuestions.forEach(qNum => {
    delete selectedAnswers[qNum];
  });
  safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
  // Yalnız flaglı sualları göstər
  renderQuiz();
  updatePageNavigation();
  // Yan paneli aç!
  document.getElementById('sidePanel').classList.add('open');
  // Side barda geri qayıt düyməsi göstər
  showExitFlaggedModeBtn();
}

function exitFlaggedMode() {
  isFlaggedMode = false;
  selectedAnswers = { ...prevSelectedAnswers };
  safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
  currentIndex = prevCurrentIndex;
  renderQuiz();
  updatePageNavigation();
  // Geri qayıt düyməsini gizlət
  hideExitFlaggedModeBtn();
}

// Geri qayıt düyməsi
function showExitFlaggedModeBtn() {
  let flaggedList = document.getElementById('flaggedQuestionsList');;
  let exitBtn = document.getElementById('exitFlaggedModeBtn');
  if (!exitBtn) {
    exitBtn = document.createElement('button');
    exitBtn.id = 'exitFlaggedModeBtn';
    exitBtn.textContent = " Geri (bütün suallara)";
    exitBtn.className = "flagged-mode-btn";
    exitBtn.addEventListener('click', exitFlaggedMode);
    // Flagged sualların altına əlavə et
    if (flaggedList && flaggedList.parentNode) {
      flaggedList.parentNode.insertBefore(exitBtn, flaggedList.nextSibling);
    }
  } else {
    exitBtn.style.display = "block";
  }
}
function hideExitFlaggedModeBtn() {
  let exitBtn = document.getElementById('exitFlaggedModeBtn');
  if (exitBtn) exitBtn.style.display = "none";
}

// Variantları qarışdıran və düzgün cavabın indeksini saxlayan funksiya
function shuffleAnswers(questionObj) {
  const correct = questionObj.answers[0];
  const shuffled = questionObj.answers.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
                                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                  }
                  // Find the new index of the correct answer
                  const correctIndex = shuffled.indexOf(correct);
                  return {
                    ...questionObj,
                    answers: shuffled,
                    correctIndex: correctIndex
                  };
                }

                function updatePageNavigation() {
  const navContainer = document.getElementById('pageNavigation');
  navContainer.innerHTML = '';
  let filteredQuestions;
  
  // Determine which questions to show based on current mode
  if (isFlaggedMode) {
    filteredQuestions = flaggedQuestions
      .map(qNum => allQuestions[qNum - 1])
      .filter(q => !!q);
  } else if (isWrongMode) {
    filteredQuestions = wrongQuestions
      .map(qNum => allQuestions[qNum - 1])
      .filter(q => !!q);
  } else {
    filteredQuestions = orderedQuestions;
  }
  
  // Apply search filter
  if (currentSearchQuery) {
    const query = currentSearchQuery.toLowerCase();
    filteredQuestions = filteredQuestions.filter(q =>
      (q.question && q.question.toLowerCase().includes(query)) ||
      (q.answers && q.answers.some(ans => ans.toLowerCase().includes(query)))
    );
  }
  const totalPages = Math.ceil(filteredQuestions.length / questionsPerPage);
  if (totalPages <= 1) return;
  for (let i = 0; i < totalPages; i++) {
  const btn = document.createElement('button');
  btn.textContent = (i + 1);
  if (i === Math.floor(currentIndex / questionsPerPage)) {
    btn.classList.add('active');
  }
  btn.addEventListener('click', () => {
    currentIndex = i * questionsPerPage;
    renderQuiz();
    updatePageNavigation();
    // Səhifə yuxarı qalxsın və ilk suala scroll etsin
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Əgər suallar varsa, ilk suala scroll et
      const firstQuestion = document.querySelector('.question');
      if (firstQuestion) {
        firstQuestion.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  });
  navContainer.appendChild(btn);
}
}
function toggleNoteArea(questionNumber) {
  const noteDiv = document.getElementById('noteDiv-' + questionNumber);
  if (noteDiv) {
    noteDiv.style.display = noteDiv.style.display === 'block' ? 'none' : 'block';
  }
}

function togglepatanSubcats() {
  const subcatsDiv = document.getElementById('patanSubcats');
  if (subcatsDiv) {
    subcatsDiv.style.display = subcatsDiv.style.display === 'none' ? 'flex' : 'none';
  }
}

function updateStatsInfo() {
  const statsDiv = document.getElementById('statsInfo');
  if (!statsDiv) return;
  const total = allQuestions.length;
  const answered = Object.keys(selectedAnswers).length;
  let correct = 0;
  let wrong = 0;
  for (let qNum in selectedAnswers) {
    const idx = Number(qNum) - 1;
    if (allQuestions[idx] && allQuestions[idx].answers) {
      if (selectedAnswers[qNum] === allQuestions[idx].answers[allQuestions[idx].correctIndex]) {
        correct++;
      } else {
        wrong++;
      }
    }
  }
  // Səhv sualların sayı: ya wrongQuestions.length, ya da yuxarıdakı wrong, hansını istəsəniz
  const flagged = flaggedQuestions.length;
  statsDiv.innerHTML = `
    <p><b>Ümumi sual:</b> ${total}</p>
    <p><b>Cavabladığın:</b> ${answered}</p>
    <p style="color:#22c55e;"><b>Düzgün:</b> ${correct}</p>
    <p style="color:#dc3545;"><b>Səhv:</b> ${wrongQuestions.length}</p>
    <p style="color:#fbbf24;"><b>İşarələnmiş:</b> ${flagged}</p>
  `;
}
function enterWrongMode() {
  isWrongMode = true;
  prevWrongSelectedAnswers = { ...selectedAnswers };
  prevWrongCurrentIndex = currentIndex;
  // Yalnız səhv suallar üçün cavabları sil
  wrongQuestions.forEach(qNum => {
    delete selectedAnswers[qNum];
  });
  safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
  renderQuizWrongOnly();
  updatePageNavigation();
  document.getElementById('sidePanel').classList.add('open');
  showExitWrongModeBtn();
}

function exitWrongMode() {
  isWrongMode = false;
  selectedAnswers = { ...prevWrongSelectedAnswers };
  safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
  currentIndex = prevWrongCurrentIndex;
  renderQuiz();
  updatePageNavigation();
  hideExitWrongModeBtn();
}

function showExitWrongModeBtn() {
  let wrongList = document.getElementById('wrongQuestionsList');
  let exitBtn = document.getElementById('exitWrongModeBtn');
  if (!exitBtn) {
    exitBtn = document.createElement('button');
    exitBtn.id = 'exitWrongModeBtn';
    exitBtn.textContent = " Geri (bütün suallara)";
    exitBtn.className = "flagged-mode-btn";
    exitBtn.addEventListener('click', exitWrongMode);
    if (wrongList && wrongList.parentNode) {
      wrongList.parentNode.insertBefore(exitBtn, wrongList.nextSibling);
    }
  } else {
    exitBtn.style.display = "block";
  }
}
function hideExitWrongModeBtn() {
  let exitBtn = document.getElementById('exitWrongModeBtn');
  if (exitBtn) exitBtn.style.display = "none";
}

function renderQuizWrongOnly() {
  updateStatsInfo();
  const container = document.getElementById('quizContainer');
  container.innerHTML = '';
  let filteredQuestions = wrongQuestions
    .map(qNum => allQuestions[qNum - 1])
    .filter(q => !!q);
    
  // Səhv suallar üçün aralıq filterini tətbiq et
  if (questionRange && questionRange.trim() !== "") {
    const range = parseQuestionRange(questionRange);
    if (range) {
      filteredQuestions = filteredQuestions.filter((_, index) => {
        const originalIndex = allQuestions.indexOf(filteredQuestions[index]);
        const questionNumber = originalIndex + 1;
        return questionNumber >= range.start && questionNumber <= range.end;
      });
    }
  }
    
  // Apply search filter
  if (currentSearchQuery) {
    const query = currentSearchQuery.toLowerCase();
    filteredQuestions = filteredQuestions.filter(q =>
      (q.question && q.question.toLowerCase().includes(query)) ||
      (q.answers && q.answers.some(ans => ans.toLowerCase().includes(query)))
    );
  }
  if (!filteredQuestions || filteredQuestions.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; margin:40px 0;">
        <div style="font-size:4em; animation:bounce 1.2s infinite;">🔍</div>
        <div style="font-size:1.4em; color:#dc3545; margin-top:18px; font-weight:bold;">
          Heç bir səhv sual tapılmadı!
        </div>
        <div style="font-size:1em; color:#888; margin-top:8px;">
          Axtarış kriteriyanı dəyiş və ya təmizlə.
        </div>
      </div>
    `;
    return;
  }
  
  // Show search results count if searching
  if (currentSearchQuery) {
    const searchInfo = document.createElement('div');
    searchInfo.style.cssText = 'text-align:center; margin-bottom:20px; padding:10px; background:#e0e7ff; border-radius:8px; color:#2563eb; font-weight:bold;';
    searchInfo.innerHTML = `🔍 "${currentSearchQuery}" üçün ${filteredQuestions.length} səhv sual tapıldı`;
    container.appendChild(searchInfo);
  }
  if (currentIndex >= filteredQuestions.length) { currentIndex = 0; }
  const questionsToShow = filteredQuestions.slice(currentIndex, currentIndex + questionsPerPage);
  questionsToShow.forEach((item, index) => {
    const questionEl = document.createElement('div');
    questionEl.className = 'question';
    const questionNumber = allQuestions.indexOf(item) + 1;
    questionEl.id = 'question-' + questionNumber;
    questionEl.innerHTML = `<h2 style="position:relative; padding-right:38px;">${questionNumber}. ${item.question}</h2>`;

    // Copy button
    const copyAllBtn = document.createElement('button');
    copyAllBtn.innerHTML = "&#128203;";
    copyAllBtn.title = "Sualı və variantları kopyala";
    copyAllBtn.style.position = "absolute";
    copyAllBtn.style.top = "8px";
    copyAllBtn.style.right = "8px";
    copyAllBtn.style.width = "32px";
    copyAllBtn.style.height = "32px";
    copyAllBtn.style.display = "flex";
    copyAllBtn.style.alignItems = "center";
    copyAllBtn.style.justifyContent = "center";
    copyAllBtn.style.background = "#f1f5f9";
    copyAllBtn.style.border = "1px solid #cbd5e1";
    copyAllBtn.style.borderRadius = "7px";
    copyAllBtn.style.cursor = "pointer";
    copyAllBtn.style.fontSize = "1.3em";
    copyAllBtn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.07)";
    copyAllBtn.addEventListener('click', () => {
      let text = `${questionNumber}. ${item.question}\n`;
      item.answers.forEach((ans, idx) => {
        const letter = String.fromCharCode(65 + idx);
        text += `${letter}) ${ans}\n`;
      });
      navigator.clipboard.writeText(text);
      copyAllBtn.innerHTML = "✔️";
      setTimeout(() => copyAllBtn.innerHTML = "&#128203;", 1200);
    });
    questionEl.appendChild(copyAllBtn);

    // Cavablar
    const answersEl = document.createElement('div');
    answersEl.className = 'answers';
    item.answers.forEach(answer => {
      const button = document.createElement('button');
      button.textContent = answer;
      if (selectedAnswers[questionNumber] !== undefined) {
        if (button.textContent === selectedAnswers[questionNumber]) {
          if (button.textContent === item.answers[item.correctIndex]) {
            button.classList.add('correct');
          } else {
            button.classList.add('wrong');
          }
        }
      } else {
        button.addEventListener('click', () => {
          if (selectedAnswers[questionNumber] === undefined) {
            selectedAnswers[questionNumber] = answer;
            safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
            if (answer === item.answers[item.correctIndex]) {
              button.classList.add('correct');
            } else {
              button.classList.add('wrong');
              addWrongQuestion(questionNumber);
            }
            updateProgressInfo();
            updateStatsInfo();
          }
        });
      }
      answersEl.appendChild(button);
    });
    questionEl.appendChild(answersEl);

    // Extra Options: Flag, Qeyd, Cavabı sil
    const extraOptionsDiv = document.createElement('div');
    extraOptionsDiv.className = 'extra-options';

    // Flag düyməsi
    const flagButton = document.createElement('button');
    flagButton.className = 'flag-btn';
    flagButton.innerHTML = flaggedQuestions.includes(questionNumber) ? '<i class="fa fa-flag"></i> Unflag' : '<i class="fa fa-flag-o"></i> İşarələ';
    flagButton.addEventListener('click', () => toggleFlagged(questionNumber, flagButton));
    extraOptionsDiv.appendChild(flagButton);

    // Qeyd düyməsi
    const noteButton = document.createElement('button');
    noteButton.className = 'note-btn';
    noteButton.innerHTML = '<i class="fa fa-sticky-note"></i> Qeyd əlavə et';
    noteButton.addEventListener('click', () => toggleNoteArea(questionNumber));
    extraOptionsDiv.appendChild(noteButton);

    // Cavabı sil düyməsi
    const clearAnswerButton = document.createElement('button');
    clearAnswerButton.className = 'clear-answer-btn';
    clearAnswerButton.innerHTML = '<i class="fa fa-eraser"></i> Cavabı sil';
    clearAnswerButton.addEventListener('click', () => {
      delete selectedAnswers[questionNumber];
      safeSetItem(getStorageKey("selectedAnswers"), selectedAnswers);
      if (!wrongQuestions.includes(questionNumber)) {
        wrongQuestions.push(questionNumber);
        safeSetItem(getStorageKey("wrongQuestions"), wrongQuestions);
      }
      renderQuizWrongOnly();
      updateWrongQuestionsList();
      updateProgressInfo();
    });
    extraOptionsDiv.appendChild(clearAnswerButton);

    // Qeyd textarea bölməsi
    const noteDiv = document.createElement('div');
    noteDiv.style.display = 'none';
    noteDiv.id = 'noteDiv-' + questionNumber;
    const noteTextarea = document.createElement('textarea');
    noteTextarea.placeholder = "Qeyd...";
    noteTextarea.rows = 3;
    if (questionNotes[questionNumber]) {
      noteTextarea.value = questionNotes[questionNumber];
      noteDiv.style.display = 'block';
    }
    ['input', 'blur'].forEach(evt =>
      noteTextarea.addEventListener(evt, () => {
        questionNotes[questionNumber] = noteTextarea.value;
        safeSetItem(getStorageKey("questionNotes"), questionNotes);
      })
    );
    noteDiv.appendChild(noteTextarea);
    extraOptionsDiv.appendChild(noteDiv);

    questionEl.appendChild(extraOptionsDiv);
    container.appendChild(questionEl);
  });
}

    // Global search functions
    window.performSearch = function() {
      console.log("performSearch called");
      currentSearchQuery = document.getElementById('searchInput').value;
      console.log("Search query:", currentSearchQuery);
      currentIndex = 0;
      renderQuiz();
      updatePageNavigation();
      // Axtarış nəticələrində yuxarı qalx
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const firstQuestion = document.querySelector('.question');
        if (firstQuestion) {
          firstQuestion.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    };

    window.clearSearch = function() {
      console.log("clearSearch called");
      currentSearchQuery = "";
      document.getElementById('searchInput').value = "";
      currentIndex = 0;
      renderQuiz();
      updatePageNavigation();
      // Təmizləndikdən sonra yuxarı qalx
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const firstQuestion = document.querySelector('.question');
        if (firstQuestion) {
          firstQuestion.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    };

    window.handleSearchInput = function(event) {
      console.log("handleSearchInput called, key:", event.key);
      // Real-time search on typing
      if (event.key === 'Enter') {
        window.performSearch();
      } else {
        // Debounced search for better performance
        clearTimeout(window.searchTimeout);
        window.searchTimeout = setTimeout(() => {
          currentSearchQuery = document.getElementById('searchInput').value;
          console.log("Debounced search query:", currentSearchQuery);
          currentIndex = 0;
          renderQuiz();
          updatePageNavigation();
          // Debounced axtarışda da yuxarı qalx
          setTimeout(() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            const firstQuestion = document.querySelector('.question');
            if (firstQuestion) {
              firstQuestion.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 100);
        }, 300);
      }
    };

    window.testSearch = function() {
      console.log("=== TEST SEARCH ===");
      console.log("allQuestions length:", allQuestions.length);
      console.log("orderedQuestions length:", orderedQuestions.length);
      console.log("currentCategory:", currentCategory);
      console.log("currentSearchQuery:", currentSearchQuery);
      console.log("searchInput value:", document.getElementById('searchInput').value);
      
      // Set a test search query
      document.getElementById('searchInput').value = "test";
      currentSearchQuery = "test";
      console.log("Set test search query to 'test'");
      
      renderQuiz();
      updatePageNavigation();
    };

  // Sual aralığını parse edən funksiya
  function parseQuestionRange(rangeStr) {
    if (!rangeStr || rangeStr.trim() === "") return null;
    
    const range = rangeStr.trim();
    const dashIndex = range.indexOf('-');
    
    if (dashIndex === -1) {
      // Tək sual nömrəsi
      const num = parseInt(range);
      return isNaN(num) ? null : { start: num, end: num };
    }
    
    const startStr = range.substring(0, dashIndex).trim();
    const endStr = range.substring(dashIndex + 1).trim();
    
    const start = parseInt(startStr);
    const end = parseInt(endStr);
    
    if (isNaN(start) || isNaN(end) || start > end || start < 1) {
      return null;
    }
    
    return { start, end };
  }

  // Sual aralığına görə filter edən funksiya
  function filterQuestionsByRange(questions) {
    if (!questionRange || questionRange.trim() === "") {
      return questions;
    }
    
    const range = parseQuestionRange(questionRange);
    if (!range) {
      console.warn("Yanlış sual aralığı formatı:", questionRange);
      return questions;
    }
    
    return questions.filter((_, index) => {
      const questionNumber = index + 1;
      return questionNumber >= range.start && questionNumber <= range.end;
    });
  }

  // Adaptiv suallar üçün sıralama funksiyası
  function createAdaptiveOrder(questions) {
    if (!adaptiveMode) return questions;
    
    // Hər sualın çətinlik dərəcəsini hesabla (səhv sayına görə)
    const questionDifficulty = questions.map((q, index) => {
      const questionNumber = allQuestions.indexOf(q) + 1;
      const wrongCount = questionWrongCount[questionNumber] || 0;
      return { question: q, difficulty: wrongCount, originalIndex: index };
    });
    
    // Çətinlik dərəcəsinə görə sırala (ən çətin suallar əvvəldə)
    questionDifficulty.sort((a, b) => b.difficulty - a.difficulty);
    
    // Adaptiv ağırlıq sistemi: çətin suallar daha tez təkrarlansın
    const adaptiveQuestions = [];
    questionDifficulty.forEach((item, index) => {
      const repeatCount = Math.max(1, Math.floor(item.difficulty / 2) + 1);
      for (let i = 0; i < repeatCount; i++) {
        adaptiveQuestions.push(item.question);
      }
    });
    
    // Sonra random qarışdır
    for (let i = adaptiveQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [adaptiveQuestions[i], adaptiveQuestions[j]] = [adaptiveQuestions[j], adaptiveQuestions[i]];
    }
    
    return adaptiveQuestions;
  }

  // Təkmilləşdirilmiş qeyd sistemi
  function createEnhancedNoteArea(questionNumber) {
    const noteDiv = document.createElement('div');
    noteDiv.style.display = 'none';
    noteDiv.id = 'noteDiv-' + questionNumber;
    noteDiv.className = 'note-container';
    
    // Qeyd başlığı
    const noteHeader = document.createElement('div');
    noteHeader.className = 'note-header';
    
    const noteTitle = document.createElement('span');
    noteTitle.innerHTML = '<i class="fa fa-sticky-note"></i> Qeyd';
    
    const noteActions = document.createElement('div');
    noteActions.className = 'note-actions';
    
    // Simvol sayı
    const charCount = document.createElement('span');
    charCount.className = 'character-count';
    charCount.textContent = '0/500';
    
    // Yadda saxla düyməsi
    const saveBtn = document.createElement('button');
    saveBtn.className = 'note-action-btn save';
    saveBtn.innerHTML = '<i class="fa fa-save"></i> Saxla';
    saveBtn.addEventListener('click', () => saveNote(questionNumber));
    
    // Sil düyməsi
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'note-action-btn delete';
    deleteBtn.innerHTML = '<i class="fa fa-trash"></i> Sil';
    deleteBtn.addEventListener('click', () => deleteNote(questionNumber));
    
    noteActions.appendChild(charCount);
    noteActions.appendChild(saveBtn);
    noteActions.appendChild(deleteBtn);
    noteHeader.appendChild(noteTitle);
    noteHeader.appendChild(noteActions);
    
    // Qeyd textarea
    const noteTextarea = document.createElement('textarea');
    noteTextarea.placeholder = "Bu sual haqqında qeydlərinizi yazın...";
    noteTextarea.rows = 4;
    noteTextarea.maxLength = 500;
    
    // Mövcud qeydi yüklə
    if (questionNotes[questionNumber]) {
      noteTextarea.value = questionNotes[questionNumber];
      noteDiv.style.display = 'block';
      updateCharCount(noteTextarea, charCount);
    }
    
    // Event listener-lər
    noteTextarea.addEventListener('input', () => {
      updateCharCount(noteTextarea, charCount);
      autoSaveNote(questionNumber, noteTextarea.value);
    });
    
    noteTextarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveNote(questionNumber);
      }
    });
    
    noteDiv.appendChild(noteHeader);
    noteDiv.appendChild(noteTextarea);
    
    return noteDiv;
  }

  function updateCharCount(textarea, charCountElement) {
    const count = textarea.value.length;
    const maxLength = textarea.maxLength;
    charCountElement.textContent = `${count}/${maxLength}`;
    
    // Rəng dəyişdir
    charCountElement.className = 'character-count';
    if (count > maxLength * 0.8) {
      charCountElement.classList.add('warning');
    }
    if (count > maxLength * 0.95) {
      charCountElement.classList.remove('warning');
      charCountElement.classList.add('danger');
    }
  }

  function autoSaveNote(questionNumber, content) {
    questionNotes[questionNumber] = content;
    safeSetItem(getStorageKey("questionNotes"), questionNotes);
  }

  function saveNote(questionNumber) {
    const textarea = document.querySelector(`#noteDiv-${questionNumber} textarea`);
    if (textarea) {
      questionNotes[questionNumber] = textarea.value;
      safeSetItem(getStorageKey("questionNotes"), questionNotes);
      
      // Saxla düyməsini müvəqqəti olaraq dəyişdir
      const saveBtn = document.querySelector(`#noteDiv-${questionNumber} .save`);
      const originalText = saveBtn.innerHTML;
      saveBtn.innerHTML = '<i class="fa fa-check"></i> Saxlandı!';
      saveBtn.style.background = '#dcfce7';
      saveBtn.style.color = '#16a34a';
      
      setTimeout(() => {
        saveBtn.innerHTML = originalText;
        saveBtn.style.background = '';
        saveBtn.style.color = '';
      }, 1500);
    }
  }

  function deleteNote(questionNumber) {
    if (confirm('Bu qeydi silmək istədiyinizə əminsiniz?')) {
      delete questionNotes[questionNumber];
      safeSetItem(getStorageKey("questionNotes"), questionNotes);
      
      const noteDiv = document.getElementById('noteDiv-' + questionNumber);
      if (noteDiv) {
        noteDiv.style.display = 'none';
        const textarea = noteDiv.querySelector('textarea');
        if (textarea) {
          textarea.value = '';
        }
      }
    }
  }

  // Flashcard rejimini düzgün başlat
  function initializeFlashcardMode() {
    const savedMode = safeGetItem("flashcardMode", "false");
    if (savedMode === null) {
      // Əgər heç bir dəyər yoxdursa, OFF ilə başlat
      safeSetItem("flashcardMode", "false");
      flashcardMode = false;
    } else {
      // Mövcud dəyəri istifadə et
      flashcardMode = savedMode === 'true';
    }
    
    // Düyməni yenilə
    const flashcardBtn = document.getElementById('flashcardModeBtn');
    const flashcardLabel = document.getElementById('flashcardModeLabel');
    if (flashcardBtn && flashcardLabel) {
      flashcardLabel.textContent = flashcardMode ? 'ON' : 'OFF';
      flashcardBtn.style.background = flashcardMode ? '#dc3545' : '#8b5cf6';
    }
  }

  // Səhifə yükləndikdə flashcard rejimini düzgün başlat
  document.addEventListener('DOMContentLoaded', function() {
    initializeFlashcardMode();
  });

  // Təhlükəsiz silmə funksiyası
  function safeRemoveItem(key) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error('localStorage silmə xətası:', error);
      return false;
    }
  }

  // Məlumatları bərpa etmək üçün funksiya
  function recoverData() {
    try {
      // localStorage və sessionStorage arasında məlumatları sinxronizasiya et
      const keys = [...new Set([...Object.keys(localStorage), ...Object.keys(sessionStorage)])];
      
      keys.forEach(key => {
        const localValue = localStorage.getItem(key);
        const sessionValue = sessionStorage.getItem(key);
        
        if (localValue && !sessionValue) {
          // localStorage-də var, sessionStorage-də yox
          sessionStorage.setItem(key, localValue);
        } else if (!localValue && sessionValue) {
          // sessionStorage-də var, localStorage-də yox
          localStorage.setItem(key, sessionValue);
        }
      });
      
      console.log('Məlumatlar bərpa edildi');
      return true;
    } catch (error) {
      console.error('Məlumat bərpa xətası:', error);
      return false;
    }
  }

  // Mobil cihazlar üçün xüsusi funksiyalar
  function handleMobileStorage() {
    // Mobil brauzerlərdə localStorage məhdudiyyətləri
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      // Mobil cihazlarda daha tez-tez yadda saxla
      setInterval(autoSave, 15000); // 15 saniyədə bir
      
      // Səhifə görünməz olduqda yadda saxla
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          autoSave();
        }
      });
      
      // Brauzer geri/irəli düymələri üçün
      window.addEventListener('popstate', autoSave);
    }
  }

  // Məlumatları yoxlamaq üçün funksiya
  function checkDataIntegrity() {
    const requiredKeys = [
      getStorageKey("selectedAnswers"),
      getStorageKey("wrongQuestions"),
      getStorageKey("flaggedQuestions"),
      getStorageKey("questionNotes"),
      getStorageKey("questionWrongCount")
    ];
    
    const missingKeys = requiredKeys.filter(key => 
      !localStorage.getItem(key) && !sessionStorage.getItem(key)
    );
    
    if (missingKeys.length > 0) {
      console.warn('Bəzi məlumatlar tapılmadı:', missingKeys);
      return false;
    }
    
    return true;
  }

  // Səhifə yükləndikdə məlumatları bərpa et
  document.addEventListener('DOMContentLoaded', function() {
    recoverData();
    handleMobileStorage();
    
    // Məlumat bütövlüyünü yoxla
    if (!checkDataIntegrity()) {
      console.log('Məlumat bütövlüyü problemi aşkar edildi, bərpa cəhdi...');
      recoverData();
    }
    
    // Firebase auth-ı başlat
    setTimeout(() => {
      initializeAuth();
    }, 1000); // Firebase yüklənməsi üçün vaxt ver
  });

  // Məlumatları export etmək üçün funksiya
  function exportData() {
    try {
      const exportData = {
        timestamp: Date.now(),
        category: currentCategory,
        selectedAnswers: selectedAnswers,
        wrongQuestions: wrongQuestions,
        flaggedQuestions: flaggedQuestions,
        questionNotes: questionNotes,
        questionWrongCount: questionWrongCount,
        settings: {
          questionsPerPage: questionsPerPage,
          questionRange: questionRange,
          orderMode: orderMode,
          adaptiveMode: adaptiveMode,
          flashcardMode: flashcardMode
        }
      };
      
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], {type: 'application/json'});
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `ets_backup_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      
      URL.revokeObjectURL(url);
      alert('Məlumatlar uğurla export edildi!');
    } catch (error) {
      console.error('Export xətası:', error);
      alert('Export zamanı xəta baş verdi!');
    }
  }

  // Məlumatları import etmək üçün funksiya
  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = function(e) {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const importData = JSON.parse(e.target.result);
          
          if (confirm('Mövcud məlumatlar silinəcək. Davam etmək istəyirsiniz?')) {
            // Məlumatları yüklə
            selectedAnswers = importData.selectedAnswers || {};
            wrongQuestions = importData.wrongQuestions || [];
            flaggedQuestions = importData.flaggedQuestions || [];
            questionNotes = importData.questionNotes || {};
            questionWrongCount = importData.questionWrongCount || {};
            
            // Tənzimləmələri yüklə
            if (importData.settings) {
              questionsPerPage = importData.settings.questionsPerPage || 10;
              questionRange = importData.settings.questionRange || "";
              orderMode = importData.settings.orderMode || "ARDICIL";
              adaptiveMode = importData.settings.adaptiveMode || false;
              flashcardMode = importData.settings.flashcardMode || false;
            }
            
            // localStorage-ə yadda saxla
            autoSave();
            
            // UI-ni yenilə
            if (currentCategory) {
              renderQuiz();
              updateWrongQuestionsList();
              updateFlaggedQuestionsList();
              updateRepeatedMistakesList();
              updateProgressInfo();
              updatePageNavigation();
            }
            
            alert('Məlumatlar uğurla import edildi!');
          }
        } catch (error) {
          console.error('Import xətası:', error);
          alert('Import zamanı xəta baş verdi! Fayl düzgün formatda deyil.');
        }
      };
      reader.readAsText(file);
    };
    
    input.click();
  }

  // Məlumatları təmizləmək üçün funksiya
  function clearAllData() {
    if (confirm('BÜTÜN məlumatlar silinəcək! Bu əməliyyat geri alına bilməz. Davam etmək istəyirsiniz?')) {
      if (confirm('Əmin olduğunuzu təsdiqləyin:')) {
        try {
          // Bütün localStorage və sessionStorage məlumatlarını təmizlə
          localStorage.clear();
          sessionStorage.clear();
          
          // Dəyişənləri sıfırla
          selectedAnswers = {};
          wrongQuestions = [];
          flaggedQuestions = [];
          questionNotes = {};
          questionWrongCount = {};
          currentIndex = 0;
          
          // UI-ni yenilə
          if (currentCategory) {
            renderQuiz();
            updateWrongQuestionsList();
            updateFlaggedQuestionsList();
            updateRepeatedMistakesList();
            updateProgressInfo();
            updatePageNavigation();
          }
          
          alert('Bütün məlumatlar təmizləndi!');
        } catch (error) {
          console.error('Təmizləmə xətası:', error);
          alert('Təmizləmə zamanı xəta baş verdi!');
        }
      }
    }
  }

  // Bütün kateqoriyaları yükləyən funksiya
  async function loadAllCategories() {
    const categories = [
      { name: 'Farmakologiya', file: 'farm.json', icon: 'fa-flask' },
      { name: 'PATFİZ', file: 'patfiz.json', icon: 'fa-heartbeat' },
      { name: 'PATFIZ2', file: 'patfiz2.json', icon: 'fa-brain' },
      { name: 'PATAN1', file: 'patan1a.json', icon: 'fa-dna' },
      { name: 'PATAN2', file: 'patan2a.json', icon: 'fa-virus' },
      { name: 'DYES', file: 'patandyes.json', icon: 'fa-bacteria' },
      { name: 'MIKROB1', file: 'mikrob1.json', icon: 'fa-microchip' },
      { name: 'MIKROB2', file: 'mikrob2.json', icon: 'fa-microchip' },
      { name: 'NORFIZ1', file: 'norfiz1.json', icon: 'fa-microchip' },
      { name: 'NORFIZ2', file: 'norfiz2.json', icon: 'fa-microchip' }
    ];

    allCategoriesData = {};
    let totalQuestions = 0;

    for (let category of categories) {
      try {
        const response = await fetch(category.file);
        if (response.ok) {
          const data = await response.json();
          allCategoriesData[category.name] = {
            questions: data.map(q => shuffleAnswers(q)),
            icon: category.icon,
            count: data.length
          };
          totalQuestions += data.length;
        }
      } catch (error) {
        console.error(`${category.name} yüklənmədi:`, error);
      }
    }

    // Default bölgü yarat (bərabər bölgü)
    const categoryNames = Object.keys(allCategoriesData);
    const defaultShare = Math.floor(100 / categoryNames.length);
    
    categoryDistribution = {};
    categoryNames.forEach((name, index) => {
      categoryDistribution[name] = index === categoryNames.length - 1 ? 
        (100 - (defaultShare * (categoryNames.length - 1))) : defaultShare;
    });

    console.log('Bütün kateqoriyalar yükləndi:', allCategoriesData);
    console.log('Default bölgü:', categoryDistribution);
    
    return totalQuestions;
  }

  // Bölgü panelini göstərən funksiya
  function showDistributionPanel() {
    const panel = document.getElementById('distributionPanel');
    const distributionContainer = document.getElementById('categoryDistribution');
    
    if (panel && distributionContainer) {
      panel.style.display = 'block';
      
      // Bölgü kontrollarını yarat
      distributionContainer.innerHTML = '';
      
      Object.keys(allCategoriesData).forEach(categoryName => {
        const categoryDiv = document.createElement('div');
        categoryDiv.style.cssText = 'background:#fff; padding:15px; border-radius:8px; border:1px solid #e5e7eb;';
        
        const icon = allCategoriesData[categoryName].icon;
        const count = allCategoriesData[categoryName].count;
        const currentShare = categoryDistribution[categoryName] || 0;
        
        categoryDiv.innerHTML = `
          <div style="display:flex; align-items:center; margin-bottom:10px;">
            <i class="fa ${icon}" style="margin-right:8px; color:#2563eb;"></i>
            <strong>${categoryName}</strong>
            <span style="margin-left:auto; color:#6b7280; font-size:0.9em;">(${count} sual)</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <label style="font-size:0.9em; color:#374151;">Faiz:</label>
            <input type="number" 
                   min="0" 
                   max="100" 
                   value="${currentShare}" 
                   onchange="updateDistribution('${categoryName}', this.value)"
                   style="width:60px; padding:4px; border-radius:4px; border:1px solid #ccc;">
            <span style="font-size:0.9em; color:#6b7280;">%</span>
          </div>
        `;
        
        distributionContainer.appendChild(categoryDiv);
      });
      // Panel göstəriləndə cəmi yoxla
      checkDistributionTotal();
    }
  }

  // Bölgünü yeniləyən funksiya
  function updateDistribution(categoryName, value) {
    categoryDistribution[categoryName] = parseInt(value) || 0;
    
    // UI-ni yenilə
    showDistributionPanel();
    // Cəmi yoxla və xəbərdarlıq göstər
    checkDistributionTotal();
  }

  // Bölgünü tətbiq edən funksiya
  function applyDistribution() {
    distributionInterval = parseInt(document.getElementById('distributionInterval').value) || 10;
    
    // Bölgünü localStorage-ə yadda saxla
    safeSetItem('categoryDistribution', categoryDistribution);
    safeSetItem('distributionInterval', distributionInterval);
    
    // Qarışıq sualları yarat
    createMixedQuestions();
    
    // Panel bağla
    document.getElementById('distributionPanel').style.display = 'none';
    
    alert('Bölgü tətbiq edildi!');
  }

  // Bölgünü sıfırlayan funksiya
  function resetDistribution() {
    const categoryNames = Object.keys(allCategoriesData);
    const defaultShare = Math.floor(100 / categoryNames.length);
    
    categoryDistribution = {};
    categoryNames.forEach((name, index) => {
      categoryDistribution[name] = index === categoryNames.length - 1 ? 
        (100 - (defaultShare * (categoryNames.length - 1))) : defaultShare;
    });
    
    document.getElementById('distributionInterval').value = 10;
    distributionInterval = 10;
    
    showDistributionPanel();
  }

  // Qarışıq sualları yaradan funksiya
  function createMixedQuestions() {
    if (!isAllCategoriesMode) return;
    
    const mixedQuestions = [];
    const categoryNames = Object.keys(allCategoriesData);
    
    // Hər interval üçün sualları seç
    for (let i = 0; i < 10000; i += distributionInterval) { // 1000 sual limiti
      const intervalQuestions = [];
      
      // Hər kateqoriyadan nisbi sayda sual al
      categoryNames.forEach(categoryName => {
        const share = categoryDistribution[categoryName] || 0;
        const questionsFromCategory = Math.round((share / 100) * distributionInterval);
        
        const categoryQuestions = allCategoriesData[categoryName].questions;
        const selectedQuestions = getRandomQuestions(categoryQuestions, questionsFromCategory);
        
        selectedQuestions.forEach(q => {
          q.sourceCategory = categoryName; // Mənbə kateqoriyasını qeyd et
        });
        
        intervalQuestions.push(...selectedQuestions);
      });
      
      // Əgər intervalQuestions azdırsa, təsadüfi suallarla doldur
      while (intervalQuestions.length < distributionInterval) {
        const randomCategory = categoryNames[Math.floor(Math.random() * categoryNames.length)];
        const randomQuestion = getRandomQuestions(allCategoriesData[randomCategory].questions, 1)[0];
        if (randomQuestion && !intervalQuestions.includes(randomQuestion)) {
          randomQuestion.sourceCategory = randomCategory;
          intervalQuestions.push(randomQuestion);
        }
      }
      
      // Interval suallarını qarışdır və əlavə et
      shuffleArray(intervalQuestions);
      mixedQuestions.push(...intervalQuestions.slice(0, distributionInterval));
    }
    
    // Ümumi sualları qarışdır
    shuffleArray(mixedQuestions);
    
    // allQuestions-ə təyin et
    allQuestions = mixedQuestions;
    applyOrderMode();
    
    console.log('Qarışıq suallar yaradıldı:', allQuestions.length);
  }

  // Təsadüfi suallar seçən funksiya
  function getRandomQuestions(questions, count) {
    const shuffled = [...questions];
    shuffleArray(shuffled);
    return shuffled.slice(0, Math.min(count, questions.length));
  }

  // Array-i qarışdıran funksiya
  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // selectCategory funksiyasını yenilə
  async function selectCategory(filename) {
    console.log("Seçilən kateqoriya:", filename);
    currentCategory = filename;
    currentIndex = safeGetItem('currentIndex_' + filename, 0);
    isFlaggedMode = false;
    isAllCategoriesMode = false;
    currentSearchQuery = "";
    document.getElementById('searchInput').value = "";
    loadCategoryState();
    document.getElementById('questionCountContainer').style.display = 'block';
    document.getElementById('categoryResetContainer').style.display = 'block';
    document.getElementById('searchContainer').style.display = 'block';
    document.getElementById('distributionPanel').style.display = 'none'; // Bölgü panelini gizlət
    
    // Focus on search input
    setTimeout(() => {
      document.getElementById('searchInput').focus();
    }, 100);
    
    document.querySelectorAll('.category-btn').forEach(btn => {
      if (btn.getAttribute('data-category') === filename || btn.id === 'cat-all') {
        btn.classList.add('selected');
        btn.classList.remove('inactive');
      } else {
        btn.classList.remove('selected');
        btn.classList.add('inactive');
      }
    });

    // Əgər bütün kateqoriyalar seçilibsə
    if (filename === 'all-categories') {
      isAllCategoriesMode = true;
      
      // Bütün kateqoriyaları yüklə
      const totalQuestions = await loadAllCategories();
      
      // Yadda saxlanılan bölgünü yüklə
      const savedDistribution = safeGetItem('categoryDistribution', null);
      const savedInterval = safeGetItem('distributionInterval', 10);
      
      if (savedDistribution) {
        categoryDistribution = savedDistribution;
        distributionInterval = savedInterval;
      }
      
      // Bölgü panelini göstər
      showDistributionPanel();
      
      // Qarışıq sualları yarat
      createMixedQuestions();
      
      renderQuiz();
      updateWrongQuestionsList();
      updateFlaggedQuestionsList();
      updateRepeatedMistakesList();
      updateProgressInfo();
      updatePageNavigation();
      return;
    }

    // Əgər bütün patan alt kateqoriyaları üçünsə
    if (filename === 'patan-all') {
      // Bütün alt kateqoriyaların json-larını yüklə və birləşdir
      const files = ['patan2a.json', 'patan1a.json', 'patandyes.json'];
      let all = [];
      for (let file of files) {
        try {
          const resp = await fetch(file);
          if (resp.ok) {
            const data = await resp.json();
            all = all.concat(data);
          }
        } catch (e) {
          console.error(file, "yüklənmədi:", e);
        }
      }
      allQuestions = all.map(q => shuffleAnswers(q));
      applyOrderMode();
      renderQuiz();
      updateWrongQuestionsList();
      updateFlaggedQuestionsList();
      updateRepeatedMistakesList();
      updateProgressInfo();
      updatePageNavigation();
      return;
    }

    // Standart halda bir json yüklə
    loadQuizData();
}
    // Firebase Authentication və Sync funksiyaları
  function signInWithGoogle() {
    if (!window.firebaseAuth || !window.firebaseProvider) {
      alert('Firebase yüklənmədi. Zəhmət olmasa səhifəni yeniləyin.');
      return;
    }

    window.signInWithPopup(window.firebaseAuth, window.firebaseProvider)
      .then((result) => {
        currentUser = result.user;
        showUserInfo();
        loadUserDataFromCloud();
        console.log('Daxil oldunuz:', currentUser.email);
      })
      .catch((error) => {
        console.error('Giriş xətası:', error);
        alert('Giriş zamanı xəta baş verdi: ' + error.message);
      });
  }

  function signOutUser() {
    if (!window.firebaseAuth) return;

    window.signOut(window.firebaseAuth)
      .then(() => {
        currentUser = null;
        hideUserInfo();
        console.log('Çıxış edildi');
      })
      .catch((error) => {
        console.error('Çıxış xətası:', error);
      });
  }

  function showUserInfo() {
    const userInfoDiv = document.getElementById('userInfo');
    const loginPrompt = document.getElementById('loginPrompt');
    
    if (userInfoDiv && currentUser) {
      userInfoDiv.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; padding:10px; background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#fff; border-radius:8px; margin-bottom:10px;">
          <img src="${currentUser.photoURL || 'https://via.placeholder.com/32'}" style="width:32px; height:32px; border-radius:50%;">
          <span style="font-weight:bold;">${currentUser.displayName || currentUser.email}</span>
          <button onclick="signOutUser()" style="margin-left:auto; background:none; border:none; color:#fff; cursor:pointer; font-size:1.2em;">🚪</button>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <button onclick="saveUserDataToCloud()" style="background:#2563eb; color:#fff; border:none; padding:8px 12px; border-radius:6px; cursor:pointer; font-size:0.9em;">
            <i class="fa fa-cloud-upload"></i> Buluda yadda saxla
          </button>
          <button onclick="loadUserDataFromCloud()" style="background:#10b981; color:#fff; border:none; padding:8px 12px; border-radius:6px; cursor:pointer; font-size:0.9em;">
            <i class="fa fa-cloud-download"></i> Buluddan yüklə
          </button>
        </div>
        ${lastSyncTime ? `<div style="font-size:0.8em; color:#666; text-align:center;">Son sinxronlaşma: ${lastSyncTime}</div>` : ''}
      `;
      userInfoDiv.style.display = 'block';
      
      // Login prompt-u gizlət
      if (loginPrompt) loginPrompt.style.display = 'none';
    }
  }

  function hideUserInfo() {
    const userInfoDiv = document.getElementById('userInfo');
    const loginPrompt = document.getElementById('loginPrompt');
    
    if (userInfoDiv) {
      userInfoDiv.style.display = 'none';
    }
    
    // Login prompt-u göstər
    if (loginPrompt) loginPrompt.style.display = 'block';
  }

  // Məlumatı buluda yadda saxla
  async function saveUserDataToCloud() {
    if (!currentUser || !window.firebaseDB) {
      alert('Zəhmət olmasa əvvəlcə daxil olun.');
      return;
    }

    if (isSyncing) {
      alert('Sinxronlaşma davam edir, zəhmət olmasa gözləyin.');
      return;
    }

    isSyncing = true;
    const syncStatus = document.getElementById('syncStatus');
    if (syncStatus) syncStatus.textContent = 'Buluda yadda saxlanılır...';

    try {
      const userData = {
        userId: currentUser.uid,
        email: currentUser.email,
        lastUpdated: new Date().toISOString(),
        category: currentCategory,
        selectedAnswers: selectedAnswers,
        wrongQuestions: wrongQuestions,
        flaggedQuestions: flaggedQuestions,
        questionNotes: questionNotes,
        questionWrongCount: questionWrongCount,
        settings: {
          questionsPerPage: questionsPerPage,
          questionRange: questionRange,
          orderMode: orderMode,
          adaptiveMode: adaptiveMode,
          flashcardMode: flashcardMode,
          categoryDistribution: categoryDistribution,
          distributionInterval: distributionInterval
        }
      };

      await window.setDoc(window.doc(window.firebaseDB, 'users', currentUser.uid), userData);
      
      lastSyncTime = new Date().toLocaleString('az-AZ');
      showUserInfo();
      
      if (syncStatus) syncStatus.textContent = 'Uğurla yadda saxlandı!';
      setTimeout(() => {
        if (syncStatus) syncStatus.textContent = '';
      }, 2000);
      
      console.log('Məlumat buluda yadda saxlandı');
    } catch (error) {
      console.error('Yadda saxlama xətası:', error);
      alert('Yadda saxlama zamanı xəta baş verdi: ' + error.message);
      if (syncStatus) syncStatus.textContent = 'Xəta baş verdi!';
    } finally {
      isSyncing = false;
    }
  }

  // Məlumatı buluddan yüklə
  async function loadUserDataFromCloud() {
    if (!currentUser || !window.firebaseDB) {
      alert('Zəhmət olmasa əvvəlcə daxil olun.');
      return;
    }

    if (isSyncing) {
      alert('Sinxronlaşma davam edir, zəhmət olmasa gözləyin.');
      return;
    }

    isSyncing = true;
    const syncStatus = document.getElementById('syncStatus');
    if (syncStatus) syncStatus.textContent = 'Buluddan yüklənilir...';

    try {
      const docRef = window.doc(window.firebaseDB, 'users', currentUser.uid);
      const docSnap = await window.getDoc(docRef);

      if (docSnap.exists()) {
        const userData = docSnap.data();
        
        // Məlumatları yüklə
        selectedAnswers = userData.selectedAnswers || {};
        wrongQuestions = userData.wrongQuestions || [];
        flaggedQuestions = userData.flaggedQuestions || [];
        questionNotes = userData.questionNotes || {};
        questionWrongCount = userData.questionWrongCount || {};
        
        // Tənzimləmələri yüklə
        if (userData.settings) {
          questionsPerPage = userData.settings.questionsPerPage || 10;
          questionRange = userData.settings.questionRange || "";
          orderMode = userData.settings.orderMode || "ARDICIL";
          adaptiveMode = userData.settings.adaptiveMode || false;
          flashcardMode = userData.settings.flashcardMode || false;
          categoryDistribution = userData.settings.categoryDistribution || {};
          distributionInterval = userData.settings.distributionInterval || 10;
        }

        // localStorage-ə yadda saxla
        autoSave();
        
        // UI-ni yenilə
        if (currentCategory) {
          renderQuiz();
          updateWrongQuestionsList();
          updateFlaggedQuestionsList();
          updateRepeatedMistakesList();
          updateProgressInfo();
          updatePageNavigation();
        }

        lastSyncTime = new Date().toLocaleString('az-AZ');
        showUserInfo();
        
        if (syncStatus) syncStatus.textContent = 'Məlumat yükləndi!';
        setTimeout(() => {
          if (syncStatus) syncStatus.textContent = '';
        }, 2000);
        
        console.log('Məlumat buluddan yükləndi');
        alert('Məlumatlar uğurla yükləndi!');
      } else {
        alert('Bu hesab üçün heç bir məlumat tapılmadı.');
        if (syncStatus) syncStatus.textContent = 'Məlumat tapılmadı';
      }
    } catch (error) {
      console.error('Yükləmə xətası:', error);
      alert('Yükləmə zamanı xəta baş verdi: ' + error.message);
      if (syncStatus) syncStatus.textContent = 'Xəta baş verdi!';
    } finally {
      isSyncing = false;
    }
  }

  // İstifadəçi giriş vəziyyətini izlə
  function initializeAuth() {
    if (!window.firebaseAuth) return;

    window.onAuthStateChanged(window.firebaseAuth, (user) => {
      if (user) {
        currentUser = user;
        showUserInfo();
        console.log('İstifadəçi daxil oldu:', user.email);
      } else {
        currentUser = null;
        hideUserInfo();
        console.log('İstifadəçi çıxış etdi');
      }
    });
  }

  // Bütün kateqoriyaları yükləyən funksiya
  async function loadAllCategories() {
    const categories = [
      { name: 'Farmakologiya', file: 'farm.json', icon: 'fa-flask' },
      { name: 'PATFİZ', file: 'patfiz.json', icon: 'fa-heartbeat' },
      { name: 'PATFIZ2', file: 'patfiz2.json', icon: 'fa-brain' },
      { name: 'PATAN1', file: 'patan1a.json', icon: 'fa-dna' },
      { name: 'PATAN2', file: 'patan2a.json', icon: 'fa-virus' },
      { name: 'DYES', file: 'patandyes.json', icon: 'fa-bacteria' },
      { name: 'MIKROB1', file: 'mikrob1.json', icon: 'fa-microchip' },
      { name: 'MIKROB2', file: 'mikrob2.json', icon: 'fa-microchip' },
      { name: 'NORFIZ1', file: 'norfiz1.json', icon: 'fa-microchip' },
      { name: 'NORFIZ2', file: 'norfiz2.json', icon: 'fa-microchip' }
    ];

    allCategoriesData = {};
    let totalQuestions = 0;

    for (let category of categories) {
      try {
        const response = await fetch(category.file);
        if (response.ok) {
          const data = await response.json();
          allCategoriesData[category.name] = {
            questions: data.map(q => shuffleAnswers(q)),
            icon: category.icon,
            count: data.length
          };
          totalQuestions += data.length;
        }
      } catch (error) {
        console.error(`${category.name} yüklənmədi:`, error);
      }
    }

    // Default bölgü yarat (bərabər bölgü)
    const categoryNames = Object.keys(allCategoriesData);
    const defaultShare = Math.floor(100 / categoryNames.length);
    
    categoryDistribution = {};
    categoryNames.forEach((name, index) => {
      categoryDistribution[name] = index === categoryNames.length - 1 ? 
        (100 - (defaultShare * (categoryNames.length - 1))) : defaultShare;
    });

    console.log('Bütün kateqoriyalar yükləndi:', allCategoriesData);
    console.log('Default bölgü:', categoryDistribution);
    
    return totalQuestions;
  }