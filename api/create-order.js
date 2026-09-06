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

function calculateTotal(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error("Cart is empty.");
  }

  return cart.reduce((total, item) => {
    if (item.name === "Custom Keychain") {
      const size = item.size || "Small";

      if (PRICES["Custom Keychain"][size] === undefined) {
        throw new Error("Invalid custom keychain size.");
      }

      return total + PRICES["Custom Keychain"][size];
    }

    if (PRICES[item.name] === undefined) {
      throw new Error("Invalid product.");
    }

    return total + PRICES[item.name];
  }, 0);
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).replace(/[<>]/g, "").trim();
}

function getItemDetails(item) {
  const name = cleanText(item.name);

  if (name === "Custom Keychain") {
    const size = cleanText(item.size, "Small");
    const base = cleanText(item.base, "White");
    const top = cleanText(item.switch1, "White");
    const bottom = cleanText(item.switch2, "White");

    return `${name} | Base: ${base} | Top: ${top} | Bottom: ${bottom} | Size: ${size}`;
  }

  const color = cleanText(item.color, "White");
  return `${name} | Color: ${color}`;
}

function makeOrderDescription(cart, customerName, customerEmail, notes) {
  const items = cart.map((item, index) => {
    return `${index + 1}. ${getItemDetails(item)}`;
  });

  let description =
    `Fidget Forge 3D order for ${cleanText(customerName)} ` +
    `(${cleanText(customerEmail)})\n` +
    items.join("\n");

  if (notes) {
    description += `\nNotes: ${cleanText(notes)}`;
  }

  return description.slice(0, 1200);
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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const cart = req.body?.cart;
    const customerName = cleanText(req.body?.name);
    const customerEmail = cleanText(req.body?.email);
    const notes = cleanText(req.body?.notes);

    if (!customerName || !customerEmail) {
      return res.status(400).json({
        error: "Name and email are required."
      });
    }

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({
        error: "Cart is empty."
      });
    }

    const total = calculateTotal(cart);

    const orderDescription = makeOrderDescription(
      cart,
      customerName,
      customerEmail,
      notes
    );

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
            description: orderDescription
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
