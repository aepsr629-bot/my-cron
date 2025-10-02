const express = require("express");
const admin = require("firebase-admin");

// 🔹 Pakai serviceAccountKey.json (download dari Firebase Console > Project Settings > Service Accounts)
const serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const app = express();

// 🔹 API endpoint untuk trigger cronjob
app.get("/run-daily", async (req, res) => {
  try {
    const snapshot = await db.collection("purchases")
      .where("status", "==", "approved")
      .get();

    let updatedCount = 0;

    for (const doc of snapshot.docs) {
      const p = doc.data();
      const userRef = db.collection("users").doc(p.userId);

      // Hitung income harian
      await userRef.update({
        saldo: admin.firestore.FieldValue.increment(p.dailyIncome || 0)
      });

      updatedCount++;
    }

    res.json({ success: true, updated: updatedCount });
  } catch (err) {
    console.error("🔥 Error dailyIncome:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("✅ Daily Income Cron is running!");
});

// Gunakan port Vercel
app.listen(3000, () => console.log("Server running on port 3000"));
