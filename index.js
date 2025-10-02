const express = require("express");
const admin = require("firebase-admin");

const app = express();

// ✅ Init Firebase Admin pake ENV
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

// ✅ Route utama
app.get("/", (req, res) => {
  res.send("🔥 Cronjob service jalan!");
});

// ✅ Route cronjob
app.get("/cron/daily-income", async (req, res) => {
  try {
    const purchasesSnap = await db.collection("purchases")
      .where("status", "==", "approved")
      .get();

    let updated = 0;

    for (const doc of purchasesSnap.docs) {
      const p = doc.data();
      const userRef = db.collection("users").doc(p.userId);

      if (p.dailyIncome && p.duration) {
        await userRef.update({
          saldo: admin.firestore.FieldValue.increment(p.dailyIncome)
        });
        updated++;
      }
    }

    res.json({ success: true, updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Export untuk Vercel
module.exports = app;
