

// Extracted module scripts (Firebase init və s.)

// Import the functions you need from the SDKs you need
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
    import { getFirestore, doc, setDoc, getDoc, collection } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
    import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

    // Your web app's Firebase configuration
    const firebaseConfig = {
      apiKey: "AIzaSyCOLGCIOWD0G5pNZWNYSqrT5VJjYehzheU",
      authDomain: "hola-b40e3.firebaseapp.com",
      projectId: "hola-b40e3",
      storageBucket: "hola-b40e3.firebasestorage.app",
      messagingSenderId: "333880238833",
      appId: "1:333880238833:web:6119d514d2f3267e7e3f50",
      measurementId: "G-81P0KGGS7J"
    };

    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    
    // Analytics-i yalnız dəstəklənərsə quraşdır
    let analytics = null;
    isSupported().then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    });
    
    const db = getFirestore(app);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();

    // Global Firebase objects
    window.firebaseAuth = auth;
    window.firebaseDB = db;
    window.firebaseProvider = provider;
    window.signInWithPopup = signInWithPopup;
    window.onAuthStateChanged = onAuthStateChanged;
    window.signOut = signOut;
    window.setDoc = setDoc;
    window.getDoc = getDoc;
    window.doc = doc;