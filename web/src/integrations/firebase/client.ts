import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyDPOxh2GU3kw0J2kFpzShM8A1UnL5dnu40",
  authDomain: "h3operations-prod.firebaseapp.com",
  projectId: "h3operations-prod",
  storageBucket: "h3operations-prod.firebasestorage.app",
  messagingSenderId: "760093548916",
  appId: "1:760093548916:web:94f8be0187eed623028c21",
  measurementId: "G-KTB97X9QLR",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// Region must match the deployed callables (createCustomer is us-central1).
const functions = getFunctions(app, "us-central1");

export { app, auth, db, functions };
