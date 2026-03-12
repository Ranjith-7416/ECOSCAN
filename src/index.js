import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// State
let user = null;
let profile = null;
let scans = [];
let redemptions = [];
let chatMessages = [];
let isCameraActive = false;

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const headerPoints = document.getElementById('header-points');
const cardPoints = document.getElementById('card-points');
const cardScans = document.getElementById('card-scans');
const userName = document.getElementById('user-name');
const userId = document.getElementById('user-id');
const startScanBtn = document.getElementById('start-scan-btn');
const cameraContainer = document.getElementById('camera-container');
const video = document.getElementById('camera-video');
const captureBtn = document.getElementById('capture-btn');
const cancelScanBtn = document.getElementById('cancel-scan-btn');
const resultContainer = document.getElementById('result-container');
const resultType = document.getElementById('result-type');
const resultName = document.getElementById('result-name');
const resultPoints = document.getElementById('result-points');
const resultConfidence = document.getElementById('result-confidence');
const resultDesc = document.getElementById('result-desc');
const closeResultBtn = document.getElementById('close-result-btn');
const speakBtn = document.getElementById('speak-btn');
const scansList = document.getElementById('scans-list');
const payoutsList = document.getElementById('payouts-list');
const openRedeemBtn = document.getElementById('open-redeem-btn');
const redeemModal = document.getElementById('redeem-modal');
const closeRedeemModal = document.getElementById('close-redeem-modal');
const submitRedeemBtn = document.getElementById('submit-redeem-btn');
const redeemPointsDisplay = document.getElementById('redeem-points');
const redeemAmountDisplay = document.getElementById('redeem-amount');
const openChatBtn = document.getElementById('open-chat-btn');
const chatDrawer = document.getElementById('chat-drawer');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatMessagesContainer = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const genArtBtn = document.getElementById('gen-art-btn');
const milestoneContainer = document.getElementById('milestone-container');
const milestoneImg = document.getElementById('milestone-img');
const dismissMilestone = document.getElementById('dismiss-milestone');
const canvas = document.getElementById('hidden-canvas');

const PLASTIC_TYPES = {
    'PET': { name: 'Polyethylene Terephthalate', code: '1', points: 10, description: 'Commonly used for water bottles and soda bottles.' },
    'HDPE': { name: 'High-Density Polyethylene', code: '2', points: 15, description: 'Used for milk jugs, detergent bottles, and toys.' },
    'LDPE': { name: 'Low-Density Polyethylene', code: '4', points: 12, description: 'Used for grocery bags, plastic wraps, and squeezable bottles.' },
    'PP': { name: 'Polypropylene', code: '5', points: 20, description: 'Used for yogurt containers, straws, and bottle caps.' },
    'PS': { name: 'Polystyrene', code: '6', points: 18, description: 'Used for disposable plates, cups, and egg cartons.' },
    'Other': { name: 'Other Plastics', code: '7', points: 5, description: 'Miscellaneous plastics like polycarbonate or acrylic.' }
};

// Auth Listener
onAuthStateChanged(auth, async (currentUser) => {
    user = currentUser;
    if (user) {
        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        await fetchOrCreateProfile(user);
        subscribeToScans(user.uid);
        subscribeToRedemptions(user.uid);
    } else {
        authScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
        profile = null;
        scans = [];
        redemptions = [];
    }
});

// Profile Logic
async function fetchOrCreateProfile(currentUser) {
    const userRef = doc(db, 'users', currentUser.uid);
    const userDoc = await getDoc(userRef);

    if (userDoc.exists()) {
        profile = userDoc.data();
        updateUI();
    } else {
        profile = {
            uid: currentUser.uid,
            email: currentUser.email || '',
            displayName: currentUser.displayName || 'Eco Warrior',
            points: 0,
            walletBalance: 0,
            createdAt: Timestamp.now()
        };
        await setDoc(userRef, profile);
        updateUI();
    }

    onSnapshot(userRef, (doc) => {
        if (doc.exists()) {
            profile = doc.data();
            updateUI();
        }
    });
}

function updateUI() {
    if (!profile) return;
    userName.textContent = profile.displayName;
    userId.textContent = `ID: ${profile.uid.slice(0, 8)}...`;
    headerPoints.textContent = profile.points;
    cardPoints.textContent = profile.points;
    cardScans.textContent = scans.length;
    
    // Add wallet balance display if it exists in profile
    const walletDisplay = document.getElementById('wallet-balance');
    if (walletDisplay) {
        walletDisplay.textContent = `$${(profile.walletBalance || 0).toFixed(2)}`;
    }

    redeemPointsDisplay.textContent = profile.points;
    redeemAmountDisplay.textContent = `$${(Math.floor(profile.points / 100)).toFixed(2)}`;
}

