const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-logistics-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
});

async function sendBookingEmail(toEmail, docket) {
  if (!toEmail) return;
  const mailOptions = {
    from: `"Corridor 9 Logistics" <${process.env.EMAIL_USER || 'noreply@corridor9.com'}>`,
    to: toEmail,
    subject: `📦 Booking Confirmed: Indent #${docket.docket_id}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #0f172a;">CORRIDOR 9 LOGISTICS</h2>
        <p>Dear <strong>${docket.customer_name}</strong>,</p>
        <p>Your shipment indent <strong>#${docket.docket_id}</strong> has been booked.</p>
        <table style="width: 100%; font-size: 14px; line-height: 1.6;">
          <tr><td><strong>Origin:</strong></td><td>${docket.origin}</td></tr>
          <tr><td><strong>Destination:</strong></td><td>${docket.destination}</td></tr>
          <tr><td><strong>Consignee:</strong></td><td>${docket.consignee_name} (${docket.consignee_phone})</td></tr>
          <tr><td><strong>Boxes:</strong></td><td>${docket.total_boxes}</td></tr>
          <tr><td><strong>Chargeable Wt:</strong></td><td>${docket.chargeable_weight_kg} kg</td></tr>
          <tr><td><strong>Total Paid:</strong></td><td>₹${docket.total_deducted}</td></tr>
        </table>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✉️ Booking email sent to ${toEmail}`);
  } catch (err) {
    console.error('Email error (Booking):', err.message);
  }
}

async function sendLREmail(toEmail, docket, lrNumber) {
  if (!toEmail) return;
  const mailOptions = {
    from: `"Corridor 9 Logistics" <${process.env.EMAIL_USER || 'noreply@corridor9.com'}>`,
    to: toEmail,
    subject: `🚚 Pickup Complete: Official e-LR #${lrNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #0f172a;">Corridor 9 - Pickup Complete</h2>
        <p>Goods picked up for Indent <strong>#${docket.docket_id}</strong>.</p>
        <div style="background: #e2e8f0; padding: 15px; border-radius: 6px; text-align: center; margin: 15px 0;">
          <strong>e-LR Number: ${lrNumber}</strong>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✉️ LR email sent to ${toEmail}`);
  } catch (err) {
    console.error('Email error (LR):', err.message);
  }
}

async function sendDeliveryEmail(toEmail, docket, receiverName) {
  if (!toEmail) return;
  const mailOptions = {
    from: `"Corridor 9 Logistics" <${process.env.EMAIL_USER || 'noreply@corridor9.com'}>`,
    to: toEmail,
    subject: `✅ Delivered: Shipment #${docket.docket_id}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #0f172a;">Delivery Confirmed</h2>
        <p>Shipment <strong>#${docket.docket_id}</strong> has been delivered to <strong>${receiverName}</strong>.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✉️ Delivery email sent to ${toEmail}`);
  } catch (err) {
    console.error('Email error (Delivery):', err.message);
  }
}

module.exports = { sendBookingEmail, sendLREmail, sendDeliveryEmail };
