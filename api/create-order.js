const PAYPAL_API = "https://api-m.sandbox.paypal.com";
const SHIPPING_COST = 4.99;

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

function calculateItemsTotal(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error("Cart is empty.");
  }

  return cart.reduce((total, item) => {
    if (!item || !item.name) {
      throw new Error("Invalid cart item.");
    }

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
  if (
    !process.env.PAYPAL_CLIENT_ID ||
    !process.env.PAYPAL_CLIENT_SECRET
  ) {
    throw new Error("PayPal environment variables are missing.");
  }

  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(
    `${PAYPAL_API}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error_description ||
      "PayPal authentication failed."
    );
  }

  return data.access_token;
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
      notes,
      shippingAddress
    } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({
        error: "Name and email are required."
      });
    }

    if (!shippingAddress) {
      return res.status(400).json({
        error: "Shipping address is required."
      });
    }

    const itemsTotal = calculateItemsTotal(cart);
    const shipping = SHIPPING_COST;
    const total = itemsTotal + shipping;

    const accessToken = await getAccessToken();

    const baseUrl =
      process.env.SITE_URL ||
      `https://${req.headers.host}`;

    const response = await fetch(
      `${PAYPAL_API}/v2/checkout/orders`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          intent: "CAPTURE",

     payment_source: {
  paypal: {
    experience_context: {
      brand_name: "Fidget Forge 3D",
      user_action: "PAY_NOW",
      shipping_preference: "SET_PROVIDED_ADDRESS",
      return_url: `${baseUrl}/api/capture-order`,
      cancel_url: `${baseUrl}/?payment=cancelled`
    }
  }
},

          purchase_units: [
            {
              amount: {
                currency_code: "USD",
                value: total.toFixed(2),

                breakdown: {
                  item_total: {
                    currency_code: "USD",
                    value: itemsTotal.toFixed(2)
                  },

                  shipping: {
                    currency_code: "USD",
                    value: shipping.toFixed(2)
                  }
                }
              },

              shipping: {
                name: {
                  full_name: name
                },

                address: {
                  address_line_1:
                    shippingAddress.address_line_1,

                  address_line_2:
                    shippingAddress.address_line_2 ||
                    undefined,

                  admin_area_2:
                    shippingAddress.admin_area_2,

                  admin_area_1:
                    shippingAddress.admin_area_1,

                  postal_code:
                    shippingAddress.postal_code,

                  country_code:
                    shippingAddress.country_code || "US"
                }
              },

              description:
                "Fidget Forge 3D order"
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "PayPal error:",
        data
      );

      throw new Error(
        data.message ||
        "Could not create PayPal order."
      );
    }
const approvalLink = data.links?.find(
  link =>
    link.rel === "approve" ||
    link.rel === "payer-action"
);

if (!approvalLink) {
  console.error(
    "FULL PAYPAL RESPONSE:",
    JSON.stringify(data, null, 2)
  );

  throw new Error(
    "PayPal checkout link was not returned."
  );
}
    /*
      Save the order so capture-order.js
      can retrieve it after PayPal approval.
    */

    if (!global.pendingOrders) {
      global.pendingOrders = {};
    }

    global.pendingOrders[data.id] = {
      cart,
      name,
      email,
      notes,
      shippingAddress,
      itemsTotal,
      shipping,
      total
    };

console.log("FULL PAYPAL RESPONSE:", JSON.stringify(data, null, 2));

const approvalLink = data.links?.find(
  link =>
    link.rel === "payer-action" ||
    link.rel === "approve"
);

if (!approvalLink) {
  throw new Error(
    `PayPal did not return a checkout link. Response: ${JSON.stringify(data)}`
  );
}
  return res.status(200).json({
  id: data.id,
  approvalUrl: approvalLink.href
});

  } catch (error) {

    console.error(
      "Create order error:",
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        "Server error."
    });
  }
};