// Subscriptions
function subscribeToScans(uid) {
    const q = query(collection(db, 'scans'), where('uid', '==', uid), orderBy('timestamp', 'desc'), limit(10));
    onSnapshot(q, (snapshot) => {
        scans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderScans();
        updateUI();
    });
}

function subscribeToRedemptions(uid) {
    const q = query(collection(db, 'redemptions'), where('uid', '==', uid), orderBy('timestamp', 'desc'), limit(5));
    onSnapshot(q, (snapshot) => {
        redemptions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPayouts();
    });
}

// Rendering
function renderScans() {
    scansList.innerHTML = scans.length === 0 ? 
        `<div class="text-center py-12 border-2 border-dashed border-[#141414]/20 rounded-lg"><p class="text-sm opacity-50 font-medium">No scans yet.</p></div>` :
        scans.map(scan => `
            <div class="bg-white border border-[#141414] p-4 flex justify-between items-center">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 bg-[#141414] text-white flex items-center justify-center font-bold text-lg">
                        ${PLASTIC_TYPES[scan.plasticType]?.code || '?'}
                    </div>
                    <div>
                        <div class="font-bold uppercase text-sm">${scan.plasticType}</div>
                        <div class="text-[10px] mono opacity-50">${scan.timestamp?.toDate().toLocaleDateString()}</div>
                    </div>
                </div>
                <div class="font-black text-lg text-[#00FF00]">+${scan.pointsEarned}</div>
            </div>
        `).join('');
}

function renderPayouts() {
    payoutsList.innerHTML = redemptions.length === 0 ?
        `<div class="text-center py-12 border-2 border-dashed border-[#141414]/20 rounded-lg"><p class="text-sm opacity-50 font-medium">No payouts yet.</p></div>` :
        redemptions.map(red => `
            <div class="bg-white border border-[#141414] p-4 flex justify-between items-center">
                <div>
                    <div class="font-bold uppercase text-sm">$${red.amount.toFixed(2)}</div>
                    <div class="text-[10px] mono opacity-50">${red.timestamp?.toDate().toLocaleDateString()}</div>
                </div>
                <div class="text-[10px] uppercase font-bold px-2 py-1 border border-[#141414] ${
                    red.status === 'approved' ? 'bg-[#00FF00]' : red.status === 'pending' ? 'bg-yellow-400' : 'bg-red-400'
                }">${red.status}</div>
            </div>
        `).join('');
}

// Camera Logic
async function startCamera() {
    try {
        isCameraActive = true;
        cameraContainer.classList.remove('hidden');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
    } catch (err) {
        alert('Camera access failed.');
    }
}

function stopCamera() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
    cameraContainer.classList.add('hidden');
    isCameraActive = false;
}

// AI Logic
async function captureAndClassify() {
    if (!video.srcObject || !user) return;
    captureBtn.disabled = true;
    captureBtn.textContent = 'Analyzing...';

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    try {
        const result = await genAI.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{
                parts: [
                    { text: 'Classify this plastic waste (PET, HDPE, LDPE, PP, PS, or Other). Return JSON: { "plasticType": "TYPE", "confidence": 0.95, "reason": "..." }' },
                    { inlineData: { mimeType: "image/jpeg", data: base64Data } }
                ]
            }],
            config: { responseMimeType: "application/json" }
        });

        const classification = JSON.parse(result.text || '{}');
        if (classification.plasticType) {
            const typeInfo = PLASTIC_TYPES[classification.plasticType] || PLASTIC_TYPES.Other;
            const points = typeInfo.points;

            await addDoc(collection(db, 'scans'), {
                uid: user.uid,
                plasticType: classification.plasticType,
                confidence: classification.confidence || 0,
                pointsEarned: points,
                timestamp: serverTimestamp()
            });

            await updateDoc(doc(db, 'users', user.uid), {
                points: (profile?.points || 0) + points
            });

            showResult(classification, typeInfo, points);
            stopCamera();
            speak(`Identified ${classification.plasticType}. +${points} points!`);
        }
    } catch (err) {
        alert('Classification failed: ' + err.message);
    } finally {
        captureBtn.disabled = false;
        captureBtn.textContent = 'Capture';
    }
}

