// 9. GENERATE TAX INVOICE HTML
app.get('/api/invoice/:docket_id', (req, res) => {
  const db = getDB();
  const docket = db.getDocket(req.params.docket_id);
  if (!docket) return res.status(404).send('Invoice not found');

  const invoiceHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Tax Invoice - ${docket.docket_id}</title>
    <style>
      body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #333; max-width: 800px; margin: auto; }
      .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 20px; }
      .company-title { font-size: 24px; font-weight: bold; color: #0f172a; }
      .badge { font-size: 14px; background: #e2e8f0; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
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
        <div class="company-title">KERALA DIRECT EXPRESS</div>
        <div style="font-size:12px; color:#666;">NH-66 Express Corridor Linehaul Network</div>
        <div style="font-size:12px; color:#666;">GSTIN: 32AAACK1234M1Z5 | Ernakulam, Kerala</div>
      </div>
      <div style="text-align: right;">
        <span class="badge">ORIGINAL FOR RECIPIENT</span>
        <h3 style="margin: 8px 0 0 0;">TAX INVOICE</h3>
        <div style="font-size: 12px; color: #555;">Inv #: INV-${docket.docket_id.replace('IND-', '')}</div>
        <div style="font-size: 12px; color: #555;">Date: ${new Date(docket.created_at).toLocaleDateString('en-IN')}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div>
        <strong>Billed To (Shipper):</strong><br>
        Name: ${docket.customer_name}<br>
        Customer ID: ${docket.customer_id}<br>
        Contact: ${docket.customer_phone}
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
          <td>PTL Express Freight (${docket.origin} to ${docket.destination})</td>
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
      This is a computer-generated tax invoice issued under reverse charge mechanism / PTL freight rules.
    </div>
  </body>
  </html>
  `;
  res.send(invoiceHtml);
});
