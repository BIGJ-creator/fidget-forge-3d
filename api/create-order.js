export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      cart = [],
      name = "",
      email = "",
      notes = "",
      shippingAddress = {}
    } = req.body || {};

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({
        error: "Cart is empty."
      });
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error("Missing PayPal environment variables.");

      return res.status(500).json({
        error: "PayPal is not configured correctly."
      });
    }

    const paypalBase =
      process.env.PAYPAL_ENV === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    // Get PayPal access token
    const authResponse = await fetch(
      `${paypalBase}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          "Authorization":
            "Basic " +
            Buffer.from(
              `${clientId}:${clientSecret}`
            ).toString("base64"),
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      }
    );

    const authText = await authResponse.text();

    if (!authResponse.ok) {
      console.error("PayPal auth error:", authText);

      return res.status(500).json({
        error: "Could not connect to PayPal."
      });
    }

    const authData = JSON.parse(authText);
    const accessToken = authData.access_token;

    // Calculate item total
    const itemTotal = cart.reduce((total, item) => {
      const price = Number(item.price);

      if (!Number.isFinite(price) || price < 0) {
        throw new Error("Invalid item price.");
      }

      return total + price;
    }, 0);

    const shipping = 4.99;
    const total = itemTotal + shipping;

    const money = value => Number(value).toFixed(2);

    console.log("CREATING PAYPAL ORDER...");
    console.log("TOTAL:", money(total));

    // Build PayPal items
    const items = cart.map(item => {
      let description = "";

      if (item.color) {
        description += item.color;
      }

      if (item.size) {
        description +=
          (description ? " | " : "") +
          `Size: ${item.size}`;
      }

      return {
        name: String(item.name || "Fidget").slice(0, 127),
        quantity: "1",
        unit_amount: {
          currency_code: "USD",
          value: money(Number(item.price))
        },
        ...(description
          ? {
              description: description.slice(0, 127)
            }
          : {})
      };
    });

    const paypalOrder = {
      intent: "CAPTURE",

      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: money(total),

            breakdown: {
              item_total: {
                currency_code: "USD",
                value: money(itemTotal)
              },

              shipping: {
                currency_code: "USD",
                value: money(shipping)
              }
            }
          },

          items,

          shipping: {
            name: {
              full_name: String(name).slice(0, 300)
            },

            address: {
              address_line_1:
                String(
                  shippingAddress.address_line_1 || ""
                ).slice(0, 300),

              admin_area_2:
                String(
                  shippingAddress.admin_area_2 || ""
                ).slice(0, 120),

              admin_area_1:
                String(
                  shippingAddress.admin_area_1 || ""
                ).slice(0, 300),

              postal_code:
                String(
                  shippingAddress.postal_code || ""
                ).slice(0, 60),

              country_code: "US"
            }
          }
        }
      ],

      application_context: {
        brand_name: "Fidget Forge 3D",
        user_action: "PAY_NOW",
        return_url:
          "https://www.jakeglenn.com/api/paypal-return",
        cancel_url:
          "https://www.jakeglenn.com/?paypal=cancelled"
      }
    };

    const orderResponse = await fetch(
      `${paypalBase}/v2/checkout/orders`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,

          // Helpful for debugging/retries
          "PayPal-Request-Id":
            `fidget-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}`
        },

        body: JSON.stringify(paypalOrder)
      }
    );

    const responseText = await orderResponse.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      console.error(
        "PayPal returned non-JSON:",
        responseText
      );

      return res.status(500).json({
        error: "PayPal returned an invalid response."
      });
    }

    console.log(
      "PAYPAL STATUS:",
      orderResponse.status
    );

    console.log(
      "PAYPAL FULL RESPONSE:",
      JSON.stringify(data, null, 2)
    );

    if (!orderResponse.ok) {
      console.error(
        "PayPal create-order error:",
        JSON.stringify(data, null, 2)
      );

      return res.status(orderResponse.status).json({
        error:
          data?.details?.[0]?.description ||
          data?.message ||
          "PayPal could not create the order.",
        details: data?.details || []
      });
    }

    /*
      PayPal's newer API commonly returns:

      rel: "payer-action"

      instead of:

      rel: "approve"

      Your frontend currently searches for "approve",
      so we create an alias below.
    */

    const links = Array.isArray(data.links)
      ? [...data.links]
      : [];

    const payerAction = links.find(
      link =>
        link &&
        link.rel === "payer-action" &&
        link.href
    );

    if (payerAction) {
      links.push({
        href: payerAction.href,
        rel: "approve",
        method: "GET"
      });
    }

    if (!payerAction) {
      console.error(
        "No PayPal payer-action link:",
        JSON.stringify(data, null, 2)
      );

      return res.status(500).json({
        error:
          "PayPal approval link was not returned.",
        paypalOrderId: data.id || null
      });
    }

    return res.status(200).json({
      id: data.id,

      status: data.status,

      links,

      // Extra easy-to-use approval URL
      approvalUrl: payerAction.href
    });

  } catch (error) {
    console.error(
      "CREATE ORDER ERROR:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Something went wrong creating the PayPal order."
    });
  }
}
