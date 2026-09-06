const PAYPAL_API = "https://api-m.sandbox.paypal.com";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getAccessToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error_description || "PayPal authentication failed."
    );
  }

  return data.access_token;
}

async function sendOrderEmail(order, paypalOrder) {
  const itemsHtml = order.cart.map(item => {
    let details = "";

    if (item.name === "Custom Keychain") {
      details = `
        <ul>
          <li><strong>Size:</strong> ${escapeHtml(item.size)}</li>
          <li><strong>Base:</strong> ${escapeHtml(item.base)}</li>
          <li><strong>Top switch:</strong> ${escapeHtml(item.switch1)}</li>
          <li><strong>Bottom switch:</strong> ${escapeHtml(item.switch2)}</li>
        </ul>
      `;
    } else {
      details = `
        <p>
          <strong>Color:</strong>
          ${escapeHtml(item.color || "Not selected")}
        </p>
      `;
    }

    return `
      <div style="
        padding:12px;
        margin-bottom:10px;
        border:1px solid #ddd;
        border-radius:8px;
      ">
        <strong>${escapeHtml(item.name)}</strong>
        <p>Price: $${Number(item.price).toFixed(2)}</p>
        ${details}
      </div>
    `;
  }).join("");

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:650px;margin:auto">

      <h1>🛒 New Fidget Forge 3D Order</h1>

      <p>
        <strong>PAYMENT CONFIRMED ✅</strong>
      </p>

      <p>
        PayPal Order ID:
        ${escapeHtml(paypalOrder.id)}
      </p>

      <h2>Customer</h2>

      <p>
        <strong>Name:</strong>
        ${escapeHtml(order.name)}
      </p>

      <p>
        <strong>Email:</strong>
        ${escapeHtml(order.email)}
      </p>

      <h2>Order</h2>

      ${itemsHtml}

      <h2>Total: $${order.total.toFixed(2)}</h2>

      <h2>Notes</h2>

      <p>
        ${escapeHtml(order.notes || "No notes")}
      </p>

    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",

    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      from: "Fidget Forge 3D <orders@jakeglenn.com>",
      to: ["jake@jakeglenn.com"],
      reply_to: order.email,
      subject: `🛒 PAID Fidget Forge Order - $${order.total.toFixed(2)}`,
      html: emailHtml
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Resend error:", data);
    throw new Error(
      data.message || "Could not send order email."
    );
  }
}

module.exports = async (req, res) => {
  try {
    const orderId = req.query.token;

    if (!orderId) {
      return res.status(400).send("Missing PayPal order ID.");
    }

    const accessToken = await getAccessToken();

    // Capture the PayPal payment
    const response = await fetch(
      `${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    const paypalOrder = await response.json();

    if (!response.ok) {
      console.error("PayPal capture error:", paypalOrder);

      return res.status(500).send(
        "PayPal payment could not be completed."
      );
    }

    if (paypalOrder.status !== "COMPLETED") {
      return res.status(400).send(
        "Payment was not completed."
      );
    }

    // Get the order information
    const order =
      global.pendingOrders &&
      global.pendingOrders[orderId];

    if (!order) {
      return res.status(500).send(
        "Payment completed, but the order information could not be found."
      );
    }

    // ONLY NOW send the email
    await sendOrderEmail(order, paypalOrder);

    // Remove the temporary order
    delete global.pendingOrders[orderId];

    return res.redirect(
      "/?payment=success"
    );

  } catch (error) {
    console.error(error);

    return res.status(500).send(
      "Something went wrong after payment."
    );
  }
};
