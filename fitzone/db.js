const DB_NAME = "barzelpro-db";
const STORE = "workouts";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE, { keyPath: "id" });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveData(data) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ id: "appData", data });
}

async function loadData() {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).get("appData");

  return new Promise(resolve => {
    req.onsuccess = () => resolve(req.result?.data || null);
  });
}