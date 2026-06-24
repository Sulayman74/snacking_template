// 🔍 Helper script to check Firestore state post-checkout conversion for E2E tests
const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'snacking-template' });
}
const db = admin.firestore();

async function main() {
  const uid = process.argv[2];
  const orderId = process.argv[3];

  if (!uid || !orderId) {
    console.error("Usage: node check-user-converted.cjs <uid> <orderId>");
    process.exit(1);
  }

  // Vérifier le doc utilisateur
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    console.error(`User document users/${uid} does not exist.`);
    process.exit(1);
  }

  const userData = userDoc.data();
  if (userData.isAnonymous !== false) {
    console.error(`User isAnonymous is still true or undefined: ${userData.isAnonymous}`);
    process.exit(1);
  }

  if (!userData.email) {
    console.error("User email is missing in Firestore.");
    process.exit(1);
  }

  // Vérifier le doc commande
  const orderDoc = await db.collection('commandes').doc(orderId).get();
  if (!orderDoc.exists) {
    console.error(`Order document commandes/${orderId} does not exist.`);
    process.exit(1);
  }

  const orderData = orderDoc.data();
  if (orderData.userId !== uid) {
    console.error(`Order userId ${orderData.userId} does not match user uid ${uid}.`);
    process.exit(1);
  }

  console.log("SUCCESS");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
