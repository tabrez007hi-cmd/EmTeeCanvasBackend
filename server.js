const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ✨ FIX: Modern Modular Firebase Admin Imports
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

// 1. Initialize Firebase Admin
// Ensure 'serviceAccountKey.json' is in the same folder as this server.js file
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  // Production (Render/Heroku)
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} else {
  // Local Development
  serviceAccount = require('./serviceAccountKey.json');
}

const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
  // ✨ FIX: Looks for either the standard name or your Vite specific .env name
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL 
});

// Initialize the specific services
const db = getDatabase(firebaseApp);
const adminAuth = getAuth(firebaseApp);

const app = express();

// 2. Middleware
app.use(cors({origin: ['http://localhost:5173', 'https://emteecanvas.vercel.app'] })); 
app.use(express.json());

// 3. Authentication Middleware
const verifyAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });

  try {
    // ✨ FIX: Using the modular getAuth() to verify the token
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken; 
    next();
  } catch (error) {
    res.status(403).json({ error: 'Unauthorized: Invalid token' });
  }
};

// ==========================================
// 🚀 API ROUTES
// ==========================================

// GET User Profile
app.get('/api/user/profile', verifyAuth, async (req, res) => {
  try {
    const snapshot = await db.ref(`users/${req.user.uid}/profile`).once('value');
    res.json(snapshot.val() || {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// GET User Workspaces
app.get('/api/workspaces', verifyAuth, async (req, res) => {
  try {
    const snapshot = await db.ref(`users/${req.user.uid}/workspaces`).once('value');
    const workspaces = snapshot.val() ? Object.values(snapshot.val()) : [];
    workspaces.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(workspaces);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch workspaces' });
  }
});

// POST Create New Workspace
app.post('/api/workspaces', verifyAuth, async (req, res) => {
  const { newId, newWS, forcePublic, userProfile, userRole } = req.body;
  const uid = req.user.uid;

  try {
    const dbUpdates = {};
    dbUpdates[`users/${uid}/workspaces/${newId}`] = newWS;
    
    if (forcePublic) {
       dbUpdates[`publicWorkspaces/${newId}`] = { 
          ...newWS, 
          authorId: uid, 
          authorName: userProfile?.username || 'Unknown', 
          authorPhoto: userProfile?.photoURL || null, 
          authorRole: userRole 
       };
    }

    await db.ref().update(dbUpdates);
    res.json({ success: true, workspaceId: newId });
    console.log(`Workspace ${newId} created by user ${uid}`);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

// GET Explore (Public Workspaces)
app.get('/api/explore', verifyAuth, async (req, res) => {
  try {
    const snapshot = await db.ref('publicWorkspaces').once('value');
    const publicItems = snapshot.val() ? Object.values(snapshot.val()) : [];
    
    const formattedItems = publicItems.map(ws => ({
      ...ws,
      likeCount: ws.likes ? Object.keys(ws.likes).length : 0,
      isLikedByMe: ws.likes ? !!ws.likes[req.user.uid] : false
    }));
    
    formattedItems.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(formattedItems);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch explore feed' });
  }
});

// POST Toggle Like
app.post('/api/workspaces/:workspaceId/like', verifyAuth, async (req, res) => {
  const { workspaceId } = req.params;
  const { authorId, isLikedByMe } = req.body;
  const uid = req.user.uid;

  try {
    const updates = {};
    if (isLikedByMe) {
      updates[`users/${authorId}/workspaces/${workspaceId}/likes/${uid}`] = null;
      updates[`publicWorkspaces/${workspaceId}/likes/${uid}`] = null;
    } else {
      updates[`users/${authorId}/workspaces/${workspaceId}/likes/${uid}`] = true;
      updates[`publicWorkspaces/${workspaceId}/likes/${uid}`] = true;
    }
    
    await db.ref().update(updates);
    res.json({ success: true, liked: !isLikedByMe });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🦅 Custom Backend running on http://localhost:${PORT}`));