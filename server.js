const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB, getDB } = require('./database');
const { calculateFreightBreakdown } = require('./rateEngine');
const { generateBarcodeBase64 } = require('./labelService');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. RATE QUOTE API
app.post('/api/quote', (req, res) => {
  try {
    const { origin, destination, dead_weight_kg, cft_volume } = req.body;
    const quote = calculateFreightBreakdown(origin, destination, dead_weight_kg, cft_volume);
    res.json({ success: true, data: quote });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 2. WALLET TOP-UP
app.post('/api/wallet/topup', async (req, res) => {
  const db = getDB();
  const { customer_id, name, phone, email, amount } = req.body;
  const topupAmount = Number(amount);

  if (topupAmount <= 0) return res.status(400).json({ success: false, error: 'Invalid top-up amount' });

  let customer = db.getCustomer(customer_id);
  if (!customer) {
    customer = {
      customer_id,
      name: name || 'Trader',
      phone: phone || '9999999999',
      email: email || '',
      wallet_balance: 0.0
    };
  }

  customer.wallet_balance += topupAmount;
  db.setCustomer(customer_id, customer);

  const txn_id = 'TXN-TOP-' + Date.now().toString().slice(-6);
  db.addTransaction({
    txn_id,
    customer_id,
    type: 'TOPUP',
    amount: topupAmount,
    balance_after: customer.wallet_balance,
    description: `Recharge of ₹${topupAmount}`,
    timestamp: new Date().toISOString()
  });

  res.json({ success: true, message: `₹${topupAmount} added.`, current_balance: customer.wallet_balance, txn_id });
});

// 3. GET WALLET BALANCE & TRANSACTIONS
app.get('/api/wallet/:customer_id', (req, res) => {
  const db = getDB();
  const customer = db.getCustomer(req.params.customer_id);
  if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });

  const transactions = db.getTransactions(req.params.customer_id).slice(0, 10);
  res.json({ success: true, customer, transactions });
});

// 4. CREATE INDENT & AUTO DEDUCT WALLET
app.post('/api/indents/create', async (req, res) => {
  const db = getDB();
  const {
    customer_id, consignee_name, consignee_phone, consignee_address,
    origin, destination, total_boxes, dead_weight_kg, cft_volume
  } = req.body;

  const customer = db.getCustomer(customer_id);
  if (!customer) {
    return res.status(404).json({ success: false, error: 'Customer not registered. Please top-up wallet first.' });
  }

  const quote = calculateFreightBreakdown(origin, destination, Number(dead_weight_kg), Number(cft_volume || 0));

  if (customer.wallet_balance < quote.totalPayable) {
    return res.status(400).json({
      success: false,
      error: 'INSUFFICIENT_WALLET_BALANCE',
      required_amount: quote.totalPayable,
      current_balance: customer.wallet_balance,
      shortfall: quote.totalPayable - customer.wallet_balance
    });
  }

  customer.wallet_balance -= quote.totalPayable;
  db.setCustomer(customer_id, customer);

  const docket_id = 'IND-' + Date.now().toString().slice(-6);
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

  res.json({
    success: true,
    message: 'Booking confirmed and freight deducted from wallet.',
    docket_id,
    deducted_amount: quote.totalPayable,
    remaining_balance: customer.wallet_balance,
    quote,
    boxes
  });
});

// 5. DRIVER PICKUP SCAN
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
    lr_number = 'LR-KL-' + Date.now().toString().slice(-6);
    const docket = db.getDocket(box.docket_id);
    if (docket) {
      docket.status = 'PICKED_UP';
      docket.lr_number = lr_number;
      db.setDocket(box.docket_id, docket);
    }
    lrGenerated = true;
  }

  res.json({ success: true, message: `Box ${box_barcode} Picked Up.`, all_boxes_picked: lrGenerated, lr_number });
});

// 6. HUB INWARD & ROUTE SEPARATION
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

// 7. LINEHAUL OUTWARD DISPATCH
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

  res.json({ success: true, message: `Box loaded onto truck ${truck_number} bound for ${destination_hub}` });
});

// 8. FINAL DELIVERY
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
  }

  res.json({ success: true, message: `Docket ${docket_id} delivered successfully.` });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Kerala PTL Engine running on port ${PORT}`));
});
