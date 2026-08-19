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
app.use(express.json({ limit: '10mb' }));

// ==========================================
// UNIFIED PORTAL SPA WITH LIVE CAMERA SCANNER & SEQUENCE GUARDS
// ==========================================
const unifiedPortalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Corridor 9 | Scheduled PTL Logistics</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/html5-qrcode" type="text/javascript"></script>
  <style>
    :root {
      --primary: #0f172a;
      --brand: #2563eb;
      --brand-hover: #1d4ed8;
      --accent: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --bg: #f8fafc;
      --border: #e2e8f0;
      --radius: 12px;
      --shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.04);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; }
    body { background-color: var(--bg); color: var(--primary); min-height: 100vh; padding: 20px 14px; }
    .container { max-width: 1200px; margin: 0 auto; }

    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-icon { width: 40px; height: 40px; background: linear-gradient(135deg, #0f172a, #2563eb); color: white; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 800; }
    .brand-title { font-size: 19px; font-weight: 800; }

    .role-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin: 30px auto 20px; max-width: 900px; }
    .role-card { background: white; border: 2px solid var(--border); border-radius: var(--radius); padding: 20px; text-align: center; cursor: pointer; transition: all 0.2s; }
    .role-card:hover { border-color: var(--brand); transform: translateY(-2px); }
    .role-card.active { border-color: var(--brand); background: #f0f7ff; }

    .auth-box { max-width: 440px; margin: 0 auto 40px; background: white; padding: 28px; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: var(--shadow); }
    .auth-tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .auth-tab-btn { background: none; border: none; font-size: 13px; font-weight: 700; color: #64748b; cursor: pointer; padding: 6px 12px; }
    .auth-tab-btn.active { color: var(--brand); border-bottom: 2px solid var(--brand); }

    .form-group { margin-bottom: 12px; text-align: left; }
    .form-group label { display: block; font-size: 12px; font-weight: 700; color: #334155; margin-bottom: 4px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    input, select { width: 100%; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 8px; font-size: 13px; }
    input:focus, select:focus { outline: none; border-color: var(--brand); }
    .btn { width: 100%; padding: 11px; border-radius: 8px; font-size: 13px; font-weight: 700; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .btn-primary { background: var(--brand); color: white; }
    .btn-dark { background: var(--primary); color: white; }
    .btn-outline { background: transparent; border: 1.5px solid var(--border); color: #334155; }
    .btn-camera { background: #047857; color: white; margin-bottom: 10px; }
    .btn-logout { background: #fee2e2; color: #991b1b; padding: 6px 12px; font-size: 12px; border-radius: 6px; font-weight: 700; border: none; cursor: pointer; }

    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 20px; }
    .stat-card { background: white; padding: 16px; border-radius: var(--radius); border: 1px solid var(--border); }
    .stat-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; }
    .stat-value { font-size: 24px; font-weight: 800; margin-top: 4px; }
    .dash-grid { display: grid; grid-template-columns: 1.1fr 1.6fr; gap: 20px; }
    @media (max-width: 860px) { .dash-grid { grid-template-columns: 1fr; } }
    .card { background: white; border-radius: var(--radius); padding: 20px; border: 1px solid var(--border); margin-bottom: 20px; box-shadow: var(--shadow); }
    .card-title { font-size: 15px; font-weight: 800; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }

    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
    th { background: #f8fafc; text-align: left; padding: 9px; color: #64748b; font-weight: 700; border-bottom: 1px solid var(--border); }
    td { padding: 10px 9px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    .status-badge { display: inline-block; padding: 3px 7px; border-radius: 4px; font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .st-created { background: #fef3c7; color: #92400e; }
    .st-assigned { background: #e0e7ff; color: #3730a3; }
    .st-picked { background: #e0f2fe; color: #0369a1; }
    .st-transit { background: #f3e8ff; color: #6b21a8; }
    .st-hub { background: #ffedd5; color: #9a3412; }
    .st-ofd { background: #fef9c3; color: #854d0e; }
    .st-delivered { background: #dcfce7; color: #15803d; }

    .timeline-wrapper { padding: 16px 0; }
    .timeline-step { display: flex; gap: 14px; position: relative; padding-bottom: 20px; }
    .timeline-step:last-child { padding-bottom: 0; }
    .timeline-step::before { content: ''; position: absolute; left: 15px; top: 32px; bottom: 0; width: 2px; background: #e2e8f0; }
    .timeline-step:last-child::before { display: none; }
    .timeline-step.done::before { background: var(--accent); }
    .step-icon { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; background: #f1f5f9; color: #94a3b8; z-index: 2; flex-shrink: 0; }
    .timeline-step.done .step-icon { background: var(--accent); color: white; }
    .timeline-step.active .step-icon { background: var(--brand); color: white; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2); }
    .step-content { flex: 1; }
    .step-title { font-size: 13px; font-weight: 800; color: var(--primary); }
    .step-meta { font-size: 11px; color: #64748b; margin-top: 2px; }

    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
    .modal-card { background: white; max-width: 580px; width: 100%; border-radius: var(--radius); padding: 24px; max-height: 90vh; overflow-y: auto; }
    
    .alert { padding: 12px; border-radius: 8px; font-size: 13px; margin-top: 12px; line-height: 1.5; }
    .alert-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
    .alert-warning { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
    .alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

    .sig-pad-box { border: 2px dashed var(--border); border-radius: 8px; background: #fafafa; margin: 10px 0; touch-action: none; }
    #reader { width: 100%; max-width: 400px; margin: 10px auto; display: none; border-radius: 8px; overflow: hidden; border: 2px solid var(--brand); }
  </style>
</head>
<body>

<div class="container">
  <header class="header">
    <div class="brand">
      <div class="brand-icon">C9</div>
      <div>
        <h1 class="brand-title">CORRIDOR 9</h1>
        <div style="font-size:11px; color:#64748b;">Scheduled Express PTL Linehaul Network</div>
      </div>
    </div>
    <div id="sessionHeaderActions" style="display:none; align-items:center; gap:10px;">
      <div style="text-align:right;">
        <strong id="sessionUserName" style="font-size:13px;">User</strong><br>
        <span id="sessionBadge" style="font-size:10px; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700;">Role</span>
      </div>
      <button class="btn-logout" onclick="logoutCurrentSession()">Sign Out</button>
    </div>
  </header>

  <!-- 1. LANDING & ROLE SELECTOR -->
  <div id="roleSelectorSection">
    <div style="text-align: center; margin: 20px 0 10px;">
      <h2 style="font-size: 22px; font-weight: 800;">Logistics Operating System</h2>
      <p style="color: #64748b; font-size: 13px; margin-top: 2px;">Select portal to proceed:</p>
    </div>

    <div class="role-grid">
      <div class="role-card active" id="cardMerchant" onclick="selectRole('merchant')">
        <div style="font-size:28px;">🏢</div>
        <strong style="font-size:15px;">Merchant Client</strong>
        <p style="font-size:11px; color:#64748b; margin-top:4px;">Book, deduct wallet, print barcodes, view live timeline tracking & invoices.</p>
      </div>

      <div class="role-card" id="cardOps" onclick="selectRole('ops')">
        <div style="font-size:28px;">🚚</div>
        <strong style="font-size:15px;">Ground Operations Console</strong>
        <p style="font-size:11px; color:#64748b; margin-top:4px;">Sequence-guarded live scanner, driver allocation & POD signature capture.</p>
      </div>

      <div class="role-card" id="cardAdmin" onclick="selectRole('admin')">
        <div style="font-size:28px;">🛡️</div>
        <strong style="font-size:15px;">Master Control Tower</strong>
        <p style="font-size:11px; color:#64748b; margin-top:4px;">Global freight revenue, active telemetry, and merchant wallet manager.</p>
      </div>
    </div>

    <!-- Merchant Auth -->
    <div id="merchantAuthBox" class="auth-box">
      <div class="auth-tabs">
        <button id="mTabLogin" class="auth-tab-btn active" onclick="switchMerchantTab('login')">Sign In</button>
        <button id="mTabReg" class="auth-tab-btn" onclick="switchMerchantTab('reg')">Register (+₹2,000 Credit)</button>
      </div>
      <form id="merchantLoginForm" onsubmit="handleMerchantLogin(event)">
        <div class="form-group"><label>Business Email</label><input type="email" id="mLoginEmail" required placeholder="merchant@business.com" /></div>
        <div class="form-group"><label>Password</label><input type="password" id="mLoginPassword" required placeholder="••••••••" /></div>
        <button type="submit" class="btn btn-primary" style="margin-top:14px;">Sign In to Dashboard</button>
      </form>
      <form id="merchantRegisterForm" style="display:none;" onsubmit="handleMerchantRegister(event)">
        <div class="form-group"><label>Company Name</label><input type="text" id="mRegCompany" required placeholder="Malabar Traders" /></div>
        <div class="form-group"><label>Contact Person</label><input type="text" id="mRegName" required placeholder="Rahul V." /></div>
        <div class="form-group"><label>Phone</label><input type="tel" id="mRegPhone" required placeholder="9847000000" /></div>
        <div class="form-group"><label>Email</label><input type="email" id="mRegEmail" required placeholder="trader@gmail.com" /></div>
        <div class="form-group"><label>Password</label><input type="password" id="mRegPass" required placeholder="••••••••" /></div>
        <button type="submit" class="btn btn-primary" style="margin-top:14px;">Register Account</button>
      </form>
      <div id="merchantAlert"></div>
    </div>

    <!-- Ops PIN -->
    <div id="opsAuthBox" class="auth-box" style="display:none;">
      <h3 style="font-size:15px; margin-bottom:4px;">🚚 Ground Operations Authentication</h3>
      <p style="font-size:11px; color:#64748b; margin-bottom:12px;">Enter Ground Operations Staff PIN:</p>
      <div class="form-group"><input type="password" id="opsPinInput" placeholder="PIN: 1234" autofocus /></div>
      <button class="btn btn-dark" onclick="verifyOpsPin()">Unlock Operations Workstation</button>
      <div id="opsAlert"></div>
    </div>

    <!-- Admin PIN -->
    <div id="adminAuthBox" class="auth-box" style="display:none;">
      <h3 style="font-size:15px; margin-bottom:4px;">🛡️ Super-Admin Authentication</h3>
      <p style="font-size:11px; color:#64748b; margin-bottom:12px;">Enter Master Administrator PIN:</p>
      <div class="form-group"><input type="password" id="adminPinInput" placeholder="PIN: 9999" autofocus /></div>
      <button class="btn btn-primary" onclick="verifyAdminPin()">Unlock Control Tower</button>
      <div id="adminAlert"></div>
    </div>
  </div>

  <!-- 2. MERCHANT DASHBOARD -->
  <div id="merchantDashboardSection" style="display:none;">
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Prepaid Balance</div><div class="stat-value" id="mStatBalance" style="color:var(--brand);">₹0</div></div>
      <div class="stat-card"><div class="stat-label">Total Bookings</div><div class="stat-value" id="mStatTotal">0</div></div>
      <div class="stat-card"><div class="stat-label">Active in Transit</div><div class="stat-value" id="mStatActive" style="color:var(--warning);">0</div></div>
      <div class="stat-card"><div class="stat-label">Delivered</div><div class="stat-value" id="mStatDelivered" style="color:var(--accent);">0</div></div>
    </div>

    <div class="dash-grid">
      <div>
        <div class="card">
          <div class="card-title"><span>💳 Instant Wallet Top-Up</span></div>
          <div class="form-group"><label>Amount (₹)</label><input type="number" id="mTopupAmt" value="5000" step="500" /></div>
          <button class="btn btn-outline" onclick="topupMerchantWallet()">Recharge Balance</button>
          <div id="mWalletAlert"></div>
        </div>

        <div class="card">
          <div class="card-title"><span>📜 Passbook History</span></div>
          <div style="max-height: 220px; overflow-y: auto;">
            <table id="mTxnTable">
              <thead><tr><th>Type</th><th>Details</th><th>Amount</th></tr></thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title"><span>📦 Create Consignment Indent</span></div>
          <div class="form-row">
            <div class="form-group"><label>Origin Hub</label><select id="mOrigin"><option value="Kochi">Kochi (Aluva Mother Hub)</option><option value="Thrissur">Thrissur Hub</option><option value="Kozhikode">Kozhikode Hub</option></select></div>
            <div class="form-group"><label>Destination Terminal</label><select id="mDestination"><option value="Kozhikode">Kozhikode (Valiyangadi Direct)</option><option value="Trivandrum">Trivandrum Hub</option><option value="Thrissur">Thrissur Hub</option></select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Consignee Name</label><input type="text" id="mConsigneeName" value="Malabar Traders" /></div>
            <div class="form-group"><label>Consignee Phone</label><input type="text" id="mConsigneePhone" value="9876543210" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Cartons</label><input type="number" id="mTotalBoxes" value="2" min="1" oninput="calcMerchantQuote()" /></div>
            <div class="form-group"><label>Dead Wt (kg)</label><input type="number" id="mDeadWeight" value="120" min="1" oninput="calcMerchantQuote()" /></div>
          </div>
          <div style="background:#f8fafc; padding:10px; border-radius:6px; margin-bottom:12px; font-size:12px;">
            Total Freight (incl. GST): <strong id="mQuoteDisplay" style="color:var(--brand);">₹888</strong>
          </div>
          <button class="btn btn-primary" onclick="createMerchantBooking()">Confirm Booking & Print Labels</button>
          <div id="mBookingResult"></div>
        </div>
      </div>
    </div>

    <div id="mLabelsContainer" class="card" style="display:none;">
      <div class="card-title">
        <span>Carton Barcode Labels</span>
        <button class="btn btn-outline" style="width:auto; padding:4px 10px;" onclick="window.print()">Print Labels</button>
      </div>
      <div id="mLabelsOutput" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:12px;"></div>
    </div>

    <div class="card">
      <div class="card-title"><span>🚚 My Consignments</span></div>
      <div style="overflow-x:auto;">
        <table id="mDocketsTable">
          <thead>
            <tr><th>Docket #</th><th>Route</th><th>Current Location</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 3. OPERATIONS SCANNER WORKSTATION -->
  <div id="opsDashboardSection" style="display:none;">
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title"><span>🔄 Ground Operations Workflow Sequence</span></div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:6px;">
        <button class="btn btn-dark" id="btnOpsStage0" onclick="setOpsWorkflowStage('assign')">0. Assign Driver</button>
        <button class="btn btn-outline" id="btnOpsStage1" onclick="setOpsWorkflowStage('pickup')">1. Pickup Scan</button>
        <button class="btn btn-outline" id="btnOpsStage2" onclick="setOpsWorkflowStage('mother_in')">2. Mother Inward</button>
        <button class="btn btn-outline" id="btnOpsStage3" onclick="setOpsWorkflowStage('bay_in')">3. Bay Staging</button>
        <button class="btn btn-outline" id="btnOpsStage4" onclick="setOpsWorkflowStage('linehaul_out')">4. Linehaul Out</button>
        <button class="btn btn-outline" id="btnOpsStage5" onclick="setOpsWorkflowStage('dest_in')">5. Dest Inward</button>
        <button class="btn btn-outline" id="btnOpsStage6" onclick="setOpsWorkflowStage('dest_bay')">6. Dest Bay</button>
        <button class="btn btn-outline" id="btnOpsStage7" onclick="setOpsWorkflowStage('ofd')">7. Out for Deliv</button>
        <button class="btn btn-outline" id="btnOpsStage8" onclick="setOpsWorkflowStage('pod')">8. Deliver & POD</button>
      </div>
    </div>

    <div class="card" id="opsScanCard">
      <div class="card-title" id="opsStageTitle"><span>0. Dispatch Allocation (Assign Driver & Vehicle)</span></div>
      
      <!-- Stage 0: Assign Driver -->
      <div id="stagePanel_assign">
        <div class="form-row">
          <div class="form-group"><label>Docket ID or Box Barcode</label><input type="text" id="assignDocketId" placeholder="e.g. C9-123456" /></div>
          <div class="form-group"><label>Assigned Vehicle Plate</label><input type="text" id="assignVehicle" value="KL-07-CC-4411" /></div>
        </div>
        <div class="form-group"><label>Driver Name & ID</label><input type="text" id="assignDriver" value="Suresh K (DRV-01)" /></div>
        <button class="btn btn-primary" onclick="submitAssignDriver()">Dispatch Driver for Pickup</button>
      </div>

      <!-- Generic Milestone Scanner Panel with CAMERA -->
      <div id="stagePanel_scan" style="display:none;">
        <button class="btn btn-camera" onclick="toggleCameraScanner()">📸 Open Camera Barcode Scanner</button>
        <div id="reader"></div>

        <div class="form-row" style="margin-top:10px;">
          <div class="form-group"><label>Box Barcode OR Docket ID</label><input type="text" id="genericBarcode" placeholder="Scan or type C9-123456 or C9-123456-B1..." autofocus /></div>
          <div class="form-group"><label id="genericMetaLabel">Station / Staging Bay</label><input type="text" id="genericMetaInput" value="Aluva Mother Hub" /></div>
        </div>
        <button class="btn btn-primary" id="genericScanBtn" onclick="submitMilestoneScan()">Submit Scan Milestone</button>
      </div>

      <!-- Stage 8: Delivery POD -->
      <div id="stagePanel_pod" style="display:none;">
        <div class="form-row">
          <div class="form-group"><label>Docket ID or Box Barcode</label><input type="text" id="podDocketId" placeholder="e.g. C9-123456" /></div>
          <div class="form-group"><label>Receiver Name</label><input type="text" id="podReceiverName" value="K. Moideen" /></div>
        </div>
        <div class="form-group"><label>Receiver Phone</label><input type="text" id="podReceiverPhone" value="9876543210" /></div>
        <label>Receiver Digital Signature (Sign below):</label>
        <div class="sig-pad-box"><canvas id="sigCanvas" width="400" height="120" style="width:100%; height:120px; display:block;"></canvas></div>
        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <button class="btn btn-outline" style="width:auto; padding:4px 10px; font-size:11px;" onclick="clearSignature()">Clear Signature</button>
        </div>
        <button class="btn btn-primary" onclick="submitPOD()">Complete Final Delivery & Save POD</button>
      </div>

      <div id="opsActionResult"></div>
    </div>

    <!-- Live Corridor Board -->
    <div class="card">
      <div class="card-title">
        <span>📍 Live Corridor Custody Board</span>
        <button class="btn btn-outline" style="width:auto; padding:4px 10px; font-size:11px;" onclick="loadOpsMasterFeed()">🔄 Refresh</button>
      </div>
      <div style="overflow-x:auto;">
        <table id="opsMasterTable">
          <thead>
            <tr><th>Docket #</th><th>Route</th><th>Current Milestone</th><th>Assigned Driver</th><th>Status</th><th>Timeline</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 4. MASTER CONTROL TOWER (SUPER-ADMIN) -->
  <div id="adminDashboardSection" style="display:none;">
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Gross Revenue</div><div class="stat-value" id="adStatRevenue" style="color:var(--brand);">₹0</div></div>
      <div class="stat-card"><div class="stat-label">Total Shipments</div><div class="stat-value" id="adStatTotal">0</div></div>
      <div class="stat-card"><div class="stat-label">Active Linehaul</div><div class="stat-value" id="adStatActive" style="color:var(--warning);">0</div></div>
      <div class="stat-card"><div class="stat-label">Registered Merchants</div><div class="stat-value" id="adStatMerchants" style="color:var(--accent);">0</div></div>
    </div>

    <div class="card">
      <div class="card-title"><span>📦 Global Consignments</span><button class="btn btn-primary" style="width:auto; padding:6px 12px; font-size:12px;" onclick="loadAdminMasterData()">🔄 Refresh</button></div>
      <div style="overflow-x:auto;">
        <table id="adShipmentsTable">
          <thead>
            <tr><th>Docket #</th><th>Date</th><th>Shipper</th><th>Consignee</th><th>Route</th><th>Boxes</th><th>Freight</th><th>Status</th><th>Track</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span>👥 Merchant Accounts</span></div>
      <div style="overflow-x:auto;">
        <table id="adMerchantsTable">
          <thead>
            <tr><th>Customer ID</th><th>Company</th><th>Name</th><th>Email</th><th>Phone</th><th>Balance</th><th>Action</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- 5. VISUAL TRACKING MODAL -->
<div id="trackingModal" class="modal-overlay">
  <div class="modal-card">
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:12px;">
      <div>
        <h3 style="font-size:16px; font-weight:800;" id="modalDocketTitle">Shipment Tracking</h3>
        <div style="font-size:11px; color:#64748b;" id="modalDocketRoute">Kochi ➔ Kozhikode</div>
      </div>
      <button onclick="closeTrackingModal()" style="background:none; border:none; font-size:18px; font-weight:bold; cursor:pointer;">✕</button>
    </div>
    <div class="timeline-wrapper" id="timelineContainer"></div>
    <div id="podViewBox" style="display:none; margin-top:14px; background:#f8fafc; border:1px solid var(--border); padding:12px; border-radius:8px;">
      <strong style="font-size:12px;">Proof of Delivery (POD)</strong>
      <div id="podMeta" style="font-size:11px; color:#64748b; margin-top:4px;"></div>
      <img id="podSignatureImg" style="max-height:60px; border:1px solid #cbd5e1; border-radius:4px; margin-top:6px; background:white;" />
    </div>
  </div>
</div>

<script>
  let currentMerchant = JSON.parse(localStorage.getItem('c9_merchant_session') || 'null');
  let currentOpsStage = 'assign';
  let html5QrcodeScanner = null;

  function initApp() {
    initCanvas();
    if (currentMerchant && currentMerchant.customer_id) {
      launchMerchantDashboard();
    } else {
      selectRole('merchant');
    }
  }

  function selectRole(role) {
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
    if (html5QrcodeScanner) stopCamera();
    document.getElementById('sessionHeaderActions').style.display = 'none';
    document.getElementById('merchantDashboardSection').style.display = 'none';
    document.getElementById('opsDashboardSection').style.display = 'none';
    document.getElementById('adminDashboardSection').style.display = 'none';
    document.getElementById('roleSelectorSection').style.display = 'block';
    selectRole('merchant');
  }

  function toggleCameraScanner() {
    const readerDiv = document.getElementById('reader');
    if (readerDiv.style.display === 'block') {
      stopCamera();
    } else {
      startCamera();
    }
  }

  function startCamera() {
    document.getElementById('reader').style.display = 'block';
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      (decodedText) => {
        document.getElementById('genericBarcode').value = decodedText;
        stopCamera();
        submitMilestoneScan();
      },
      (errorMessage) => {}
    ).catch(err => {
      alert("Camera permission denied or camera not supported: " + err);
      stopCamera();
    });
  }

  function stopCamera() {
    if (html5QrcodeScanner) {
      html5QrcodeScanner.stop().then(() => {
        document.getElementById('reader').style.display = 'none';
      }).catch(err => {
        document.getElementById('reader').style.display = 'none';
      });
    }
  }

  function switchMerchantTab(tab) {
    document.getElementById('mTabLogin').className = tab === 'login' ? 'auth-tab-btn active' : 'auth-tab-btn';
    document.getElementById('mTabReg').className = tab === 'reg' ? 'auth-tab-btn active' : 'auth-tab-btn';
    document.getElementById('merchantLoginForm').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('merchantRegisterForm').style.display = tab === 'reg' ? 'block' : 'none';
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
        <td><strong style="color:#2563eb;">\${d.current_milestone_text || 'Order Placed'}</strong><br><small style="color:#64748b;">\${d.current_location || d.origin}</small></td>
        <td><span class="status-badge st-\${getStatusClass(d.status)}">\${d.status}</span></td>
        <td>
          <button onclick="openTrackingModal('\${d.docket_id}')" style="background:#2563eb; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; cursor:pointer;">📍 Track</button>
          <a href="/api/invoice/\${d.docket_id}" target="_blank" style="color:#0f172a; margin-left:6px; font-weight:bold; text-decoration:none; font-size:11px;">📄 Invoice</a>
        </td>
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
          <button onclick="openTrackingModal('\${data.docket_id}')" style="background:#0f172a; color:white; border:none; padding:5px 10px; border-radius:6px; font-size:11px; cursor:pointer;">📍 Track</button>
        </div>\`;
      document.getElementById('mLabelsContainer').style.display = 'block';
      data.boxes.forEach(b => {
        labelsGrid.innerHTML += \`
          <div class="label-card" style="border:2px dashed #0f172a; padding:10px; text-align:center; background:white; border-radius:8px;">
            <strong style="font-size:12px;">CORRIDOR 9</strong><br>
            <small>Box \${b.box_number} of \${payload.total_boxes}</small>
            <img src="\${b.barcodeImage}" style="width:100%; height:55px; object-fit:contain; margin:4px 0;" />
            <div style="font-weight:bold; font-size:11px;">\${payload.origin} ➔ \${payload.destination}</div>
          </div>\`;
      });
      refreshMerchantDashboard();
    } else {
      out.innerHTML = '<div class="alert alert-error" style="margin-top:12px;">❌ ' + data.error + '</div>';
    }
  }

  // --- OPS WORKFLOW LOGIC ---
  function verifyOpsPin() {
    if (document.getElementById('opsPinInput').value === '1234') {
      document.getElementById('roleSelectorSection').style.display = 'none';
      document.getElementById('opsDashboardSection').style.display = 'block';
      document.getElementById('sessionHeaderActions').style.display = 'flex';
      document.getElementById('sessionUserName').innerText = 'Ground Staff';
      document.getElementById('sessionBadge').innerText = 'OPERATIONS';
      setOpsWorkflowStage('assign');
      loadOpsMasterFeed();
    } else {
      document.getElementById('opsAlert').innerHTML = '<div class="alert alert-error">Invalid Staff PIN.</div>';
    }
  }

  const STAGE_CONFIG = {
    assign: { num: 0, title: '0. Dispatch Allocation (Assign Driver & Vehicle)', type: 'assign' },
    pickup: { num: 1, title: '1. First-Mile Pickup Scan (Doorstep Handover)', type: 'scan', scan_type: 'PICKUP', meta: 'Merchant Dock', label: 'Pickup Location' },
    mother_in: { num: 2, title: '2. Mother Hub Inward Scan (Kochi Central)', type: 'scan', scan_type: 'MOTHER_HUB_INWARD', meta: 'Kochi Mother Hub Gate', label: 'Hub Facility' },
    bay_in: { num: 3, title: '3. Mother Hub Bay Routing Scan', type: 'scan', scan_type: 'BAY_STAGED', meta: 'BAY-NORTH-KOZHIKODE', label: 'Route Staging Bay' },
    linehaul_out: { num: 4, title: '4. Linehaul Outward Manifest Scan', type: 'scan', scan_type: 'LINEHAUL_OUTWARD', meta: 'LINEHAUL-TRUCK-KL-07-8899', label: 'Linehaul Vehicle' },
    dest_in: { num: 5, title: '5. Destination Hub Inward Scan', type: 'scan', scan_type: 'DEST_HUB_INWARD', meta: 'Kozhikode Valiyangadi Hub', label: 'Destination Hub' },
    dest_bay: { num: 6, title: '6. Destination Bay Sorting Scan', type: 'scan', scan_type: 'DEST_BAY_STAGED', meta: 'DELIVERY-BAY-LOCAL-01', label: 'Delivery Bay' },
    ofd: { num: 7, title: '7. Out For Delivery (Last-Mile Van Load)', type: 'scan', scan_type: 'OUT_FOR_DELIVERY', meta: 'VAN-LASTMILE-04', label: 'Delivery Vehicle' },
    pod: { num: 8, title: '8. Consignee Delivery & Digital POD Signature', type: 'pod' }
  };

  function setOpsWorkflowStage(stageKey) {
    if (html5QrcodeScanner) stopCamera();
    currentOpsStage = stageKey;
    const cfg = STAGE_CONFIG[stageKey];
    for (let i = 0; i <= 8; i++) {
      const keys = Object.keys(STAGE_CONFIG);
      const b = document.getElementById('btnOpsStage' + i);
      if (b) b.className = (keys[i] === stageKey) ? 'btn btn-dark' : 'btn btn-outline';
    }

    document.getElementById('opsStageTitle').innerText = cfg.title;
    document.getElementById('stagePanel_assign').style.display = cfg.type === 'assign' ? 'block' : 'none';
    document.getElementById('stagePanel_scan').style.display = cfg.type === 'scan' ? 'block' : 'none';
    document.getElementById('stagePanel_pod').style.display = cfg.type === 'pod' ? 'block' : 'none';
    document.getElementById('opsActionResult').innerHTML = '';

    if (cfg.type === 'scan') {
      document.getElementById('genericMetaLabel').innerText = cfg.label;
      document.getElementById('genericMetaInput').value = cfg.meta;
      document.getElementById('genericBarcode').focus();
    }
  }

  async function submitAssignDriver() {
    const docket_id = document.getElementById('assignDocketId').value.trim();
    const assigned_vehicle = document.getElementById('assignVehicle').value.trim();
    const assigned_driver = document.getElementById('assignDriver').value.trim();
    if (!docket_id) return alert('Enter Docket ID');

    const res = await fetch('/api/ops/assign-dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docket_id, assigned_vehicle, assigned_driver })
    });
    const data = await res.json();
    const out = document.getElementById('opsActionResult');
    if (data.success) {
      out.innerHTML = '<div class="alert alert-success">✅ ' + data.message + '</div>';
      loadOpsMasterFeed();
    } else {
      out.innerHTML = '<div class="alert alert-warning">⚠️ ' + data.error + '</div>';
    }
  }

  async function submitMilestoneScan() {
    const box_barcode = document.getElementById('genericBarcode').value.trim();
    const location = document.getElementById('genericMetaInput').value.trim();
    const cfg = STAGE_CONFIG[currentOpsStage];
    if (!box_barcode) return alert('Please enter or scan a barcode.');

    const res = await fetch('/api/ops/milestone-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box_barcode, scan_type: cfg.scan_type, location, scanned_by: 'STAFF-OPS-01' })
    });
    const data = await res.json();
    const out = document.getElementById('opsActionResult');
    if (data.success) {
      out.innerHTML = \`<div class="alert alert-success">📦 <strong>\${box_barcode}</strong> ➔ \${data.milestone_text} (Status: \${data.current_status})</div>\`;
      document.getElementById('genericBarcode').value = '';
      loadOpsMasterFeed();
    } else {
      out.innerHTML = \`<div class="alert alert-warning">⚠️ <strong>Sequence Alert:</strong> \${data.error}</div>\`;
    }
  }

  async function loadOpsMasterFeed() {
    const res = await fetch('/api/admin/overview');
    const data = await res.json();
    if (!data.success) return;
    const body = document.querySelector('#opsMasterTable tbody');
    body.innerHTML = data.dockets.length ? data.dockets.map(d => \`
      <tr>
        <td><strong>\${d.docket_id}</strong><br><small>\${d.total_boxes} boxes (\${d.chargeable_weight_kg}kg)</small></td>
        <td>\${d.origin} ➔ \${d.destination}</td>
        <td><strong style="color:#2563eb;">\${d.current_milestone_text || 'Indent Booked'}</strong><br><small style="color:#64748b;">\${d.current_location || d.origin}</small></td>
        <td>\${d.assigned_driver || 'Unassigned'}<br><small style="color:#64748b;">\${d.assigned_vehicle || ''}</small></td>
        <td><span class="status-badge st-\${getStatusClass(d.status)}">\${d.status}</span></td>
        <td><button onclick="openTrackingModal('\${d.docket_id}')" style="background:#0f172a; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:11px; cursor:pointer;">Timeline</button></td>
      </tr>
    \`).join('') : '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No consignments in corridor yet.</td></tr>';
  }

  // --- SIGNATURE CANVAS ---
  let canvas, ctx, isDrawing = false;
  function initCanvas() {
    canvas = document.getElementById('sigCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f172a';

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    canvas.addEventListener('mousedown', (e) => { isDrawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('mousemove', (e) => { if (!isDrawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    window.addEventListener('mouseup', () => isDrawing = false);

    canvas.addEventListener('touchstart', (e) => { isDrawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); });
    canvas.addEventListener('touchmove', (e) => { if (!isDrawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); });
    window.addEventListener('touchend', () => isDrawing = false);
  }

  function clearSignature() {
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function submitPOD() {
    const docket_id = document.getElementById('podDocketId').value.trim();
    const receiver_name = document.getElementById('podReceiverName').value.trim();
    const receiver_phone = document.getElementById('podReceiverPhone').value.trim();
    const signature_data = canvas ? canvas.toDataURL() : '';

    if (!docket_id) return alert('Enter Docket ID');

    const res = await fetch('/api/scan/deliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docket_id, receiver_name, receiver_phone, signature_data })
    });
    const data = await res.json();
    const out = document.getElementById('opsActionResult');
    if (data.success) {
      out.innerHTML = '<div class="alert alert-success">🎉 ' + data.message + ' (Digital POD Verified)</div>';
      loadOpsMasterFeed();
    } else {
      out.innerHTML = '<div class="alert alert-warning">⚠️ ' + data.error + '</div>';
    }
  }

  // --- VISUAL TRACKING MODAL ---
  const ALL_MILESTONES = [
    { key: 'INDENT_CREATED', label: 'Order Booked & Indent Created', icon: '1' },
    { key: 'DISPATCHED_FOR_PICKUP', label: 'Driver & Vehicle Allocated for Pickup', icon: '2' },
    { key: 'PICKED_UP', label: 'First-Mile Pickup Scanned (e-LR Issued)', icon: '3' },
    { key: 'MOTHER_HUB_INWARD', label: 'Mother Hub Inward Gate Scan (Kochi)', icon: '4' },
    { key: 'STAGED_IN_BAY', label: 'Staged in Route Sorting Bay', icon: '5' },
    { key: 'LINEHAUL_TRANSIT', label: 'Loaded on Corridor Linehaul Express', icon: '6' },
    { key: 'DEST_HUB_INWARD', label: 'Arrived at Destination Terminal', icon: '7' },
    { key: 'DEST_BAY_STAGED', label: 'Staged in Delivery Bay', icon: '8' },
    { key: 'OUT_FOR_DELIVERY', label: 'Out for Final-Mile Delivery', icon: '9' },
    { key: 'DELIVERED', label: 'Delivered (Digital POD Recorded)', icon: '✓' }
  ];

  async function openTrackingModal(docketId) {
    const res = await fetch('/api/tracking/' + docketId);
    const data = await res.json();
    if (!data.success) return alert('Shipment tracking not found.');

    const d = data.docket;
    const history = data.history || [];
    const pod = data.pod || null;

    document.getElementById('modalDocketTitle').innerText = 'Consignment #' + d.docket_id;
    document.getElementById('modalDocketRoute').innerText = d.origin + ' ➔ ' + d.destination + ' | ' + d.consignee_name;

    const cont = document.getElementById('timelineContainer');
    const currIdx = ALL_MILESTONES.findIndex(m => m.key === d.status);

    cont.innerHTML = ALL_MILESTONES.map((m, idx) => {
      let isDone = (currIdx !== -1 && idx <= currIdx);
      let isActive = (idx === currIdx);
      let cls = isDone ? (isActive ? 'timeline-step active done' : 'timeline-step done') : 'timeline-step';
      
      const logMatch = history.filter(h => h.status === m.key).pop();
      const meta = logMatch ? (logMatch.location + ' • ' + new Date(logMatch.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : (isDone ? 'Completed' : 'Pending');

      return \`
        <div class="\${cls}">
          <div class="step-icon">\${m.icon}</div>
          <div class="step-content">
            <div class="step-title">\${m.label}</div>
            <div class="step-meta">\${meta}</div>
          </div>
        </div>
      \`;
    }).join('');

    const viewBox = document.getElementById('podViewBox');
    if (pod && pod.signature_data) {
      viewBox.style.display = 'block';
      document.getElementById('podMeta').innerText = 'Received by: ' + pod.receiver_name + ' (' + pod.receiver_phone + ') at ' + new Date(pod.delivered_at).toLocaleString();
      document.getElementById('podSignatureImg').src = pod.signature_data;
    } else {
      viewBox.style.display = 'none';
    }

    document.getElementById('trackingModal').style.display = 'flex';
  }

  function closeTrackingModal() {
    document.getElementById('trackingModal').style.display = 'none';
  }

  // --- ADMIN LOGIC ---
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
        <td><strong>\${d.docket_id}</strong></td>
        <td><small>\${new Date(d.created_at).toLocaleDateString()}</small></td>
        <td><strong>\${d.company || d.customer_name}</strong></td>
        <td>\${d.consignee_name}</td>
        <td>\${d.origin} ➔ \${d.destination}</td>
        <td>\${d.total_boxes} bxs (\${d.chargeable_weight_kg}kg)</td>
        <td><strong style="color:var(--brand);">₹\${d.total_deducted}</strong></td>
        <td><span class="status-badge st-\${getStatusClass(d.status)}">\${d.status}</span></td>
        <td><button onclick="openTrackingModal('\${d.docket_id}')" style="background:#2563eb; color:white; border:none; padding:3px 6px; border-radius:4px; font-size:10px; cursor:pointer;">Timeline</button></td>
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

  function getStatusClass(st) {
    st = (st || '').toLowerCase();
    if (st.includes('deliv')) return 'delivered';
    if (st.includes('ofd') || st.includes('out_for')) return 'ofd';
    if (st.includes('transit') || st.includes('linehaul')) return 'transit';
    if (st.includes('hub') || st.includes('bay')) return 'hub';
    if (st.includes('pick')) return 'picked';
    if (st.includes('dispatch') || st.includes('assign')) return 'assigned';
    return 'created';
  }

  initApp();
</script>
</body>
</html>`;

// --- ROUTING ---
app.get(['/', '/ops', '/admin'], (req, res) => res.send(unifiedPortalHtml));

// ==========================================
// STRICT SEQUENCE GUARDS & APIS
// ==========================================
const MILESTONE_ORDER = [
  'INDENT_CREATED',         // 0
  'DISPATCHED_FOR_PICKUP',  // 1
  'PICKED_UP',              // 2
  'MOTHER_HUB_INWARD',      // 3
  'STAGED_IN_BAY',          // 4
  'LINEHAUL_TRANSIT',       // 5
  'DEST_HUB_INWARD',        // 6
  'DEST_BAY_STAGED',        // 7
  'OUT_FOR_DELIVERY',       // 8
  'DELIVERED'               // 9
];

const MILESTONE_STATUS_MAP = {
  PICKUP: { status: 'PICKED_UP', text: 'First-Mile Pickup Complete (e-LR Issued)' },
  MOTHER_HUB_INWARD: { status: 'MOTHER_HUB_INWARD', text: 'Arrived at Mother Hub (Kochi)' },
  BAY_STAGED: { status: 'STAGED_IN_BAY', text: 'Sorted into Outbound Bay' },
  LINEHAUL_OUTWARD: { status: 'LINEHAUL_TRANSIT', text: 'Loaded on Corridor Linehaul Express' },
  DEST_HUB_INWARD: { status: 'DEST_HUB_INWARD', text: 'Arrived at Destination Terminal' },
  DEST_BAY_STAGED: { status: 'DEST_BAY_STAGED', text: 'Staged in Local Delivery Bay' },
  OUT_FOR_DELIVERY: { status: 'OUT_FOR_DELIVERY', text: 'Out for Final Mile Delivery' }
};

const MILESTONE_LABELS = {
  'INDENT_CREATED': 'Stage 0 (Order Booked)',
  'DISPATCHED_FOR_PICKUP': 'Stage 1 (Driver Assigned for Pickup)',
  'PICKED_UP': 'Stage 2 (First-Mile Picked Up)',
  'MOTHER_HUB_INWARD': 'Stage 3 (Mother Hub Inward Gate)',
  'STAGED_IN_BAY': 'Stage 4 (Mother Hub Outbound Bay)',
  'LINEHAUL_TRANSIT': 'Stage 5 (Linehaul Express Transit)',
  'DEST_HUB_INWARD': 'Stage 6 (Destination Hub Inward)',
  'DEST_BAY_STAGED': 'Stage 7 (Destination Delivery Bay)',
  'OUT_FOR_DELIVERY': 'Stage 8 (Out for Delivery)',
  'DELIVERED': 'Stage 9 (Delivered & POD Completed)'
};

// 1. PUBLIC TRACKING API
app.get('/api/tracking/:docket_id', (req, res) => {
  try {
    const db = getDB();
    let docket_id = req.params.docket_id.trim();
    if (docket_id.includes('-B')) docket_id = docket_id.split('-B')[0];

    const docket = db.getDocket(docket_id);
    if (!docket) return res.status(404).json({ success: false, error: 'Docket not found' });

    const dataStorePath = path.join(__dirname, 'data_store.json');
    let store = { scan_logs: [], pods: {} };
    if (fs.existsSync(dataStorePath)) store = JSON.parse(fs.readFileSync(dataStorePath, 'utf8'));

    const history = (store.scan_logs || []).filter(l => l.docket_id === docket_id);
    const pod = (store.pods || {})[docket_id] || null;

    res.json({ success: true, docket, history, pod });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. OPS STAGE 0: ASSIGN DRIVER (WITH GUARD)
app.post('/api/ops/assign-dispatch', (req, res) => {
  try {
    const db = getDB();
    let { docket_id, assigned_vehicle, assigned_driver } = req.body;
    if (!docket_id) return res.status(400).json({ success: false, error: 'Docket ID required' });
    if (docket_id.includes('-B')) docket_id = docket_id.split('-B')[0];

    const docket = db.getDocket(docket_id);
    if (!docket) return res.status(404).json({ success: false, error: `Docket ${docket_id} not found.` });

    const currentIdx = MILESTONE_ORDER.indexOf(docket.status || 'INDENT_CREATED');
    const targetIdx = MILESTONE_ORDER.indexOf('DISPATCHED_FOR_PICKUP');

    // SEQUENCE GUARD
    if (currentIdx > targetIdx) {
      const currentName = MILESTONE_LABELS[docket.status] || docket.status;
      return res.status(400).json({
        success: false,
        error: `This consignment is already at ${currentName}. You cannot re-assign driver at Step 0. Please check sequence.`
      });
    }

    docket.status = 'DISPATCHED_FOR_PICKUP';
    docket.assigned_vehicle = assigned_vehicle;
    docket.assigned_driver = assigned_driver;
    docket.current_milestone_text = `Driver Assigned (${assigned_driver}) for Pickup`;
    docket.current_location = `Dispatched: ${assigned_vehicle}`;
    db.setDocket(docket_id, docket);

    db.addScanLog({
      docket_id,
      status: 'DISPATCHED_FOR_PICKUP',
      location: `Driver Assigned (${assigned_driver} - ${assigned_vehicle})`,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true, message: `Driver ${assigned_driver} assigned to ${docket_id}.`, docket });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. TOLERANT MILESTONE SCANNER (WITH PREV-STAGE & DUPLICATE PROTECTION)
app.post('/api/ops/milestone-scan', (req, res) => {
  try {
    const db = getDB();
    let { box_barcode, scan_type, location, scanned_by } = req.body;
    box_barcode = (box_barcode || '').trim();

    let docket_id = box_barcode;
    if (docket_id.includes('-B')) docket_id = docket_id.split('-B')[0];

    let docket = db.getDocket(docket_id);
    if (!docket) {
      const box = db.getBox(box_barcode);
      if (box) {
        docket_id = box.docket_id;
        docket = db.getDocket(docket_id);
      }
    }

    if (!docket) {
      return res.status(404).json({ success: false, error: `Invalid Barcode or Docket ID (${box_barcode}). Not found in system.` });
    }

    const milestone = MILESTONE_STATUS_MAP[scan_type];
    if (!milestone) return res.status(400).json({ success: false, error: 'Invalid Scan Type' });

    const currentStatus = docket.status || 'INDENT_CREATED';
    const currentIdx = MILESTONE_ORDER.indexOf(currentStatus);
    const targetIdx = MILESTONE_ORDER.indexOf(milestone.status);

    // GUARD 1: RE-SCANNING AN EARLIER STAGE
    if (targetIdx < currentIdx) {
      const currentName = MILESTONE_LABELS[currentStatus] || currentStatus;
      const targetName = MILESTONE_LABELS[milestone.status] || milestone.status;
      return res.status(400).json({
        success: false,
        error: `Consignment is already at ${currentName}. It cannot be rescanned backwards at ${targetName}. Please check!`
      });
    }

    // GUARD 2: DUPLICATE SCAN AT THE EXACT SAME STAGE
    if (targetIdx === currentIdx) {
      const currentName = MILESTONE_LABELS[currentStatus] || currentStatus;
      return res.status(400).json({
        success: false,
        error: `Item already processed at ${currentName}. Duplicate scan ignored.`
      });
    }

    // PROGRESS UPDATE
    docket.status = milestone.status;
    docket.current_milestone_text = milestone.text;
    docket.current_location = location;

    if (scan_type === 'PICKUP' && !docket.lr_number) {
      docket.lr_number = 'LR-C9-' + Date.now().toString().slice(-6);
      sendLREmail(docket.customer_email, docket, docket.lr_number);
    }
    db.setDocket(docket_id, docket);

    db.addScanLog({
      docket_id,
      box_barcode,
      status: milestone.status,
      scan_type,
      location,
      scanned_by: scanned_by || 'STAFF',
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      box_barcode,
      docket_id,
      current_status: milestone.status,
      milestone_text: milestone.text
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. DELIVERY POD (WITH GUARD)
app.post('/api/scan/deliver', (req, res) => {
  try {
    const db = getDB();
    let { docket_id, receiver_name, receiver_phone, signature_data } = req.body;
    docket_id = (docket_id || '').trim();
    if (docket_id.includes('-B')) docket_id = docket_id.split('-B')[0];

    const docket = db.getDocket(docket_id);
    if (!docket) return res.status(404).json({ success: false, error: `Docket ${docket_id} not found.` });

    if (docket.status === 'DELIVERED') {
      return res.status(400).json({ success: false, error: `Consignment is already DELIVERED and POD is locked.` });
    }

    db.setPod(docket_id, {
      docket_id,
      receiver_name,
      receiver_phone,
      signature_data: signature_data || '',
      delivered_at: new Date().toISOString()
    });

    docket.status = 'DELIVERED';
    docket.current_milestone_text = `Delivered to ${receiver_name}`;
    docket.current_location = 'Consignee Doorstep';
    db.setDocket(docket_id, docket);
    sendDeliveryEmail(docket.customer_email, docket, receiver_name);

    db.addScanLog({
      docket_id,
      status: 'DELIVERED',
      location: `Delivered to ${receiver_name} (${receiver_phone})`,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true, message: `Docket ${docket_id} delivered successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- SUPER-ADMIN OVERVIEW API ---
app.get('/api/admin/overview', (req, res) => {
  try {
    const dataStorePath = path.join(__dirname, 'data_store.json');
    let store = { dockets: {}, users: {} };
    if (fs.existsSync(dataStorePath)) store = JSON.parse(fs.readFileSync(dataStorePath, 'utf8'));

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

// --- AUTHENTICATION APIS ---
app.post('/api/auth/register', (req, res) => {
  try {
    const db = getDB();
    const { name, email, phone, company, password } = req.body;
    if (!email || !password || !name) return res.status(400).json({ success: false, error: 'All fields required.' });

    const existing = db.getUser(email);
    if (existing) return res.status(400).json({ success: false, error: 'Account already exists. Please Sign In.' });

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
      description: 'Welcome Bonus Credit',
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
    const user = db.getUser(email);
    if (!user || user.password !== password) return res.status(401).json({ success: false, error: 'Invalid credentials.' });
    res.json({ success: true, message: 'Login successful.', user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- MERCHANT DASHBOARD DATA ---
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

// --- WALLET TOPUP ---
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
      description: `Recharge ₹${topupAmount}`,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true, message: `₹${topupAmount} added.`, current_balance: customer.wallet_balance, txn_id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- CREATE INDENT ---
app.post('/api/indents/create', async (req, res) => {
  try {
    const db = getDB();
    const { customer_id, consignee_name, consignee_phone, consignee_address, origin, destination, total_boxes, dead_weight_kg, cft_volume } = req.body;
    const customer = db.getCustomer(customer_id);
    if (!customer) return res.status(404).json({ success: false, error: 'Session expired. Please log in again.' });

    const quote = calculateFreightBreakdown(origin, destination, Number(dead_weight_kg), Number(cft_volume || 0));
    if (customer.wallet_balance < quote.totalPayable) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance (Required: ₹${quote.totalPayable}, Available: ₹${customer.wallet_balance}).`,
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
      current_milestone_text: 'Order Booked & Indent Created',
      current_location: `${origin} Terminal Area`,
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

    db.addScanLog({
      docket_id,
      status: 'INDENT_CREATED',
      location: `Booked by ${customer.company || customer.name}`,
      timestamp: new Date().toISOString()
    });

    sendBookingEmail(customer.email, docket);

    res.json({ success: true, message: 'Booking confirmed.', docket_id, deducted_amount: quote.totalPayable, remaining_balance: customer.wallet_balance, quote, boxes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- TAX INVOICE ---
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
        <tr><th>Description (SAC: 996511)</th><th>Boxes</th><th>Chargeable Wt</th><th>Rate/Kg</th><th style="text-align:right;">Amount (₹)</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>Corridor 9 Express Freight (${docket.origin} to ${docket.destination})</td>
          <td>${docket.total_boxes}</td>
          <td>${docket.chargeable_weight_kg} kg</td>
          <td>₹${(docket.freight_amount / docket.chargeable_weight_kg).toFixed(2)}</td>
          <td style="text-align:right;">₹${docket.freight_amount}</td>
        </tr>
        <tr><td colspan="4">Docket Booking & Documentation Fee</td><td style="text-align:right;">₹${docket.docket_fee}</td></tr>
        <tr><td colspan="4">Fuel Surcharge (FSC 10%)</td><td style="text-align:right;">₹${docket.fuel_surcharge}</td></tr>
      </tbody>
    </table>
    <div class="totals">
      <table>
        <tr><td><strong>Taxable Subtotal:</strong></td><td style="text-align:right;">₹${docket.freight_amount + docket.docket_fee + docket.fuel_surcharge}</td></tr>
        <tr><td>CGST (2.5%):</td><td style="text-align:right;">₹${(docket.gst_amount / 2).toFixed(2)}</td></tr>
        <tr><td>SGST (2.5%):</td><td style="text-align:right;">₹${(docket.gst_amount / 2).toFixed(2)}</td></tr>
        <tr style="font-size:16px; font-weight:bold; border-top: 2px solid #0f172a;"><td>Total Paid:</td><td style="text-align:right; color:#2563eb;">₹${docket.total_deducted}</td></tr>
      </table>
    </div>
  </body>
  </html>`;
  res.send(invoiceHtml);
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Corridor 9 Guarded Engine on port ${PORT}`));
});
