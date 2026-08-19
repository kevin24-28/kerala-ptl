const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDB, getDB } = require('./database');
const { calculateFreightBreakdown } = require('./rateEngine');
const { generateBarcodeBase64 } = require('./labelService');
const { sendBookingEmail, sendLREmail, sendDeliveryEmail } = require('./emailService');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. EMBEDDED HTML: OPERATIONS SCANNER (/ops)
// ==========================================
const opsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Corridor 9 | Ground Operations Scanner</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --primary: #0f172a; --brand: #2563eb; --bg: #f8fafc; --border: #e2e8f0; --radius: 12px; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background-color: var(--bg); color: var(--primary); min-height: 100vh; padding: 20px 14px; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
    .card { background: white; border-radius: var(--radius); padding: 20px; border: 1px solid var(--border); margin-bottom: 16px; }
    .card-title { font-size: 15px; font-weight: 800; margin-bottom: 14px; }
    .form-group { margin-bottom: 12px; }
    label { display: block; font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 4px; }
    input, select { width: 100%; padding: 11px 12px; border: 1.5px solid var(--border); border-radius: 8px; font-size: 14px; }
    input:focus, select:focus { outline: none; border-color: var(--brand); }
    .btn { width: 100%; padding: 12px; border-radius: 8px; font-size: 14px; font-weight: 700; border: none; cursor: pointer; }
    .btn-primary { background: var(--brand); color: white; }
    .btn-dark { background: var(--primary); color: white; }
    .alert { padding: 12px; border-radius: 8px; font-size: 13px; margin-top: 12px; }
    .alert-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .tab-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .tab-btn { background: #e2e8f0; border: none; padding: 10px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; color: #475569; }
    .tab-btn.active { background: var(--primary); color: white; }
  </style>
</head>
<body>
<div class="container">
  <header class="header">
    <div>
      <strong style="font-size: 18px;">CORRIDOR 9 OPS</strong>
      <div style="font-size:11px; color:#64748b;">Ground Staff & Driver Scanner</div>
    </div>
    <span style="font-size:11px; background:#e0f2fe; color:#0369a1; padding:4px 8px; border-radius:6px; font-weight:bold;">PIN: 1234</span>
  </header>

  <div id="pinGate" class="card" style="margin-top: 40px;">
    <div class="card-title">🔒 Ground Operations Access</div>
    <div class="form-group">
      <label>Staff Security PIN</label>
      <input type="password" id="staffPin" placeholder="Enter PIN (1234)" autofocus />
    </div>
    <button class="btn btn-primary" onclick="checkPin()">Unlock Scanner Console</button>
    <div id="pinAlert"></div>
  </div>

  <div id="opsConsole" style="display:none;">
    <div class="tab-row">
      <button id="tabPickupBtn" class="tab-btn active" onclick="switchOpsTab('pickup')">1. Driver Pickup</button>
      <button id="tabInwardBtn" class="tab-btn" onclick="switchOpsTab('inward')">2. Hub Inward</button>
    </div>

    <div id="pickupSection" class="card">
      <div class="card-title">🚚 First-Mile Box Pickup</div>
      <div class="form-group">
        <label>Driver ID / Vehicle</label>
        <input type="text" id="driverId" value="DRV-ALUVA-01" />
      </div>
      <div class="form-group">
        <label>Scan Box Barcode (e.g. C9-123456-B1)</label>
        <input type="text" id="pickupBarcode" placeholder="Scan or paste barcode..." />
      </div>
      <button class="btn btn-primary" onclick="submitPickupScan()">Confirm Pickup Scan</button>
      <div id="pickupAlert"></div>
    </div>

    <div id="inwardSection" class="card" style="display:none;">
      <div class="card-title">🏢 Central Hub Inward Sorting</div>
      <div class="form-group">
        <label>Hub Location</label>
        <select id="hubLocation">
          <option value="Kochi Central Mother Hub">Kochi Central Mother Hub (Aluva)</option>
          <option value="Thrissur Hub">Thrissur Hub</option>
          <option value="Kozhikode Hub">Kozhikode Hub</option>
        </select>
      </div>
      <div class="form-group">
        <label>Scan Box Barcode</label>
        <input type="text" id="inwardBarcode" placeholder="Scan barcode for bay route..." />
      </div>
      <button class="btn btn-dark" onclick="submitInwardScan()">Scan & Get Bay Location</button>
      <div id="inwardAlert"></div>
    </div>
  </div>
</div>

<script>
  function checkPin() {
    if (document.getElementById('staffPin').value === '1234') {
      document.getElementById('pinGate').style.display = 'none';
      document.getElementById('opsConsole').style.display = 'block';
    } else {
      document.getElementById('pinAlert').innerHTML = '<div class="alert alert-error">Invalid Staff PIN.</div>';
    }
  }

  function switchOpsTab(tab) {
    document.getElementById('tabPickupBtn').className = tab === 'pickup' ? 'tab-btn active' : 'tab-btn';
    document.getElementById('tabInwardBtn').className = tab === 'inward' ? 'tab-btn active' : 'tab-btn';
    document.getElementById('pickupSection').style.display = tab === 'pickup' ? 'block' : 'none';
    document.getElementById('inwardSection').style.display = tab === 'inward' ? 'block' : 'none';
  }

  async function submitPickupScan() {
    const box_barcode = document.getElementById('pickupBarcode').value.trim();
    const driver_id = document.getElementById('driverId').value.trim();
    if (!box_barcode) return alert('Please enter barcode.');

    const res = await fetch('/api/scan/pickup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box_barcode, driver_id, location: 'Merchant Doorstep' })
    });
    const data = await res.json();
    const alertBox = document.getElementById('pickupAlert');
    if (data.success) {
      let lrMsg = data.all_boxes_picked ? '<br><strong>🎉 All Boxes Picked! Generated ' + data.lr_number + '</strong>' : '';
      alertBox.innerHTML = '<div class="alert alert-success">✅ ' + data.message + lrMsg + '</div>';
      document.getElementById('pickupBarcode').value = '';
    } else {
      alertBox.innerHTML = '<div class="alert alert-error">❌ ' + data.error + '</div>';
    }
  }

  async function submitInwardScan() {
    const box_barcode = document.getElementById('inwardBarcode').value.trim();
    const hub_name = document.getElementById('hubLocation').value;
    if (!box_barcode) return alert('Please enter barcode.');

    const res = await fetch('/api/scan/warehouse-inward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box_barcode, warehouse_staff_id: 'STAFF-HUB-01', hub_name })
    });
    const data = await res.json();
    const alertBox = document.getElementById('inwardAlert');
    if (data.success) {
      alertBox.innerHTML = '<div class="alert alert-success">📦 <strong>' + data.box_barcode + '</strong> Inward Complete.<br><span style="font-size:16px; font-weight:800; color:#1e3a8a;">👉 ' + data.route_instruction + '</span></div>';
      document.getElementById('inwardBarcode').value = '';
    } else {
      alertBox.innerHTML = '<div class="alert alert-error">❌ ' + data.error + '</div>';
    }
  }
