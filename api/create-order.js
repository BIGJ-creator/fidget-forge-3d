const PAYPAL_API = "https://api-m.sandbox.paypal.com";

const PRICES = {
  "Keyboard Clicker": 5,
  "Infinity Fidget": 6,
  "Flexi Fidget": 7,
  "Custom Keychain": {
    Small: 6,
    Medium: 7,
    Large: 8
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function calculateTotal(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error("Cart is empty.");
  }

  return cart.reduce((total, item) => {
    if (item.name === "Custom Keychain") {
      const size = item.size || "Small";
      const price = PRICES["Custom Keychain"][size];

      if (price === undefined) {
        throw new Error("Invalid custom keychain size.");
      }

      return total + price;
    }

    if (PRICES[item.name] === undefined) {
      throw new Error("Invalid product.");
    }

    return total + PRICES[item.name];
  }, 0);
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

async function sendOrderEmail({
  name,
  email,
  notes,
  cart,
  total
}) {
  const itemsHtml = cart
    .map((item) => {
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
          <p><strong>Color:</strong> ${escapeHtml(item.color || "Not selected")}</p>
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
    })
    .join("");

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:650px;margin:auto">
      <h1>🛒 New Fidget Forge 3D Order</h1>

      <h2>Customer</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>

      <h2>Order</h2>
      ${itemsHtml}

      <h2>Total: $${total.toFixed(2)}</h2>

      <h2>Notes</h2>
      <p>${escapeHtml(notes || "No notes")}</p>
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
      reply_to: email,
      subject: `🛒 New Fidget Forge Order - $${total.toFixed(2)}`,
      html: emailHtml
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Resend error:", data);
    throw new Error(data.message || "Could not send order email.");
  }

  return data;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      cart,
      name,
      email,
      notes
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        error: "Name and email are required."
      });
    }

    const total = calculateTotal(cart);

    const accessToken = await getAccessToken();

    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: total.toFixed(2)
            },
            description: "Fidget Forge 3D order"
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "Could not create PayPal order."
      );
    }

    // Send the order notification to you.
    await sendOrderEmail({
      name,
      email,
      notes,
      cart,
      total
    });

    return res.status(200).json({
      id: data.id,
      links: data.links
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message || "Server error."
    });
  }
};
