const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'store.json');

let store = {
  customers: {},
  dockets: {},
  box_labels: {},
  wallet_transactions: [],
  scan_logs: [],
  pods: {}
};

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('Error saving DB:', err);
  }
}

async function initDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      store = JSON.parse(data);
    } catch (e) {
      console.log('Starting fresh in-memory database.');
    }
  }
  console.log('✅ Pure JS Database Initialized successfully.');
  return true;
}

const db = {
  getCustomer: (id) => store.customers[id] || null,
  setCustomer: (id, data) => { store.customers[id] = data; saveDB(); },
  addTransaction: (tx) => { store.wallet_transactions.unshift(tx); saveDB(); },
  getTransactions: (custId) => store.wallet_transactions.filter(t => t.customer_id === custId),
  setDocket: (id, data) => { store.dockets[id] = data; saveDB(); },
  getDocket: (id) => store.dockets[id] || null,
  setBox: (barcode, data) => { store.box_labels[barcode] = data; saveDB(); },
  getBox: (barcode) => store.box_labels[barcode] || null,
  getBoxesByDocket: (docketId) => Object.values(store.box_labels).filter(b => b.docket_id === docketId),
  addScanLog: (log) => { store.scan_logs.unshift(log); saveDB(); },
  setPod: (docketId, podData) => { store.pods[docketId] = podData; saveDB(); }
};

module.exports = { initDB, getDB: () => db };
