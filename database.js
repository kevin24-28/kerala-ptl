const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data_store.json');

let store = {
  users: {},         // email -> { name, email, phone, company, password, wallet_balance, customer_id, created_at }
  customers: {},     // customer_id -> customer object
  transactions: [],  // list of wallet txns
  dockets: {},       // docket_id -> shipment details
  boxes: {},         // box_barcode -> box tracking info
  scan_logs: [],     // audit scan history
  pods: {}           // proof of deliveries
};

async function initDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      store = JSON.parse(data);
    } else {
      saveDB();
    }
  } catch (err) {
    console.error('Error loading DB:', err.message);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('Error saving DB:', err.message);
  }
}

const getDB = () => ({
  // User Authentication
  getUser: (email) => store.users[email?.toLowerCase()],
  setUser: (email, data) => {
    store.users[email.toLowerCase()] = data;
    store.customers[data.customer_id] = data;
    saveDB();
  },
  
  // Customers & Wallets
  getCustomer: (id) => store.customers[id],
  setCustomer: (id, data) => { store.customers[id] = data; saveDB(); },
  
  // Transactions
  addTransaction: (txn) => { store.transactions.unshift(txn); saveDB(); },
  getTransactions: (customerId) => store.transactions.filter(t => t.customer_id === customerId),
  
  // Shipments & Dockets
  getDocket: (id) => store.dockets[id],
  setDocket: (id, data) => { store.dockets[id] = data; saveDB(); },
  getDocketsByCustomer: (customerId) => Object.values(store.dockets).filter(d => d.customer_id === customerId).reverse(),
  
  // Boxes & Scans
  getBox: (barcode) => store.boxes[barcode],
  setBox: (barcode, data) => { store.boxes[barcode] = data; saveDB(); },
  getBoxesByDocket: (docketId) => Object.values(store.boxes).filter(b => b.docket_id === docketId),
  addScanLog: (log) => { store.scan_logs.push(log); saveDB(); },
  
  // POD
  setPod: (docketId, pod) => { store.pods[docketId] = pod; saveDB(); }
});

module.exports = { initDB, getDB };
