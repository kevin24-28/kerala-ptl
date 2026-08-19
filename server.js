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

// Helper function to locate files in public/ or root
function getHtmlPath(filename) {
  const inPublic = path.join(__dirname, 'public', filename);
  if (fs.existsSync(inPublic)) return inPublic;
  return path.join(__dirname, filename);
}

// --- DIRECT HTML ROUTES ---
app.get('/', (req, res) => {
  res.sendFile(getHtmlPath('index.html'));
});

app.get('/ops', (req, res) => {
  res.sendFile(getHtmlPath('ops.html'));
});
app.get('/ops.html', (req, res) => {
  res.sendFile(getHtmlPath('ops.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(getHtmlPath('admin.html'));
});
app.get('/admin.html', (req, res) => {
  res.sendFile(getHtmlPath('admin.html'));
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

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

  const invoiceHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Tax Invoice - ${docket.docket_id} | Corridor 9</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1e293b; max-width: 800px; margin: auto; }
      .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 20px; }
      .company-title { font-size: 26px; font-weight: 900; color: #0f172a; letter-spacing: -0.5px; }
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

    <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 11px; color: #666;">
      Issued under reverse charge mechanism / PTL freight carriage rules.
    </div>
  </body>
  </html>
  `;
  res.send(invoiceHtml);
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Corridor 9 Engine running on port ${PORT}`));
});
