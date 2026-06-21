import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDPOxh2GU3kw0J2kFpzShM8A1UnL5dnu40',
  authDomain: 'h3operations-prod.firebaseapp.com',
  projectId: 'h3operations-prod',
  storageBucket: 'h3operations-prod.firebasestorage.app',
  messagingSenderId: '760093548916',
  appId: '1:760093548916:web:94f8be0187eed623028c21',
  measurementId: 'G-KTB97X9QLR',
}

export const firebaseApp = initializeApp(firebaseConfig)
export const auth = getAuth(firebaseApp)
export const db = getFirestore(firebaseApp)
