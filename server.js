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

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// Direct Route Handlers serving the UI file safely
app.get(['/', '/ops', '/admin'], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

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

// 3. TOLERANT MILESTONE SCANNER (WITH GUARDS)
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

    if (targetIdx < currentIdx) {
      const currentName = MILESTONE_LABELS[currentStatus] || currentStatus;
      const targetName = MILESTONE_LABELS[milestone.status] || milestone.status;
      return res.status(400).json({
        success: false,
        error: `Consignment is already at ${currentName}. It cannot be rescanned backwards at ${targetName}. Please check!`
      });
    }

    if (targetIdx === currentIdx) {
      const currentName = MILESTONE_LABELS[currentStatus] || currentStatus;
      return res.status(400).json({
        success: false,
        error: `Item already processed at ${currentName}. Duplicate scan ignored.`
      });
    }

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
      body { font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; padding: 40px; color: #1e0842; max-width: 800px; margin: auto; }
      .header { display: flex; justify-content: space-between; border-bottom: 2px solid #6d28d9; padding-bottom: 20px; }
      .company-title { font-size: 26px; font-weight: 800; color: #1e0842; letter-spacing: -0.5px; }
      .badge { font-size: 11px; background: #f5f3ff; color: #6d28d9; border: 1px solid #ede9fe; padding: 4px 8px; border-radius: 4px; font-weight: 700; }
      .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 25px 0; font-size: 13px; line-height: 1.6; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
      th { background: #6d28d9; color: white; text-align: left; padding: 10px; }
      td { padding: 10px; border-bottom: 1px solid #ede9fe; }
      .totals { margin-top: 20px; text-align: right; font-size: 14px; }
      .totals table { width: 300px; margin-left: auto; }
      .totals td { padding: 6px; }
      .print-btn { background: #6d28d9; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; margin-bottom: 20px; }
      @media print { .print-btn { display: none; } body { padding: 0; } }
    </style>
  </head>
  <body>
    <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
    <div class="header">
      <div>
        <div class="company-title">CORRIDOR 9 EXPRESS LOGISTICS</div>
        <div style="font-size:12px; color:#6b21a8;">Scheduled Express PTL Linehaul Network (NH-66)</div>
        <div style="font-size:12px; color:#6b21a8;">GSTIN: 32AAACK1234M1Z5 | Central Mother Hub, Kochi</div>
      </div>
      <div style="text-align: right;">
        <span class="badge">ORIGINAL FOR RECIPIENT</span>
        <h3 style="margin: 8px 0 0 0; color:#1e0842;">TAX INVOICE</h3>
        <div style="font-size: 12px; color: #64748b;">Inv #: INV-${docket.docket_id.replace('C9-', '')}</div>
        <div style="font-size: 12px; color: #64748b;">Date: ${new Date(docket.created_at).toLocaleDateString('en-IN')}</div>
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
        <tr style="font-size:16px; font-weight:bold; border-top: 2px solid #6d28d9;"><td>Total Paid:</td><td style="text-align:right; color:#6d28d9;">₹${docket.total_deducted}</td></tr>
      </table>
    </div>
  </body>
  </html>`;
  res.send(invoiceHtml);
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Corridor 9 Express Server running cleanly on port ${PORT}`));
});