function showResult(data, info, pts) {
    resultType.textContent = data.plasticType;
    resultName.textContent = info.name;
    resultPoints.textContent = `+${pts}`;
    resultConfidence.textContent = `${(data.confidence * 100).toFixed(1)}% Accuracy`;
    resultDesc.textContent = info.description;
    resultContainer.classList.remove('hidden');
}

async function speak(text) {
    try {
        const response = await genAI.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: `Say: ${text}` }] }],
            config: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
            }
        });
        const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64) new Audio(`data:audio/mp3;base64,${base64}`).play();
    } catch (e) {}
}

// Chat Logic
async function handleChat(e) {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;
    chatInput.value = '';
    addChatMessage('user', msg);

    try {
        const chat = genAI.chats.create({
            model: "gemini-3-flash-preview",
            config: { systemInstruction: "Friendly EcoGuide AI assistant." },
            history: chatMessages.map(m => ({ role: m.role, parts: [{ text: m.text }] }))
        });
        const result = await chat.sendMessage({ message: msg });
        addChatMessage('model', result.text || 'Error');
    } catch (err) {
        addChatMessage('model', 'Error: ' + err.message);
    }
}

function addChatMessage(role, text) {
    chatMessages.push({ role, text });
    const div = document.createElement('div');
    div.className = `flex ${role === 'user' ? 'justify-end' : 'justify-start'}`;
    div.innerHTML = `
        <div class="max-w-[80%] p-3 border-2 border-[#141414] shadow-[2px_2px_0px_#141414] ${role === 'user' ? 'bg-[#00FF00]' : 'bg-white'}">
            <p class="text-sm font-medium">${text}</p>
        </div>
    `;
    chatMessagesContainer.appendChild(div);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// Milestone Art
async function generateArt() {
    genArtBtn.disabled = true;
    genArtBtn.innerHTML = 'Generating...';
    try {
        const response = await genAI.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: `Futuristic eco-art celebrating ${profile.points} recycling points.` }] }
        });
        const base64 = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
        if (base64) {
            milestoneImg.src = `data:image/png;base64,${base64}`;
            milestoneContainer.classList.remove('hidden');
        }
    } catch (e) { alert('Art failed'); }
    finally {
        genArtBtn.disabled = false;
        genArtBtn.innerHTML = 'Generate Milestone Art';
    }
}

// Event Listeners
loginBtn.onclick = () => signInWithPopup(auth, provider);
logoutBtn.onclick = () => signOut(auth);
startScanBtn.onclick = startCamera;
cancelScanBtn.onclick = stopCamera;
captureBtn.onclick = captureAndClassify;
closeResultBtn.onclick = () => resultContainer.classList.add('hidden');
speakBtn.onclick = () => speak(`${resultType.textContent}. ${resultDesc.textContent}`);
openRedeemBtn.onclick = () => redeemModal.classList.remove('hidden');
closeRedeemModal.onclick = () => redeemModal.classList.add('hidden');
openChatBtn.onclick = () => chatDrawer.classList.remove('hidden');
closeChatBtn.onclick = () => chatDrawer.classList.add('hidden');
chatForm.onsubmit = handleChat;
genArtBtn.onclick = generateArt;
dismissMilestone.onclick = () => milestoneContainer.classList.add('hidden');

submitRedeemBtn.onclick = async () => {
    if (!profile || profile.points < 100) return;
    const pts = Math.floor(profile.points / 100) * 100;
    const amt = pts / 100;
    try {
        const docRef = await addDoc(collection(db, 'redemptions'), { 
            uid: user.uid, 
            pointsRedeemed: pts, 
            amount: amt, 
            status: 'pending', 
            timestamp: serverTimestamp() 
        });
        
        await updateDoc(doc(db, 'users', user.uid), { 
            points: profile.points - pts 
        });
        
        redeemModal.classList.add('hidden');
        alert(`Request for $${amt.toFixed(2)} submitted! The government is processing your payment...`);

        // Simulate Government Processing and Automated Payout
        setTimeout(async () => {
            try {
                // Update redemption status to approved
                await updateDoc(doc(db, 'redemptions', docRef.id), {
                    status: 'approved',
                    processedAt: serverTimestamp()
                });

                // Add money to user's wallet balance
                const userRef = doc(db, 'users', user.uid);
                const currentProfile = (await getDoc(userRef)).data();
                await updateDoc(userRef, {
                    walletBalance: (currentProfile.walletBalance || 0) + amt
                });

                speak(`Your payout of $${amt.toFixed(2)} has been approved and sent to your wallet!`);
            } catch (err) {
                console.error('Automated payout failed:', err);
            }
        }, 5000); // 5 second delay for simulation

    } catch (e) { alert('Redeem failed'); }
};
