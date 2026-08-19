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

// ==========================================
// UNIFIED PORTAL SINGLE-PAGE APPLICATION
// ==========================================
const unifiedPortalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Corridor 9 | Unified Logistics Portal</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #0f172a;
      --brand: #2563eb;
      --brand-hover: #1d4ed8;
      --accent: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --radius: 14px;
      --shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.04), 0 8px 10px -6px rgba(15, 23, 42, 0.03);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; }
    body { background-color: var(--bg); color: var(--text-main); min-height: 100vh; padding: 24px 16px; }
    .container { max-width: 1160px; margin: 0 auto; }

    /* Top Bar */
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon { width: 44px; height: 44px; background: linear-gradient(135deg, #0f172a, #2563eb); color: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 17px; }
    .brand-title { font-size: 20px; font-weight: 800; color: var(--primary); }
    
    /* Gate Switcher */
    .role-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin: 40px auto 24px; max-width: 900px; }
    .role-card { background: white; border: 2px solid var(--border); border-radius: var(--radius); padding: 24px; text-align: center; cursor: pointer; transition: all 0.2s ease; }
    .role-card:hover { border-color: var(--brand); transform: translateY(-2px); box-shadow: var(--shadow); }
    .role-card.active { border-color: var(--brand); background: #f0f7ff; }
    .role-icon { font-size: 32px; margin-bottom: 10px; }

    .auth-box { max-width: 440px; margin: 0 auto 50px; background: white; padding: 32px; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: var(--shadow); }
    .auth-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .auth-tab-btn { background: none; border: none; font-size: 14px; font-weight: 700; color: var(--text-muted); cursor: pointer; padding: 6px 12px; }
    .auth-tab-btn.active { color: var(--brand); border-bottom: 2px solid var(--brand); }

    /* Form Controls */
    .form-group { margin-bottom: 14px; text-align: left; }
    .form-group label { display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 6px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    input, select { width: 100%; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 8px; font-size: 14px; }
    input:focus, select:focus { outline: none; border-color: var(--brand); }
    .btn { width: 100%; padding: 12px; border-radius: 8px; font-size: 14px; font-weight: 700; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-primary { background: var(--brand); color: white; }
    .btn-dark { background: var(--primary); color: white; }
    .btn-outline { background: transparent; border: 1.5px solid var(--border); color: #334155; }
    .btn-logout { background: #fee2e2; color: #991b1b; padding: 6px 14px; font-size: 12px; border-radius: 6px; font-weight: 700; border: none; cursor: pointer; }

    /* Dashboard Layouts */
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: white; padding: 20px; border-radius: var(--radius); border: 1px solid var(--border); }
    .stat-label { font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); }
    .stat-value { font-size: 26px; font-weight: 800; margin-top: 6px; }

    .dash-grid { display: grid; grid-template-columns: 1fr 1.6fr; gap: 24px; }
    @media (max-width: 860px) { .dash-grid { grid-template-columns: 1fr; } }
    .card { background: white; border-radius: var(--radius); padding: 24px; border: 1px solid var(--border); margin-bottom: 24px; }
    .card-title { font-size: 16px; font-weight: 800; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th { background: #f8fafc; text-align: left; padding: 10px; color: #64748b; font-weight: 700; border-bottom: 1px solid var(--border); }
    td { padding: 12px 10px; border-bottom: 1px solid var(--border); }
    .status-badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .st-created { background: #fef3c7; color: #92400e; }
    .st-picked { background: #e0f2fe; color: #0369a1; }
    .st-transit { background: #f3e8ff; color: #6b21a8; }
    .st-delivered { background: #dcfce7; color: #15803d; }

    .alert { padding: 12px; border-radius: 8px; font-size: 13px; margin-top: 12px; text-align: left; }
    .alert-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .labels-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin-top: 14px; }
    .label-card { background: white; border: 2px dashed #0f172a; border-radius: 8px; padding: 14px; text-align: center; }
    .label-card img { width: 100%; height: 65px; object-fit: contain; margin: 6px 0; }
  </style>
</head>
<body>

<div class="container">
  <!-- Top Unified Header -->
  <header class="header">
    <div class="brand">
      <div class="brand-icon">C9</div>
      <div>
        <h1 class="brand-title">CORRIDOR 9 LOGISTICS</h1>
        <div style="font-size:12px; color:var(--text-muted);">Scheduled Express PTL Linehaul Network (NH-66)</div>
      </div>
    </div>
    <div id="sessionHeaderActions" style="display:none; align-items:center; gap:12px;">
      <div style="text-align:right;">
        <strong id="sessionUserName" style="font-size:14px;">User</strong><br>
        <span id="sessionBadge" style="font-size:11px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700;">Role</span>
      </div>
      <button class="btn-logout" onclick="logoutCurrentSession()">Sign Out</button>
    </div>
  </header>

  <!-- ========================================== -->
  <!-- 1. LANDING & UNIFIED ROLE SELECTOR GATE    -->
  <!-- ========================================== -->
  <div id="roleSelectorSection">
    <div style="text-align: center; margin-top: 20px;">
      <h2 style="font-size: 24px; font-weight: 800;">Welcome to Corridor 9 Hub</h2>
      <p style="color: var(--text-muted); font-size: 14px; margin-top: 4px;">Select your portal below to sign in:</p>
    </div>

    <div class="role-grid">
      <div class="role-card" id="cardMerchant" onclick="selectRole('merchant')">
        <div class="role-icon">🏢</div>
        <strong style="font-size:16px;">Merchant Client</strong>
        <p style="font-size:12px; color:var(--text-muted); margin-top:6px;">Book consignments, wallet balance, print barcodes & tax invoices.</p>
      </div>

      <div class="role-card" id="cardOps" onclick="selectRole('ops')">
        <div class="role-icon">🚚</div>
        <strong style="font-size:16px;">Ground Operations</strong>
        <p style="font-size:12px; color:var(--text-muted); margin-top:6px;">Driver first-mile pickup scanner & warehouse bay cross-dock inward.</p>
      </div>

      <div class="role-card" id="cardAdmin" onclick="selectRole('admin')">
        <div class="role-icon">🛡️</div>
        <strong style="font-size:16px;">Master Control Tower</strong>
        <p style="font-size:12px; color:var(--text-muted); margin-top:6px;">Gross network revenue, merchant accounts, and live consignment feed.</p>
      </div>
    </div>

    <!-- MERCHANT AUTH FORM -->
    <div id="merchantAuthBox" class="auth-box">
      <div class="auth-tabs">
        <button id="mTabLogin" class="auth-tab-btn active" onclick="switchMerchantTab('login')">Sign In</button>
        <button id="mTabReg" class="auth-tab-btn" onclick="switchMerchantTab('reg')">Create Account (+₹2,000 Bonus)</button>
      </div>

      <form id="merchantLoginForm" onsubmit="handleMerchantLogin(event)">
        <div class="form-group">
          <label>Email Address</label>
          <input type="email" id="mLoginEmail" required placeholder="merchant@business.com" />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="mLoginPassword" required placeholder="••••••••" />
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:16px;">Sign In to Merchant Desk</button>
      </form>

      <form id="merchantRegisterForm" style="display:none;" onsubmit="handleMerchantRegister(event)">
        <div class="form-group">
          <label>Company / Firm Name</label>
          <input type="text" id="mRegCompany" required placeholder="Malabar Traders" />
        </div>
        <div class="form-group">
          <label>Contact Person</label>
          <input type="text" id="mRegName" required placeholder="Rahul V." />
        </div>
        <div class="form-group">
          <label>Mobile Number</label>
          <input type="tel" id="mRegPhone" required placeholder="9847000000" />
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="mRegEmail" required placeholder="trader@gmail.com" />
        </div>
        <div class="form-group">
          <label>Create Password</label>
          <input type="password" id="mRegPass" required placeholder="••••••••" />
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:16px;">Register & Claim ₹2,000 Credit</button>
      </form>
      <div id="merchantAlert"></div>
    </div>

    <!-- OPS PIN GATE -->
    <div id="opsAuthBox" class="auth-box" style="display:none;">
      <h3 style="font-size:16px; margin-bottom:6px;">🚚 Ground Crew Security Verification</h3>
      <p style="font-size:12px; color:var(--text-muted); margin-bottom:14px;">Enter your staff security PIN to unlock the scanner console:</p>
      <div class="form-group">
        <label>Staff PIN (Default: 1234)</label>
        <input type="password" id="opsPinInput" placeholder="Enter PIN (1234)" autofocus />
      </div>
      <button class="btn btn-dark" onclick="verifyOpsPin()">Unlock Ops Console</button>
      <div id="opsAlert"></div>
    </div>

    <!-- ADMIN PIN GATE -->
    <div id="adminAuthBox" class="auth-box" style="display:none;">
      <h3 style="font-size:16px; margin-bottom:6px;">🛡️ Super-Admin Verification</h3>
      <p style="font-size:12px; color:var(--text-muted); margin-bottom:14px;">Enter the Master Administrator PIN:</p>
      <div class="form-group">
        <label>Master PIN (Default: 9999)</label>
        <input type="password" id="adminPinInput" placeholder="Enter PIN (9999)" autofocus />
      </div>
      <button class="btn btn-primary" onclick="verifyAdminPin()">Unlock Control Tower</button>
      <div id="adminAlert"></div>
    </div>
  </div>

  <!-- ========================================== -->
  <!-- 2. MERCHANT DASHBOARD VIEW                 -->
  <!-- ========================================== -->
  <div id="merchantDashboardSection" style="display:none;">
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Prepaid Balance</div>
        <div class="stat-value" id="mStatBalance" style="color:var(--brand);">₹0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Shipments</div>
        <div class="stat-value" id="mStatTotal">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">In Transit</div>
        <div class="stat-value" id="mStatActive" style="color:var(--warning);">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Delivered</div>
        <div class="stat-value" id="mStatDelivered" style="color:var(--accent);">0</div>
      </div>
    </div>

    <div class="dash-grid">
      <!-- Wallet Panel -->
      <div>
        <div class="card">
          <div class="card-title"><span>💳 Wallet Top-Up</span></div>
          <div class="form-group">
            <label>Recharge Amount (₹)</label>
            <input type="number" id="mTopupAmt" value="5000" step="500" />
          </div>
          <button class="btn btn-outline" onclick="topupMerchantWallet()">Add Funds</button>
          <div id="mWalletAlert"></div>
        </div>

        <div class="card">
          <div class="card-title"><span>📜 Wallet Passbook</span></div>
          <div style="max-height: 220px; overflow-y: auto;">
            <table id="mTxnTable">
              <thead><tr><th>Type</th><th>Details</th><th>Amount</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Consignment Indent Booking -->
      <div>
        <div class="card">
          <div class="card-title"><span>📦 Book Linehaul Consignment</span></div>
          <div class="form-row">
            <div class="form-group">
              <label>Origin Hub</label>
              <select id="mOrigin">
                <option value="Kochi">Kochi (Aluva Mother Hub)</option>
                <option value="Thrissur">Thrissur Hub</option>
                <option value="Kozhikode">Kozhikode Hub</option>
              </select>
            </div>
            <div class="form-group">
              <label>Destination Terminal</label>
              <select id="mDestination">
                <option value="Kozhikode">Kozhikode (Valiyangadi Direct)</option>
                <option value="Trivandrum">Trivandrum Hub</option>
                <option value="Thrissur">Thrissur Hub</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Consignee Name</label>
              <input type="text" id="mConsigneeName" value="Malabar Traders" />
            </div>
            <div class="form-group">
              <label>Consignee Phone</label>
              <input type="text" id="mConsigneePhone" value="9876543210" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Cartons Count</label>
              <input type="number" id="mTotalBoxes" value="2" min="1" oninput="calcMerchantQuote()" />
            </div>
            <div class="form-group">
              <label>Dead Weight (kg)</label>
              <input type="number" id="mDeadWeight" value="120" min="1" oninput="calcMerchantQuote()" />
            </div>
          </div>

          <div style="background:#f8fafc; padding:12px; border-radius:8px; margin-bottom:14px; font-size:13px;">
            Estimated Total Freight (incl. GST): <strong id="mQuoteDisplay" style="color:var(--brand);">₹888</strong>
          </div>

          <button class="btn btn-primary" onclick="createMerchantBooking()">Confirm Booking & Deduct Freight</button>
          <div id="mBookingResult"></div>
        </div>
      </div>
    </div>

    <!-- Thermal Labels -->
    <div id="mLabelsContainer" class="card" style="display:none;">
      <div class="card-title">
        <span>Ready-to-Print Thermal Labels</span>
        <button class="btn btn-outline" style="width:auto; padding:6px 14px;" onclick="window.print()">🖨️ Print Labels</button>
      </div>
      <div id="mLabelsOutput" class="labels-grid"></div>
    </div>

    <!-- Merchant Shipments History -->
    <div class="card">
      <div class="card-title"><span>🚚 Consignment History</span></div>
      <div style="overflow-x:auto;">
        <table id="mDocketsTable">
          <thead>
            <tr><th>Docket #</th><th>Destination</th><th>Boxes/Wt</th><th>Status</th><th>Invoice</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ========================================== -->
  <!-- 3. OPERATIONS SCANNER VIEW                 -->
  <!-- ========================================== -->
  <div id="opsDashboardSection" style="display:none; max-width:640px; margin:auto;">
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px;">
      <button id="opsTabP" class="btn btn-dark" onclick="switchOpsTabMode('pickup')">1. Driver Pickup</button>
      <button id="opsTabI" class="btn btn-outline" onclick="switchOpsTabMode('inward')">2. Hub Inward</button>
    </div>

    <div id="opsPickupCard" class="card">
      <div class="card-title">🚚 Driver Box Pickup Scanner</div>
      <div class="form-group">
        <label>Driver ID / Truck</label>
        <input type="text" id="opsDriverId" value="DRV-ALUVA-01" />
      </div>
      <div class="form-group">
        <label>Scan Box Barcode (e.g. C9-123456-B1)</label>
        <input type="text" id="opsPickupBarcode" placeholder="Scan or type barcode..." />
      </div>
      <button class="btn btn-primary" onclick="submitOpsPickup()">Confirm Box Pickup</button>
      <div id="opsPickupResult"></div>
    </div>

    <div id="opsInwardCard" class="card" style="display:none;">
      <div class="card-title">🏢 Hub Inward & Bay Routing</div>
      <div class="form-group">
        <label>Current Hub Facility</label>
        <select id="opsHubLocation">
          <option value="Kochi Central Mother Hub">Kochi Central Mother Hub (Aluva)</option>
          <option value="Thrissur Hub">Thrissur Hub</option>
          <option value="Kozhikode Hub">Kozhikode Hub</option>
        </select>
      </div>
      <div class="form-group">
        <label>Scan Box Barcode for Bay Direction</label>
        <input type="text" id="opsInwardBarcode" placeholder="Scan barcode..." />
      </div>
      <button class="btn btn-dark" onclick="submitOpsInward()">Scan & Direct Bay</button>
      <div id="opsInwardResult"></div>
    </div>
  </div>

  <!-- ========================================== -->
  <!-- 4. MASTER CONTROL TOWER (SUPER-ADMIN) VIEW -->
  <!-- ========================================== -->
  <div id="adminDashboardSection" style="display:none;">
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Gross Freight Revenue</div>
        <div class="stat-value" id="adStatRevenue" style="color:var(--brand);">₹0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Corridor Shipments</div>
        <div class="stat-value" id="adStatTotal">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active in Transit</div>
        <div class="stat-value" id="adStatActive" style="color:var(--warning);">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Registered Merchants</div>
        <div class="stat-value" id="adStatMerchants" style="color:var(--accent);">0</div>
      </div>
    </div>

    <!-- Master Shipments -->
    <div class="card">
      <div class="card-title">
        <span>📦 All Consignments (Telemetry Feed)</span>
        <button class="btn btn-primary" style="width:auto; padding:6px 12px; font-size:12px;" onclick="loadAdminMasterData()">🔄 Refresh Feed</button>
      </div>
      <div style="overflow-x:auto;">
        <table id="adShipmentsTable">
          <thead>
            <tr>
              <th>Docket #</th><th>Date</th><th>Shipper</th><th>Consignee</th>
              <th>Route</th><th>Boxes/Wt</th><th>Freight</th><th>Status</th><th>Invoice</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <!-- Master Merchants -->
    <div class="card">
      <div class="card-title"><span>👥 Registered Merchants & Wallets</span></div>
      <div style="overflow-x:auto;">
        <table id="adMerchantsTable">
          <thead>
            <tr>
              <th>Customer ID</th><th>Company</th><th>Name</th><th>Email</th><th>Phone</th><th>Balance</th><th>Action</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<script>
  let activeRole = 'merchant';
  let currentMerchant = JSON.parse(localStorage.getItem('c9_merchant_session') || 'null');

  function initApp() {
    if (currentMerchant && currentMerchant.customer_id) {
      launchMerchantDashboard();
    } else {
      selectRole('merchant');
    }
  }

  function selectRole(role) {
    activeRole = role;
    document.getElementById('cardMerchant').className = role === 'merchant' ? 'role-card active' : 'role-card';
    document.getElementById('cardOps').className = role === 'ops' ? 'role-card active' : 'role-card';
    document.getElementById('cardAdmin').className = role === 'admin' ? 'role-card active' : 'role-card';

    document.getElementById('merchantAuthBox').style.display = role === 'merchant' ? 'block' : 'none';
    document.getElementById('opsAuthBox').style.display = role === 'ops' ? 'block' : 'none';
    document.getElementById('adminAuthBox').style.display = role === 'admin' ? 'block' : 'none';
  }

  function logoutCurrentSession() {
    localStorage.removeItem('c9_merchant_session');
    currentMerchant = null;
    document.getElementById('sessionHeaderActions').style.display = 'none';
    document.getElementById('merchantDashboardSection').style.display = 'none';
    document.getElementById('opsDashboardSection').style.display = 'none';
    document.getElementById('adminDashboardSection').style.display = 'none';
    document.getElementById('roleSelectorSection').style.display = 'block';
    selectRole('merchant');
  }

  // --- MERCHANT AUTH & LOGIC ---
  function switchMerchantTab(tab) {
    document.getElementById('mTabLogin').className = tab === 'login' ? 'auth-tab-btn active' : 'auth-tab-btn';
    document.getElementById('mTabReg').className = tab === 'reg' ? 'auth-tab-btn active' : 'auth-tab-btn';
    document.getElementById('merchantLoginForm').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('merchantRegisterForm').style.display = tab === 'reg' ? 'block' : 'none';
    document.getElementById('merchantAlert').innerHTML = '';
  }

  async function handleMerchantLogin(e) {
    e.preventDefault();
    const email = document.getElementById('mLoginEmail').value.trim();
    const password = document.getElementById('mLoginPassword').value.trim();

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentMerchant = data.user;
      localStorage.setItem('c9_merchant_session', JSON.stringify(currentMerchant));
      launchMerchantDashboard();
    } else {
      document.getElementById('merchantAlert').innerHTML = '<div class="alert alert-error">' + (data.error || 'Login failed') + '</div>';
    }
  }

  async function handleMerchantRegister(e) {
    e.preventDefault();
    const payload = {
      company: document.getElementById('mRegCompany').value.trim(),
      name: document.getElementById('mRegName').value.trim(),
      phone: document.getElementById('mRegPhone').value.trim(),
      email: document.getElementById('mRegEmail').value.trim(),
      password: document.getElementById('mRegPass').value.trim()
    };

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success && data.user) {
      currentMerchant = data.user;
      localStorage.setItem('c9_merchant_session', JSON.stringify(currentMerchant));
      launchMerchantDashboard();
    } else {
      document.getElementById('merchantAlert').innerHTML = '<div class="alert alert-error">' + (data.error || 'Registration failed') + '</div>';
    }
  }

  async function launchMerchantDashboard() {
    document.getElementById('roleSelectorSection').style.display = 'none';
    document.getElementById('merchantDashboardSection').style.display = 'block';
    document.getElementById('sessionHeaderActions').style.display = 'flex';
    document.getElementById('sessionUserName').innerText = currentMerchant.company || currentMerchant.name;
    document.getElementById('sessionBadge').innerText = currentMerchant.customer_id;
    await refreshMerchantDashboard();
    calcMerchantQuote();
  }

  async function refreshMerchantDashboard() {
    if (!currentMerchant) return;
    const res = await fetch('/api/merchant/dashboard/' + currentMerchant.customer_id);
    const data = await res.json();
    if (!data.success) return;

    document.getElementById('mStatBalance').innerText = '₹' + data.stats.wallet_balance;
    document.getElementById('mStatTotal').innerText = data.stats.total_shipments;
    document.getElementById('mStatActive').innerText = data.stats.active_shipments;
    document.getElementById('mStatDelivered').innerText = data.stats.delivered_shipments;

    const txnBody = document.querySelector('#mTxnTable tbody');
    txnBody.innerHTML = (data.transactions && data.transactions.length) ? data.transactions.map(t => \`
      <tr>
        <td><strong style="font-size:11px;">\${t.type}</strong></td>
        <td>\${t.description}</td>
        <td style="color:\${t.type === 'FREIGHT_DEDUCT' ? '#dc2626' : '#16a34a'}; font-weight:bold;">
          \${t.type === 'FREIGHT_DEDUCT' ? '-' : '+'}₹\${t.amount}
        </td>
      </tr>
    \`).join('') : '<tr><td colspan="3" style="text-align:center; color:#94a3b8;">No transactions yet.</td></tr>';

    const docketBody = document.querySelector('#mDocketsTable tbody');
    docketBody.innerHTML = (data.recent_dockets && data.recent_dockets.length) ? data.recent_dockets.map(d => \`
      <tr>
        <td><strong>\${d.docket_id}</strong><br><small style="color:#64748b;">\${new Date(d.created_at).toLocaleDateString()}</small></td>
        <td>\${d.origin} ➔ \${d.destination}<br><small>\${d.consignee_name}</small></td>
        <td>\${d.total_boxes} bxs (\${d.chargeable_weight_kg} kg)</td>
        <td><span class="status-badge \${d.status === 'DELIVERED' ? 'st-delivered' : d.status === 'PICKED_UP' ? 'st-picked' : 'st-created'}">\${d.status}</span></td>
        <td><a href="/api/invoice/\${d.docket_id}" target="_blank" style="color:var(--brand); font-weight:bold; text-decoration:none;">📄 Invoice</a></td>
      </tr>
    \`).join('') : '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No consignments booked yet.</td></tr>';
  }

  function calcMerchantQuote() {
    const deadWeight = Number(document.getElementById('mDeadWeight').value) || 0;
    const base = Math.max(deadWeight * 5.5, 350);
    const total = Math.round((base + (base * 0.10) + 120) * 1.05);
    document.getElementById('mQuoteDisplay').innerText = '₹' + total;
  }

  async function topupMerchantWallet() {
    const amount = document.getElementById('mTopupAmt').value;
    const res = await fetch('/api/wallet/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: currentMerchant.customer_id, amount })
    });
    const data = await res.json();
    if (data.success) {
      refreshMerchantDashboard();
      document.getElementById('mWalletAlert').innerHTML = '<div class="alert alert-success">Added ₹' + amount + ' successfully!</div>';
    }
  }

  async function createMerchantBooking() {
    const payload = {
      customer_id: currentMerchant.customer_id,
      consignee_name: document.getElementById('mConsigneeName').value,
      consignee_phone: document.getElementById('mConsigneePhone').value,
      consignee_address: 'Main Market Road',
      origin: document.getElementById('mOrigin').value,
      destination: document.getElementById('mDestination').value,
      total_boxes: document.getElementById('mTotalBoxes').value,
      dead_weight_kg: document.getElementById('mDeadWeight').value
    };

    const res = await fetch('/api/indents/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    const out = document.getElementById('mBookingResult');
    const labelsGrid = document.getElementById('mLabelsOutput');
    labelsGrid.innerHTML = '';

    if (data.success) {
      out.innerHTML = \`
        <div class="alert alert-success" style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;">
          <span>🎉 <strong>\${data.docket_id}</strong> Booked (-₹\${data.deducted_amount})</span>
          <a href="/api/invoice/\${data.docket_id}" target="_blank" style="background:#0f172a; color:white; padding:6px 12px; border-radius:6px; font-size:12px; text-decoration:none;">📄 Invoice</a>
        </div>\`;
      document.getElementById('mLabelsContainer').style.display = 'block';
      data.boxes.forEach(b => {
        labelsGrid.innerHTML += \`
          <div class="label-card">
            <strong style="font-size:13px;">CORRIDOR 9</strong><br>
            <small>Box \${b.box_number} of \${payload.total_boxes}</small>
            <img src="\${b.barcodeImage}" />
            <div style="font-weight:bold; font-size:12px;">\${payload.origin} ➔ \${payload.destination}</div>
          </div>\`;
      });
      refreshMerchantDashboard();
    } else {
      out.innerHTML = '<div class="alert alert-error" style="margin-top:12px;">❌ ' + data.error + '</div>';
    }
  }

  // --- OPS AUTH & LOGIC ---
  function verifyOpsPin() {
    if (document.getElementById('opsPinInput').value === '1234') {
      document.getElementById('roleSelectorSection').style.display = 'none';
      document.getElementById('opsDashboardSection').style.display = 'block';
      document.getElementById('sessionHeaderActions').style.display = 'flex';
      document.getElementById('sessionUserName').innerText = 'Ground Staff';
      document.getElementById('sessionBadge').innerText = 'OPERATIONS';
    } else {
      document.getElementById('opsAlert').innerHTML = '<div class="alert alert-error">Invalid Staff PIN.</div>';
    }
  }

  function switchOpsTabMode(tab) {
    document.getElementById('opsTabP').className = tab === 'pickup' ? 'btn btn-dark' : 'btn btn-outline';
    document.getElementById('opsTabI').className = tab === 'inward' ? 'btn btn-dark' : 'btn btn-outline';
    document.getElementById('opsPickupCard').style.display = tab === 'pickup' ? 'block' : 'none';
    document.getElementById('opsInwardCard').style.display = tab === 'inward' ? 'block' : 'none';
  }

  async function submitOpsPickup() {
    const box_barcode = document.getElementById('opsPickupBarcode').value.trim();
    const driver_id = document.getElementById('opsDriverId').value.trim();
    if (!box_barcode) return alert('Enter a box barcode.');

    const res = await fetch('/api/scan/pickup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box_barcode, driver_id, location: 'Merchant Doorstep' })
    });
    const data = await res.json();
    const alertBox = document.getElementById('opsPickupResult');
    if (data.success) {
      let lrMsg = data.all_boxes_picked ? '<br><strong>🎉 All Boxes Scanned! Generated ' + data.lr_number + '</strong>' : '';
      alertBox.innerHTML = '<div class="alert alert-success">✅ ' + data.message + lrMsg + '</div>';
      document.getElementById('opsPickupBarcode').value = '';
    } else {
      alertBox.innerHTML = '<div class="alert alert-error">❌ ' + data.error + '</div>';
    }
  }

  async function submitOpsInward() {
    const box_barcode = document.getElementById('opsInwardBarcode').value.trim();
    const hub_name = document.getElementById('opsHubLocation').value;
    if (!box_barcode) return alert('Enter a box barcode.');

    const res = await fetch('/api/scan/warehouse-inward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box_barcode, warehouse_staff_id: 'STAFF-HUB-01', hub_name })
    });
    const data = await res.json();
    const alertBox = document.getElementById('opsInwardResult');
    if (data.success) {
      alertBox.innerHTML = '<div class="alert alert-success">📦 <strong>' + data.box_barcode + '</strong> Inward Complete.<br><span style="font-size:16px; font-weight:800; color:#1e3a8a;">👉 ' + data.route_instruction + '</span></div>';
      document.getElementById('opsInwardBarcode').value = '';
    } else {
      alertBox.innerHTML = '<div class="alert alert-error">❌ ' + data.error + '</div>';
    }
  }

  // --- ADMIN AUTH & LOGIC ---
  function verifyAdminPin() {
    if (document.getElementById('adminPinInput').value === '9999') {
      document.getElementById('roleSelectorSection').style.display = 'none';
      document.getElementById('adminDashboardSection').style.display = 'block';
      document.getElementById('sessionHeaderActions').style.display = 'flex';
      document.getElementById('sessionUserName').innerText = 'Administrator';
      document.getElementById('sessionBadge').innerText = 'SUPER-ADMIN';
      loadAdminMasterData();
    } else {
      document.getElementById('adminAlert').innerHTML = '<div class="alert alert-error">Invalid Master Admin PIN.</div>';
    }
  }

  async function loadAdminMasterData() {
    const res = await fetch('/api/admin/overview');
    const data = await res.json();
    if (!data.success) return;

    document.getElementById('adStatRevenue').innerText = '₹' + Number(data.summary.total_revenue).toLocaleString('en-IN');
    document.getElementById('adStatTotal').innerText = data.summary.total_shipments;
    document.getElementById('adStatActive').innerText = data.summary.active_shipments;
    document.getElementById('adStatMerchants').innerText = data.summary.total_merchants;

    const sBody = document.querySelector('#adShipmentsTable tbody');
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
        <td><a href="/api/invoice/\${d.docket_id}" target="_blank" style="color:var(--brand); font-weight:700; text-decoration:none;">📄 Invoice</a></td>
      </tr>
    \`).join('') : '<tr><td colspan="9" style="text-align:center; color:#94a3b8;">No consignments booked yet.</td></tr>';

    const mBody = document.querySelector('#adMerchantsTable tbody');
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
    const amt = prompt('Top-up amount in ₹ for ' + cid + ':', '5000');
    if (!amt) return;
    const res = await fetch('/api/wallet/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: cid, amount: Number(amt) })
    });
    const d = await res.json();
    if (d.success) { alert('Added ₹' + amt); loadAdminMasterData(); }
  }

  initApp();
</script>
</body>
</html>`;

// ==========================================
// UNIFIED PAGE ROUTE
// ==========================================
app.get(['/', '/ops', '/admin'], (req, res) => {
  res.send(unifiedPortalHtml);
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
  app.listen(PORT, () => console.log(`🚀 Corridor 9 Unified Engine running on port ${PORT}`));
});
