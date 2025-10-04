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
  res.send("🔥 Cronjob service aktif (daily income + referral auto-hold)!");
});


// ============================================================
// ✅ CRON 1: Jalankan harian untuk bagi hasil (daily income)
// ============================================================
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
        const elapsedDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
        const paidDays = p.paidDays || 0;
        const newDays = Math.min(elapsedDays, p.duration) - paidDays;

        if (newDays > 0) {
          const income = p.dailyIncome * newDays;

          // 🔹 Tambahkan income ke saldo
          await userRef.update({
            saldo: admin.firestore.FieldValue.increment(income),
            aset: admin.firestore.FieldValue.increment(income),
          });

          // 🔹 Update status progress
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

          // 🔹 Kirim notifikasi
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


// ============================================================
// ✅ CRON 2: Proses Bonus Referral (Auto-Hold sampai Approved)
// ============================================================
app.get("/cron/referral-bonus", async (req, res) => {
  try {
    const purchasesSnap = await db
      .collection("purchases")
      .where("status", "==", "approved")
      .where("isFirstPurchase", "==", true)
      .get();

    if (purchasesSnap.empty) {
      return res.json({ success: true, message: "Tidak ada pembelian baru." });
    }

    let processed = 0;

    for (const doc of purchasesSnap.docs) {
      const purchase = { id: doc.id, ...doc.data() };

      // ✅ Skip kalau bonus sudah diproses sebelumnya
      const bonusSnap = await db
        .collection("referralBonuses")
        .where("purchaseId", "==", doc.id)
        .get();
      if (!bonusSnap.empty) continue;

      const userRef = db.collection("users").doc(purchase.userId);
      const userSnap = await userRef.get();
      const userData = userSnap.data();

      if (!userData?.invitedBy) continue;

      // ✅ Proses bonus kalau status benar-benar approved
      if (purchase.status === "approved") {
        let sponsorId = userData.invitedBy;
        let level = 1;

        while (sponsorId && level <= 2) {
          const sponsorRef = db.collection("users").doc(sponsorId);
          const sponsorSnap = await sponsorRef.get();
          if (!sponsorSnap.exists) break;

          const sponsorData = sponsorSnap.data();
          let bonus = 0;
          if (level === 1) bonus = 20000; // langsung
          if (level === 2) bonus = 5000;  // sponsor di atasnya

          if (bonus > 0) {
            // 💰 Tambahkan ke saldo bonus
            await sponsorRef.update({
              bonusBalance: admin.firestore.FieldValue.increment(bonus),
            });

            // 📄 Catat transaksi bonus
            await db.collection("referralBonuses").add({
              sponsorId,
              fromUserId: purchase.userId,
              purchaseId: purchase.id,
              level,
              bonus,
              status: "released", // sudah cair karena approved
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // 🔔 Kirim notifikasi
            await db.collection("notifications").add({
              userId: sponsorId,
              title: "🎁 Bonus Referral Aktif",
              message: `Bonus Rp ${bonus.toLocaleString()} telah dikreditkan dari level ${level}`,
              type: "referral",
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }

          sponsorId = sponsorData.invitedBy || null;
          level++;
        }

        processed++;
      }
    }

    res.json({ success: true, processed });
  } catch (err) {
    console.error("❌ Error referral bonus:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ✅ Wajib untuk Vercel
module.exports = app;