</script>
</body>
</html>`;

// ==========================================
// 2. EMBEDDED HTML: MASTER ADMIN (/admin)
// ==========================================
const adminHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Corridor 9 | Master Control Tower</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root { --primary: #0f172a; --brand: #2563eb; --accent: #10b981; --warning: #f59e0b; --bg: #f8fafc; --border: #e2e8f0; --radius: 12px; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background-color: var(--bg); color: var(--primary); min-height: 100vh; padding: 24px 16px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .brand-title { font-size: 22px; font-weight: 800; }
    .admin-pill { background: #fee2e2; color: #991b1b; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; }
    .pin-card { max-width: 400px; margin: 80px auto; background: white; padding: 32px; border-radius: var(--radius); border: 1px solid var(--border); }
    input { width: 100%; padding: 11px 14px; border: 1.5px solid var(--border); border-radius: 8px; font-size: 14px; margin-top: 8px; }
    .btn { width: 100%; padding: 12px; border-radius: 8px; font-size: 14px; font-weight: 700; border: none; cursor: pointer; margin-top: 14px; }
    .btn-primary { background: var(--brand); color: white; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .kpi-card { background: white; padding: 20px; border-radius: var(--radius); border: 1px solid var(--border); }
    .kpi-label { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; }
    .kpi-value { font-size: 26px; font-weight: 800; margin-top: 6px; }
    .card { background: white; border-radius: var(--radius); padding: 24px; border: 1px solid var(--border); margin-bottom: 24px; }
    .card-title { font-size: 16px; font-weight: 800; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th { background: #f8fafc; text-align: left; padding: 10px; color: #64748b; font-weight: 700; border-bottom: 1px solid var(--border); }
    td { padding: 12px 10px; border-bottom: 1px solid var(--border); }
    .status-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .st-created { background: #fef3c7; color: #92400e; }
    .st-picked { background: #e0f2fe; color: #0369a1; }
    .st-delivered { background: #dcfce7; color: #15803d; }
  </style>
</head>
<body>
<div class="container">
  <header class="header">
    <div>
      <h1 class="brand-title">CORRIDOR 9 <span class="admin-pill">MASTER CONTROL TOWER</span></h1>
      <div style="font-size:12px; color:#64748b;">NH-66 Central Network Operations & Revenue Ledger</div>
    </div>
    <button id="adminLogoutBtn" class="btn" style="width:auto; margin:0; padding:6px 14px; background:#f1f5f9; color:#334155; display:none;" onclick="adminLogout()">Sign Out</button>
  </header>

  <div id="adminPinGate" class="pin-card">
    <h2 style="font-size:18px; margin-bottom:6px;">🔒 Super-Admin Verification</h2>
    <p style="font-size:13px; color:#64748b; margin-bottom:14px;">Enter the Master Administrator PIN:</p>
    <input type="password" id="adminPinInput" placeholder="Enter PIN (Default: 9999)" autofocus />
    <button class="btn btn-primary" onclick="verifyAdminPin()">Unlock Control Tower</button>
    <div id="pinError" style="color:red; font-size:12px; margin-top:8px;"></div>
  </div>

  <div id="adminContent" style="display:none;">
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Gross Freight Revenue</div>
        <div class="kpi-value" id="kpiRevenue" style="color:var(--brand);">₹0</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Consignments</div>
        <div class="kpi-value" id="kpiTotalShipments">0</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Active In Transit</div>
        <div class="kpi-value" id="kpiActiveShipments" style="color:var(--warning);">0</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Registered Merchants</div>
        <div class="kpi-value" id="kpiMerchants" style="color:var(--accent);">0</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>📦 All Corridor Consignments</span>
        <button class="btn btn-primary" style="width:auto; margin:0; padding:6px 12px; font-size:12px;" onclick="loadAdminData()">🔄 Refresh</button>
      </div>
      <div style="overflow-x:auto;">
        <table id="adminShipmentsTable">
          <thead>
            <tr>
              <th>Docket #</th>
              <th>Date</th>
              <th>Shipper</th>
              <th>Consignee</th>
              <th>Route</th>
              <th>Boxes/Wt</th>
              <th>Freight</th>
              <th>Status</th>
              <th>Invoice</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span>👥 Registered Merchants & Wallets</span></div>
      <div style="overflow-x:auto;">
        <table id="adminMerchantsTable">
          <thead>
            <tr>
              <th>Customer ID</th>
              <th>Company</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Wallet Balance</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script>
  function verifyAdminPin() {
    if (document.getElementById('adminPinInput').value === "9999") {
      document.getElementById('adminPinGate').style.display = 'none';
      document.getElementById('adminContent').style.display = 'block';
      document.getElementById('adminLogoutBtn').style.display = 'block';
      loadAdminData();
    } else {
      document.getElementById('pinError').innerText = 'Invalid Admin Passcode.';
    }
  }

  function adminLogout() {
    document.getElementById('adminPinGate').style.display = 'block';
    document.getElementById('adminContent').style.display = 'none';
    document.getElementById('adminLogoutBtn').style.display = 'none';
    document.getElementById('adminPinInput').value = '';
  }

  async function loadAdminData() {
    const res = await fetch('/api/admin/overview');
    const data = await res.json();
    if (!data.success) return;

    document.getElementById('kpiRevenue').innerText = '₹' + Number(data.summary.total_revenue).toLocaleString('en-IN');
    document.getElementById('kpiTotalShipments').innerText = data.summary.total_shipments;
    document.getElementById('kpiActiveShipments').innerText = data.summary.active_shipments;
    document.getElementById('kpiMerchants').innerText = data.summary.total_merchants;

    const sBody = document.querySelector('#adminShipmentsTable tbody');
    sBody.innerHTML = data.dockets.length ? data.dockets.map(d => \`
      <tr>
        <td><strong>\${d.docket_id}</strong><br><small style="color:#64748b;">\${d.lr_number || ''}</small></td>
        <td><small>\${new Date(d.created_at).toLocaleDateString()}</small></td>
        <td><strong>\${d.company || d.customer_name}</strong></td>
        <td>\${d.consignee_name}</td>
        <td>\${d.origin} ➔ \${d.destination}</td>
        <td>\${d.total_boxes} bxs (\${d.chargeable_weight_kg}kg)</td>
        <td><strong style="color:var(--brand);">₹\${d.total_deducted}</strong></td>
        <td><span class="status-badge \${d.status === 'DELIVERED' ? 'st-delivered' : d.status === 'PICKED_UP' ? 'st-picked' : 'st-created'}">\${d.status}</span></td>
        <td><a href="/api/invoice/\${d.docket_id}" target="_blank" style="color:var(--brand); font-weight:700; text-decoration:none;">📄 PDF</a></td>
      </tr>
    \`).join('') : '<tr><td colspan="9" style="text-align:center; color:#94a3b8;">No consignments booked yet.</td></tr>';

    const mBody = document.querySelector('#adminMerchantsTable tbody');
    mBody.innerHTML = data.merchants.length ? data.merchants.map(m => \`
      <tr>
        <td><code>\${m.customer_id}</code></td>
        <td><strong>\${m.company || m.name}</strong></td>
        <td>\${m.name}</td>
        <td>\${m.email}</td>
        <td>\${m.phone}</td>
        <td><strong style="color:var(--accent);">₹\${m.wallet_balance}</strong></td>
        <td><button onclick="adminAdjustBalance('\${m.customer_id}')" style="padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">+ Add ₹</button></td>
      </tr>
    \`).join('') : '<tr><td colspan="7" style="text-align:center; color:#94a3b8;">No merchants registered yet.</td></tr>';
  }

  async function adminAdjustBalance(cid) {
    const amt = prompt('Add amount in ₹ for ' + cid + ':', '5000');
    if (!amt) return;
    const res = await fetch('/api/wallet/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: cid, amount: Number(amt) })
    });
    const d = await res.json();
    if (d.success) { alert('Added ₹' + amt); loadAdminData(); }
  }
</script>
</body>
</html>`;

