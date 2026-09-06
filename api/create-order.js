export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      cart,
      name,
      email,
      notes,
      shippingAddress
    } = req.body || {};

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({
        error: "Your cart is empty."
      });
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        error: "PayPal credentials are missing."
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
          Authorization:
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

    const authData = await authResponse.json();

    if (!authResponse.ok) {
      console.error("PAYPAL AUTH ERROR:", authData);

      return res.status(500).json({
        error: "PayPal authentication failed."
      });
    }

    const accessToken = authData.access_token;

    // Calculate totals
    const itemTotal = cart.reduce((sum, item) => {
      const price = Number(item.price);

      if (!Number.isFinite(price) || price < 0) {
        throw new Error("Invalid item price.");
      }

      return sum + price;
    }, 0);

    const shipping = cart.length > 0 ? 4.99 : 0;
    const total = itemTotal + shipping;

    const money = value =>
      Number(value).toFixed(2);

    // PayPal items
    const items = cart.map(item => ({
      name: String(
        item.name || "Fidget"
      ).slice(0, 127),

      quantity: "1",

      unit_amount: {
        currency_code: "USD",
        value: money(item.price)
      },

      category: "PHYSICAL_GOODS"
    }));

    // Create PayPal order
    const orderBody = {
      intent: "CAPTURE",

      payment_source: {
        paypal: {
          experience_context: {
            payment_method_preference:
              "IMMEDIATE_PAYMENT_REQUIRED",

            landing_page: "LOGIN",

            shipping_preference:
              "SET_PROVIDED_ADDRESS",

            user_action: "PAY_NOW",

            return_url:
              "https://www.jakeglenn.com/api/paypal-return",

            cancel_url:
              "https://www.jakeglenn.com/?paypal=cancelled"
          }
        }
      },

      purchase_units: [
        {
          reference_id: "FIDGET-FORGE-ORDER",

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
              full_name: String(name || "")
                .slice(0, 300)
            },

            address: {
              address_line_1:
                String(
                  shippingAddress?.address_line_1 || ""
                ).slice(0, 300),

              admin_area_2:
                String(
                  shippingAddress?.admin_area_2 || ""
                ).slice(0, 120),

              admin_area_1:
                String(
                  shippingAddress?.admin_area_1 || ""
                ).slice(0, 300),

              postal_code:
                String(
                  shippingAddress?.postal_code || ""
                ).slice(0, 60),

              country_code: "US"
            }
          }
        }
      ]
    };

    console.log("CREATING PAYPAL ORDER...");
    console.log("TOTAL:", money(total));

    const paypalResponse = await fetch(
      `${paypalBase}/v2/checkout/orders`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",

          Prefer:
            "return=representation",

          "PayPal-Request-Id":
            `fidget-${Date.now()}`
        },

        body: JSON.stringify(orderBody)
      }
    );

    const data = await paypalResponse.json();

    console.log(
      "PAYPAL STATUS:",
      paypalResponse.status
    );

    console.log(
      "PAYPAL FULL RESPONSE:",
      JSON.stringify(data, null, 2)
    );

    if (!paypalResponse.ok) {
      return res.status(paypalResponse.status).json({
        error:
          data?.details?.[0]?.description ||
          data?.message ||
          "PayPal could not create the order."
      });
    }

    // PayPal currently returns rel="payer-action"
    const approvalLink =
      data.links?.find(
        link =>
          link.rel === "payer-action" &&
          link.href
      );

    if (!approvalLink) {
      console.error(
        "NO PAYER-ACTION LINK:",
        JSON.stringify(data, null, 2)
      );

      return res.status(500).json({
        error:
          "PayPal did not return a checkout link.",
        orderId: data.id || null,
        links: data.links || []
      });
    }

    // Send the checkout URL to your website
    return res.status(200).json({
      id: data.id,

      status: data.status,

      approvalUrl: approvalLink.href,

      links: data.links
    });

  } catch (error) {
    console.error(
      "CREATE ORDER ERROR:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Something went wrong."
    });
  }
}
