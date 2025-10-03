const express = require("express");
const admin = require("firebase-admin");

const app = express();

// ✅ Inisialisasi Firebase Admin pakai ENV
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

// ✅ Route utama untuk cek server jalan
app.get("/", (req, res) => {
  res.send("🔥 Cronjob service jalan!");
});

// ✅ Cronjob: jalankan harian
app.get("/cron/daily-income", async (req, res) => {
  try {
    const purchasesSnap = await db
      .collection("purchases")
      .where("status", "==", "approved")
      .get();

    const now = new Date();
    let updated = 0;

    for (const doc of purchasesSnap.docs) {
      const p = doc.data();
      const userRef = db.collection("users").doc(p.userId);

      if (p.dailyIncome && p.duration) {
        const start = p.createdAt.toDate();

        // Hitung total hari sudah lewat sejak pembelian
        const elapsedDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));

        // Sudah dibayar berapa hari
        const paidDays = p.paidDays || 0;

        // Hari baru yang harus dibayar (catch-up juga kalau cron telat)
        const newDays = Math.min(elapsedDays, p.duration) - paidDays;

        if (newDays > 0) {
          const income = p.dailyIncome * newDays;

          // 🔹 Update saldo user
          await userRef.update({
            saldo: admin.firestore.FieldValue.increment(income),
            aset: admin.firestore.FieldValue.increment(income),
          });

          // 🔹 Update purchase progress
          await doc.ref.update({
            paidDays: paidDays + newDays,
            ...(paidDays + newDays >= p.duration
              ? { status: "finished", finishedAt: now }
              : {}),
          });

          // 🔹 Simpan ke riwayat
          await db.collection("history").add({
            userId: p.userId,
            animal: p.animal,
            amount: income,
            type: "income",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // 🔹 Simpan notifikasi
          await db.collection("notifications").add({
            userId: p.userId,
            title: "✅ Claim Harian",
            message: `+ Rp ${income.toLocaleString()} dari ${p.animal} (${newDays} hari)`,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            type: "income",
          });

          updated++;
        }
      }
    }

    res.json({ success: true, updated });
  } catch (err) {
    console.error("❌ Error cronjob:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Wajib untuk Vercel
module.exports = app;