// ==========================================
// 3. DIRECT ROUTE HANDLERS
// ==========================================
app.get('/ops', (req, res) => res.send(opsHtml));
app.get('/ops.html', (req, res) => res.send(opsHtml));

app.get('/admin', (req, res) => res.send(adminHtml));
app.get('/admin.html', (req, res) => res.send(adminHtml));

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// --- SUPER-ADMIN OVERVIEW API ---
app.get('/api/admin/overview', (req, res) => {
  try {
    const dataStorePath = path.join(__dirname, 'data_store.json');
    let store = { dockets: {}, users: {} };
    if (fs.existsSync(dataStorePath)) {
      store = JSON.parse(fs.readFileSync(dataStorePath, 'utf8'));
    }
    const allDockets = Object.values(store.dockets || {}).reverse();
    const allMerchants = Object.values(store.users || {});
    let totalRevenue = 0;
    allDockets.forEach(d => { totalRevenue += Number(d.total_deducted || 0); });

    res.json({
      success: true,
      summary: {
        total_revenue: totalRevenue,
        total_shipments: allDockets.length,
        active_shipments: allDockets.filter(d => d.status !== 'DELIVERED').length,
        total_merchants: allMerchants.length
      },
      dockets: allDockets,
      merchants: allMerchants
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 1. USER AUTHENTICATION ---
app.post('/api/auth/register', (req, res) => {
  try {
    const db = getDB();
    const { name, email, phone, company, password } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }

    const existing = db.getUser(email);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Account with this email already exists. Please Sign In.' });
    }

    const customer_id = 'C9-CUST-' + Math.floor(1000 + Math.random() * 9000);
    const user = {
      customer_id,
      name,
      email: email.toLowerCase(),
      phone: phone || '',
      company: company || name,
      password,
      wallet_balance: 2000.0,
      created_at: new Date().toISOString()
    };

    db.setUser(email, user);
    db.addTransaction({
      txn_id: 'TXN-BONUS-' + Date.now().toString().slice(-6),
      customer_id,
      type: 'PROMO_BONUS',
      amount: 2000,
      balance_after: 2000,
      description: 'Welcome Promotional Credit',
      timestamp: new Date().toISOString()
    });

    res.json({ success: true, message: 'Account registered.', user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const db = getDB();
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required.' });
    }

    const user = db.getUser(email);
    if (!user || user.password !== password) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    res.json({ success: true, message: 'Login successful.', user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 2. MERCHANT DASHBOARD DATA ---
app.get('/api/merchant/dashboard/:customer_id', (req, res) => {
  try {
    const db = getDB();
    const customer = db.getCustomer(req.params.customer_id);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

    const dockets = db.getDocketsByCustomer(req.params.customer_id) || [];
    const transactions = (db.getTransactions(req.params.customer_id) || []).slice(0, 15);

    res.json({
      success: true,
      customer,
      stats: {
        wallet_balance: customer.wallet_balance || 0,
        total_shipments: dockets.length,
        active_shipments: dockets.filter(d => d.status !== 'DELIVERED').length,
        delivered_shipments: dockets.filter(d => d.status === 'DELIVERED').length
      },
      recent_dockets: dockets.slice(0, 10),
      transactions
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 3. RATE ESTIMATION ---
app.post('/api/quote', (req, res) => {
  try {
    const { origin, destination, dead_weight_kg, cft_volume } = req.body;
    const quote = calculateFreightBreakdown(origin, destination, dead_weight_kg, cft_volume);
    res.json({ success: true, data: quote });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// --- 4. PREPAID WALLET RECHARGE ---
app.post('/api/wallet/topup', (req, res) => {
  try {
    const db = getDB();
    const { customer_id, amount } = req.body;
    const topupAmount = Number(amount);

    if (topupAmount <= 0) return res.status(400).json({ success: false, error: 'Invalid top-up amount' });

    let customer = db.getCustomer(customer_id);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

    customer.wallet_balance += topupAmount;
    db.setCustomer(customer_id, customer);

    const txn_id = 'TXN-TOP-' + Date.now().toString().slice(-6);
    db.addTransaction({
      txn_id,
      customer_id,
      type: 'TOPUP',
      amount: topupAmount,
      balance_after: customer.wallet_balance,
      description: `Prepaid Recharge ₹${topupAmount}`,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true, message: `₹${topupAmount} added.`, current_balance: customer.wallet_balance, txn_id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 5. CREATE INDENT BOOKING ---
app.post('/api/indents/create', async (req, res) => {
  try {
    const db = getDB();
    const {
      customer_id, consignee_name, consignee_phone, consignee_address,
      origin, destination, total_boxes, dead_weight_kg, cft_volume
    } = req.body;

    const customer = db.getCustomer(customer_id);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Session expired. Please log in again.' });
    }

    const quote = calculateFreightBreakdown(origin, destination, Number(dead_weight_kg), Number(cft_volume || 0));

    if (customer.wallet_balance < quote.totalPayable) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance (Required: ₹${quote.totalPayable}, Available: ₹${customer.wallet_balance}). Please add funds.`,
        required_amount: quote.totalPayable,
        current_balance: customer.wallet_balance
      });
    }

    customer.wallet_balance -= quote.totalPayable;
    db.setCustomer(customer_id, customer);

    const docket_id = 'C9-' + Date.now().toString().slice(-6);
    const txn_id = 'TXN-FRT-' + Date.now().toString().slice(-6);

    db.addTransaction({
      txn_id,
      customer_id,
      docket_id,
      type: 'FREIGHT_DEDUCT',
      amount: quote.totalPayable,
      balance_after: customer.wallet_balance,
      description: `Booking ${origin} -> ${destination} (${quote.chargeableWeight}kg)`,
      timestamp: new Date().toISOString()
    });

    const docket = {
      docket_id,
      customer_id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email,
      company: customer.company,
      consignee_name,
      consignee_phone,
      consignee_address,
      origin,
      destination,
      total_boxes: Number(total_boxes),
      dead_weight_kg: Number(dead_weight_kg),
      chargeable_weight_kg: quote.chargeableWeight,
      freight_amount: quote.baseFreight,
      docket_fee: quote.docketFee,
      fuel_surcharge: quote.fuelSurcharge,
      gst_amount: quote.gstAmount,
      total_deducted: quote.totalPayable,
      status: 'INDENT_CREATED',
      created_at: new Date().toISOString()
    };
    db.setDocket(docket_id, docket);

    const boxes = [];
    for (let i = 1; i <= Number(total_boxes); i++) {
      const box_barcode = `${docket_id}-B${i}`;
      db.setBox(box_barcode, {
        box_barcode,
        docket_id,
        box_number: i,
        current_status: 'READY_FOR_PICKUP',
        current_location: origin,
        last_scanned_at: new Date().toISOString()
      });

      const barcodeImage = await generateBarcodeBase64(box_barcode);
      boxes.push({ box_barcode, box_number: i, barcodeImage });
    }

    sendBookingEmail(customer.email, docket);

    res.json({
      success: true,
      message: 'Booking confirmed.',
      docket_id,
      deducted_amount: quote.totalPayable,
      remaining_balance: customer.wallet_balance,
      quote,
      boxes
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 6. DRIVER PICKUP SCAN ---
app.post('/api/scan/pickup', (req, res) => {
  const db = getDB();
  const { box_barcode, driver_id, location } = req.body;

  const box = db.getBox(box_barcode);
  if (!box) return res.status(404).json({ success: false, error: 'Invalid Box Barcode' });

  db.addScanLog({ box_barcode, docket_id: box.docket_id, scan_type: 'PICKUP', location, scanned_by: driver_id, timestamp: new Date().toISOString() });

  box.current_status = 'PICKED_UP';
  box.current_location = location;
  box.scanned_by = driver_id;
  box.last_scanned_at = new Date().toISOString();
  db.setBox(box_barcode, box);

  const pending = db.getBoxesByDocket(box.docket_id).filter(b => b.current_status !== 'PICKED_UP');
  let lrGenerated = false;
  let lr_number = null;

  if (pending.length === 0) {
    lr_number = 'LR-C9-' + Date.now().toString().slice(-6);
    const docket = db.getDocket(box.docket_id);
    if (docket) {
      docket.status = 'PICKED_UP';
      docket.lr_number = lr_number;
      db.setDocket(box.docket_id, docket);
      sendLREmail(docket.customer_email, docket, lr_number);
    }
    lrGenerated = true;
  }

  res.json({ success: true, message: `Box ${box_barcode} Picked Up.`, all_boxes_picked: lrGenerated, lr_number });
});

// --- 7. HUB INWARD ---
app.post('/api/scan/warehouse-inward', (req, res) => {
  const db = getDB();
  const { box_barcode, warehouse_staff_id, hub_name } = req.body;

  const box = db.getBox(box_barcode);
  if (!box) return res.status(404).json({ success: false, error: 'Invalid Box Barcode' });

  const docket = db.getDocket(box.docket_id);
  const dest = docket ? docket.destination.toUpperCase() : '';

  let assigned_bay = 'BAY-GENERAL';
  if (dest.includes('KOZHIKODE') || dest.includes('CALICUT')) assigned_bay = 'BAY-NORTH-KOZHIKODE';
  else if (dest.includes('TRIVANDRUM')) assigned_bay = 'BAY-SOUTH-TRIVANDRUM';
  else if (dest.includes('THRISSUR')) assigned_bay = 'BAY-CENTRAL-THRISSUR';

  db.addScanLog({ box_barcode, docket_id: box.docket_id, scan_type: 'HUB_INWARD', location: hub_name, scanned_by: warehouse_staff_id, timestamp: new Date().toISOString() });

  box.current_status = 'AT_CENTRAL_HUB';
  box.current_location = hub_name;
  box.scanned_by = warehouse_staff_id;
  box.last_scanned_at = new Date().toISOString();
  db.setBox(box_barcode, box);

  res.json({ success: true, box_barcode, destination: dest, route_instruction: `Place box in: ${assigned_bay}` });
});

// --- 8. LINEHAUL OUTWARD ---
app.post('/api/scan/linehaul-outward', (req, res) => {
  const db = getDB();
  const { box_barcode, truck_number, destination_hub } = req.body;

  const box = db.getBox(box_barcode);
  if (!box) return res.status(404).json({ success: false, error: 'Invalid Box Barcode' });

  db.addScanLog({ box_barcode, docket_id: box.docket_id, scan_type: 'LINEHAUL_OUTWARD', location: `LINEHAUL-${truck_number}`, scanned_by: truck_number, timestamp: new Date().toISOString() });

  box.current_status = 'LINEHAUL_TRANSIT';
  box.current_location = `TRUCK-${truck_number} -> ${destination_hub}`;
  box.last_scanned_at = new Date().toISOString();
  db.setBox(box_barcode, box);

  res.json({ success: true, message: `Loaded on Linehaul Truck ${truck_number} bound for ${destination_hub}` });
});

// --- 9. FINAL DELIVERY ---
app.post('/api/scan/deliver', (req, res) => {
  const db = getDB();
  const { docket_id, receiver_name, receiver_phone, signature_data } = req.body;

  db.setPod(docket_id, {
    docket_id,
    receiver_name,
    receiver_phone,
    signature_data: signature_data || 'SIGNED_ON_GLASS',
    delivered_at: new Date().toISOString()
  });

  const docket = db.getDocket(docket_id);
  if (docket) {
    docket.status = 'DELIVERED';
    db.setDocket(docket_id, docket);
    sendDeliveryEmail(docket.customer_email, docket, receiver_name);
  }

  res.json({ success: true, message: `Docket ${docket_id} delivered successfully.` });
});

// --- 10. GST TAX INVOICE ---
app.get('/api/invoice/:docket_id', (req, res) => {
  const db = getDB();
  const docket = db.getDocket(req.params.docket_id);
  if (!docket) return res.status(404).send('<h2>Invoice Not Found</h2>');

  const invoiceHtml = `<!DOCTYPE html>
  <html>
  <head>
    <title>Tax Invoice - ${docket.docket_id} | Corridor 9</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1e293b; max-width: 800px; margin: auto; }
      .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 20px; }
      .company-title { font-size: 26px; font-weight: 900; color: #0f172a; }
      .badge { font-size: 12px; background: #e2e8f0; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
      .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 25px 0; font-size: 13px; line-height: 1.6; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
      th { background: #0f172a; color: white; text-align: left; padding: 10px; }
      td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
      .totals { margin-top: 20px; text-align: right; font-size: 14px; }
      .totals table { width: 300px; margin-left: auto; }
      .totals td { padding: 6px; }
      .print-btn { background: #2563eb; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; margin-bottom: 20px; }
      @media print { .print-btn { display: none; } body { padding: 0; } }
    </style>
  </head>
  <body>
    <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
    <div class="header">
      <div>
        <div class="company-title">CORRIDOR 9 LOGISTICS</div>
        <div style="font-size:12px; color:#666;">Scheduled Express PTL Linehaul Network (NH-66)</div>
        <div style="font-size:12px; color:#666;">GSTIN: 32AAACK1234M1Z5 | Central Mother Hub, Kochi</div>
      </div>
      <div style="text-align: right;">
        <span class="badge">ORIGINAL FOR RECIPIENT</span>
        <h3 style="margin: 8px 0 0 0;">TAX INVOICE</h3>
        <div style="font-size: 12px; color: #555;">Inv #: INV-${docket.docket_id.replace('C9-', '')}</div>
        <div style="font-size: 12px; color: #555;">Date: ${new Date(docket.created_at).toLocaleDateString('en-IN')}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div>
        <strong>Shipper (Billed To):</strong><br>
        Company: ${docket.company || docket.customer_name}<br>
        Contact: ${docket.customer_name}<br>
        Customer ID: ${docket.customer_id}<br>
        Phone: ${docket.customer_phone}
      </div>
      <div>
        <strong>Consignee Details:</strong><br>
        Name: ${docket.consignee_name}<br>
        Destination: ${docket.destination} (${docket.consignee_address})<br>
        Phone: ${docket.consignee_phone}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description (SAC: 996511)</th>
          <th>Boxes</th>
          <th>Chargeable Wt</th>
          <th>Rate/Kg</th>
          <th style="text-align:right;">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Corridor 9 Express Freight (${docket.origin} to ${docket.destination})</td>
          <td>${docket.total_boxes}</td>
          <td>${docket.chargeable_weight_kg} kg</td>
          <td>₹${(docket.freight_amount / docket.chargeable_weight_kg).toFixed(2)}</td>
          <td style="text-align:right;">₹${docket.freight_amount}</td>
        </tr>
        <tr>
          <td colspan="4">Docket Booking & Documentation Fee</td>
          <td style="text-align:right;">₹${docket.docket_fee}</td>
        </tr>
        <tr>
          <td colspan="4">Fuel Surcharge (FSC 10%)</td>
          <td style="text-align:right;">₹${docket.fuel_surcharge}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td><strong>Taxable Subtotal:</strong></td><td style="text-align:right;">₹${docket.freight_amount + docket.docket_fee + docket.fuel_surcharge}</td></tr>
        <tr><td>CGST (2.5%):</td><td style="text-align:right;">₹${(docket.gst_amount / 2).toFixed(2)}</td></tr>
        <tr><td>SGST (2.5%):</td><td style="text-align:right;">₹${(docket.gst_amount / 2).toFixed(2)}</td></tr>
        <tr style="font-size:16px; font-weight:bold; border-top: 2px solid #0f172a;">
          <td>Total Paid (Prepaid):</td>
          <td style="text-align:right; color:#2563eb;">₹${docket.total_deducted}</td>
        </tr>
      </table>
    </div>
  </body>
  </html>`;
  res.send(invoiceHtml);
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Corridor 9 Engine running on port ${PORT}`));
});
